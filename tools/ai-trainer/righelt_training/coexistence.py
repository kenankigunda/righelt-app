"""Explicit finite coexistence leases. No model imports or implicit restarts."""
import hashlib
import json
import math
import os
from pathlib import Path
import subprocess
import time
from datetime import datetime
from .manifest_envelope import active_envelope
RESOURCE_SYSTEM=Path(__file__).resolve().parents[4]/'righelt-validation-tools/scripts/resources/system.mjs'


def timestamp(value):
    if not isinstance(value, str):
        raise ValueError('Missing finite lease date')
    result = datetime.fromisoformat(value.replace('Z', '+00:00'))
    if result.tzinfo is None:
        raise ValueError('Lease date requires timezone')
    return result.timestamp()


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def atomic(path, value):
    path = Path(path)
    temporary = path.with_name(path.name + '.coexistence.tmp')
    with temporary.open('w') as stream:
        json.dump(value, stream, allow_nan=False)
        stream.flush()
        os.fsync(stream.fileno())
    os.replace(temporary, path)


def capacity_binding(permit,binding):
    legacy={'maxWorkers':2,'maxMemoryGiB':16,'rampAuthorized':False}
    capacity=permit.get('capacity',legacy)
    if (not isinstance(capacity,dict)or set(capacity)!=set(legacy)
            or type(capacity['maxWorkers'])is not int or capacity['maxWorkers']not in(2,4,8)
            or type(capacity['maxMemoryGiB'])is not int or capacity['maxMemoryGiB']!=16
            or capacity['rampAuthorized']is not(capacity['maxWorkers']>2)
            or binding.get('capacity',legacy)!=capacity
            or(capacity['maxWorkers']>2 and permit.get('mode')!='exclusive')):
        raise ValueError('Explicit exclusive worker capacity mismatch')
    return capacity


