"""Budgeted local experiment child. Supervisor owns permission and hard limits."""
from .budget import effective_deadline
from .admission import estimate as admission_estimate, observe as observe_duration, restore_observations
from .allocation import rows
from .fallback_report import add_game as add_fallback_game
import argparse
from contextlib import nullcontext
from .recovery import RecoveryLedger
from .runner_monitor import RunnerMonitor
from .manifest import active_manifest, manifest_hashes
import gzip
import hashlib
import json
import os
from pathlib import Path
import selectors
import signal
import subprocess
import time
import torch
from .checkpoint import atomic_json, save_checkpoint, load_checkpoint
from .config import CONFIG, ROOT
from .resource_policy import LIMITS
from .curriculum import Curriculum
from .model import PolicyValueNet
from .replay import ReplayBuffer, save_game
from .trainer import make_optimizer, train_round
from . import fresh_health
from . import exploration_adoption
from .training_recipe import record_recipe, recipe_binding

ENGINE = ROOT / 'tools/ai-trainer/engine-worker.mjs'
CHECKPOINT_INTERVAL = 590


def read_json(path):
    return json.loads(Path(path).read_text())


def stop_worker(process):
    if process.poll() is None:
        process.kill()
    process.wait(timeout=2)
    for stream in (process.stdin, process.stdout, process.stderr):
        if stream is not None:
            stream.close()


