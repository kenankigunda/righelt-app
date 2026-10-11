"""One separately authorized follow-up after a closed eight-hour experiment.

The registry is separate from the predecessor amendment. It cannot reopen the
predecessor, replace its accounting, or authorize a third allocation.
"""
import argparse
import fcntl
import hashlib
import json
from pathlib import Path

POLICY = json.loads((Path(__file__).resolve().parents[1] / 'followup-policy-v1.json').read_text())
PHASE = POLICY['phase']
FIELD = 'followupAuthorization'
KIND = 'separate-eight-hour-followup-v1'


def validate_launch(contract, seed, stage):
    if contract and contract.get('phase') == PHASE:
        if contract.get('seed') != POLICY['seed'] or seed != POLICY['seed'] or stage != POLICY['stage']:
            raise ValueError('follow-up requires preserved initial stage and seed 107')


def read(path):
    return json.loads(Path(path).read_text())


def reference(path):
    path = Path(path).resolve()
    return {'path': str(path), 'sha256': hashlib.sha256(path.read_bytes()).hexdigest()}


def checked(ref, root):
    path = Path(ref['path']).resolve()
    if not path.is_relative_to(Path(root).resolve()) or reference(path) != ref:
        raise ValueError('follow-up reference changed or outside archive')
    return path


def registry_path(root, sequence_id):
    return Path(root).resolve() / 'followup-authorizations' / (hashlib.sha256(sequence_id.encode()).hexdigest() + '.json')


def validate(value, root):
    from .allocation import Allocation
    root = Path(root).resolve()
    expected = {'schema': 1, 'kind': KIND, 'phase': PHASE, 'stopAfter': True,
                'budgetSeconds': POLICY['budgetSeconds'], 'reserveSeconds': POLICY['reserveSeconds'],
                'runDirectory': str(root / 'followup-eight-hour-r1')}
    if any(value.get(k) != v for k, v in expected.items()) or not value.get('sequenceId'):
        raise ValueError('invalid one-run follow-up authorization')
    authority = read(checked(value['authority'], root))
    scope = authority.get('authorization', {})
    if (scope.get('followupRuns') != 1 or scope.get('followupBudgetSeconds') != POLICY['budgetSeconds']
            or not authority.get('requestText') or not authority.get('source', '').startswith('Direct human message')):
        raise ValueError('follow-up lacks direct one-run human authority')
    predecessor_path = checked(value['predecessorReport'], root)
    predecessor = read(predecessor_path)
    if (predecessor.get('phase') != 'eight-hour' or predecessor.get('sequenceId') != value['sequenceId']
            or predecessor.get('experimentComplete') is not True or predecessor.get('healthAudited') is not True
            or predecessor.get('continuationAllowed') is not False or predecessor.get('advancementEligible') is not False):
        raise ValueError('follow-up requires the closed predecessor evaluation')
    stage_path = checked({'path': predecessor['evidence'], 'sha256': predecessor['evidenceSha256']}, root)
    source = stage_path.parent
    terminal = read(source / 'experiment-finished.json')
    if terminal.get('result') != reference(stage_path):
        raise ValueError('predecessor terminal binding changed')
    creation, charged, pending = Allocation(root, source).accounting()
    if (pending or creation['id'] != predecessor.get('allocationId')
            or charged != predecessor.get('chargedSeconds')):
        raise ValueError('predecessor accounting is not settled at its report')
    cleanup = read(checked(value['predecessorCleanup'], root))
    if (cleanup.get('allocation', {}).get('id') != creation['id']
            or cleanup['allocation'].get('chargedSeconds') != charged
            or cleanup['allocation'].get('openIntervals') != []
            or not cleanup.get('processes') or any(p.get('matchingLive') is not False for p in cleanup['processes'])
            or not cleanup.get('locks') or any(v != 'free' for v in cleanup['locks'].values())):
        raise ValueError('predecessor cleanup proof incomplete')
    checkpoint = checked(value['recoveryCheckpoint'], root)
    if str(checkpoint) != predecessor['recoveryCheckpoint'] or reference(checkpoint)['sha256'] != predecessor['recoverySha256']:
        raise ValueError('follow-up must inherit the evaluated checkpoint')
    if checked(value['recoveryMetadata'], root) != checkpoint.with_suffix('.json') or checked(value['recoverySidecar'], root) != checkpoint.with_suffix('.runner.json'):
        raise ValueError('follow-up recovery companions changed')
    from .manifest import manifest_hashes
    digest = read(checkpoint.with_suffix('.json'))['manifestSha256']
    if digest not in manifest_hashes(source): raise ValueError('follow-up recovery lineage changed')
    origin = read(source / 'manifest.json')
    if origin['sha256'] != digest: origin = read(source / 'manifests' / f'{digest}.json')
    if (hashlib.sha256(json.dumps(origin['manifest'], sort_keys=True, allow_nan=False).encode()).hexdigest() != digest
            or origin['manifest']['seed'] != POLICY['seed'] or origin['manifest']['stage'] != POLICY['stage']):
        raise ValueError('follow-up must preserve source stage and seed 107')
    design_path = checked(value['design'], root); design = read(design_path)
    review = read(checked(value['designReview'], root))
    if (design.get('status') != 'frozen' or design.get('selectedAt', 0) < cleanup.get('observedAt', float('inf'))
            or design.get('predecessor') != value['predecessorReport']
            or design.get('authority') != value['authority']
            or design.get('policy') != POLICY
            or review.get('passed') is not True or review.get('design') != reference(design_path)):
        raise ValueError('follow-up design must be selected after evaluation and independently reviewed')
    if value.get('explorationAdoption') != predecessor.get('explorationAdoption') or value.get('trainingRecipe') != predecessor.get('trainingRecipe'):
        raise ValueError('follow-up changed inherited recipe selection')
    lineage = value.get('sourceLineage', {})
    revision = lineage.get('preparedRevision', '')
    if len(revision) != 40 or any(c not in '0123456789abcdef' for c in revision):
        raise ValueError('follow-up source revision missing')
    for key in ('regressionEvidence', 'reviewEvidence'):
        refs = lineage.get(key)
        if not isinstance(refs, list) or not refs:
            raise ValueError('follow-up source lacks correctness/budget/recovery evidence')
        for ref in refs: checked(ref, root)
    return value


