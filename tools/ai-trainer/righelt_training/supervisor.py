"""External watchdog: resource policy and hard process-group deadline enforcement."""
import argparse
import fcntl
import hashlib
from dataclasses import asdict
import json
import os
from pathlib import Path
import signal
import sys
import time
import uuid
import psutil

from .budget import Budget
from .checkpoint import atomic_json
from .config import CONFIG,CONFIG_SHA256,ROOT
from .manifest import build_manifest,write_manifest,active_manifest,amend_manifest,manifest_hashes,dependency_inventory
from .allocation import Allocation,validate_continuation
from .processes import start_group,stop_group,install_stop_handlers,register_owned,cleanup_owned
from .resources import AdaptivePolicy
from .telemetry import Telemetry,read_device_memory
from .resume import validate_reset_checkpoint,validate_continuation_checkpoint


def validate_gate_report(report, source_revision, stage):
    if report.get('sourceRevision')!=source_revision or report.get('configSha256')!=CONFIG_SHA256:
        raise ValueError('gate report does not match committed source and configuration')
    for name in ('coreTests','trainerTests','exactReplay','exportParity'):
        gate=report.get('checks',{}).get(name,{})
        if gate.get('passed') is not True or not gate.get('evidence'):
            raise ValueError(f'launch gate missing: {name}')
    if report.get('proofDependencies')!=dependency_inventory():raise ValueError('proof dependency inventory missing or changed')
    parity=report['checks']['exportParity']
    if parity.get('heldoutStates',0)<1000 or parity.get('legalMasksPassed') is not True or parity.get('tacticalParityPassed') is not True:
        raise ValueError('export parity acceptance proof is incomplete')
    if stage=='overnight':
        health=report.get('health',{})
        if (health.get('terminalGames',0)<100 or health.get('distinctRecoverableTrainedCheckpoints',0)<2
            or health.get('finiteNonzeroUpdates') is not True or health.get('unresolvedCorrectnessFailures',1)!=0
            or health.get('trainedExportParityPassed') is not True or health.get('unfinishedAttempts',[])
            or health.get('progressReportPublished') is not True):
            raise ValueError('overnight health or progress-report gate missing')


def validation_boundary(runtime,now=None):
    duration=runtime['deadlineMonotonic']-runtime['startedMonotonic']
    boundary=runtime['startedMonotonic']+duration*5/6
    if 'deadlineWall' in runtime:
        now=time.monotonic() if now is None else now
        boundary=min(boundary,now+(runtime['deadlineWall']-duration/6-time.time()))
    return boundary


def validate_training_window(runtime,now):
    if runtime['command']=='training' and now>=validation_boundary(runtime,now):
        raise ValueError('training window ended; resume health, preparation or arena within the original validation reserve')


def request_validation_handoff(run_dir,runtime,now):
    if runtime.get('command')!='training' or now<validation_boundary(runtime,now):return False
    directory=Path(run_dir);path=directory/'handoff-request.json'
    request_id=f"automatic-validation:{runtime['manifestSha256']}:{runtime['deadlineMonotonic']}"
    if path.exists():
        pending=json.loads(path.read_text())
        if pending.get('id')==request_id:return False
        # Preserve an outstanding manual request. A consumed manual request may
        # remain on disk after an earlier checkpoint/resume; it cannot disable
        # the later automatic validation boundary.
        latest=directory/'latest.json'
        consumed=None
        if latest.exists():
            checkpoint=Path(json.loads(latest.read_text())['checkpoint'])
            consumed=json.loads(checkpoint.with_suffix('.runner.json').read_text())['state'].get('lastHandoffId')
        if pending.get('id')!=consumed:return False
    atomic_json(path,{'schema':1,'id':request_id,'reason':'validation',
                     'manifestSha256':runtime['manifestSha256']})
    return True