class LeaseGuard:
    """A launch binding must be refreshed explicitly for every checkpoint resume."""
    def __init__(self, binding, runtime, directory, *, clock=time.time, monotonic=time.monotonic, execute=subprocess.run):
        self.binding = binding
        self.runtime = runtime
        self.directory = Path(directory).resolve()
        self.clock = clock
        self.monotonic = monotonic
        self.execute = execute
        self.handoff_at = None
        self.handoff_monotonic = None
        self.reason = None
        if binding['runDirectory'] != str(self.directory):
            raise ValueError('Coexistence run directory mismatch')
        if binding['manifestSha256'] != runtime['manifestSha256']:
            raise ValueError('Coexistence manifest mismatch')
        record = active_envelope(self.directory)
        manifest = record['manifest']
        calculated = hashlib.sha256(json.dumps(manifest, sort_keys=True, allow_nan=False).encode()).hexdigest()
        if record['sha256'] != calculated or calculated != runtime['manifestSha256']:
            raise ValueError('Coexistence manifest file checksum mismatch')
        if manifest['sourceRevision'] != binding['sourceRevision']:
            raise ValueError('Coexistence source mismatch')
        checkpoint = binding['checkpoint']
        if str(Path(runtime['parentCheckpoint']).resolve()) != checkpoint['path'] or digest(checkpoint['path']) != checkpoint['sha256']:
            raise ValueError('Explicit recovery checkpoint mismatch')
        self.permit = json.loads(Path(binding['permitPath']).read_text())
        if digest(binding['permitPath']) != binding['permitSha256'] or digest(binding['readerPath']) != binding['readerSha256']:
            raise ValueError('Coexistence launch checksum mismatch')
        if self.permit['subject'] != 'model' or self.permit['model']['sourceRevision'] != binding['sourceRevision']:
            raise ValueError('Explicit model permit required')
        if self.permit['readerSha256'] != binding['readerSha256']:
            raise ValueError('Reader binding mismatch')
        self.end = timestamp(self.permit['expiresAt'])
        self.monotonic_end = self.monotonic() + max(0, self.end - self.clock())
        self.check()

    def check(self):
        """Cheap revocation check between full actual ownership samples."""
        now = self.clock()
        followup = json.loads(Path(self.binding['statePath']).read_text())['followupTraining']
        start, end = timestamp(followup['executionStartedAt']), timestamp(followup['deadline'])
        if not math.isfinite(now) or not start <= now < end or end - start != 86400:
            raise ValueError('Original24-hour allocation changed')
        if followup['executionStartedAt'] != self.binding['executionStartedAt'] or followup['deadline'] != self.binding['deadline']:
            raise ValueError('Original clock binding changed')
        if self.permit['overallDeadline'] != followup['deadline'] or self.runtime['deadlineWall'] > end:
            raise ValueError('Runtime exceeds original deadline')
        grant = followup['currentResourceGrant']
        capacity=capacity_binding(self.permit,self.binding)
        if (grant.get('active') is not True or grant.get('subject') != 'model'
                or grant.get('grantId') != self.permit['grantId']
                or grant.get('permitSha256') != self.binding['permitSha256']
                or grant.get('recordedAt') != self.permit['grantRecordedAt']
                or grant.get('maxWorkers') != capacity['maxWorkers'] or grant.get('maxMemoryGiB') != capacity['maxMemoryGiB']
                or grant.get('rampAuthorized') is not capacity['rampAuthorized']):
            raise ValueError('Model grant withdrawn or changed')
        if grant.get('handoffRequested')is True:
            raise ValueError('Model handoff requested')
        if not timestamp(grant['recordedAt']) <= now < min(timestamp(grant['expiresAt']), self.end):
            raise ValueError('Model lease expired')
        if now >= self.end - 60 or self.monotonic() >= self.monotonic_end - 60:
            raise ValueError('Model lease handoff reserve')

    def observe(self, sample):
        self.check()
        if self.permit.get('mode')=='exclusive':
            return self.observe_exclusive(sample)
        try:
            result = self.execute(['node', self.binding['readerPath'], os.environ['RIGHELT_RESOURCE_RUN'],
                               self.binding['permitPath'], self.binding['permitSha256'], self.binding['statePath'],
                               str(sample.experiment_bytes), str(os.getpid())],
                              env={**os.environ, 'RIGHELT_OBSERVED_AVAILABLE_BYTES': str(sample.available_bytes)},
                                  capture_output=True, text=True, timeout=5, check=True)
            observation = json.loads(result.stdout)
        except (subprocess.SubprocessError, OSError, ValueError) as error:
            raise UnsafeResources('Actual resource observation unavailable') from error
        if observation.get('permitSha256') != self.binding['permitSha256'] or observation.get('subject') != 'model':
            raise ValueError('Actual ownership observation mismatch')
        self.check()
        return observation

    def observe_exclusive(self,sample):
        """Reviewed serialized fallback, a positive lease, never a fake idle flag."""
        deadline=self.monotonic()+5
        def execute(args,**kwargs):
            remaining=deadline-self.monotonic()
            if remaining<=0:raise UnsafeResources('Exclusive observation timed out')
            kwargs['timeout']=min(kwargs.get('timeout',remaining),remaining)
            result=self.execute(args,**kwargs)
            if self.monotonic()>=deadline:raise UnsafeResources('Exclusive observation timed out')
            return result
        if (type(sample.experiment_bytes)is not int or not 0<=sample.experiment_bytes<=16*1024**3
                or sample.memory_pressure not in ('normal','warning')
                or type(sample.available_bytes)is not int or sample.available_bytes<6*1024**3):
            raise UnsafeResources('Unsafe exclusive host or model memory')
        registry=(Path.home()/'.local/state/righelt/resources').resolve(strict=True)
        if (self.permit.get('registryPath')!=str(registry)
                or os.environ.get('RIGHELT_RESOURCE_REGISTRY',str(registry))!=str(registry)):
            raise UnsafeResources('Global exclusive registry binding changed')
        grant=json.loads(Path(self.binding['statePath']).read_text())['followupTraining']['currentResourceGrant']
        if grant.get('mode')!='exclusive':raise UnsafeResources('Exclusive lease required')
        inputs=self.binding.get('exclusiveInputs')
        if not isinstance(inputs,dict)or str(RESOURCE_SYSTEM.resolve())not in inputs or any(digest(path)!=expected for path,expected in inputs.items()):
            raise UnsafeResources('Frozen exclusive dependencies changed')
        if digest(self.binding['permitPath'])!=self.binding['permitSha256']:
            raise UnsafeResources('Exclusive permit changed')
        if Path.cwd().resolve()!=Path(self.permit['model']['cwd']).resolve():
            raise UnsafeResources('Exclusive working directory changed')
        if digest(self.binding['readerPath'])!=self.binding['readerSha256']:
            raise UnsafeResources('Reviewed exclusive reader changed')
        run=os.environ['RIGHELT_RESOURCE_RUN']
        own=json.loads((registry/(run+'.json')).read_text())
        if own['cwd']!=self.permit['model']['cwd']or own['kind']!='heavy'or own['pgid']!=os.getpgrp():
            raise UnsafeResources('Exclusive caller ownership mismatch')
        env={**os.environ,'RIGHELT_RESOURCE_REGISTRY':str(registry)}
        try:
            head=execute(['git','rev-parse','HEAD'],cwd=self.permit['model']['cwd'],capture_output=True,text=True,timeout=2,check=True).stdout.strip()
            dirty=execute(['git','status','--porcelain','--untracked-files=normal'],cwd=self.permit['model']['cwd'],capture_output=True,text=True,timeout=2,check=True).stdout.strip()
            if head!=self.binding['sourceRevision']or dirty:
                raise UnsafeResources('Exclusive source changed')
            outputs=[]
            for _ in range(2):
                result=execute(['node',self.binding['readerPath'],run],env=env,
                    capture_output=True,text=True,timeout=5,check=True)
                outputs.append(json.loads(result.stdout))
        except (OSError,ValueError,subprocess.SubprocessError)as error:
            raise UnsafeResources('Actual exclusive ownership unavailable')from error
        try:
            closing_head=execute(['git','rev-parse','HEAD'],cwd=self.permit['model']['cwd'],capture_output=True,text=True,timeout=2,check=True).stdout.strip()
            closing_dirty=execute(['git','status','--porcelain','--untracked-files=normal'],cwd=self.permit['model']['cwd'],capture_output=True,text=True,timeout=2,check=True).stdout.strip()
            if closing_head!=self.binding['sourceRevision']or closing_dirty:
                raise UnsafeResources('Closing exclusive checkout changed')
        except(OSError,ValueError,subprocess.SubprocessError)as error:
            raise UnsafeResources('Closing exclusive source unavailable')from error
        if any(o.get('exclusiveVerified')is not True or o.get('blockers')!=[] for o in outputs):
            raise UnsafeResources('Foreign work or unknown ownership')
        if any(digest(path)!=expected for path,expected in inputs.items())or digest(self.binding['permitPath'])!=self.binding['permitSha256']or digest(self.binding['readerPath'])!=self.binding['readerSha256']:
            raise UnsafeResources('Closing exclusive source binding changed')
        if self.monotonic()>=deadline:raise UnsafeResources('Exclusive observation timed out')
        self.check()
        capacity=capacity_binding(self.permit,self.binding)
        return {'subject':'model','decision':'continue','coexistenceVerified':True,
                'exclusiveMaxWorkers':capacity['maxWorkers'],'exclusiveMemoryGiB':16,
                'exclusiveRampAuthorized':capacity['rampAuthorized'],
                'exclusiveVerified':True,'rootGrantId':grant['grantId'],
                'permitSha256':self.binding['permitSha256'],
                'observedAt':datetime.now().astimezone().isoformat(),
                'modelBytes':sample.experiment_bytes,'foreignRssBytes':0,'blockers':[]}

    def request_handoff(self, reason):
        if self.handoff_at is None:
            self.handoff_at = self.clock()
            self.handoff_monotonic = self.monotonic()
            self.reason = str(reason)
            atomic(self.directory / 'allocation.json', {'workers': 0, 'memory_gib': 16,
                   'paused': True, 'stop': False, 'reason': 'coexistence-handoff', 'observedAt': self.handoff_at})
            target = self.directory / 'handoff-request.json'
            preserve = False
            if target.exists():
                prior = json.loads(target.read_text())
                if (prior.get('manifestSha256') != self.runtime['manifestSha256']
                        or prior.get('schema') != 1 or prior.get('reason') not in ('validation', 'reporting')
                        or not isinstance(prior.get('id'), str) or not prior['id']):
                    raise ValueError('Conflicting handoff manifest')
                latest = self.directory / 'latest.json'
                consumed = None
                if latest.exists():
                    saved = json.loads(latest.read_text())
                    checkpoint = Path(saved['checkpoint'])
                    if not checkpoint.resolve().is_relative_to((self.directory / 'checkpoints').resolve()) or digest(checkpoint) != saved['sha256']:
                        raise ValueError('Handoff checkpoint identity changed')
                    companion = json.loads(checkpoint.with_suffix('.runner.json').read_text())
                    if companion['checkpointSha256'] != saved['sha256']:
                        raise ValueError('Handoff checkpoint companion changed')
                    consumed = companion['state'].get('lastHandoffId')
                preserve = prior['id'] != consumed
            # A fresh request cannot be mistaken for a consumed previous lease.
            if not preserve:
                atomic(target, {'schema': 1, 'id': 'coexistence:' + self.permit['grantId'],
                                'reason': 'validation', 'manifestSha256': self.runtime['manifestSha256']})
            atomic(self.directory / 'coexistence-handoff.json', {'reason': self.reason,
                   'requestedAt': self.handoff_at, 'cleanupDeadline': min(self.end, self.handoff_at + 60),
                   'manifestSha256': self.runtime['manifestSha256'], 'permitSha256': self.binding['permitSha256']})

    def cleanup_due(self):
        # Existing process-group stop and registry cleanup need up to5seconds.
        # Reserve10seconds, rather than initiating cleanup at the deadline.
        return self.handoff_at is not None and (
            self.clock() >= self.end - 10
            or self.monotonic() >= min(self.monotonic_end - 10, self.handoff_monotonic + 50))


def from_environment(runtime, directory):
    path = os.environ.get('RIGHELT_COEXISTENCE_LAUNCH')
    if path is None:
        return None
    expected = os.environ.get('RIGHELT_COEXISTENCE_LAUNCH_SHA256')
    if not expected or digest(path) != expected:
        raise ValueError('Explicit coexistence launch binding required')
    return LeaseGuard(json.loads(Path(path).read_text()), runtime, directory)
class UnsafeResources(RuntimeError):
    """Actual observation failed. Stop owned compute without a grace interval."""


