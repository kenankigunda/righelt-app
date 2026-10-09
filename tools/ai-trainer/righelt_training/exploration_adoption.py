"""One immutable training recipe choice for each authorized initial allocation."""
from pathlib import Path

from .allocation import Allocation
from .continuation_policy import INITIAL_PHASES, FOLLOWUP_PHASE
from .development_probe import checked_ref, reference
from .exploration_receipt import validate_receipt
from .sequence import immutable, read
from .training_recipe import recipe_binding, record_recipe, validate_recipe, validate_decision_recipe

PROTOCOL = 'screen-selection-v1'
FIELD = 'explorationAdoption'


def required(continuation):
    if not continuation or 'explorationProtocol' not in continuation: return False
    if continuation['explorationProtocol'] != PROTOCOL: raise ValueError('unknown exploration continuation protocol')
    return True


def locate_receipt(directory):
    directory = Path(directory) / 'exploration-screen'
    # Reviewed repair supersedes old comparison evidence; an original on receipt
    # cannot silently regain authority after its comparison was quarantined.
    for name in ('receipt-repair.json', 'receipt-terminal.json', 'receipt-resolution.json', 'receipt.json'):
        path = directory / name
        if path.exists(): return path
    raise ValueError('training requires an immutable screen selection receipt')


def publish(directory, receipt_path):
    directory = Path(directory).resolve(); allocation = Allocation(directory.parent, directory)
    creation, _, pending = allocation.accounting()
    if pending: raise ValueError('adoption requires settled computation')
    contract = creation.get('continuation')
    if not required(contract) or contract['phase'] not in INITIAL_PHASES: raise ValueError('only initial-allocation screen may select a recipe')
    if Path(receipt_path).resolve() != locate_receipt(directory).resolve(): raise ValueError('superseded screen selection')
    receipt = validate_receipt(receipt_path, allocation)
    plan = read(checked_ref(receipt['plan']))
    value = {'schema': 1, 'kind': PROTOCOL, 'allocation': str(directory), 'allocationId': creation['id'],
             'sequenceId': contract['sequenceId'], 'receipt': reference(receipt_path), 'plan': receipt['plan'],
             'screenSource': plan['seedPlan']['source'], 'startingCheckpoint': plan['seedPlan']['checkpoint'],
             'trainingRecipe': validate_recipe(receipt['selectedRecipe'])}
    path = directory / 'recipe-adoption.json'; immutable(path, value)
    binding = reference(path); validate(binding, directory=directory)
    return binding


def read_binding(binding):
    value = read(checked_ref(binding))
    if (value.get('schema') != 1 or value.get('kind') != PROTOCOL
            or Path(binding['path']) != Path(value['allocation']) / 'recipe-adoption.json'):
        raise ValueError('invalid recipe adoption identity')
    validate_recipe(value.get('trainingRecipe'))
    return value


def validate(binding, *, directory=None, mode='admission'):
    value = read_binding(binding); source = Path(value['allocation']).resolve()
    if Path(binding['path']).resolve() != source / 'recipe-adoption.json': raise ValueError('noncanonical recipe adoption')
    allocation = Allocation(source.parent, source)
    creation, _, _ = allocation.accounting(); contract = creation.get('continuation')
    if (not required(contract) or contract['phase'] not in INITIAL_PHASES or creation['id'] != value['allocationId']
            or contract['sequenceId'] != value['sequenceId']):
        raise ValueError('adoption belongs to another source allocation')
    if checked_ref(value['receipt']).resolve() != locate_receipt(source).resolve(): raise ValueError('superseded adoption receipt')
    receipt = validate_receipt(value['receipt']['path'], allocation, mode=mode)
    plan = read(checked_ref(receipt['plan']))
    if (value['plan'] != receipt['plan'] or value['screenSource'] != plan['seedPlan']['source']
            or value['startingCheckpoint'] != plan['seedPlan']['checkpoint']
            or value['trainingRecipe'] != receipt['selectedRecipe']):
        raise ValueError('adoption differs from frozen screen choice')
    if directory is not None:
        target = Path(directory).resolve(); target_creation = Allocation(target.parent, target).accounting()[0]
        if target.parent != source.parent: raise ValueError('adoption target belongs to another archive')
        target_contract = target_creation.get('continuation')
        if not required(target_contract) or target_contract['sequenceId'] != value['sequenceId']:
            raise ValueError('adoption differs from target sequence')
        if target_contract['phase'] in INITIAL_PHASES:
            if target != source or target_creation['id'] != value['allocationId']: raise ValueError('wrong initial adoption allocation')
        elif target_contract['phase'] in ('twelve-hour', FOLLOWUP_PHASE):
            if target_contract.get(FIELD) != binding: raise ValueError('overnight recipe choice changed')
        else: raise ValueError('adoption has unsupported phase')
    return value