def supervise(process,budget,policy,telemetry,run_dir,*,clock=time.monotonic,sleep=time.sleep,sample_seconds=None,runtime=None):
    sample_seconds=sample_seconds or CONFIG['resources']['sampleSeconds']
    next_sample=clock();paused_since=None
    events=Path(run_dir)/'resource-events.jsonl'
    try:
        while process.poll() is None:
            now=clock()
            if budget.remaining(now)<=0:
                stop_group(process)
                return 'budget-expired'
            operation=Path(run_dir)/'operation-status.json'
            if operation.exists():
                state=json.loads(operation.read_text())
                if state.get('pid')==process.pid and (state.get('status') in ('timed-out','monitor-failed') or (state.get('status')=='running' and now>=state['deadlineMonotonic'])):
                    stop_group(process);return 'operation-timeout'
            if runtime is not None:request_validation_handoff(run_dir,runtime,now)
            if runtime is not None and runtime.get('command')=='training' and now>=validation_boundary(runtime,now)+60:
                stop_group(process)
                return 'validation-handoff-timeout'
            if now>=next_sample:
                try:
                    sample=telemetry.sample()
                except (RuntimeError, OSError) as error:
                    with events.open('a') as f:
                        f.write(json.dumps({'event':'telemetry-failed','error':str(error)})+'\n')
                    stop_group(process)
                    return 'telemetry-failed'
                allocation=policy.decide(sample)
                atomic_json(Path(run_dir)/'allocation.json',{**allocation.record(),'observedAt':sample.now})
                with events.open('a') as f:
                    f.write(json.dumps({'sample':asdict(sample),'allocation':allocation.record()},allow_nan=False)+'\n');f.flush()
                if allocation.stop:
                    stop_group(process)
                    return allocation.reason
                if allocation.paused:
                    if paused_since is None:
                        paused_since=now
                        # The runner checkpoints between bounded operations. A blocked runner
                        # cannot defeat this external watchdog or extend the run budget.
                        try:
                            if read_device_memory(Path(run_dir)/'device-memory.json',process.pid)[1]:
                                os.kill(process.pid,signal.SIGUSR1)
                        except ProcessLookupError:pass
                    elif now-paused_since>=sample_seconds:
                        stop_group(process)
                        return 'resource-pressure-stop'
                else:paused_since=None
                next_sample=now+sample_seconds
            sleep(min(.25,budget.remaining(clock())))
        return 'completed' if process.returncode==0 else 'runner-failed'
    finally:
        stop_group(process)


def latest_recovery(run_dir,runtime):
    from .checkpoint import inspect_checkpoint
    directory=Path(run_dir);latest=json.loads((directory/'latest.json').read_text())
    path=Path(latest['checkpoint']).resolve()
    if not path.is_relative_to((directory/'checkpoints').resolve()):raise ValueError('recovery checkpoint outside run')
    if hashlib.sha256(path.read_bytes()).hexdigest()!=latest['sha256']:raise ValueError('latest recovery checkpoint changed')
    metadata=json.loads(path.with_suffix('.json').read_text())
    if metadata['manifestSha256'] not in manifest_hashes(directory):raise ValueError('recovery checkpoint lineage unauthorized')
    data=inspect_checkpoint(path,manifest_sha256=metadata['manifestSha256'],require_recovery=True)
    if latest.get('updates')!=data['updates']:raise ValueError('latest recovery update count changed')
    runtime.update(parentCheckpoint=str(path),parentCheckpointManifestSha256=metadata['manifestSha256'])
    atomic_json(directory/'runtime.json',runtime)
    return path,data['recovery']['state']


def wait_for_resources(budget,policy,telemetry,run_dir,runtime,*,clock=time.monotonic,sleep=time.sleep):
    """The caller has verified cleanup; the original allocation remains open."""
    while budget.remaining(clock())>0:
        now=clock()
        if runtime['command']=='training' and now>=validation_boundary(runtime,now):return 'validation-boundary'
        try:sample=telemetry.sample()
        except (RuntimeError,OSError):return 'telemetry-failed'
        assigned=policy.decide(sample)
        atomic_json(Path(run_dir)/'allocation.json',{**assigned.record(),'observedAt':sample.now})
        with (Path(run_dir)/'resource-events.jsonl').open('a') as stream:
            stream.write(json.dumps({'event':'charged-resource-wait','sample':asdict(sample),'allocation':assigned.record()})+'\n')
        if assigned.stop:return assigned.reason
        if not assigned.paused:return 'resources-ready'
        delay=min(CONFIG['resources']['sampleSeconds'],budget.remaining(clock()))
        if runtime['command']=='training':delay=min(delay,max(0,validation_boundary(runtime,clock())-clock()))
        sleep(delay)
    return 'budget-expired'


