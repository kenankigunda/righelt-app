"""One isolated frozen model; the external screen coordinator owns its deadline.

No optimizer, RNG restoration, checkpoint writes or training-buffer admission.
Both arms use this process and the same model. Each operation uses one Node child.
"""
import argparse
import json
import os
from pathlib import Path
import subprocess
import sys
import torch

from .checkpoint import inspect_checkpoint, weights_sha256
from .config import CONFIG, ROOT
from .development_probe import checked_ref, reference
from .exploration_plan import LIMITS, PROFILE
from .model import PolicyValueNet
from .processes import register_owned
from .resume import validate_continuation_checkpoint
from .runner_monitor import RunnerMonitor
from .sequence import read


def send(value):
    print(json.dumps(value, allow_nan=False, sort_keys=True), flush=True)


def engine_call(job, model, directory):
    # Inherit the externally owned Python group/token. The independent ownership
    # record also lets cleanup find Node if Python exits or is suspended.
    process = subprocess.Popen(['node', '--import', 'tsx', str(ROOT / 'tools/ai-trainer/engine-worker.mjs')],
                               cwd=ROOT, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=sys.stderr, text=True)
    register_owned(directory, process)
    evaluations = 0
    try:
        process.stdin.write(json.dumps(job, allow_nan=False) + '\n'); process.stdin.flush()
        for line in process.stdout:
            message = json.loads(line)
            if message['type'] == 'evaluate':
                if job['command'] != 'search': raise ValueError('record/replay requested inference')
                evaluations += 1
                values = torch.tensor(message['input'], dtype=torch.float32, device='mps').reshape(
                    1, CONFIG['inputPlanes'], CONFIG['boardSize'], CONFIG['boardSize'])
                with torch.inference_mode(): logits, value = model(values)
                response = {'type': 'evaluation', 'id': message['id'],
                            'policyLogits': logits[0].cpu().tolist(), 'value': value[0].item()}
                process.stdin.write(json.dumps(response, allow_nan=False) + '\n'); process.stdin.flush()
            else:
                if message['type'] == 'error': raise ValueError('authoritative worker correctness error: ' + message['message'])
                return {**message, 'evaluations': evaluations}
        raise RuntimeError('engine child exited without disposition')
    finally:
        if process.poll() is None: process.kill()
        process.wait(timeout=2)
        process.stdin.close(); process.stdout.close()


def run(launch_path, session):
    launch = read(launch_path); plan = read(checked_ref(launch['plan'])); seed = plan['seedPlan']
    checkpoint = checked_ref(seed['checkpoint']); directory = Path(launch['allocation'])
    session = Path(session); session.mkdir(parents=True, exist_ok=True)
    torch.set_num_threads(1)
    with RunnerMonitor(session) as monitor:
        with monitor.operation('screen-frozen-checkpoint-restore', LIMITS['startupSeconds']):
            if not torch.backends.mps.is_available(): raise RuntimeError('screen requires MPS')
            audit = validate_continuation_checkpoint(checkpoint, read(checked_ref(launch['gate'])),
                                                    launch['contract'], directory)
            meta = read(checkpoint.with_suffix('.json'))
            payload = inspect_checkpoint(checkpoint, manifest_sha256=meta['manifestSha256'], require_recovery=True)
            # Load only weights in this isolated process; training RNG and
            # optimizer remain in their original immutable checkpoint bundle.
            model = PolicyValueNet().eval(); model.load_state_dict(payload['model'])
            weights = weights_sha256(model.state_dict()); model = model.to('mps').eval()
            references = [reference(checkpoint.with_suffix('.json')), reference(checkpoint.with_suffix('.runner.json'))]
            references.extend(reference(checkpoint.parent.parent / name) for name in payload['recovery']['archives'])
            del payload
        identity = {'checkpoint': seed['checkpoint'], 'audit': audit, 'weightsSha256': weights,
                    'recoveryReferences': references}
        send({'type': 'ready', **identity, 'pid': os.getpid()})
        pending = None
        slots = {slot['id']: slot for slot in plan['slots']}
        for line in sys.stdin:
            command = json.loads(line)
            if command.get('type') == 'select':
                slot = command['slot']
                if slots.get(slot['id']) != slot or pending is not None: raise ValueError('invalid screen slot dispatch')
                job = {'command': 'search', 'id': slot['id'], 'state': command['state'], 'seed': slot['seed'],
                       'profile': PROFILE, 'partition': 'development', 'kind': 'exploration-screen',
                       'rootExploration': {'purpose': 'development-screen', 'recipe': seed['recipes'][slot['arm']]},
                       'budgetMs': LIMITS['selectionSeconds'] * 1000 - 500}
                with monitor.operation('screen-selection', LIMITS['selectionSeconds']):
                    result = engine_call(job, model, directory)
                if result['type'] == 'searched' and result['result']['status'] == 'ready':
                    pending = (slot, command['state'], result['result'])
                send({'type': 'selected', 'slotId': slot['id'], 'answer': result})
            elif command.get('type') == 'record':
                if pending is None or command['slotId'] != pending[0]['id']: raise ValueError('record without matching selection')
                slot, state, result = pending
                job = {'command': 'exploration-record', 'id': slot['id'], 'state': state, 'result': result,
                       'seed': slot['seed'], 'recipe': seed['recipes'][slot['arm']], 'partition': 'development',
                       'kind': 'exploration-screen', 'budgetMs': LIMITS['replaySeconds'] * 1000 - 500}
                with monitor.operation('screen-record-replay', LIMITS['replaySeconds']):
                    answer = engine_call(job, model, directory)
                    if answer['type'] == 'exploration-recorded': answer['proof']['model'] = identity
                pending = None
                send({'type': 'recorded', 'slotId': slot['id'], 'answer': answer})
            else: raise ValueError('unknown screen worker command')


def main():
    parser = argparse.ArgumentParser(); parser.add_argument('--launch', required=True); parser.add_argument('--session', required=True)
    args = parser.parse_args()
    try: run(args.launch, args.session)
    except BaseException as error:
        send({'type': 'error', 'errorType': type(error).__name__, 'message': str(error)})
        raise


if __name__ == '__main__': main()
