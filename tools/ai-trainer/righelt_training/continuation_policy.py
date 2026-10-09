"""Fixed continuation budgets and an explicit, one-run authorization amendment.

The archive registry is authoritative even when a caller omits the amendment
from a contract. Historical reports and sequence configuration are never edited.
"""
import hashlib
import json
from pathlib import Path
import re
from .followup_policy import PHASE as FOLLOWUP_PHASE, POLICY as FOLLOWUP_POLICY

LIMITS = {'six-hour': (21600, 3600), 'eight-hour': (28800, 3600), 'twelve-hour': (43200, 7200),
          FOLLOWUP_PHASE: (FOLLOWUP_POLICY['budgetSeconds'], FOLLOWUP_POLICY['reserveSeconds'])}
BOUNDED_PHASES = frozenset(('eight-hour', FOLLOWUP_PHASE))

def stage_for_phase(phase):
    return 'initial' if phase in ('six-hour', 'eight-hour', FOLLOWUP_PHASE) else 'overnight'

INITIAL_PHASES = frozenset(('six-hour', 'eight-hour'))
LEGACY_PHASES = ('diagnostic', 'six-hour', 'twelve-hour')
KIND = 'single-eight-hour-v1'
FIELD = 'sequenceAmendment'


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def reference(path):
    return {'path': str(Path(path).resolve()), 'sha256': digest(path)}


def read(path):
    return json.loads(Path(path).read_text())


def checked(ref, root):
    path = Path(ref['path']).resolve()
    if not path.is_relative_to(Path(root).resolve()) or reference(path) != ref:
        raise ValueError('amendment evidence changed or outside archive')
    return path


def registry_path(root, sequence_id):
    return Path(root).resolve() / 'sequence-amendments' / (hashlib.sha256(sequence_id.encode()).hexdigest() + '.json')


def accounting_hash(events):
    return hashlib.sha256(json.dumps(events, sort_keys=True, allow_nan=False).encode()).hexdigest()


def validate(value, root):
    from .allocation import Allocation
    root = Path(root).resolve()
    if (value.get('schema') != 1 or value.get('kind') != KIND
            or not isinstance(value.get('sequenceId'), str) or not value['sequenceId']
            or value.get('phase') != 'eight-hour' or value.get('stopAfter') is not True
            or (value.get('budgetSeconds'), value.get('reserveSeconds')) != LIMITS['eight-hour']
            or value.get('explorationSeconds') != 1800
            or value.get('exception') != 'terminal-games-15-of-16'
            or value.get('supersedes') != ['six-hour', 'twelve-hour']):
        raise ValueError('invalid single-run amendment')
    config_path = checked(value['sequenceConfig'], root)
    config = read(config_path)
    if config_path.name != 'sequence.json' or config_path.parent.parent != root or config['sequenceId'] != value['sequenceId']:
        raise ValueError('amendment sequence identity mismatch')
    destination = Path(value['runDirectory']).resolve()
    if destination != root / 'restart-eight-hour-r1':
        raise ValueError('amendment requires canonical eight-hour destination')
    report_path = checked(value['diagnosticReport'], root)
    if report_path != config_path.parent / 'reports' / 'diagnostic.json':
        raise ValueError('amendment diagnostic report belongs to another sequence')
    raw_path = checked(value['diagnosticEvidence'], root)
    report, raw = read(report_path), read(raw_path)
    if (report.get('phase') != 'diagnostic' or report.get('sequenceId') != config['sequenceId']
            or report.get('advancementEligible') is not False
            or report.get('evidence') != str(raw_path) or report.get('evidenceSha256') != digest(raw_path)
            or not raw_path.is_relative_to(Path(config['diagnosticDirectory']).resolve())):
        raise ValueError('amendment must preserve the sealed failed diagnostic')
    for proof in (report, raw):
        if (proof.get('diagnosticGatePassed') is not False or proof.get('allAttemptsAccounted') is not True
                or proof.get('terminalGames') != 15 or proof.get('scheduledGames') != 20
                or proof.get('workload') != 'restart-diagnostic-20-v1'
                or proof.get('reason') != 'diagnostic-incomplete-matches'):
            raise ValueError('amendment only accepts the exact terminal-count shortfall')
    allocation = Allocation(root, config['diagnosticDirectory'])
    creation, charged, pending = allocation.accounting()
    if (creation['id'] != config['diagnosticAllocationId'] or creation['id'] != value['diagnosticAllocationId']
            or report.get('allocationId') != creation['id'] or creation['seconds'] != 7200
            or pending or report.get('chargedSeconds') != charged
            or accounting_hash(allocation.events()) != value['diagnosticAccountingSha256']):
        raise ValueError('diagnostic accounting changed or unsettled')
    checkpoint = checked(value['recoveryCheckpoint'], root)
    if str(checkpoint) != config['recoveryCheckpoint'] or digest(checkpoint) != config['recoverySha256']:
        raise ValueError('amendment recovery checkpoint changed')
    if (checked(value['recoveryMetadata'], root) != checkpoint.with_suffix('.json')
            or checked(value['recoverySidecar'], root) != checkpoint.with_suffix('.runner.json')):
        raise ValueError('amendment recovery companions changed')
    audit = read(checked(value['recoveryAudit'], root))
    if (audit.get('passed') is not True or audit.get('checkpoint') != str(checkpoint)
            or audit.get('sha256') != digest(checkpoint) or audit.get('optimizerRestored') is not True
            or audit.get('randomStateRestored') is not True):
        raise ValueError('amendment recovery audit failed')
    authority = read(checked(value['authority'], root))
    if (authority.get('verifiedHumanInstruction') is not True or not authority.get('threadId')
            or not authority.get('messageId') or not authority.get('instruction')):
        raise ValueError('amendment requires a verified direct human instruction')
    source = value.get('sourceLineage', {})
    if (source.get('diagnosticRevision') != raw.get('sourceRevision')
            or not re.fullmatch(r'[0-9a-f]{40}', source.get('preparedRevision', ''))):
        raise ValueError('amendment source lineage missing')
    bridge = read(checked(source['reviewedBridge'], root))
    if (bridge.get('schema') != 1 or bridge.get('passed') is not True
            or bridge.get('fromRevision') != source['diagnosticRevision']
            or bridge.get('toRevision') != source['preparedRevision']
            or bridge.get('compatibleModelProof') is not True):
        raise ValueError('amendment source bridge is not approved for these revisions')
    for field in ('regressionEvidence', 'reviewEvidence'):
        records = bridge.get(field)
        if not isinstance(records, list) or not records:
            raise ValueError('amendment source bridge lacks review/regression evidence')
        for ref in records: checked(ref, root)
    return value


