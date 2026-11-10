"""Broader execution identity. Historical root-exploration hashes stay intact.

Only the audited ordinary residual trainer and the disposable closed-loop fixture
are supported here. Retained attention/teaching branches need a separate audit.
"""
import hashlib
import json
import os
from pathlib import Path
from .config import ROOT, CONFIG
from .training_recipe import recipe_binding
from .architecture import architecture_binding, model_architecture

SOURCES = ('trainer.py', 'model.py', 'curriculum.py', 'runner.py', 'replay.py',
           'checkpoint.py', 'training_recipe.py', 'canary.py', 'hosted_canary.py', 'execution_recipe.py')


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':'), allow_nan=False).encode()).hexdigest()


def settings(mode, training_recipe=None):
    if mode not in ('ordinary-continuation', 'closed-loop-fixture'):
        raise ValueError('execution mode requires reviewed runtime audit')
    return {'schema': 1, 'mode': mode, 'architecture': architecture_binding(),
            'trainingRecipe': training_recipe or recipe_binding(),
            'config': CONFIG, 'optimizer': {'kind': 'AdamW', 'lr': CONFIG['training']['learningRate'],
                'weightDecay': CONFIG['training']['weightDecay']},
            'losses': {'policy': 1, 'observedTerminalValue': 1, 'futureFacts': 0, 'teacherValue': 0},
            'sampling': 'seeded-shuffle-bounded-replay-pass',
            'fixtureContract': json.loads((ROOT/'tools/hosted-compute/fixture-contract.json').read_text()) if mode == 'closed-loop-fixture' else None,
            'teaching': 'none', 'automaticSwitches': 'curriculum.observe-source-bound',
            'sourceFiles': {name: hashlib.sha256((ROOT/'tools/ai-trainer/righelt_training'/name).read_bytes()).hexdigest() for name in SOURCES}}


def record(checkpoint, data_sha256, *, mode, training_recipe=None):
    # The checkpoint hash binds optimizer tensors, RNG, replay list and cursor,
    # rather than reconstructing those from an unrelated main-branch default.
    from .checkpoint import inspect_checkpoint, weights_sha256
    meta = json.loads(Path(checkpoint).with_suffix('.json').read_text())
    state = inspect_checkpoint(checkpoint, manifest_sha256=meta['manifestSha256'])
    if state.get('trainingRecipe', recipe_binding()) != (training_recipe or recipe_binding()):
        raise ValueError('incumbent root recipe differs')
    if state.get('modelArchitecture', architecture_binding()) != architecture_binding():
        raise ValueError('incumbent architecture requires retained-branch audit')
    return {'schema': 1, 'kind': 'execution-recipe', 'settings': settings(mode, training_recipe),
            'incumbent': {'checkpointSha256': meta['sha256'], 'weightsSha256': weights_sha256(state['model']),
                'manifestSha256': state['manifestSha256'], 'updates': state['updates'],
                'round': state['round'], 'replayIds': state['replayIds'],
                'optimizerRngReplayBinding': 'checkpoint-payload'}, 'dataSha256': data_sha256}


def verify_runtime(training_recipe=None, *, model=None, optimizer=None):
    if os.environ.get('RIGHELT_HOSTED') != '1':
        return None
    raw = Path(os.environ['RIGHELT_EXECUTION_RECIPE_PATH']).read_bytes()
    if hashlib.sha256(raw).hexdigest() != os.environ['RIGHELT_EXECUTION_RECIPE_SHA256']:
        raise ValueError('execution recipe bytes changed')
    value = json.loads(raw)
    if value.get('schema') != 1 or value.get('kind') != 'execution-recipe' or value['settings'] != settings(value['settings']['mode'], training_recipe or value['settings']['trainingRecipe']):
        raise ValueError('runtime differs from execution recipe')
    if model is not None and model_architecture(model) != value['settings']['architecture']:
        raise ValueError('runtime model architecture mismatch')
    if optimizer is not None:
        import torch
        if not isinstance(optimizer, torch.optim.AdamW) or any(g['lr'] != CONFIG['training']['learningRate'] or g['weight_decay'] != CONFIG['training']['weightDecay'] for g in optimizer.param_groups):
            raise ValueError('runtime optimizer mismatch')
    return value


def verify_start(checkpoint, model, optimizer):
    value = verify_runtime(model=model, optimizer=optimizer)
    if value is None: return
    context = json.loads(Path(os.environ['RIGHELT_EXECUTION_CONTEXT']).read_text())
    identity = context['execution']
    if value['incumbent']['checkpointSha256'] != identity['inputCheckpointSha256'] or value['dataSha256'] != identity['dataSha256']:
        raise ValueError('execution recipe input binding mismatch')
    if checkpoint is None: raise ValueError('hosted continuation requires explicit incumbent recovery')
    raw_hash = hashlib.sha256(Path(checkpoint).read_bytes()).hexdigest()
    if raw_hash != identity['inputCheckpointSha256'] and not any(a['sha256'] == raw_hash for a in context['recoveryFiles'] if a['path'].endswith('.pt')):
        raise ValueError('checkpoint not in incumbent or durable recovery chain')
    if raw_hash == identity['inputCheckpointSha256']:
        from .checkpoint import weights_sha256
        if weights_sha256(model.state_dict()) != value['incumbent']['weightsSha256']:
            raise ValueError('runtime weights differ from incumbent')