def run_phase(argv,env,log,budget,runtime,run_dir,artifact_root,activity_file,*,clock=time.monotonic,sleep=time.sleep):
    """Retry only resource stops, never repair/correctness failures or new budgets."""
    directory=Path(run_dir);policy=AdaptivePolicy();process=None;recovering=False
    while True:
        # Initial launch and every restart wait on host resources before loading
        # MPS. No GPU heartbeat is required while no owned compute exists.
        reason=wait_for_resources(budget,policy,Telemetry(artifact_root,activity_file),directory,runtime,clock=clock,sleep=sleep)
        if reason not in ('resources-ready','validation-boundary'):return reason,process
        if runtime['command']=='training' and (recovering or reason=='validation-boundary'):
            path,state=latest_recovery(directory,runtime)
            if budget.remaining(clock())<=0:return 'budget-expired',process
            if clock()>=validation_boundary(runtime,clock()):
                atomic_json(directory/'runner-result.json',{'schema':1,'status':'stopped','reason':'validation-handoff',
                    'origin':'supervisor-resource-wait','checkpoint':str(path),'state':state,'unfinishedWork':recovering,
                    'trainingHealthOnly':True,'productionGatesPassed':False})
                return 'completed',process
            argv=list(argv)
            if '--resume' in argv:argv[argv.index('--resume')+1]=str(path)
            else:argv+=['--resume',str(path)]
        validate_training_window(runtime,clock())
        atomic_json(directory/'allocation.json',{'workers':0,'memory_gib':CONFIG['resources']['minMemoryGiB'],
                    'paused':True,'stop':False,'reason':'device-memory-unknown','observedAt':time.time()})
        process=start_group(['/usr/bin/nice','-n','10',*argv],cwd=ROOT,env=env,stdout=log,stderr=log)
        try:
            register_owned(directory,process)
            reason=supervise(process,budget,policy,Telemetry(artifact_root,activity_file,directory/'device-memory.json',process.pid),directory,
                             runtime=runtime,clock=clock,sleep=sleep)
        finally:
            stop_group(process)
            cleanup_owned(directory)
        if reason!='resource-pressure-stop':return reason,process
        with (directory/'resource-events.jsonl').open('a') as stream:
            stream.write(json.dumps({'event':'resource-compute-stopped','pid':process.pid,'reason':reason,'cleanupVerified':True})+'\n')
        if runtime['command']!='training':
            with (directory/'resource-events.jsonl').open('a') as stream:
                stream.write(json.dumps({'event':'engineering-review-stop','phase':runtime['command'],
                    'reason':'phase-resource-restart-not-supported','cleanupVerified':True})+'\n')
            return 'resource-restart-review-required',process
        recovering=True


def claim_stage(artifact_root, stage, run_directory):
    path=Path(artifact_root)/'budget-ledger.json'
    ledger=json.loads(path.read_text()) if path.exists() else {'schema':1,'stages':{}}
    location=str(Path(run_directory).resolve())
    prior=ledger['stages'].get(stage)
    if prior is not None and prior!=location:
        raise ValueError(f'{stage} stage already claimed; resume its original run instead of resetting budget')
    ledger['stages'][stage]=location
    atomic_json(path,ledger)


def arena_arguments(args,artifact_root):
    prepare=getattr(args,'prepare_arena',False)
    if prepare and (args.arena_plan or getattr(args,'health',False)):raise ValueError('preparation is exclusive with arena and health')
    if not args.arena_plan and not prepare:
        if args.candidate_checkpoint or args.opponent_checkpoint:raise ValueError('arena checkpoint paths require a frozen plan')
        return None
    if not args.run_dir.exists() or not args.resume:raise ValueError('arena reuses an existing supervised run and original deadline')
    if not args.candidate_checkpoint or not args.opponent_checkpoint:raise ValueError('both frozen arena checkpoints required')
    if args.arena_plan and not args.arena_plan.resolve().is_relative_to(args.run_dir.resolve()):raise ValueError('arena plan must belong to this run')
    for path in (args.candidate_checkpoint,args.opponent_checkpoint):
        if not path.resolve().is_relative_to(artifact_root.resolve()):raise ValueError('arena checkpoints must remain in experiment archive')
    if prepare:return None
    from .arena import read_frozen_plan
    _,digest=read_frozen_plan(args.arena_plan)
    return digest


