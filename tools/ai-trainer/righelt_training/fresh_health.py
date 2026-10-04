"""Allocation-scoped evidence, retained inside the checkpoint recovery bundle.

The archive and event directories are not a source of positive training evidence.
Only receipts and update witnesses carried by the selected checkpoint qualify.
"""
import gzip
import hashlib
import json
import math
import os
from pathlib import Path
import uuid

from .allocation import Allocation, rows
from .checkpoint import inspect_checkpoint, weights_sha256


BASELINE_NAME = 'fresh-health-baseline.json'
STATE_KEY = 'freshTraining'


def continuation_for(directory, manifest):
    # A removed manifest field must not downgrade an already-authorized fresh
    # allocation to legacy health. Legacy fixtures may predate allocation logs.
    events = Allocation(Path(directory).resolve().parent, directory).events()
    if manifest.get('continuation') is None and not (events and events[0].get('continuation')):
        return None
    from .allocation import validate_continuation
    return validate_continuation(directory, manifest)


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, allow_nan=False).encode()).hexdigest()


def file_digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def read_game(path):
    with gzip.open(path, 'rt') as stream:
        return json.load(stream)


def trajectory_digest(game):
    # Ignore identities, search targets, seeds and model labels: relabeling or
    # recompressing an existing trajectory cannot manufacture fresh experience.
    return digest({
        'initialState': game.get('initialState'), 'rootState': game.get('rootState'),
        'warmupActions': game.get('warmupActions'), 'outcome': game['outcome'],
        'decisions': [{key: decision.get(key) for key in
                       ('controller', 'action', 'beforeHash', 'afterHash')}
                      for decision in game['decisions']],
    })


def immutable_json(path, value):
    """Publish once, including across a crash or competing initialization."""
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + '.' + uuid.uuid4().hex + '.tmp')
    try:
        with temporary.open('x') as stream:
            json.dump(value, stream, sort_keys=True, allow_nan=False)
            stream.write('\n'); stream.flush(); os.fsync(stream.fileno())
        os.link(temporary, path)
        fd = os.open(path.parent, os.O_RDONLY)
        try: os.fsync(fd)
        finally: os.close(fd)
    finally:
        temporary.unlink(missing_ok=True)


def allocation_record(directory):
    events = Allocation(Path(directory).parent, directory).events()
    if not events or events[0].get('event') != 'created':
        raise ValueError('fresh health requires an authorized allocation')
    return events[0]


def source_identity(checkpoint):
    checkpoint = Path(checkpoint).resolve()
    meta = json.loads(checkpoint.with_suffix('.json').read_text())
    data = inspect_checkpoint(checkpoint, manifest_sha256=meta['manifestSha256'], require_recovery=True)
    return {'path': str(checkpoint), 'sha256': meta['sha256'], 'updates': data['updates'],
            'weightsSha256': weights_sha256(data['model']),
            'recoverySha256': data['recoverySha256']}, data


def load_baseline(directory, continuation, *, expected_sha256=None):
    directory = Path(directory).resolve()
    baseline = json.loads((directory / BASELINE_NAME).read_text())
    value = baseline['baseline']
    if digest(value) != baseline['sha256'] or (expected_sha256 is not None and expected_sha256 != baseline['sha256']):
        raise ValueError('fresh baseline checksum mismatch')
    creation = allocation_record(directory)
    source, data = source_identity(continuation['recoveryCheckpoint'])
    if (value['schema'] != 1 or value['allocation'] != str(directory)
            or value['allocationId'] != creation['id'] or value['allocationSha256'] != digest(creation)
            or value['continuation'] != continuation or value['checkpoint'] != source):
        raise ValueError('fresh baseline allocation or starting checkpoint changed')
    inherited = {str((Path(source['path']).parent.parent / name).resolve()): sha
                 for name, sha in data['recovery']['archives'].items()}
    archived = {entry['path']: entry['sha256'] for entry in value['archives']}
    if not inherited.items() <= archived.items():
        raise ValueError('fresh baseline omits inherited archives')
    launches = rows(directory.parent / 'generation-launches.jsonl')
    if (len(launches) < value['launchCount']
            or digest(launches[:value['launchCount']]) != value['launchesSha256']):
        raise ValueError('fresh baseline launch history changed')
    return baseline


