"""Broader execution identity. Historical root-exploration hashes stay intact.

The ordinary residual trainer, disposable fixture and explicitly qualified
attention incumbent method have separate execution bindings.
"""
import hashlib
import json
import os
from pathlib import Path
from .config import ROOT, CONFIG
from .training_recipe import recipe_binding
from .architecture import architecture_binding, model_architecture
from .sequence_targets import FUTURE_LOSS_WEIGHT
from .pilot_recipe import DEFINITION
from .arithmetic import POLICY

SOURCES = ('trainer.py', 'model.py', 'curriculum.py', 'runner.py', 'replay.py', 'arithmetic.py', 'export.py', 'device.py', 'runtime_probe.py',
           'checkpoint.py', 'production.py', 'training_recipe.py', 'canary.py', 'hosted_canary.py', 'execution_recipe.py',
           'portable.py', 'attention_method.py', 'pilot_recipe.py', 'sequence_targets.py', 'board_attention.py',
           'hosted_science.py','cloud_episode.py','cloud_launch.py','linux_memory.py','consumption_transfer.py','exploratory_contract.py','exploratory_window.py','fresh_health.py','supervisor.py','policy_pool.py','export_runtime.py','hosted_receipts.py','source_image.py',
           'prospective_durability.py','evaluation_start.py','development_assessment.py','comparison_report.py','evaluation.py','arena.py','search_parity.py',
           'local_episode.py','local_series.py','certificate_teacher.py')


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':'), allow_nan=False).encode()).hexdigest()


def settings(mode, training_recipe=None, attention_method=None, policy_refresh=None):
    if mode not in ('ordinary-continuation', 'closed-loop-fixture', 'attention-incumbent-continuation'):
        raise ValueError('execution mode requires reviewed runtime audit')
    attention = mode == 'attention-incumbent-continuation'
    if attention:
        from .attention_method import validate_method
        attention_method=validate_method(attention_method)
    elif attention_method is not None:raise ValueError('attention method in ordinary recipe')
    if policy_refresh is not None and (not attention or not isinstance(policy_refresh,dict) or set(policy_refresh)!={'path','sha256'}):
        raise ValueError('policy refresh needs explicit attention intervention binding')
    return {'schema': 1, 'mode': mode, 'arithmeticPolicy':dict(POLICY), 'architecture': attention_method['architecture'] if attention else architecture_binding(),
            **({'attentionMethod':attention_method} if attention else {}),
            **({'policyRefresh':policy_refresh} if policy_refresh is not None else {}),
            'trainingRecipe': training_recipe or recipe_binding(),
            'config': CONFIG, 'optimizer': {'kind': 'AdamW', 'lr': DEFINITION['learningRates']['continuation'] if attention else CONFIG['training']['learningRate'],
                'weightDecay': CONFIG['training']['weightDecay']},
            'losses': {'policy': 1, 'observedTerminalValue': 1, 'futureFacts': FUTURE_LOSS_WEIGHT if attention else 0, 'teacherValue': 0},
            'sampling': 'seeded-shuffle-bounded-replay-pass',
            'dataContract':json.loads((ROOT/'tools/ai-trainer/learning-evidence-contract.json').read_text()),
            'fixtureContract': json.loads((ROOT/'tools/hosted-compute/fixture-contract.json').read_text()) if mode == 'closed-loop-fixture' else None,
            'teaching': attention_method['pilotRecipe'] if attention else 'none',
            'automaticSwitches': 'fixed-local-teaching-v2' if attention else 'curriculum.observe-source-bound',
            'sourceFiles': {name: hashlib.sha256((Path(__file__).resolve().parent/name).read_bytes()).hexdigest() for name in SOURCES}}


def record(checkpoint, data_sha256, *, mode, training_recipe=None, attention_method=None, policy_refresh=None):
    # The checkpoint hash binds optimizer tensors, RNG, replay list and cursor,
    # rather than reconstructing those from an unrelated main-branch default.
    from .checkpoint import inspect_checkpoint, weights_sha256
    from .portable import resolve_reference
    checkpoint=resolve_reference(checkpoint)
    meta = json.loads(resolve_reference(Path(checkpoint).with_suffix('.json')).read_text())
    state = inspect_checkpoint(checkpoint, manifest_sha256=meta['manifestSha256'])
    if state.get('trainingRecipe', recipe_binding()) != (training_recipe or recipe_binding()):
        raise ValueError('incumbent root recipe differs')
    expected_settings=settings(mode, training_recipe, attention_method,policy_refresh)
    if state.get('modelArchitecture', architecture_binding()) != expected_settings['architecture']:
        raise ValueError('incumbent architecture requires retained-branch audit')
    if any(group['lr']!=expected_settings['optimizer']['lr'] or group['weight_decay']!=expected_settings['optimizer']['weightDecay'] for group in state['optimizer']['param_groups']):
        raise ValueError('incumbent optimizer differs from actual method')
    return {'schema': 1, 'kind': 'execution-recipe', 'settings': expected_settings,
            'incumbent': {'checkpointSha256': meta['sha256'], 'weightsSha256': weights_sha256(state['model']),
                'manifestSha256': state['manifestSha256'], 'updates': state['updates'],
                'round': state['round'], 'replayIds': state['replayIds'],
                'optimizerRngReplayBinding': 'checkpoint-payload'}, 'dataSha256': data_sha256}


def verify_runtime(training_recipe=None, *, model=None, optimizer=None):
    if os.environ.get('RIGHELT_HOSTED') != '1' and os.environ.get('RIGHELT_EXPLORATORY_LOCAL') != '1':
        return None
    raw = Path(os.environ['RIGHELT_EXECUTION_RECIPE_PATH']).read_bytes()
    if hashlib.sha256(raw).hexdigest() != os.environ['RIGHELT_EXECUTION_RECIPE_SHA256']:
        raise ValueError('execution recipe bytes changed')
    value = json.loads(raw)
    if value.get('schema') != 1 or value.get('kind') != 'execution-recipe' or value['settings'] != settings(value['settings']['mode'], training_recipe or value['settings']['trainingRecipe'],value['settings'].get('attentionMethod'),value['settings'].get('policyRefresh')):
        raise ValueError('runtime differs from execution recipe')
    if model is not None and model_architecture(model) != value['settings']['architecture']:
        raise ValueError('runtime model architecture mismatch')
    if value['settings'].get('policyRefresh'):
        context=json.loads(Path(os.environ['RIGHELT_EXECUTION_CONTEXT']).read_bytes())
        if context['execution'].get('scientific',{}).get('arm')!='treatment':
            raise ValueError('policy refresh cannot change unchanged control')
    if optimizer is not None:
        import torch
        if not isinstance(optimizer, torch.optim.AdamW) or any(g['lr'] != value['settings']['optimizer']['lr'] or g['weight_decay'] != CONFIG['training']['weightDecay'] for g in optimizer.param_groups):
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
    from .portable import resolve_reference
    raw_hash = hashlib.sha256(resolve_reference(checkpoint).read_bytes()).hexdigest()
    if raw_hash != identity['inputCheckpointSha256'] and not any(a['sha256'] == raw_hash for a in context['recoveryFiles'] if a['path'].endswith('.pt')):
        raise ValueError('checkpoint not in incumbent or durable recovery chain')
    if raw_hash == identity['inputCheckpointSha256']:
        from .checkpoint import weights_sha256
        if weights_sha256(model.state_dict()) != value['incumbent']['weightsSha256']:
            raise ValueError('runtime weights differ from incumbent')
