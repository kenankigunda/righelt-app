"""One explicitly authorized training hour, added without rewriting an allocation.

The original contract and manifest retain their original allowance. Only the
validated append-only event changes effective accounting and future deadlines.
Apply while holding coordinator.lock, then supervisor.lock, with compute stopped.
"""
import argparse
import fcntl
import json
import os
from pathlib import Path
import time
import psutil

from .continuation_policy import checked, read, reference, accounting_hash

KIND = 'single-training-hour-v1'
EVENT = 'budget-extended'
ADDITIONAL_SECONDS = 3600
ORIGINAL_SECONDS = 28800
TOTAL_SECONDS = ORIGINAL_SECONDS + ADDITIONAL_SECONDS
RESERVE_SECONDS = 3600


def original_seconds(creation):
    return creation.get('originalSeconds', creation['seconds'])


def validate_event(event, prefix, root, directory):
    """Recheck immutable authority and the exact settled historical prefix."""
    from .allocation import contract_hash
    if not prefix or prefix[0]['event'] != 'created':
        raise ValueError('extension lacks original allocation')
    creation = prefix[0]; contract = creation.get('continuation', {})
    value = read(checked(event['evidence'], root))
    expected = {'schema': 1, 'kind': KIND, 'allocationId': creation['id'],
                'runDirectory': str(Path(directory).resolve()), 'sequenceId': contract.get('sequenceId'),
                'originalBudgetSeconds': ORIGINAL_SECONDS, 'additionalTrainingSeconds': ADDITIONAL_SECONDS,
                'newBudgetSeconds': TOTAL_SECONDS, 'reserveSeconds': RESERVE_SECONDS,
                'stopAfter': True, 'sameExperiment': True, 'preserveHistoricalCharges': True,
                'originalContractSha256': contract_hash(contract),
                'accountingBeforeSha256': accounting_hash(prefix)}
    if any(value.get(k) != v for k, v in expected.items()):
        raise ValueError('extension differs from exact one-hour authority or accounting')
    if (creation['seconds'] != ORIGINAL_SECONDS or contract.get('phase') != 'eight-hour'
            or contract.get('budgetSeconds') != ORIGINAL_SECONDS or contract.get('reserveSeconds') != RESERVE_SECONDS
            or creation.get('contractSha256') != contract_hash(contract)
            or event.get('allocation') != str(Path(directory).resolve())
            or event.get('allocationId') != creation['id'] or event.get('event') != EVENT
            or any(r['event'] == EVENT for r in prefix)):
        raise ValueError('extension requires original single eight-hour allocation')
    starts = {r['id']: r for r in prefix if r['event'] == 'started'}
    ends = {r['id']: r for r in prefix if r['event'] == 'finished'}
    if (starts.keys() != ends.keys() or not any(r['phase'] == 'training' for r in starts.values())
            or any(r['phase'] not in ('exploration-screen', 'training') for r in starts.values())):
        raise ValueError('extension requires settled training before final audits')
    charged = sum(r['chargedSeconds'] for r in ends.values())
    if value.get('chargedSecondsBefore') != charged or not 0 <= charged < ORIGINAL_SECONDS:
        raise ValueError('extension historical charges changed or original allocation exhausted')
    authority = read(checked(value['authority'], root))
    authority_expected = {k: expected[k] for k in ('allocationId', 'originalBudgetSeconds',
        'additionalTrainingSeconds', 'newBudgetSeconds', 'reserveSeconds', 'sameExperiment', 'preserveHistoricalCharges')}
    if (authority.get('verifiedHumanInstruction') is not True or not authority.get('threadId')
            or not authority.get('instruction') or any(authority.get(k) != v for k,v in authority_expected.items())):
        raise ValueError('extension requires direct human authority for this allocation and hour')
    return value


def effective_creation(events, root, directory):
    indexes = [i for i, row in enumerate(events) if row['event'] == EVENT]
    if not indexes: return events[0]
    if len(indexes) != 1: raise ValueError('only one training-hour extension is authorized')
    i = indexes[0]; event = events[i]
    validate_event(event, events[:i], root, directory)
    return {**events[0], 'originalSeconds': ORIGINAL_SECONDS, 'seconds': TOTAL_SECONDS,
            'budgetExtension': event['evidence']}


def owned_compute_absent(directory):
    """Read-only check also finds detached descendants after their leader exits."""
    from .allocation import rows
    records = rows(Path(directory)/'process-ownership.jsonl')
    tokens = {r['groupToken'] for r in records if r.get('groupToken')}
    earliest = min((r['created'] for r in records), default=float('inf'))
    for process in psutil.process_iter():
        try:
            born = process.create_time()
            if born < earliest or process.uids().real != os.getuid() or process.status() == psutil.STATUS_ZOMBIE:
                continue
            exact = any(process.pid == r['pid'] and born == r['created'] for r in records)
            if exact: return False
            try: token = process.environ().get('RIGHELT_COMPUTE_GROUP_TOKEN')
            except psutil.AccessDenied:
                if any(os.getpgid(process.pid) == r.get('group') for r in records): raise
                continue
            if token in tokens: return False
        except psutil.NoSuchProcess: continue
    return True


def apply_extension(allocation, evidence_path):
    from .allocation import append, validate_contract
    from .continuation_policy import ensure_compute_open
    creation, charged, pending = allocation.accounting()
    if pending: raise ValueError('stop and settle compute before extending')
    if not owned_compute_absent(allocation.directory):
        raise ValueError('owned compute must be absent before extending')
    validate_contract(creation.get('continuation'), allocation.root, allocation.directory)
    ensure_compute_open(creation, allocation.root, allocation.directory)
    evidence = reference(evidence_path)
    existing = [r for r in allocation.events() if r['event'] == EVENT]
    if existing:
        if existing[0]['evidence'] != evidence: raise ValueError('training-hour extension already frozen')
        return existing[0]
    if (allocation.directory/'phase-receipts'/'training.json').exists():
        raise ValueError('training already finalized; extension is not another phase')
    # A completed, validated adoption is required. The extra hour never admits
    # another exploration screen or changes its historical budget.
    from .exploration_adoption import for_allocation
    if not for_allocation(allocation.directory, creation['continuation']):
        raise ValueError('extension requires completed exploration adoption')
    event = {'event': EVENT, 'allocation': allocation.key, 'allocationId': creation['id'],
             'evidence': evidence, 'observedAt': time.time()}
    validate_event(event, allocation.events(), allocation.root, allocation.directory)
    append(allocation.path, event)
    return event


def main():
    from .allocation import Allocation
    parser = argparse.ArgumentParser()
    parser.add_argument('--archive', type=Path, required=True)
    parser.add_argument('--target', type=Path, required=True)
    parser.add_argument('--evidence', type=Path, required=True)
    args = parser.parse_args()
    with (args.archive/'coordinator.lock').open('a+') as coordinator:
        fcntl.flock(coordinator, fcntl.LOCK_EX | fcntl.LOCK_NB)
        with (args.archive/'supervisor.lock').open('a+') as supervisor:
            fcntl.flock(supervisor, fcntl.LOCK_EX | fcntl.LOCK_NB)
            print(json.dumps(apply_extension(Allocation(args.archive, args.target), args.evidence)))


if __name__ == '__main__': main()