def initialize(directory, continuation, state, checkpoint):
    """Called after full restoration and before this allocation starts work."""
    directory = Path(directory).resolve()
    creation = allocation_record(directory)
    retained = state.get(STATE_KEY)
    same_allocation = retained is not None and retained.get('allocationId') == creation['id']
    path = directory / BASELINE_NAME
    if not path.exists():
        if same_allocation or Path(checkpoint).resolve() != Path(continuation['recoveryCheckpoint']).resolve():
            raise ValueError('fresh baseline missing for recovered allocation')
        source, data = source_identity(checkpoint)
        inherited = {(Path(checkpoint).resolve().parent.parent / name).resolve()
                     for name in data['recovery']['archives']}
        # Freeze prior training, diagnostic and disposable canary archives too.
        archives = inherited | set(directory.parent.glob('**/games/*.json.gz'))
        inventory = []
        for archive in sorted(archives):
            entry = {'path': str(archive.resolve()), 'sha256': file_digest(archive)}
            try:
                game = read_game(archive)
                entry.update(gameId=game['id'], trajectorySha256=trajectory_digest(game))
            except (ValueError, KeyError, OSError):
                if archive in inherited: raise
            inventory.append(entry)
        launches = rows(directory.parent / 'generation-launches.jsonl')
        value = {'schema': 1, 'allocation': str(directory), 'allocationId': creation['id'],
                 'allocationSha256': digest(creation), 'continuation': continuation,
                 'checkpoint': source, 'archives': inventory, 'launchCount': len(launches),
                 'launchesSha256': digest(launches)}
        immutable_json(path, {'baseline': value, 'sha256': digest(value)})
    baseline = load_baseline(directory, continuation,
                             expected_sha256=retained['baselineSha256'] if same_allocation else None)
    if not same_allocation:
        if Path(checkpoint).resolve() != Path(continuation['recoveryCheckpoint']).resolve():
            raise ValueError('fresh allocation must start at its authorized checkpoint')
        state[STATE_KEY] = {'schema': 1, 'allocationId': creation['id'], 'baselineSha256': baseline['sha256'],
                            'games': {}, 'batches': [], 'checkpoints': []}
    return baseline


def accept_game(directory, state, baseline, game, archive, job):
    """Receipt publication follows exact replay and a real training launch."""
    value = baseline['baseline']
    if (not job or job.get('command') != 'generate' or job.get('partition') != 'train'
            or any(game.get(key) != job.get(key) for key in
                   ('id', 'seed', 'familyId', 'partition', 'kind', 'modelVersion'))
            or 'modelVersions' in game or 'profileVersions' in game):
        raise ValueError('fresh game lacks matching training generation job')
    if any(decision.get('id') != f"{game['id']}:{index}" for index, decision in enumerate(game['decisions'])):
        raise ValueError('fresh game decision identity mismatch')
    launches = rows(Path(directory).parent / 'generation-launches.jsonl')
    matches = [(index, row) for index, row in enumerate(launches)
               if row['jobId'] == game['id'] and row['directory'] == str(Path(directory).resolve())]
    if len(matches) != 1 or matches[0][0] < value['launchCount']:
        raise ValueError('fresh game has no new allocation launch')
    index, launch = matches[0]
    fresh = state[STATE_KEY]
    if game['id'] in fresh['games']:
        raise ValueError('duplicate fresh training receipt')
    archive_digest = file_digest(archive)
    trajectory = trajectory_digest(game)
    eligible = (game['termination'] == 'terminal' and game['outcome']['status'] in ('p1_win', 'p2_win', 'draw')
                and bool(game['decisions']) and game['id'] not in {entry.get('gameId') for entry in value['archives']}
                and archive_digest not in {entry['sha256'] for entry in value['archives']}
                and trajectory not in {entry.get('trajectorySha256') for entry in value['archives']}
                and trajectory not in {receipt['trajectorySha256'] for receipt in fresh['games'].values()})
    fresh['games'][game['id']] = {
        'archive': str(Path(archive).relative_to(directory)), 'sha256': archive_digest, 'eligible': eligible,
        'trajectorySha256': trajectory, 'launchIndex': index, 'launchSha256': digest(launch),
        'job': {key: job[key] for key in ('command', 'id', 'seed', 'familyId', 'partition', 'kind', 'modelVersion')},
    }


def eligible_game_ids(state):
    return {game_id for game_id, receipt in state[STATE_KEY]['games'].items() if receipt['eligible']}


def record_batch(state, metrics):
    fresh = state[STATE_KEY]
    row = {key: metrics[key] for key in ('loss', 'policyLoss', 'valueLoss', 'gradientNorm', 'parameterDelta')}
    if any(type(v) not in (int, float) or not math.isfinite(v) for v in row.values()) or row['parameterDelta'] <= 0:
        raise ValueError('fresh update must be finite and nonzero')
    row.update(update=state['updates'], policyExamples=metrics.get('policyExamples', [])[:1],
               valueExamples=metrics.get('valueExamples', [])[:1])
    fresh['batches'].append(row)


def checkpoint_reference(path, digest_value, state, model_state):
    return {'path': str(Path(path).resolve()), 'sha256': digest_value, 'updates': state['updates'],
            'weightsSha256': weights_sha256(model_state)}


