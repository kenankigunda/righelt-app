"""Small real closed loop, disposable fixture evidence only. No live allocation."""
import argparse
from contextlib import nullcontext
import hashlib
import json
import os
from pathlib import Path
import random
import time
import torch
from .checkpoint import atomic_json, save_checkpoint, load_checkpoint, weights_sha256
from .config import ROOT
from .canary import canary_roots, selfplay, train_and_recover
from .execution_recipe import record, verify_runtime
from .export import export_onnx, numeric_parity
from .model import PolicyValueNet
from .replay import ReplayBuffer, save_game
from .runner import default_state, verify_game
from .trainer import make_optimizer
from .training_recipe import recipe_binding


def file_record(path, role, root):
    path = Path(path)
    return {'name': path.name, 'path': str(path.relative_to(root)), 'role': role,
            'sha256': hashlib.sha256(path.read_bytes()).hexdigest(), 'bytes': path.stat().st_size}


FIXTURE = json.loads((ROOT/'tools/hosted-compute/fixture-contract.json').read_text())


def validate_fixture(corpus, context):
    expected = [{'state': state, 'family': family} for state,family in list(canary_roots())[:FIXTURE['rootCount']]]
    if corpus != {'kind': 'generated-canary-fixtures', 'seed': FIXTURE['seed'], 'roots': expected}:
        raise ValueError('unsupported fixture corpus or seed')
    if context['execution']['seed'] != FIXTURE['seed']: raise ValueError('unsupported execution seed')
    if context['completedWorkIds'] != FIXTURE['workIds']:
        raise ValueError('unsupported fixture workload')


def prepare(directory, seed=FIXTURE['seed']):
    if seed != FIXTURE['seed']: raise ValueError('unsupported fixture seed')
    directory = Path(directory).resolve(); directory.mkdir(parents=True, exist_ok=False)
    torch.set_num_threads(1); torch.manual_seed(seed); random.seed(seed)
    model = PolicyValueNet(); checkpoint = directory/'initial.pt'
    save_checkpoint(checkpoint, model, make_optimizer(model), round_index=0, updates=0,
                    replay_ids=[], manifest_sha256='hosted-fixture-v1', recovery_state=default_state())
    atomic_json(directory/'corpus.json', {'kind': 'generated-canary-fixtures', 'seed': seed,
        'roots': [{'state': state, 'family': family} for state, family in list(canary_roots())[:FIXTURE['rootCount']]]})
    atomic_json(directory/'recipe.json', recipe_binding())
    data = hashlib.sha256((directory/'corpus.json').read_bytes()).hexdigest()
    atomic_json(directory/'execution-recipe.json', record(checkpoint, data, mode='closed-loop-fixture'))
    return {'fixtureOnly': True, 'seed': seed, 'inputs': [file_record(p, 'input', Path.cwd()) for p in sorted(directory.iterdir())]}


class Monitor:
    def operation(self, *_): return nullcontext()