def engine_command(job, *, timeout):
    if timeout <= 0:
        raise TimeoutError('no engine budget')
    process = subprocess.Popen(['node', '--import', 'tsx', str(ENGINE)], cwd=ROOT,
                               stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    try:
        output, error = process.communicate((json.dumps(job) + '\n').encode(), timeout=timeout)
        if process.returncode:
            raise RuntimeError(f'engine failed: {error.decode()[-2000:]} {output.decode()[-2000:]}')
        messages = [json.loads(line) for line in output.splitlines()]
        if len(messages) != 1 or messages[0]['type'] == 'error':
            raise RuntimeError(f'invalid engine result: {messages[-1:]!r}')
        return messages[0]
    finally:
        stop_worker(process)


def verify_game(game, deadline):
    remaining = min(600, deadline - time.monotonic())
    result = engine_command({'command': 'replay', 'game': game, 'budgetMs': remaining * 1000}, timeout=remaining)
    if result['type'] == 'unfinished':
        raise TimeoutError('replay verification unfinished')
    if result['type'] != 'replayed' or result['hash'] != game['finalHash']:
        raise ValueError('exact replay verification failed')


def default_state():
    return {'schema': 1, 'round': 0, 'updates': 0, 'nonzeroUpdates': 0, 'nextJob': 0,
            'phase': 'generation', 'trainingBatch': 0, 'checkpointSequence': 0,
            'generationLaunched': 0, 'generationStartedMonotonic': None,'generationElapsedSeconds':0.,
            'archives': [], 'completedGames': 0, 'terminalGames': 0, 'truncatedGames': 0,
            'unfinishedGames': 0, 'unavailableStarts': 0, 'curriculumSwitched': False,
            'replayChecks': 0, 'pendingGenerationJob': None,
            'generationKinds': {'normal': 0, 'simple': 0, 'continuation': 0}}


class Runner:
    def __init__(self, directory, seed, stage, resume=None, monitor=None):
        self.directory = Path(directory)
        self.monitor=monitor
        self.ledger=RecoveryLedger(self.directory.parent)
        self.runtime = read_json(self.directory / 'runtime.json')
        self.manifest = active_manifest(self.directory)
        if (self.runtime['seed'], self.runtime['stage']) != (seed, stage):
            raise ValueError('runner identity differs from supervisor')
        self.manifest_hash = self.runtime['manifestSha256']
        if self.manifest_hash != self.manifest['sha256']:
            raise ValueError('manifest identity mismatch')
        digest = hashlib.sha256(json.dumps(self.manifest['manifest'], sort_keys=True, allow_nan=False).encode()).hexdigest()
        if digest != self.manifest_hash:
            raise ValueError('manifest content mismatch')
        self.continuation = fresh_health.continuation_for(self.directory, self.manifest['manifest'])
        self.training_recipe = record_recipe(self.manifest['manifest'])
        self.exploration_adoption = exploration_adoption.manifest_binding(self.directory, self.manifest['manifest'], mode='provenance')
        if self.exploration_adoption and (self.runtime.get('explorationAdoption') != self.exploration_adoption
                or self.runtime.get('trainingRecipe') != self.training_recipe):
            raise ValueError('runner adoption differs from supervised manifest')
        if self.continuation and not resume:
            raise ValueError('continuation requires checkpoint restoration')
        self.deadline = effective_deadline(self.runtime)
        self.started = self.runtime['startedMonotonic']
        if self.deadline <= self.started or self.deadline <= time.monotonic():
            raise ValueError('expired experiment')
        self.device = torch.device('mps' if torch.backends.mps.is_available() else 'cpu')
        # Runtime fallback is prohibited for experiments; CPU remains available to unit tests.
        if self.device.type != 'mps':
            raise RuntimeError('MPS unavailable; run preflight with Metal access')
        torch.set_num_threads(2)
        torch.manual_seed(seed)
        self.model = PolicyValueNet().to(self.device)
        self.optimizer = make_optimizer(self.model)
        self.buffer = ReplayBuffer()
        self.state = default_state()
        self.seed = seed
        self.stage = stage
        self.checkpoint_requested = False
        self.last_checkpoint = time.monotonic()
        self.model_version = 'untrained'
        self.inference_bound = 30.
        if resume:
            self.restore(Path(resume))
        restore_observations(self.state,self.directory)
        self.restore_admission_claims()
        self.curriculum = Curriculum(seed, switched=self.state['curriculumSwitched'])
        self.model.eval()
        self.report_device_memory()

    def operation(self,name,seconds):
        monitor=getattr(self,'monitor',None)
        return monitor.operation(name,seconds) if monitor else nullcontext()

    def report_device_memory(self):
        if getattr(self,'monitor',None):
            self.monitor.check();return
        amount=torch.mps.driver_allocated_memory() if self.device.type=='mps' else 0
        atomic_json(self.directory/'device-memory.json', {'schema':1,'pid':os.getpid(),
                    'observedAt':time.time(),'driverBytes':amount})

    def restore(self, checkpoint):
        with self.operation("restore-and-replay",300):return self._restore(checkpoint)

    def _restore(self, checkpoint):
        continuation = getattr(self, 'continuation', None)
        if continuation is None:
            continuation = fresh_health.continuation_for(self.directory, getattr(self, 'manifest', {}).get('manifest', {}))
            self.continuation = continuation
        preserve_state = continuation is not None and continuation['preserveState'] is True
        parent_manifest = self.runtime.get('parentCheckpointManifestSha256', self.manifest_hash)
        source_directory = checkpoint.parent.parent
        relocated = source_directory.resolve() != self.directory.resolve()
        same_stage = False
        if relocated:
            if parent_manifest not in manifest_hashes(source_directory):
                raise ValueError('checkpoint manifest outside source lineage')
            source = read_json(source_directory / 'manifest.json')
            if source['sha256'] != parent_manifest:
                source = read_json(source_directory / 'manifests' / f'{parent_manifest}.json')
            destination = self.manifest
            for record, expected in ((source, parent_manifest), (destination, self.manifest_hash)):
                digest = hashlib.sha256(json.dumps(record['manifest'], sort_keys=True, allow_nan=False).encode()).hexdigest()
                if record['sha256'] != expected or digest != expected:
                    raise ValueError('restore manifest checksum mismatch')
            origin, target = source['manifest'], destination['manifest']
            same_stage = origin['stage'] == target['stage']
            if (same_stage or preserve_state) and origin['seed'] != target['seed']:
                raise ValueError('same-stage restore seed mismatch')
            if not preserve_state and not same_stage and (origin['stage'], target['stage']) != ('initial', 'overnight'):
                raise ValueError('unsupported restore stage transition')
            if preserve_state and checkpoint.resolve() != Path(continuation['recoveryCheckpoint']).resolve():
                raise ValueError('continuation checkpoint differs from authorized recovery source')
        manifest = getattr(self, 'manifest', {}).get('manifest', {})
        self.training_recipe = record_recipe(manifest)
        self.exploration_adoption = exploration_adoption.manifest_binding(self.directory, manifest, mode='provenance')
        data = load_checkpoint(checkpoint, self.model, self.optimizer, manifest_sha256=parent_manifest, require_recovery=True,
            validate_state=lambda data: exploration_adoption.checkpoint_recipe(checkpoint, data, recipe=self.training_recipe,
                binding=self.exploration_adoption, continuation=continuation))
        companion = read_json(checkpoint.with_suffix('.runner.json'))
        if companion['checkpointSha256'] != hashlib.sha256(checkpoint.read_bytes()).hexdigest():
            raise ValueError('runner checkpoint mismatch')
        self.state = data['recovery']['state']
        restore_observations(self.state,source_directory)
        if self.state['generationStartedMonotonic'] is not None:
            elapsed=self.state['generationElapsedSeconds']
            if not __import__('math').isfinite(elapsed) or elapsed<0:raise ValueError('invalid generation elapsed time')
            self.state['generationStartedMonotonic']=time.monotonic()-elapsed
        if relocated:
            previous = self.state
            if not same_stage and not preserve_state:
                # Initial-to-overnight starts new stage counters. A same-stage
                # allocation reset instead continues the exact training cursor.
                self.state = default_state()
                self.state['updates'] = data['updates']
                self.state['nonzeroUpdates'] = previous['nonzeroUpdates']
                self.state['admissionDurations'] = previous.get('admissionDurations',{})
            self.state.pop('lastHandoffId', None)
            self.state['archives'] = [str((source_directory / p).resolve()) for p in previous['archives']]
        self.buffer.positions.clear(); self.buffer.ids.clear(); self.buffer.game_ids.clear()
        for path in self.state['archives']:
            with gzip.open(self.directory / path, 'rt') as stream:
                self.buffer.append(json.load(stream))
        self.model_version = companion['checkpointSha256']
        restore_observations(self.state,self.directory)
        self.restore_admission_claims()
        if continuation and continuation['freshHealth'] is True:
            self.fresh_baseline = fresh_health.initialize(self.directory, continuation, self.state, checkpoint)
            if self.runtime.get('allocationId') != self.fresh_baseline['baseline']['allocationId']:
                raise ValueError('fresh baseline differs from runtime allocation')
            self.fresh_previous_checkpoint = (fresh_health.checkpoint_reference(
                checkpoint, companion['checkpointSha256'], self.state, data['model']) if not relocated else None)

    def restore_admission_claims(self):
        ledger=getattr(self,'ledger',None) or RecoveryLedger(self.directory)
        observed={row['jobId'] for row in rows(self.directory/'admission-durations.jsonl') if row['phase']=='generation'}
        reported=self.state.setdefault('admissionUnobservedClaims',[])
        for record in ledger.launches():
            if record['directory']!=str(self.directory.resolve()) or record['jobId'] in observed or record['jobId'] in reported:continue
            # A claim precedes spawn. A crash can leave no trustworthy duration;
            # report that gap rather than inventing a completed or elapsed game.
            self.event('admission-unobserved',id=record['jobId'],reason='interrupted-launch-without-duration')
            reported.append(record['jobId'])

    def allocation(self):
        allocation = read_json(self.directory / 'allocation.json')
        if allocation.get('stop'):
            return {**allocation, 'paused': True, 'workers': 0}
        workers = allocation['workers']
        if isinstance(workers, bool) or not isinstance(workers, int) or not 0 <= workers <= LIMITS['maxWorkers']:
            raise ValueError('invalid allocation')
        return allocation

    def handoff_requested(self):
        path=self.directory/'handoff-request.json'
        if not path.exists():return None
        request=read_json(path)
        if (request.get('schema')!=1 or request.get('manifestSha256')!=self.manifest_hash
            or request.get('reason') not in ('validation','reporting') or not isinstance(request.get('id'),str)
            or not request['id']):raise ValueError('invalid checkpoint handoff request')
        return request if request['id']!=self.state.get('lastHandoffId') else None

    def event(self, event_type, **fields):
        with (self.directory / 'runner-events.jsonl').open('a') as stream:
            stream.write(json.dumps({'type': event_type, 'monotonic': time.monotonic(), **fields}, allow_nan=False) + '\n')

    def checkpoint(self):
        with self.operation("checkpoint",120):return self._checkpoint()

    def _checkpoint(self):
        started=self.state['generationStartedMonotonic']
        self.state['generationElapsedSeconds']=max(0,time.monotonic()-started) if started is not None else 0.
        ledger=getattr(self,'ledger',None) or RecoveryLedger(self.directory)
        self.state['checkpointSequence'] = ledger.checkpoint(self.state['checkpointSequence'])+1
        path = self.directory / 'checkpoints' / f"checkpoint-{self.state['checkpointSequence']:06d}.pt"
        if getattr(self, 'fresh_baseline', None) is not None:
            fresh = self.state[fresh_health.STATE_KEY]
            previous = getattr(self, 'fresh_previous_checkpoint', None)
            if previous and (not fresh['checkpoints'] or fresh['checkpoints'][-1] != previous):
                fresh['checkpoints'].append(previous)
        digest = save_checkpoint(path, self.model, self.optimizer, round_index=self.state['round'],
                                 updates=self.state['updates'], replay_ids=self.state['archives'], manifest_sha256=self.manifest_hash,recovery_state=self.state,
                                 training_recipe=getattr(self,'training_recipe',recipe_binding()),
                                 exploration_adoption=getattr(self,'exploration_adoption',None))
        atomic_json(self.directory / 'latest.json', {'checkpoint': str(path), 'sha256': digest, 'updates': self.state['updates']})
        self.model_version = digest
        if getattr(self, 'fresh_baseline', None) is not None:
            self.fresh_previous_checkpoint = fresh_health.checkpoint_reference(path, digest, self.state, self.model.state_dict())
        self.last_checkpoint = time.monotonic()
        self.checkpoint_requested = False
        self.event('checkpoint', path=str(path), sha256=digest, updates=self.state['updates'])

    def maybe_checkpoint(self):
        self.report_device_memory()
        if self.checkpoint_requested or time.monotonic() - self.last_checkpoint >= CHECKPOINT_INTERVAL:
            self.checkpoint()

    def infer(self, requests, deadline):
        with self.operation("inference",30):return self._infer(requests,deadline)

    def _infer(self, requests, deadline):
        if deadline - time.monotonic() < self.inference_bound:
            return False
        started = time.monotonic()
        with torch.inference_mode():
            inputs = torch.tensor([message['input'] for _, message in requests], dtype=torch.float32, device=self.device)
            inputs = inputs.reshape(len(requests), CONFIG['inputPlanes'], CONFIG['boardSize'], CONFIG['boardSize'])
            if not torch.isfinite(inputs).all():
                raise ValueError('nonfinite inference input')
            policy, value = self.model(inputs)
            if not torch.isfinite(policy).all() or not torch.isfinite(value).all():
                raise ValueError('nonfinite inference output')
            policies, values = policy.cpu().tolist(), value.cpu().tolist()
        self.report_device_memory()
        for (worker, message), logits, scalar in zip(requests, policies, values):
            worker['process'].stdin.write((json.dumps({'type': 'evaluation', 'id': message['id'], 'policyLogits': logits, 'value': scalar}) + '\n').encode())
            worker['process'].stdin.flush()
        seconds=time.monotonic()-started
        self.inference_bound = max(self.inference_bound, seconds * 2)
        self.event('inference-batch',seconds=seconds,positions=len(requests))
        return True

    def accept_game(self, game, round_deadline, *, job=None):
        self.maybe_checkpoint()
        path = save_game(self.directory / 'games', game)
        exploration_adoption.validate_game(game, getattr(self,'training_recipe',recipe_binding()), getattr(self,'exploration_adoption',None))
        verification_deadline = min(round_deadline, self.deadline - 10,
                                    self.last_checkpoint + CHECKPOINT_INTERVAL - 10)
        started=time.monotonic()
        try:
            with self.operation("exact-replay",max(.1,verification_deadline-time.monotonic())):
                verify_game(game, verification_deadline)
        except (TimeoutError, subprocess.TimeoutExpired):
            # Keep the complete compressed record for audit, but never sample or
            # count a game whose exact replay could not finish within its bound.
            self.state['unfinishedGames'] += 1
            self.event('unfinished-verification', id=game['id'], archive=str(path))
            observe_duration(self.state,self.directory,job_id=game['id'],kind=game['kind'],
                             phase='replay',seconds=time.monotonic()-started,censored=True)
            return False
        observe_duration(self.state,self.directory,job_id=game['id'],kind=game['kind'],
                         phase='replay',seconds=time.monotonic()-started,censored=False)
        if getattr(self, 'fresh_baseline', None) is not None:
            fresh_health.accept_game(self.directory, self.state, self.fresh_baseline, game, path, job)
        self.buffer.append(game)
        self.state['archives'].append(str(path.relative_to(self.directory)))
        self.state['completedGames'] += 1
        self.state['terminalGames' if game['termination'] == 'terminal' else 'truncatedGames'] += 1
        self.state['generationKinds'][game['kind']] += 1
        self.state['replayChecks'] += 1
        add_fallback_game(self.state.setdefault('fallbackReport',{}),game)
        self.event('game', id=game['id'], termination=game['termination'], decisions=len(game['decisions']), kind=game['kind'],
                   policyPositions=sum(d.get('policyMask',True) for d in game['decisions']),
                   valuePositions=len(game['decisions']) if game['termination']=='terminal' else 0,
                   fallbackDecisions=sum(bool(d.get('fallback')) for d in game['decisions']))
        return True

    def next_generation_job(self,round_deadline):
        """Reserve identity once; a deferred kind cannot be replaced by an easier start."""
        ledger=getattr(self,'ledger',None) or RecoveryLedger(self.directory)
        job=self.state.get('pendingGenerationJob')
        if job is not None and ledger.launched(job['id']):
            self.event('admission-pending-consumed',id=job['id'],kind=job['kind'])
            self.state['pendingGenerationJob']=None;job=None
        if job is None:
            index=ledger.job(self.stage,getattr(self,'seed',self.curriculum.seed),self.state['nextJob'])
            job=self.curriculum.job(index,self.model_version)
            job['id']=f"{self.stage}-{job['id']}"
            self.state['nextJob']=index+1
            self.state['pendingGenerationJob']=job
        job=exploration_adoption.authorize_job(job,getattr(self,'training_recipe',recipe_binding()),getattr(self,'exploration_adoption',None))
        self.state['pendingGenerationJob']=job
        bound=admission_estimate(self.state,job['kind'])
        if round_deadline-time.monotonic()<bound['requiredSeconds']:
            key=f"{self.state['round']}:{job['id']}"
            if self.state.get('admissionLastDeferral')!=key:
                self.state['admissionLastDeferral']=key
                counts=self.state.setdefault('admissionDeferrals',{})
                counts[job['kind']]=counts.get(job['kind'],0)+1
                self.event('admission-deferred',id=job['id'],kind=job['kind'],bound=bound,
                           remainingSeconds=max(0,round_deadline-time.monotonic()))
                self.checkpoint()
            if bound['requiredSeconds']>CONFIG['training']['generationSeconds']:
                self.state['admissionStop']='observed-game-bound-exceeds-round'
            elif self.deadline-time.monotonic()-10<bound['requiredSeconds']:
                self.state['admissionStop']='insufficient-generation-runway'
            return None
        # Persist consumption before spawning. Recovery never reuses a live or
        # interrupted game's ID. A merely deferred job remains bound to its seed.
        self.state['pendingGenerationJob']=None
        self.state['generationLaunched']+=1
        self.checkpoint()
        remaining=round_deadline-time.monotonic()
        if remaining<bound['requiredSeconds']:
            # Checkpointing consumed the admission allowance; no process started.
            self.state['pendingGenerationJob']=job
            self.state['generationLaunched']-=1
            self.checkpoint()
            return None
        if not ledger.launch(job['id'],self.directory):
            raise ValueError('generation identity already launched')
        return {**job,'modelVersion':self.model_version,
                'budgetMs':max(1,(remaining-bound['replay']-bound['checkpoint'])*1000)}

    def record_generation_duration(self,worker,*,censored):
        if worker.get('durationRecorded'):return
        observe_duration(self.state,self.directory,job_id=worker['job']['id'],kind=worker['job']['kind'],
                         phase='generation',seconds=time.monotonic()-worker['startedMonotonic'],censored=censored)
        worker['durationRecorded']=True

    def generate_round(self):
        self.state.pop('admissionStop',None)
        if self.state['generationStartedMonotonic'] is None:
            self.state['generationStartedMonotonic'] = time.monotonic()
        round_deadline = min(self.deadline - 10, self.state['generationStartedMonotonic'] + CONFIG['training']['generationSeconds'])
        selector = selectors.DefaultSelector()
        workers = {}
        launched = self.state['generationLaunched']
        try:
            while time.monotonic() < round_deadline:
                self.maybe_checkpoint()
                if self.handoff_requested():break
                allocation = self.allocation()
                if allocation.get('stop'):
                    break
                if allocation['paused']:
                    # Free live engine memory promptly; unfinished work is never a draw.
                    for fd in list(workers):
                        self.finish_worker(selector, workers, fd, 'resource-pause')
                    self.checkpoint()
                    break
                allowed = allocation['workers']
                # Stop excess workers on downscaling; otherwise a long game could
                # defeat the user's promise to give development resources back.
                while len(workers) > allowed:
                    self.finish_worker(selector, workers, next(reversed(workers)), 'resource-downscale')
                while len(workers) < allowed and launched < CONFIG['training']['roundGames']:
                    job=self.next_generation_job(round_deadline)
                    if job is None:break
                    diagnostics=self.directory/'worker-diagnostics';diagnostics.mkdir(exist_ok=True)
                    identity=hashlib.sha256(job['id'].encode()).hexdigest()
                    job['diagnosticPath']=str((diagnostics/f'{identity}.state.json').resolve())
                    error_path=diagnostics/f'{identity}.stderr.log'
                    error_stream = error_path.open('ab')
                    started=time.monotonic()
                    process = subprocess.Popen(['node', '--import', 'tsx', str(ENGINE)], cwd=ROOT,
                                               stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=error_stream)
                    error_stream.close()
                    process.stdin.write((json.dumps(job) + '\n').encode()); process.stdin.flush()
                    fd = process.stdout.fileno()
                    workers[fd] = {'process': process, 'job': job, 'buffer': b'', 'errorPath':str(error_path),
                                   'startedMonotonic':started}
                    selector.register(fd, selectors.EVENT_READ)
                    launched += 1
                if not workers:
                    break
                requests = []
                for key, _ in selector.select(timeout=min(1, max(0, round_deadline - time.monotonic()))):
                    fd = key.fd
                    worker = workers[fd]
                    chunk = os.read(fd, 65536)
                    if not chunk:
                        code=worker['process'].poll()
                        self.event('worker-exit',job=worker['job'],returncode=code,stderr=worker.get('errorPath'),partialBytes=len(worker['buffer']))
                        raise RuntimeError(f"engine exited without complete result: {worker['job']['id']} (code={code}, stderr={worker.get('errorPath')})")
                    worker['buffer'] += chunk
                    while b'\n' in worker['buffer']:
                        raw, worker['buffer'] = worker['buffer'].split(b'\n', 1)
                        message = json.loads(raw)
                        if not worker.get('firstMessage'):
                            worker['firstMessage']=True
                            self.event('worker-first-message',id=worker['job']['id'],
                                       seconds=time.monotonic()-worker['startedMonotonic'])
                        kind = message['type']
                        if kind == 'evaluate':
                            requests.append((worker, message))
                        elif kind == 'decision-progress':
                            self.event(kind,gameId=message['gameId'],kind=message['kind'],decision=message['decision'])
                        elif kind == 'game':
                            self.record_generation_duration(worker,censored=False)
                            game=message['game']
                            self.event('generated-game',id=game['id'],kind=worker['job']['kind'],
                                       decisions=len(game.get('decisions',[])),termination=game.get('termination'),
                                       valuePositions=len(game.get('decisions',[])) if game.get('termination')=='terminal' else 0)
                            self.accept_game(message['game'], round_deadline, job=worker['job'])
                            self.finish_worker(selector, workers, fd)
                            self.checkpoint()
                            break
                        elif kind in ('unfinished', 'unavailable-start'):
                            if kind=='unfinished':self.record_generation_duration(worker,censored=True)
                            self.state['unavailableStarts' if kind == 'unavailable-start' else 'unfinishedGames'] += 1
                            self.event(kind, job=worker['job'], result=message)
                            self.finish_worker(selector, workers, fd)
                            break
                        else:
                            raise RuntimeError(f'engine protocol error: {message}')
                if requests:
                    if not self.infer(requests, min(round_deadline, self.deadline - 10)):
                        break
                if launched >= CONFIG['training']['roundGames'] and not workers:
                    break
        finally:
            for fd in list(workers):
                self.finish_worker(selector, workers, fd, 'generation-bound')
            selector.close()

    def finish_worker(self, selector, workers, fd, unfinished=None):
        worker = workers.pop(fd)
        selector.unregister(fd)
        stop_worker(worker['process'])
        if unfinished:
            self.record_generation_duration(worker,censored=True)
            self.state['unfinishedGames'] += 1
            self.event('unfinished', job=worker['job'], reason=unfinished)

    def record_training_batch(self, metrics):
        self.state['updates'] += 1
        self.state['nonzeroUpdates'] += 1
        self.state['trainingBatch'] = metrics['batchIndex'] + 1
        if getattr(self, 'fresh_baseline', None) is not None:
            fresh_health.record_batch(self.state, metrics)
        self.event('training-batch', **metrics)
        self.maybe_checkpoint()

    def run(self):
        self.checkpoint()
        handoff=None
        while self.deadline - time.monotonic() >= 40:
            handoff=self.handoff_requested()
            if handoff:break
            allocation = self.allocation()
            if allocation.get('stop'):
                break
            if allocation['paused']:
                self.maybe_checkpoint(); time.sleep(min(1, max(0, self.deadline - time.monotonic()))); continue
            elapsed = time.monotonic() - self.started
            if self.curriculum.observe(elapsed, self.state['terminalGames'], self.state['truncatedGames'], self.state['completedGames']):
                self.state['curriculumSwitched'] = True
                self.event('curriculum-change', weights=CONFIG['training']['fallbackCurriculum'])
            if self.state['phase'] == 'generation':
                self.generate_round()
                if self.state.get('admissionStop'):break
                handoff=self.handoff_requested()
                if handoff:break
                self.state['phase'] = 'training'
                self.state['trainingBatch'] = 0
                self.checkpoint()
            if self.buffer.positions:
                result = train_round(self.model, self.optimizer, list(self.buffer.positions), device=self.device,
                                     seed=self.seed + self.state['round'], deadline=self.deadline,
                                     should_pause=lambda: self.allocation()['paused'] or bool(self.handoff_requested()), on_batch=self.record_training_batch,
                                     start_batch=self.state['trainingBatch'],operation=self.operation,
                                     evidence_game_ids=(fresh_health.eligible_game_ids(self.state)
                                                        if getattr(self, 'fresh_baseline', None) is not None else None))
                self.event('training-round', result=result)
                if result['stopped'] != 'complete':
                    self.checkpoint()
                    handoff=self.handoff_requested()
                    if handoff:break
                    if result['stopped'] == 'budget': break
                    continue
            self.state['phase'] = 'generation'
            self.state['round'] += 1
            self.state['generationLaunched'] = 0
            self.state['generationStartedMonotonic'] = None
            self.checkpoint()
        if handoff:
            self.state['lastHandoffId']=handoff['id']
            self.event('checkpoint-handoff',reason=handoff['reason'],requestId=handoff['id'],deadlineMonotonic=self.deadline)
        self.checkpoint()
        atomic_json(self.directory / 'runner-result.json', {'schema': 1, 'state': self.state,
                    'status': 'stopped', 'elapsedSeconds': time.monotonic() - self.started,
                    'reason':f"{handoff['reason']}-handoff" if handoff else self.state.get('admissionStop','budget-or-resource-stop'),
                    'trainingHealthOnly': True, 'productionGatesPassed': False})


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--run-dir', required=True)
    parser.add_argument('--seed', required=True, type=int)
    parser.add_argument('--stage', required=True, choices=['initial', 'overnight'])
    parser.add_argument('--resume')
    args = parser.parse_args()
    pending=[]
    signal.signal(signal.SIGUSR1, lambda *_: pending.append(True))
    monitor=RunnerMonitor(args.run_dir)
    monitor.__enter__()
    try:
        with monitor.operation('initialization',360):
            runner = Runner(args.run_dir, args.seed, args.stage, args.resume,monitor=monitor)
    except BaseException:
        monitor.__exit__(None,None,None);raise
    runner.checkpoint_requested=bool(pending)
    signal.signal(signal.SIGUSR1, lambda *_: setattr(runner, 'checkpoint_requested', True))
    try:
        runner.run()
    except Exception as error:
        runner.event('failure', error=str(error))
        atomic_json(runner.directory / 'runner-result.json', {'status': 'failed', 'error': str(error), 'state': runner.state})
        raise
    finally:monitor.__exit__(None,None,None)

if __name__ == '__main__':
    main()