def parity_arguments(args,artifact_root):
    if getattr(args,'canary',False):
        if not args.parity_corpus or not args.parity_corpus.resolve().is_relative_to(artifact_root.resolve()):raise ValueError('canary requires archived parity corpus')
        return hashlib.sha256(args.parity_corpus.read_bytes()).hexdigest()
    if not args.export_parity:
        if args.parity_corpus and not getattr(args,'canary',False):raise ValueError('parity corpus requires export-parity phase')
        return None
    if args.arena_plan or args.prepare_arena or args.health:raise ValueError('export parity is an exclusive phase')
    if not args.resume or not args.run_dir.exists():raise ValueError('export parity requires original run and trained checkpoint resume')
    if not args.parity_corpus or not args.parity_corpus.resolve().is_relative_to(artifact_root.resolve()):raise ValueError('parity corpus must be under experiment archive')
    return hashlib.sha256(args.parity_corpus.read_bytes()).hexdigest()


def validate_overnight_checkpoint(checkpoint,gate):
    if checkpoint is None:raise ValueError('overnight requires audited initial checkpoint')
    checkpoint=Path(checkpoint).resolve();directory=checkpoint.parent.parent
    manifest=active_manifest(directory)
    health=json.loads((directory/'health-report.json').read_text())
    latest=json.loads((directory/'latest.json').read_text())
    if manifest['manifest']['stage']!='initial' or health.get('healthy') is not True or gate.get('health')!={**health,'progressReportPublished':True}:
        raise ValueError('overnight health must bind to its initial run')
    if str(checkpoint)!=latest['checkpoint'] or hashlib.sha256(checkpoint.read_bytes()).hexdigest()!=latest['sha256']:
        raise ValueError('overnight checkpoint differs from audited latest')
    if not any(row['sha256']==latest['sha256'] for row in health['checkpoints']):raise ValueError('checkpoint not audited')
    return latest


def record_attempt(directory,event):
    with (Path(directory)/'supervisor-attempts.jsonl').open('a') as stream:
        stream.write(json.dumps({**event,'observedAt':time.time()},allow_nan=False)+'\n')
        stream.flush();os.fsync(stream.fileno())


