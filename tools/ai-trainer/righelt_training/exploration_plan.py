"""Immutable development-only exploration workload, separate from training data."""
import copy
import hashlib
import json
from pathlib import Path
import re

from .bootstrap import source_identity, runtime_identity
from .config import CONFIG_SHA256
from .development_probe import load_cases, corpus_rows, reference, checked_ref, checksum
from .resource_policy import manifest_fields
from .sequence import immutable, read
from .training_recipe import recipe_binding


KIND = 'root-exploration-screen-v1'
LIMITS = {'screenSeconds': 1800, 'validationReserveSeconds': 3600, 'selectionSeconds': 20,
          'replaySeconds': 10, 'cleanupSeconds': 5, 'publicationSeconds': 10, 'pairAdmissionSeconds': 80,
          'startupSeconds': 30, 'roots': 20, 'families': 5, 'replicates': 6, 'pairs': 120, 'attempts': 240}
PROFILE = {'simulations': 64, 'temperature': 1, 'maxValueGap': .1, 'maxNodes': 2048, 'decisionCache': False}
SEED_DERIVATION = 'sha256-exploration-root-replicate-v1'


def derived_seed(seed_plan_sha256, root_id, replicate):
    value = f'righelt/{SEED_DERIVATION}\0{seed_plan_sha256}\0{root_id}\0{replicate}'
    return int.from_bytes(hashlib.sha256(value.encode()).digest()[:4], 'big')


def freeze(cases, rows, *, cases_ref, checkpoint, allocation_id, source, runtime):
    if (len(cases.get('cases', [])) != LIMITS['roots'] or cases.get('missingCoverage') or
            cases.get('configSha256') != CONFIG_SHA256 or not isinstance(allocation_id, str) or not allocation_id):
        raise ValueError('screen requires the twenty frozen development roots and allocation identity')
    roots = []
    for case in cases['cases']:
        row = rows[case['corpusIndex']]
        if (case['id'] != row['id'] or case['rowSha256'] != checksum(row) or case['stateHash'] != row['hash'] or
                row['partition'] != 'validation' or row['familyId'] != row['id'].rsplit(':', 1)[0] or
                not row['familyId'].startswith('export-validation-')):
            raise ValueError('screen root differs from frozen development case')
        roots.append({**case, 'familyId': row['familyId']})
    if len({root['id'] for root in roots}) != LIMITS['roots'] or len({root['familyId'] for root in roots}) != LIMITS['families']:
        raise ValueError('screen requires twenty roots from five archive families')
    if (not re.fullmatch('[0-9a-f]{40}', source.get('sourceRevision', '')) or source.get('configSha256') != CONFIG_SHA256 or
            any(not isinstance(source.get(key), dict) or not source[key] for key in ('proofDependencies', 'bootstrapDependencies')) or
            not isinstance(runtime, dict) or not runtime):
        raise ValueError('screen source and runtime identities are required')
    seed_plan = {'kind': KIND, 'cases': cases_ref, 'corpus': cases['corpus'], 'checkpoint': checkpoint,
                 'allocationId': allocation_id, 'source': source, 'runtime': runtime,
                 'profile': PROFILE, 'resourcePolicy': manifest_fields(), 'limits': LIMITS,
                 'recipes': {'off': recipe_binding(), 'on': recipe_binding('root-dirichlet-v1')},
                 'seedDerivation': SEED_DERIVATION, 'roots': roots,
                 'ordering': '(rootOrdinal + replicateOrdinal) % 2', 'partition': 'development',
                 'finalChoiceStream': 'search-seeded-v1'}
    seed_hash = checksum(seed_plan)
    slots = []
    for replicate in range(LIMITS['replicates']):
        for ordinal, root in enumerate(roots):
            pair = replicate * LIMITS['roots'] + ordinal
            seed = derived_seed(seed_hash, root['id'], replicate)
            order = ['on', 'off'] if (ordinal + replicate) % 2 else ['off', 'on']
            for arm in order:
                slots.append({'id': f'{allocation_id}:exploration:{seed_hash}:{pair}:{arm}', 'pair': pair,
                              'rootOrdinal': ordinal, 'rootId': root['id'], 'replicate': replicate,
                              'arm': arm, 'seed': seed})
    return copy.deepcopy({'schema': 1, 'kind': KIND, 'seedPlan': seed_plan, 'seedPlanSha256': seed_hash, 'slots': slots})


def prepare(cases_path, checkpoint, allocation_id, output):
    cases = load_cases(cases_path)
    plan = freeze(cases, corpus_rows(checked_ref(cases['corpus'])), cases_ref=reference(cases_path),
                  checkpoint=reference(checkpoint), allocation_id=allocation_id, source=source_identity(), runtime=runtime_identity())
    target = Path(output)
    if target.exists():
        if read(target) != plan:
            raise ValueError('screen manifest already frozen with different inputs')
    else:
        immutable(target, plan)
    return plan


def validate(plan, *, current_source=False):
    seed = plan['seedPlan']
    cases = load_cases(checked_ref(seed['cases']))
    checked_ref(seed['checkpoint'])
    expected = freeze(cases, corpus_rows(checked_ref(seed['corpus'])), cases_ref=seed['cases'], checkpoint=seed['checkpoint'],
                      allocation_id=seed['allocationId'], source=seed['source'], runtime=seed['runtime'])
    if plan != expected:
        raise ValueError('screen manifest, slots or seeds changed')
    if current_source and (seed['source'] != source_identity() or seed['runtime'] != runtime_identity()):
        raise ValueError('screen source or runtime changed; do not pool incompatible observations')
    return plan


def slot_name(slot):
    return hashlib.sha256(slot['id'].encode()).hexdigest()