def run(directory, checkpoint, corpus, *, resume=False):
    if resume: raise ValueError('partial fixture requires review and a new separately accounted attempt')
    directory = Path(directory).resolve(); directory.mkdir(parents=True, exist_ok=True)
    context = json.loads(Path(os.environ['RIGHELT_EXECUTION_CONTEXT']).read_text())
    execution = context['execution']
    recipe = verify_runtime(recipe_binding())
    if recipe['settings']['mode'] != 'closed-loop-fixture': raise ValueError('fixture recipe required')
    if hashlib.sha256(Path(checkpoint).read_bytes()).hexdigest() != execution['inputCheckpointSha256'] or recipe['incumbent']['checkpointSha256'] != execution['inputCheckpointSha256']:
        raise ValueError('wrong input checkpoint')
    if hashlib.sha256(Path(corpus).read_bytes()).hexdigest() != execution['dataSha256'] or recipe['dataSha256'] != execution['dataSha256']:
        raise ValueError('wrong input corpus')
    corpus_record = json.loads(Path(corpus).read_text())
    validate_fixture(corpus_record, context)
    device = os.environ['RIGHELT_TRAINING_DEVICE']
    torch.set_num_threads(1)
    model = PolicyValueNet().to(device); optimizer = make_optimizer(model)
    data = load_checkpoint(checkpoint, model, optimizer, manifest_sha256=recipe['incumbent']['manifestSha256'], require_recovery=True)
    before = weights_sha256(model.state_dict())
    if before != recipe['incumbent']['weightsSha256'] or data['updates'] != 0 or data['replayIds']:
        raise ValueError('fixture requires audited initial model and empty replay')
    deadline = time.monotonic()+180
    buffer = ReplayBuffer(); archives = []; monitor = Monitor()
    for i, root in enumerate(corpus_record['roots']):
        job = {'command': 'generate', 'id': f"{execution['campaign']}-fixture-{i}", 'familyId': root['family'],
            'seed': FIXTURE['seed']+i, 'partition': 'train', 'kind': 'simple', 'initialState': root['state'], 'modelVersion': before}
        game = selfplay(job, model, device, deadline, monitor)
        verify_game(game, deadline)
        if game['termination'] != 'terminal': raise ValueError('fixture requires observed terminal outcome')
        archive = save_game(directory/'games', game); archives.append(str(archive.relative_to(directory))); buffer.append(game)
    model, training = train_and_recover(directory, model, list(buffer.positions), archives,
                                       execution['manifestSha256'], device, deadline, monitor)
    after = weights_sha256(model.state_dict())
    if before == after: raise ValueError('zero actual weight change')
    trained = directory/'checkpoints/canary.pt'
    # inspect_checkpoint verifies recovery cursor and every retained replay archive.
    from .checkpoint import inspect_checkpoint
    recovered = inspect_checkpoint(trained, manifest_sha256=execution['manifestSha256'], require_recovery=True)
    if recovered['recovery']['state']['updates'] != training['updates']: raise ValueError('recovered cursor mismatch')
    exported = directory/'model.onnx'; metadata = export_onnx(model, exported)
    import numpy as np
    inputs = np.asarray([p['encoded'] for p in buffer.positions], dtype=np.float32).reshape(-1,46,10,10)
    parity = numeric_parity(model, exported, inputs, reference_device=device)
    if not parity['numericPassed']: raise ValueError('export proof failed')
    proof = {'schema': 1, 'kind': 'pipeline-proof', 'execution': execution, 'fixtureOnly': True, 'strengthEstablished': False, 'initialWeightsSha256': before,
        'resultWeightsSha256': after, 'checkpointSha256': training['checkpointSha256'], 'export': metadata,
        'parity': parity, 'training': training, 'recoveredUpdates': recovered['updates'],
        'terminalGames': len(archives), 'replayChecks': len(archives),
        'policyUsablePositions': sum(p.get('policyMask', True) for p in buffer.positions),
        'terminalValuePositions': sum(p['terminalMask'] for p in buffer.positions)}
    atomic_json(directory/'pipeline-proof.json', proof)
    atomic_json(directory/'latest.json', {'checkpoint': str(trained), 'sha256': training['checkpointSha256']})
    result = {'schema': 1, 'kind': 'compute-result', 'disposition': 'complete', 'execution': execution,
        'completedWorkIds': context['completedWorkIds'], 'updates': training['updates'],
        'parameterDelta': sum(b['parameterDelta'] for b in training['batches']),
        'artifacts': [file_record(exported,'model',Path.cwd()), file_record(trained,'checkpoint',Path.cwd()),
                      file_record(directory/'pipeline-proof.json','proof',Path.cwd())]}
    atomic_json(directory/'result.json', result)
    return result


def main():
    p = argparse.ArgumentParser(); p.add_argument('--prepare', type=Path); p.add_argument('--run-dir', type=Path)
    p.add_argument('--resume', action='store_true'); p.add_argument('--checkpoint', type=Path); p.add_argument('--corpus', type=Path); args = p.parse_args()
    if args.prepare: print(json.dumps(prepare(args.prepare))); return
    if not all((args.run_dir,args.checkpoint,args.corpus)): p.error('run requires directory/checkpoint/corpus')
    print(json.dumps(run(args.run_dir,args.checkpoint,args.corpus,resume=args.resume)))

if __name__ == '__main__': main()