def main():
    install_stop_handlers()
    parser=argparse.ArgumentParser()
    parser.add_argument('--run-dir',type=Path,required=True)
    parser.add_argument('--activity-file',type=Path,required=True)
    parser.add_argument('--gate-report',type=Path,required=True)
    parser.add_argument('--stage',choices=('initial','overnight'),required=True)
    parser.add_argument('--seed',type=int,required=True)
    parser.add_argument('--resume',type=Path)
    parser.add_argument('--continuation',type=Path)
    parser.add_argument('--diagnostic',action='store_true')
    parser.add_argument('--arena-plan',type=Path)
    parser.add_argument('--health',action='store_true')
    parser.add_argument('--canary',action='store_true')
    parser.add_argument('--prepare-arena',action='store_true')
    parser.add_argument('--export-parity',action='store_true')
    parser.add_argument('--parity-corpus',type=Path)
    parser.add_argument('--candidate-checkpoint',type=Path)
    parser.add_argument('--opponent-checkpoint',type=Path)
    args=parser.parse_args()
    if args.diagnostic and not args.prepare_arena:parser.error('diagnostic flag requires preparation')
    artifact_root=ROOT/'.ai-runs'
    parity_digest=parity_arguments(args,artifact_root)
    arena_digest=arena_arguments(args,artifact_root)
    if args.health and (arena_digest or not args.run_dir.exists() or not args.resume):
        raise ValueError('health requires an existing supervised allocation and cannot run alongside arena')
    if not args.run_dir.resolve().is_relative_to(artifact_root.resolve()):
        raise ValueError('run directories must be under .ai-runs for aggregate artifact accounting')
    if args.resume and not args.resume.resolve().is_relative_to(artifact_root.resolve()):
        raise ValueError('resume checkpoints must remain in the aggregate experiment archive')
    artifact_root.mkdir(parents=True,exist_ok=True)
    # Kernel lock survives no crashed process, prevents competing supervisors.
    lock=(artifact_root/'supervisor.lock').open('a+')
    fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
    manifest=build_manifest(args.seed,args.stage)
    continuation=json.loads(args.continuation.read_text()) if args.continuation else None
    if continuation:
        if args.stage!=('initial' if continuation['phase']=='six-hour' else 'overnight'):
            raise ValueError('continuation stage mismatch')
        manifest.update(continuation=continuation,seconds=continuation['budgetSeconds'])
    # Continuations prove fresh predecessor health through their bound contract;
    # legacy stage launches keep their original health requirements.
    validate_gate_report(json.loads(args.gate_report.read_text()),manifest['sourceRevision'],'initial' if continuation else args.stage)
    phase='canary' if args.canary else 'export-parity' if args.export_parity else 'prepare-arena' if args.prepare_arena else 'health' if args.health else 'arena' if arena_digest else 'training'
    if args.canary and (args.resume or args.export_parity or args.prepare_arena or args.health or args.arena_plan):raise ValueError('canary is exclusive')
    allocation=Allocation(artifact_root,args.run_dir)
    if continuation:allocation.create_continuation(continuation)
    else:allocation.create(args.stage)
    validate_continuation(args.run_dir,manifest)
    allocation.recover_abandoned(cleanup_owned)
    if continuation:
        if not args.resume:raise ValueError('continuation requires trained recovery checkpoint')
        validate_continuation_checkpoint(args.resume,json.loads(args.gate_report.read_text()),continuation,args.run_dir)
    elif args.stage=='overnight' and not (args.run_dir/'latest.json').exists():
        gate=json.loads(args.gate_report.read_text())
        creation=allocation.accounting()[0]
        if creation.get('resetFrom'):
            # Canary creates the manifest but never supplies trained state.
            checkpoint=args.resume or (gate.get('resumeCheckpoint',{}).get('checkpoint') if phase=='canary' else None)
            validate_reset_checkpoint(checkpoint,gate,creation)
        elif phase!='canary':
            validate_overnight_checkpoint(args.resume,gate)
    runtime_path=args.run_dir/'runtime.json'
    manifest_path=args.run_dir/'manifest.json'
    if manifest_path.exists():
        original=active_manifest(args.run_dir)
        if any(original['manifest'][key]!=manifest[key] for key in ('sourceRevision','configSha256','seed','stage','dependencies','lockHashes')):
            original=amend_manifest(args.run_dir,manifest,json.loads(args.gate_report.read_text()).get('repair',{}))
        digest=original['sha256']
        runtime=json.loads(runtime_path.read_text()) if runtime_path.exists() else {}
        if phase=='training' and (args.run_dir/'latest.json').exists() and not args.resume:raise ValueError('trained state requires explicit verified checkpoint resume')
    else:
        args.run_dir.mkdir(parents=True,exist_ok=True)
        digest=write_manifest(manifest_path,manifest);runtime={}
    interval,remaining,charged=allocation.begin(phase)
    reason='setup-failed'
    try:
        now=time.monotonic();wall=time.time()
        total=allocation.accounting()[0]['seconds']
        budget=Budget(now-charged,total,wall+remaining)
        if phase=='canary':budget=Budget(now,min(600,remaining),wall+min(600,remaining))
        started=now-charged
        runtime.update(schema=2,startedMonotonic=started,deadlineMonotonic=now+remaining,startedWall=wall-charged,
                       deadlineWall=wall+remaining,manifestSha256=digest,stage=args.stage,seed=args.seed,
                       bootTime=psutil.boot_time(),elapsedBefore=charged,allocationInterval=interval['id'],allocationId=allocation.accounting()[0]['id'])
        if phase=='canary':runtime.update(deadlineMonotonic=now+min(600,remaining),deadlineWall=wall+min(600,remaining))
        if args.resume:
            metadata=json.loads(args.resume.with_suffix('.json').read_text())
            checkpoint_directory=args.resume.resolve().parent.parent
            if metadata['manifestSha256'] not in manifest_hashes(checkpoint_directory):raise ValueError('checkpoint lineage not authorized')
            if metadata['configSha256']!=CONFIG_SHA256:raise ValueError('resume checkpoint configuration changed')
            runtime['parentCheckpointManifestSha256']=metadata['manifestSha256']
            runtime['parentCheckpoint']=str(args.resume.resolve())
        runtime['supervisorPid']=os.getpid()
        runtime['command']=phase
        validate_training_window(runtime,time.monotonic())
        if parity_digest:
            runtime['parityCorpusSha256']=parity_digest
            runtime['parityCorpusPath']=str(args.parity_corpus.resolve())
        runtime['supervisorAttempt']=uuid.uuid4().hex
        if arena_digest:runtime['arenaPlanSha256']=arena_digest
        else:runtime.pop('arenaPlanSha256',None)
        atomic_json(runtime_path,runtime)
        atomic_json(args.run_dir/'allocation.json',{'workers':CONFIG['resources']['minWorkers'],
                    'memory_gib':CONFIG['resources']['minMemoryGiB'],'paused':False,'stop':False,
                    'reason':'initial-conservative','observedAt':time.time()})
        if args.canary:
            argv=[sys.executable,'-m','righelt_training.canary','--run-dir',str(args.run_dir.resolve()),'--corpus',str(args.parity_corpus.resolve())]
        elif args.export_parity:
            argv=[sys.executable,'-m','righelt_training.export_parity','--run-dir',str(args.run_dir.resolve()),
                  '--checkpoint',str(args.resume.resolve()),'--corpus',str(args.parity_corpus.resolve()),
                  '--gate-report',str(args.gate_report.resolve())]
        elif args.prepare_arena:
            argv=[sys.executable,'-m','righelt_training.prepare_arena','--run-dir',str(args.run_dir.resolve()),
                  '--candidate-checkpoint',str(args.candidate_checkpoint.resolve()),'--opponent-checkpoint',str(args.opponent_checkpoint.resolve())]
            if args.diagnostic:argv+=['--diagnostic']
        elif args.health:
            argv=[sys.executable,'-m','righelt_training.health','--run-dir',str(args.run_dir.resolve())]
        elif arena_digest:
            argv=[sys.executable,'-m','righelt_training.arena','run','--run-dir',str(args.run_dir.resolve()),
                  '--plan',str(args.arena_plan.resolve()),'--candidate-checkpoint',str(args.candidate_checkpoint.resolve()),
                  '--opponent-checkpoint',str(args.opponent_checkpoint.resolve())]
        else:
            argv=[sys.executable,'-m','righelt_training.runner','--run-dir',str(args.run_dir.resolve()),'--seed',str(args.seed),'--stage',args.stage]
            if args.resume:argv+=['--resume',str(args.resume.resolve())]
        env={**os.environ,'PYTHONPATH':str(ROOT/'tools/ai-trainer')}
        record_attempt(args.run_dir,{'event':'started','id':runtime['supervisorAttempt'],'phase':runtime['command'],'pid':os.getpid()})
        with (args.run_dir/'runner.log').open('a') as log:
            reason='interrupted'
            reason,process=run_phase(argv,env,log,budget,runtime,args.run_dir,artifact_root,args.activity_file)
        record_attempt(args.run_dir,{'event':'finished','id':runtime['supervisorAttempt'],'phase':runtime['command'],'reason':reason})
        atomic_json(args.run_dir/'supervisor-result.json',{'reason':reason,'runnerReturncode':process.returncode if process is not None else None,
                    'elapsedSeconds':time.monotonic()-started,'budgetSeconds':budget.seconds,'productionPromotion':False})
        print(json.dumps({'reason':reason,'runDir':str(args.run_dir)}))
    finally:
        cleanup_owned(args.run_dir)
        allocation.finish(interval['id'],reason=reason)

if __name__=='__main__':main()