def registered(root, sequence_id):
    path = registry_path(root, sequence_id)
    if not path.exists():
        raise ValueError('follow-up has not been explicitly registered')
    entry = read(path)
    value = validate(read(checked(entry['authorization'], root)), root)
    if entry.get('sequenceId') != sequence_id or value['sequenceId'] != sequence_id:
        raise ValueError('follow-up registry identity changed')
    return value, entry['authorization']


def register(root, evidence):
    """Caller holds the global coordinator and supervisor locks."""
    from .allocation import rows
    from .sequence import immutable
    ref = reference(evidence); value = validate(read(checked(ref, root)), root)
    path = registry_path(root, value['sequenceId'])
    if path.exists():
        if registered(root, value['sequenceId']) != (value, ref):
            raise ValueError('follow-up authorization already frozen')
        return ref
    for row in rows(Path(root) / 'allocation-events.jsonl'):
        if row['event'] == 'created' and (row.get('continuation', {}).get('phase') == PHASE
                or row['allocation'] == value['runDirectory']):
            raise ValueError('follow-up allocation already claimed')
    immutable(path, {'sequenceId': value['sequenceId'], 'authorization': ref})
    return ref


def contract_for(value, ref):
    return {'sequenceId': value['sequenceId'], 'phase': PHASE, FIELD: ref,
            'budgetSeconds': POLICY['budgetSeconds'], 'reserveSeconds': POLICY['reserveSeconds'],
            'preserveState': True, 'freshHealth': True, 'seed': POLICY['seed'],
            'recoveryCheckpoint': value['recoveryCheckpoint']['path'], 'recoverySha256': value['recoveryCheckpoint']['sha256'],
            'predecessorEvidence': value['predecessorReport']['path'], 'predecessorEvidenceSha256': value['predecessorReport']['sha256'],
            'explorationProtocol': 'screen-selection-v1', 'explorationAdoption': value['explorationAdoption']}


def authorize(contract, root, directory=None):
    value, ref = registered(root, contract['sequenceId'])
    if contract != contract_for(value, ref):
        raise ValueError('contract differs from frozen follow-up authorization')
    if directory is not None and Path(directory).resolve() != Path(value['runDirectory']):
        raise ValueError('follow-up allocation destination changed')
    return value


def ensure_open(directory):
    directory = Path(directory)
    result = directory / 'stage-result.json'
    if (directory / 'experiment-finished.json').exists() or (result.exists() and read(result).get('experimentComplete') is True):
        raise ValueError('follow-up finished; no further computation authorized')


def main():
    from .allocation import Allocation
    from .sequence import immutable
    parser = argparse.ArgumentParser(); parser.add_argument('--archive', type=Path, required=True)
    sub = parser.add_subparsers(dest='command', required=True)
    reg = sub.add_parser('register'); reg.add_argument('--evidence', type=Path, required=True)
    claim = sub.add_parser('claim'); claim.add_argument('--sequence-id', required=True)
    args = parser.parse_args(); root = args.archive.resolve()
    with (root / 'coordinator.lock').open('a+') as coordinator, (root / 'supervisor.lock').open('a+') as supervisor:
        fcntl.flock(coordinator, fcntl.LOCK_EX | fcntl.LOCK_NB)
        fcntl.flock(supervisor, fcntl.LOCK_EX | fcntl.LOCK_NB)
        if args.command == 'register': result = register(root, args.evidence)
        else:
            value, ref = registered(root, args.sequence_id); contract = contract_for(value, ref)
            directory = Path(value['runDirectory']); ensure_open(directory)
            creation = Allocation(root, directory).create_continuation(contract)
            immutable(directory / 'continuation.json', contract)
            result = {'allocationId': creation['id'], 'runDirectory': str(directory), 'contract': str(directory / 'continuation.json')}
    print(json.dumps(result, sort_keys=True))


if __name__ == '__main__':
    main()
