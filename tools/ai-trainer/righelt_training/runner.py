"""Budgeted local experiment child. Supervisor owns permission and hard limits."""
import argparse
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
from .curriculum import Curriculum
from .model import PolicyValueNet
from .replay import ReplayBuffer, save_game
from .trainer import make_optimizer, train_round

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
            'generationLaunched': 0, 'generationStartedMonotonic': None,
            'archives': [], 'completedGames': 0, 'terminalGames': 0, 'truncatedGames': 0,
            'unfinishedGames': 0, 'unavailableStarts': 0, 'curriculumSwitched': False,
            'replayChecks': 0, 'generationKinds': {'normal': 0, 'simple': 0, 'continuation': 0}}


class Runner:
    def __init__(self, directory, seed, stage, resume=None):
        self.directory = Path(directory)
        self.runtime = read_json(self.directory / 'runtime.json')
        self.manifest = read_json(self.directory / 'manifest.json')
        if (self.runtime['seed'], self.runtime['stage']) != (seed, stage):
            raise ValueError('runner identity differs from supervisor')
        self.manifest_hash = self.runtime['manifestSha256']
        if self.manifest_hash != self.manifest['sha256']:
            raise ValueError('manifest identity mismatch')
        digest = hashlib.sha256(json.dumps(self.manifest['manifest'], sort_keys=True, allow_nan=False).encode()).hexdigest()
        if digest != self.manifest_hash:
            raise ValueError('manifest content mismatch')
        self.deadline = self.runtime['deadlineMonotonic']
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
        self.curriculum = Curriculum(seed, switched=self.state['curriculumSwitched'])
        self.model.eval()

    def restore(self, checkpoint):
        parent_manifest = self.runtime.get('parentCheckpointManifestSha256', self.manifest_hash)
        data = load_checkpoint(checkpoint, self.model, self.optimizer, manifest_sha256=parent_manifest)
        companion = read_json(checkpoint.with_suffix('.runner.json'))
        if companion['checkpointSha256'] != hashlib.sha256(checkpoint.read_bytes()).hexdigest():
            raise ValueError('runner checkpoint mismatch')
        source_directory = checkpoint.parent.parent
        self.state = companion['state']
        if source_directory.resolve() != self.directory.resolve():
            # Overnight inherits optimizer, replay and random states, but gets a new
            # stage budget/counters and game IDs; elapsed time is never inherited.
            previous = self.state
            self.state = default_state()
            self.state['updates'] = data['updates']
            self.state['nonzeroUpdates'] = previous['nonzeroUpdates']
            self.state['archives'] = [str((source_directory / p).resolve()) for p in previous['archives']]
        for path in self.state['archives']:
            with gzip.open(self.directory / path, 'rt') as stream:
                self.buffer.append(json.load(stream))
        self.model_version = companion['checkpointSha256']

    def allocation(self):
        allocation = read_json(self.directory / 'allocation.json')
        if allocation.get('stop'):
            return {**allocation, 'paused': True, 'workers': 0}
        workers = allocation['workers']
        if not isinstance(workers, int) or not 0 <= workers <= CONFIG['resources']['maxWorkers']:
            raise ValueError('invalid allocation')
        return allocation

    def event(self, kind, **fields):
        with (self.directory / 'runner-events.jsonl').open('a') as stream:
            stream.write(json.dumps({'type': kind, 'monotonic': time.monotonic(), **fields}, allow_nan=False) + '\n')

    def checkpoint(self):
        self.state['checkpointSequence'] += 1
        path = self.directory / 'checkpoints' / f"checkpoint-{self.state['checkpointSequence']:06d}.pt"
        digest = save_checkpoint(path, self.model, self.optimizer, round_index=self.state['round'],
                                 updates=self.state['updates'], replay_ids=self.state['archives'], manifest_sha256=self.manifest_hash)
        atomic_json(path.with_suffix('.runner.json'), {'schema': 1, 'checkpointSha256': digest, 'state': self.state})
        atomic_json(self.directory / 'latest.json', {'checkpoint': str(path), 'sha256': digest, 'updates': self.state['updates']})
        self.model_version = digest
        self.last_checkpoint = time.monotonic()
        self.checkpoint_requested = False
        self.event('checkpoint', path=str(path), sha256=digest, updates=self.state['updates'])

    def maybe_checkpoint(self):
        if self.checkpoint_requested or time.monotonic() - self.last_checkpoint >= CHECKPOINT_INTERVAL:
            self.checkpoint()

    def infer(self, requests, deadline):
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
        for (worker, message), logits, scalar in zip(requests, policies, values):
            worker['process'].stdin.write((json.dumps({'type': 'evaluation', 'id': message['id'], 'policyLogits': logits, 'value': scalar}) + '\n').encode())
            worker['process'].stdin.flush()
        self.inference_bound = max(self.inference_bound, (time.monotonic() - started) * 2)
        return True

    def accept_game(self, game, round_deadline):
        self.maybe_checkpoint()
        path = save_game(self.directory / 'games', game)
        verification_deadline = min(round_deadline, self.deadline - 10,
                                    self.last_checkpoint + CHECKPOINT_INTERVAL - 10)
        try:
            verify_game(game, verification_deadline)
        except (TimeoutError, subprocess.TimeoutExpired):
            # Keep the complete compressed record for audit, but never sample or
            # count a game whose exact replay could not finish within its bound.
            self.state['unfinishedGames'] += 1
            self.event('unfinished-verification', id=game['id'], archive=str(path))
            return False
        self.buffer.append(game)
        self.state['archives'].append(str(path.relative_to(self.directory)))
        self.state['completedGames'] += 1
        self.state['terminalGames' if game['termination'] == 'terminal' else 'truncatedGames'] += 1
        self.state['generationKinds'][game['kind']] += 1
        self.state['replayChecks'] += 1
        self.event('game', id=game['id'], termination=game['termination'], decisions=len(game['decisions']), kind=game['kind'])
        return True

    def generate_round(self):
        if self.state['generationStartedMonotonic'] is None:
            self.state['generationStartedMonotonic'] = time.monotonic()
        round_deadline = min(self.deadline - 10, self.state['generationStartedMonotonic'] + CONFIG['training']['generationSeconds'])
        selector = selectors.DefaultSelector()
        workers = {}
        launched = self.state['generationLaunched']
        try:
            while time.monotonic() < round_deadline:
                self.maybe_checkpoint()
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
                    remaining = round_deadline - time.monotonic()
                    if remaining < 10:
                        break
                    job = self.curriculum.job(self.state['nextJob'], self.model_version)
                    job['id'] = f"{self.stage}-{job['id']}"
                    self.state['nextJob'] += 1
                    self.state['generationLaunched'] += 1
                    # Persist consumed seeds before spawning so restart never reuses IDs.
                    self.checkpoint()
                    job['modelVersion'] = self.model_version
                    job['budgetMs'] = max(1, (round_deadline - time.monotonic()) * 1000)
                    error_path = self.directory / 'worker-errors.log'
                    error_stream = error_path.open('ab')
                    process = subprocess.Popen(['node', '--import', 'tsx', str(ENGINE)], cwd=ROOT,
                                               stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=error_stream)
                    error_stream.close()
                    process.stdin.write((json.dumps(job) + '\n').encode()); process.stdin.flush()
                    fd = process.stdout.fileno()
                    workers[fd] = {'process': process, 'job': job, 'buffer': b''}
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
                        raise RuntimeError(f"engine exited without complete result: {worker['job']['id']}")
                    worker['buffer'] += chunk
                    while b'\n' in worker['buffer']:
                        raw, worker['buffer'] = worker['buffer'].split(b'\n', 1)
                        message = json.loads(raw)
                        kind = message['type']
                        if kind == 'evaluate':
                            requests.append((worker, message))
                        elif kind == 'game':
                            self.accept_game(message['game'], round_deadline)
                            self.finish_worker(selector, workers, fd)
                            self.checkpoint()
                            break
                        elif kind in ('unfinished', 'unavailable-start'):
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
            self.state['unfinishedGames'] += 1
            self.event('unfinished', job=worker['job'], reason=unfinished)

    def run(self):
        self.checkpoint()
        while self.deadline - time.monotonic() >= 40:
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
                self.state['phase'] = 'training'
                self.state['trainingBatch'] = 0
                self.checkpoint()
            if self.buffer.positions:
                def after_batch(metrics):
                    self.state['updates'] += 1
                    self.state['nonzeroUpdates'] += 1
                    self.state['trainingBatch'] = metrics['batchIndex'] + 1
                    self.event('training-batch', **metrics)
                    self.maybe_checkpoint()
                result = train_round(self.model, self.optimizer, list(self.buffer.positions), device=self.device,
                                     seed=self.seed + self.state['round'], deadline=self.deadline,
                                     should_pause=lambda: self.allocation()['paused'], on_batch=after_batch,
                                     start_batch=self.state['trainingBatch'])
                self.event('training-round', result=result)
                if result['stopped'] != 'complete':
                    self.checkpoint()
                    if result['stopped'] == 'budget': break
                    continue
            self.state['phase'] = 'generation'
            self.state['round'] += 1
            self.state['generationLaunched'] = 0
            self.state['generationStartedMonotonic'] = None
            self.checkpoint()
        self.checkpoint()
        atomic_json(self.directory / 'runner-result.json', {'schema': 1, 'state': self.state,
                    'status': 'stopped', 'elapsedSeconds': time.monotonic() - self.started,
                    'trainingHealthOnly': True, 'productionGatesPassed': False})


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--run-dir', required=True)
    parser.add_argument('--seed', required=True, type=int)
    parser.add_argument('--stage', required=True, choices=['initial', 'overnight'])
    parser.add_argument('--resume')
    args = parser.parse_args()
    runner = Runner(args.run_dir, args.seed, args.stage, args.resume)
    signal.signal(signal.SIGUSR1, lambda *_: setattr(runner, 'checkpoint_requested', True))
    try:
        runner.run()
    except Exception as error:
        runner.event('failure', error=str(error))
        atomic_json(runner.directory / 'runner-result.json', {'status': 'failed', 'error': str(error), 'state': runner.state})
        raise

if __name__ == '__main__':
    main()