def for_allocation(directory, continuation, *, mode='admission'):
    if not required(continuation): return None
    binding = reference(Path(directory) / 'recipe-adoption.json') if continuation['phase'] in INITIAL_PHASES else continuation.get(FIELD)
    validate(binding, directory=directory, mode=mode)
    return binding


def manifest_binding(directory, manifest, *, mode='admission'):
    binding = for_allocation(directory, manifest.get('continuation'), mode=mode)
    if binding is None:
        if FIELD in manifest or record_recipe(manifest) != recipe_binding():
            raise ValueError('non-baseline training requires authorized recipe adoption')
        return None
    value = read_binding(binding)
    if manifest.get(FIELD) != binding or record_recipe(manifest) != value['trainingRecipe']:
        raise ValueError('manifest differs from authorized recipe adoption')
    return binding


def admission(directory, continuation):
    binding = for_allocation(directory, continuation)
    if binding is None: return None
    value = read_binding(binding); allocation = Allocation(Path(directory).parent, directory)
    creation, _, pending = allocation.accounting()
    if pending: raise ValueError('training admission requires an exclusive settled allocation')
    claim = {'schema': 1, 'allocationId': creation['id'], 'sequenceId': continuation['sequenceId'],
             'phase': continuation['phase'], FIELD: binding, 'trainingRecipe': value['trainingRecipe']}
    immutable(Path(directory) / 'training-admission.json', claim)
    return claim


def first_manifest_source(manifest, repair):
    """Keep a reviewed bridge if code changed after selection, before training."""
    binding = manifest.get(FIELD)
    if binding is None: return
    old = read_binding(binding)['screenSource']['sourceRevision']
    new = manifest['sourceRevision']
    if old == new: return
    if (repair.get('sourceRevision') != new or repair.get('screenSelectionCompatible') is not True
            or not repair.get('cause') or not repair.get('artifactDisposition')):
        raise ValueError('reviewed source amendment must preserve the frozen screen selection')
    for key in ('regressionEvidence', 'reviewEvidence'):
        records = repair.get(key)
        if not isinstance(records, list) or not records: raise ValueError('screen source amendment lacks evidence')
        for record in records: checked_ref(record)
    manifest['explorationSourceAmendment'] = {**repair, 'oldSourceRevision': old, 'newSourceRevision': new}


def checkpoint_recipe(checkpoint, data, *, recipe, binding=None, continuation=None):
    """Only the exact authorized initial starting bundle may predate adoption."""
    actual = record_recipe(data)
    if binding is None:
        if actual != recipe or FIELD in data: raise ValueError('checkpoint recipe differs from experiment')
        return
    adoption = read_binding(binding)
    starting = (continuation and continuation['phase'] in INITIAL_PHASES
                and Path(checkpoint).resolve() == Path(adoption['startingCheckpoint']['path'])
                and reference(checkpoint) == adoption['startingCheckpoint'])
    if starting:
        if actual != recipe_binding() or FIELD in data: raise ValueError('approved starting bundle must retain baseline identity')
    elif actual != recipe or data.get(FIELD) != binding:
        raise ValueError('recovery changed selected recipe or adoption')


def authorize_job(job, recipe, binding):
    if binding is None: return job
    if job.get('command') != 'generate' or job.get('partition') != 'train': raise ValueError('recipe option only belongs to self-play')
    expected = {'trainingRecipe': recipe, FIELD: binding,
                'rootExploration': {'purpose': 'self-play', 'recipe': recipe}}
    if any(key in job and job[key] != value for key, value in expected.items()):
        raise ValueError('deferred job changed its bound recipe or adoption')
    # A merely deferred inherited job retains its ID, seed, category and model.
    return {**job, **expected}


def validate_game(game, recipe, binding):
    if game.get('partition') != 'train' or game.get('kind') == 'exploration-screen': raise ValueError('screen records cannot enter training')
    if record_recipe(game) != recipe or (binding is not None and game.get(FIELD) != binding):
        raise ValueError('new game differs from authorized recipe adoption')
    for decision in game['decisions']:
        if validate_decision_recipe(decision) != recipe or (binding is not None and decision.get(FIELD) != binding):
            raise ValueError('new decision changed recipe or adoption')


def report(directory, binding):
    value = validate(binding, directory=directory, mode='provenance')
    receipt = read(value['receipt']['path'])
    return {'adoption': binding, 'trainingRecipe': value['trainingRecipe'], 'receipt': value['receipt'],
            'screenReport': receipt['report'], 'scope': receipt['report']['scope']}