def registered(root, sequence_id):
    path = registry_path(root, sequence_id)
    if not path.exists():
        return None
    entry = read(path)
    value = validate(read(checked(entry['amendment'], root)), root)
    if entry.get('sequenceId') != sequence_id or value['sequenceId'] != sequence_id:
        raise ValueError('amendment registry identity changed')
    return value, entry['amendment']


def register(directory, amendment_path):
    """Caller holds coordinator then supervisor locks, including publication."""
    from .allocation import rows
    from .sequence import immutable
    directory = Path(directory).resolve(); root = directory.parent
    ref = reference(amendment_path)
    value = validate(read(checked(ref, root)), root)
    if checked(value['sequenceConfig'], root) != directory / 'sequence.json':
        raise ValueError('amendment belongs to another coordinator')
    existing = registered(root, value['sequenceId'])
    if existing:
        if existing != (value, ref): raise ValueError('sequence amendment already frozen')
        return ref
    for row in rows(root / 'allocation-events.jsonl'):
        if row['event'] == 'created' and (row.get('continuation', {}).get('sequenceId') == value['sequenceId']
                                         or Path(row['allocation']).resolve() == Path(value['runDirectory'])):
            raise ValueError('continuation allocation already claimed')
    for phase in LIMITS:
        if any((directory / part / f'{phase}.json').exists() for part in ('claims', 'contracts', 'reports')):
            raise ValueError('continuation already published')
    immutable(registry_path(root, value['sequenceId']), {'sequenceId': value['sequenceId'], 'amendment': ref})
    return ref


def authorize(contract, root, directory=None):
    """Shared admission for new allocations, recovery and sequence progression."""
    if contract.get('phase') == FOLLOWUP_PHASE:
        from .followup_policy import authorize as authorize_followup
        return authorize_followup(contract, root, directory)
    found = registered(root, contract['sequenceId'])
    if found is None:
        if contract.get('phase') == 'eight-hour' or FIELD in contract:
            raise ValueError('eight-hour continuation requires registered amendment')
        return None
    value, ref = found
    expected = {'phase': 'eight-hour', FIELD: ref, 'budgetSeconds': value['budgetSeconds'],
                'explorationProtocol': 'screen-selection-v1',
                'reserveSeconds': value['reserveSeconds'], 'recoveryCheckpoint': value['recoveryCheckpoint']['path'],
                'recoverySha256': value['recoveryCheckpoint']['sha256'],
                'predecessorEvidence': value['diagnosticEvidence']['path'],
                'predecessorEvidenceSha256': value['diagnosticEvidence']['sha256']}
    if any(contract.get(key) != item for key, item in expected.items()):
        raise ValueError('contract differs from registered eight-hour amendment')
    if directory is not None and Path(directory).resolve() != Path(value['runDirectory']):
        raise ValueError('amendment allocation destination changed')
    return value


def validate_source(contract, root, directory, revision, gate):
    value = authorize(contract, root, directory)
    if value is None: return
    prepared = value['sourceLineage']['preparedRevision']
    from .manifest import active_manifest
    path = Path(directory)
    prior = active_manifest(path)['manifest']['sourceRevision'] if (path / 'manifest.json').exists() else prepared
    if revision == prior: return
    repair = gate.get('repair', {})
    if (repair.get('oldRevision') != prior or repair.get('sourceRevision') != revision
            or not repair.get('cause') or not repair.get('artifactDisposition')):
        raise ValueError('eight-hour source change requires an explicit reviewed bridge')
    for field in ('regressionEvidence', 'reviewEvidence'):
        records = repair.get(field)
        if not isinstance(records, list) or not records:
            raise ValueError('eight-hour source bridge lacks evidence')
        for ref in records: checked(ref, root)


def ensure_compute_open(creation, root, directory):
    contract = creation.get('continuation')
    if not contract: return
    value = authorize(contract, root, directory)
    if value is None: return
    if contract['phase'] == FOLLOWUP_PHASE:
        from .followup_policy import ensure_open
        ensure_open(directory)
        return
    report = Path(value['sequenceConfig']['path']).parent / 'reports' / 'eight-hour.json'
    stage = Path(directory) / 'stage-result.json'
    if report.exists() or (Path(directory)/'experiment-finished.json').exists() or (stage.exists() and read(stage).get('experimentComplete') is True):
        raise ValueError('eight-hour experiment finished; further computation is not authorized')