def audit_evidence(directory, state, baseline, games):
    """Validate latest checkpoint witnesses against independently replayed games."""
    value = baseline['baseline']; fresh = state[STATE_KEY]
    if (fresh.get('schema') != 1 or fresh['allocationId'] != value['allocationId']
            or fresh['baselineSha256'] != baseline['sha256']):
        raise ValueError('fresh recovery baseline binding mismatch')
    old_ids = {entry.get('gameId') for entry in value['archives']}
    old_hashes = {entry['sha256'] for entry in value['archives']}
    old_trajectories = {entry.get('trajectorySha256') for entry in value['archives']}
    launches = rows(Path(directory).parent / 'generation-launches.jsonl')
    qualified = {}; excluded = 0; trajectories = set()
    for game_id, receipt in fresh['games'].items():
        name = receipt['archive']; path = (Path(directory) / name).resolve()
        if not path.is_relative_to((Path(directory) / 'games').resolve()) or name not in state['archives']:
            raise ValueError('fresh archive outside retained training data')
        game = games.get(name)
        if (game is None or game['id'] != game_id or file_digest(path) != receipt['sha256']
                or trajectory_digest(game) != receipt['trajectorySha256']):
            raise ValueError('fresh archive receipt mismatch')
        index = receipt['launchIndex']
        if (type(index) is not int or not value['launchCount'] <= index < len(launches)
                or digest(launches[index]) != receipt['launchSha256']
                or launches[index]['jobId'] != game_id
                or launches[index]['directory'] != str(Path(directory).resolve())):
            raise ValueError('fresh launch binding mismatch')
        job = receipt['job']
        if (job.get('command') != 'generate' or job.get('partition') != 'train'
                or any(game.get(key) != job.get(key) for key in
                       ('id', 'seed', 'familyId', 'partition', 'kind', 'modelVersion'))
                or 'modelVersions' in game or 'profileVersions' in game
                or any(d.get('id') != f'{game_id}:{i}' for i, d in enumerate(game['decisions']))):
            raise ValueError('fresh generation identity mismatch')
        trajectory = receipt['trajectorySha256']
        if type(receipt.get('eligible')) is not bool:
            raise ValueError('fresh eligibility receipt missing')
        if not receipt['eligible']:
            excluded += 1; continue
        if (game_id in old_ids or receipt['sha256'] in old_hashes or trajectory in old_trajectories
                or trajectory in trajectories or game['termination'] != 'terminal'
                or game['outcome']['status'] not in ('p1_win', 'p2_win', 'draw') or not game['decisions']):
            raise ValueError('inherited, duplicate or nonterminal game claimed as fresh')
        trajectories.add(trajectory)
        qualified[game_id] = {d['id']: d for d in game['decisions']}
    policy = set(); values = set()
    if len(fresh['batches']) != state['updates'] - value['checkpoint']['updates']:
        raise ValueError('fresh update history differs from checkpoint cursor')
    for expected, batch in enumerate(fresh['batches'], value['checkpoint']['updates'] + 1):
        numbers = [batch[key] for key in ('loss', 'policyLoss', 'valueLoss', 'gradientNorm', 'parameterDelta')]
        if (batch['update'] != expected or any(type(n) not in (int, float) or not math.isfinite(n) for n in numbers)
                or batch['parameterDelta'] <= 0):
            raise ValueError('invalid retained fresh update')
        for key, used in (('policyExamples', policy), ('valueExamples', values)):
            for example in batch[key]:
                game_id, position_id = example['gameId'], example['positionId']
                if game_id not in fresh['games']:
                    raise ValueError('update witness outside new generated data')
                game = games[fresh['games'][game_id]['archive']]
                decision = next((d for d in game['decisions'] if d.get('id') == position_id), None)
                if decision is None or (key == 'policyExamples' and not decision.get('policyMask', True)) or (
                        key == 'valueExamples' and game['termination'] != 'terminal'):
                    raise ValueError('update witness references masked or missing example')
                if game_id in qualified: used.add((game_id, position_id))
    inherited = sum(game['termination'] == 'terminal' for name, game in games.items()
                    if name not in {receipt['archive'] for receipt in fresh['games'].values()})
    return {'freshTerminalGames': len(qualified), 'inheritedTerminalGames': inherited,
            'excludedFreshGames': excluded, 'freshPolicyExamples': len(policy), 'freshValueExamples': len(values),
            'freshFiniteNonzeroUpdates': len(fresh['batches']), 'freshExamplesUsed': bool(policy and values)}


def retained_checkpoint(candidate, latest_state, baseline):
    """A prior publication must be retained by the latest recovery bundle."""
    previous = candidate['recovery']['state'].get(STATE_KEY)
    current = latest_state[STATE_KEY]
    if previous is None or any(previous.get(key) != current[key] for key in ('allocationId', 'baselineSha256')):
        raise ValueError('checkpoint outside fresh allocation lineage')
    if (previous['batches'] != current['batches'][:len(previous['batches'])]
            or any(current['games'].get(key) != item for key, item in previous['games'].items())
            or previous['checkpoints'] != current['checkpoints'][:len(previous['checkpoints'])]
            or len(previous['batches']) != candidate['updates'] - baseline['baseline']['checkpoint']['updates']):
        raise ValueError('checkpoint outside retained training lineage')
