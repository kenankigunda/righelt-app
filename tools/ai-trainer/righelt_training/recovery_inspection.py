"""Charged recovery verification in an owned, externally bounded process."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import sys
import time
import uuid

from .checkpoint import atomic_json
from .config import ROOT
from .processes import start_group, stop_group, register_owned, cleanup_owned

INSPECTION_SECONDS = 300


def reference(path):
    path = Path(path).resolve()
    return {'path': str(path), 'sha256': hashlib.sha256(path.read_bytes()).hexdigest()}


def read(path):
    return json.loads(Path(path).read_text())


def verify_inputs(request):
    for ref in request['inputs'].values():
        if reference(ref['path']) != ref:
            raise ValueError('recovery inspection input changed')


def inspect_request(request):
    from .checkpoint import inspect_checkpoint
    from .manifest import manifest_hashes
    from .resume import validate_continuation_checkpoint
    verify_inputs(request)
    checkpoint = Path(request['inputs']['checkpoint']['path'])
    metadata = read(request['inputs']['metadata']['path'])
    if metadata['manifestSha256'] not in manifest_hashes(checkpoint.parent.parent):
        raise ValueError('recovery checkpoint lineage unauthorized')
    if request['mode'] == 'continuation':
        validate_continuation_checkpoint(checkpoint, read(request['inputs']['gate']['path']),
                                         request['continuation'], request['directory'])
    elif request['mode'] != 'latest':
        raise ValueError('unknown recovery inspection mode')
    data = inspect_checkpoint(checkpoint, manifest_sha256=metadata['manifestSha256'], require_recovery=True)
    if request['mode'] == 'latest':
        latest = read(request['inputs']['latest']['path'])
        if latest.get('updates') != data['updates']:
            raise ValueError('latest recovery update count changed')
    verify_inputs(request)
    return {'passed': True, 'checkpoint': str(checkpoint), 'updates': data['updates'],
            'manifestSha256': metadata['manifestSha256'], 'state': data['recovery']['state']}


def inspect_owned(directory, runtime, budget, checkpoint, *, gate=None, continuation=None,
                  latest=None, clock=time.monotonic, sleep=time.sleep):
    """The native supervisor owns this worker inside an already open interval."""
    directory = Path(directory).resolve(); checkpoint = Path(checkpoint).resolve()
    if not runtime.get('allocationInterval') or not runtime.get('allocationId'):
        raise ValueError('recovery inspection requires a charged interval')
    now = clock(); remaining = budget.remaining(now)
    if remaining <= 0: raise TimeoutError('recovery inspection budget exhausted')
    inputs = {name: reference(path) for name, path in {
        'checkpoint': checkpoint, 'metadata': checkpoint.with_suffix('.json'),
        'sidecar': checkpoint.with_suffix('.runner.json')}.items()}
    if latest is not None: inputs['latest'] = reference(latest)
    if gate is not None:
        inputs['gate'] = reference(gate)
        proof = read(gate).get('resumeCheckpoint', {})
        if proof.get('auditPath'): inputs['audit'] = reference(proof['auditPath'])
    request = {'schema': 1, 'mode': 'latest' if latest is not None else 'continuation',
               'directory': str(directory), 'allocationId': runtime['allocationId'],
               'allocationInterval': runtime['allocationInterval'], 'manifestSha256': runtime['manifestSha256'],
               'continuation': continuation, 'inputs': inputs}
    output = directory / 'recovery-inspections' / uuid.uuid4().hex
    output.mkdir(parents=True)
    request_path = output / 'request.json'; result_path = output / 'result.json'
    atomic_json(request_path, request); request_ref = reference(request_path)
    deadline = now + min(INSPECTION_SECONDS, remaining)
    process = None
    try:
        with (output / 'worker.log').open('w') as log:
            if clock() >= deadline or budget.remaining(clock()) <= 0:
                raise TimeoutError('recovery preparation exceeded budget')
            process = start_group([sys.executable, '-m', 'righelt_training.recovery_inspection',
                                   '--request', str(request_path), '--result', str(result_path)],
                                  cwd=ROOT, env={**os.environ, 'PYTHONPATH': str(ROOT / 'tools/ai-trainer')},
                                  stdout=log, stderr=log)
            register_owned(directory, process)
            while process.poll() is None:
                if clock() >= deadline or budget.remaining(clock()) <= 0:
                    raise TimeoutError('recovery inspection timed out')
                sleep(min(.25, max(0, deadline-clock()), budget.remaining(clock())))
            if process.returncode != 0: raise RuntimeError(f'recovery inspection failed: {output}')
            if clock() >= deadline or budget.remaining(clock()) <= 0:
                raise TimeoutError('recovery inspection exceeded budget')
        result = read(result_path)
        if result.get('request') != request_ref or result.get('passed') is not True:
            raise ValueError('unbound recovery inspection result')
        verify_inputs(request)
        if reference(request_path) != request_ref: raise ValueError('recovery request changed')
        return result
    finally:
        if process is not None: stop_group(process)
        cleanup_owned(directory)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--request', type=Path, required=True)
    parser.add_argument('--result', type=Path, required=True)
    args = parser.parse_args(); ref = reference(args.request)
    result = inspect_request(read(args.request))
    if reference(args.request) != ref: raise ValueError('recovery request changed')
    atomic_json(args.result, {**result, 'request': ref})


if __name__ == '__main__': main()
