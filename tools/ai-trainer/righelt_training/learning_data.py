"""Read-only learning diagnostics. Counts are observations, never health gates."""
import argparse
from collections import Counter, defaultdict
import gzip
import hashlib
import json
import math
from pathlib import Path
import statistics
import subprocess
import time

from .config import CONFIG, CONFIG_SHA256, ROOT
from .fresh_health import immutable_json, trajectory_digest
from .replay import partition_for_family


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def journal_snapshot(path):
    """Hash exactly the bytes parsed, retaining a live writer's partial tail."""
    raw = Path(path).read_bytes()
    end = raw.rfind(b'\n') + 1
    parsed = [json.loads(line) for line in raw[:end].splitlines()]
    return parsed, {'path': str(Path(path).resolve()), 'sha256': hashlib.sha256(raw).hexdigest(),
                    'bytesRead': len(raw), 'completeBytes': end, 'partialTailBytes': len(raw) - end,
                    'observedAt': time.time()}


def accounting_snapshot(directory):
    import psutil
    from .allocation import Allocation
    ledger = Allocation(Path(directory).parent, directory)
    records, snapshot = journal_snapshot(ledger.path)
    ledger.events = lambda: [r for r in records if r['allocation'] == ledger.key]
    creation, charged, pending = ledger.accounting()
    wall, mono, boot = time.time(), time.monotonic(), psutil.boot_time()
    for interval in pending:
        elapsed = max(0, wall - interval['wall'])
        if interval['boot'] == boot: elapsed = max(elapsed, mono - interval['monotonic'])
        charged += elapsed
    snapshot.update(allocationId=creation['id'], chargedAt=wall, chargedSeconds=charged, openIntervals=len(pending))
    return charged, snapshot


def checkpoint_games(checkpoint):
    # CPU deserialization only; do not restore RNG or construct/run a model.
    from .checkpoint import inspect_checkpoint
    checkpoint = Path(checkpoint).resolve()
    meta = json.loads(checkpoint.with_suffix('.json').read_text())
    data = inspect_checkpoint(checkpoint, manifest_sha256=meta['manifestSha256'], require_recovery=True)
    games = []; seen = set()
    for name, expected in data['recovery']['archives'].items():
        path = (checkpoint.parent.parent / name).resolve()
        # Continuations retain absolute predecessor archive paths. Their exact
        # bytes and cursor are already bound into this checkpoint's recovery.
        if sha(path) != expected:
            raise ValueError('archive changed during report')
        with gzip.open(path, 'rt') as stream:
            game = json.load(stream)
        validate_game(game)
        if game['id'] in seen:
            raise ValueError('duplicate archived game')
        seen.add(game['id'])
        games.append({'game': game, 'path': str(path), 'sha256': expected, 'replayKey': name})
    # JSON dict ordering is not training age. Preserve the actual replay cursor.
    order = {name: i for i, name in enumerate(data['replayIds'])}
    games.sort(key=lambda row: order[row['replayKey']])
    return {'checkpoint': str(checkpoint), 'checkpointSha256': meta['sha256'],
            'recoverySha256': data['recoverySha256'], 'configSha256': CONFIG_SHA256,
            'updates': data['updates'], 'freshBaseline': {
                k: data['recovery']['state'].get('freshTraining', {}).get(k)
                for k in ('allocationId', 'baselineSha256')}}, games


def inherited_games(directory, identity):
    from .fresh_health import load_baseline
    path = Path(directory) / 'fresh-health-baseline.json'
    if not path.exists(): return None
    raw = path.read_bytes(); data = json.loads(raw)
    data = load_baseline(directory, data['baseline']['continuation'], expected_sha256=data['sha256'])
    if (identity['freshBaseline']['baselineSha256'] != data['sha256']
            or identity['freshBaseline']['allocationId'] != data['baseline']['allocationId']):
        raise ValueError('baseline does not belong to retained checkpoint')
    identity['baselineSha256'] = hashlib.sha256(raw).hexdigest()
    return {row['gameId'] for row in data['baseline']['archives'] if 'gameId' in row}


def validate_game(game):
    if game.get('partition') != 'train' or partition_for_family(game['familyId']) != 'train':
        raise ValueError('only training-family archives may enter learning inventory')
    if 'modelVersions' in game or 'profileVersions' in game:
        raise ValueError('evaluation games cannot enter learning inventory')
    if game.get('termination') not in ('terminal', 'truncated'):
        raise ValueError('unfinished archive')
    if game['outcome']['status'] not in ('p1_win', 'p2_win', 'draw', 'ongoing'):
        raise ValueError('unknown outcome')
    if (game['termination'] == 'terminal') != (game['outcome']['status'] != 'ongoing'):
        raise ValueError('inconsistent terminal label')
    seen = set()
    for row in game['decisions']:
        if row['id'] in seen or row.get('controller') not in ('P1', 'P2'):
            raise ValueError('invalid decision identity/controller')
        seen.add(row['id'])
        if type(row.get('policyMask', True)) is not bool:
            raise ValueError('invalid policy mask')
        if bool(row.get('fallback')) == row.get('policyMask', True):
            raise ValueError('fallback mask mismatch')
        if not row.get('policyMask', True) and row['policy']:
            raise ValueError('fallback cannot supply policy targets')


def phase_of(row):
    encoded = row.get('encoded')
    if encoded is None:
        return 'unobserved'
    area = CONFIG['boardSize'] ** 2
    if len(encoded) != CONFIG['inputPlanes'] * area:
        raise ValueError('invalid encoding size')
    phases = []
    for phase in ('none', 'rush', 'retreat', 'follow'):
        start = CONFIG['planes'].index('phase.' + phase) * area
        values = encoded[start:start + area]
        if any(value not in (0, 1) for value in values) or len(set(values)) != 1:
            raise ValueError('invalid phase plane')
        if values[0]: phases.append(phase)
    if len(phases) != 1:
        raise ValueError('phase is not one-hot')
    return phases[0]


def search_metrics(row):
    policy = row.get('policy', [])
    target = {p['index']: p['probability'] for p in policy}
    if (len(target) != len(policy) or any(not math.isfinite(v) or v < 0 for v in target.values())
            or (row.get('policyMask', True) and abs(sum(target.values()) - 1) > 1e-5)):
        raise ValueError('invalid policy distribution')
    result = {'policyEntropy': -sum(p * math.log(p) for p in target.values() if p > 0) if target else None}
    actions = (row.get('search') or {}).get('actions')
    if not actions:
        return result
    priors = {a['index']: a['prior'] for a in actions}
    if (len(priors) != len(actions) or any(not math.isfinite(p) or p < 0 for p in priors.values())
            or abs(sum(priors.values()) - 1) > 1e-5 or any(type(a['visits']) is not int or a['visits'] < 0 for a in actions)):
        raise ValueError('invalid search distribution')
    result.update(visitedFraction=sum(a['visits'] > 0 for a in actions) / len(actions),
                  unvisitedPriorMass=sum(a['prior'] for a in actions if not a['visits']))
    # Jensen-Shannon stays finite with zero priors. Tactical overrides have a
    # separate reason group; a large difference is not evidence of improvement.
    if target:
        if not set(target) <= set(priors): raise ValueError('target absent from root report')
        js = 0.
        for i in priors:
            p, q = priors[i], target.get(i, 0.)
            mid = (p + q) / 2
            if p: js += .5 * p * math.log(p / mid)
            if q: js += .5 * q * math.log(q / mid)
        result['priorTargetJensenShannon'] = js
    return result


def describe(rows):
    metrics = defaultdict(list); masks = Counter(fallback=0, policySupervised=0, legacyMask=0); reasons = Counter(); stops = Counter()
    for row in rows:
        masks['fallback'] += bool(row.get('fallback'))
        masks['policySupervised'] += row.get('policyMask', True)
        masks['legacyMask'] += 'policyMask' not in row
        reasons[(row.get('search') or {}).get('reason', 'unobserved')] += 1
        stops[(row.get('search') or {}).get('stopped', 'unobserved')] += 1
        for name, value in search_metrics(row).items():
            if value is not None: metrics[name].append(value)
    return {'positions': len(rows), **dict(masks), 'fallbackRate': masks['fallback'] / len(rows) if rows else None,
            'searchReasons': dict(reasons), 'searchStops': dict(stops),
            'metrics': {key: {'observations': len(values), 'mean': statistics.mean(values)} for key, values in sorted(metrics.items())}}


def exposure(events, games, inherited_ids=None):
    by_game = {}; total = measured = unobserved = 0
    known = {g['id']: (i, g) for i, g in enumerate(games)}
    for event in events:
        if event.get('type') != 'training-batch': continue
        total += event['positions']
        samples = event.get('sampledGames')
        if samples is None:
            unobserved += event['positions']; continue
        if len({r['gameId'] for r in samples}) != len(samples): raise ValueError('duplicate exposure game')
        for field in ('positions', 'policyPositions', 'valuePositions'):
            if sum(r[field] for r in samples) != event[field]: raise ValueError('batch exposure mismatch')
        for sample in samples:
            if any(type(sample[k]) is not int or sample[k] < 0 for k in ('positions', 'policyPositions', 'valuePositions')):
                raise ValueError('invalid exposure count')
            if max(sample['policyPositions'], sample['valuePositions']) > sample['positions']:
                raise ValueError('exposure mask exceeds batch')
            row = by_game.setdefault(sample['gameId'], {'positions': 0, 'policyPositions': 0, 'valuePositions': 0})
            for k in row: row[k] += sample[k]
            measured += sample['positions']
    for identity, counts in by_game.items():
        item = known.get(identity)
        counts.update(kind=item[1]['kind'] if item else 'not-in-checkpoint',
                      familyId=item[1]['familyId'] if item else None,
                      archiveAgeGames=len(games) - 1 - item[0] if item else None,
                      origin=('inherited' if identity in inherited_ids else 'new') if inherited_ids is not None else 'unobserved')
    return {'observedSampledPositions': total, 'attributedPositions': measured, 'unattributedLegacyPositions': unobserved,
            'byGame': by_game, 'scope': 'Actual batch observations; may include updates later rolled back. Age is retained-archive order, not elapsed time. Not fresh-health evidence.'}


def report(games, events=(), charged=None, inherited_ids=None):
    from .throughput import report as throughput_report
    games = list(games); events = list(events)
    if len({g['id'] for g in games}) != len(games): raise ValueError('duplicate game identity')
    by_kind = defaultdict(list); by_phase = defaultdict(list); by_reason = defaultdict(list)
    by_family = defaultdict(list); hashes = set(); trajectories = set()
    for game in games:
        validate_game(game); by_kind[game['kind']].append(game); by_family[game['familyId']].append(game)
        trajectories.add(trajectory_digest(game))
        for row in game['decisions']:
            hashes.add(row['beforeHash']); by_phase[f"{row['controller']}|{phase_of(row)}"].append(row)
            by_reason[(row.get('search') or {}).get('reason', 'unobserved')].append(row)
    def group(items):
        rows = [r for game in items for r in game['decisions']]
        return {'games': len(items), 'terminalGames': sum(g['termination'] == 'terminal' for g in items),
                'valuePositions': sum(len(g['decisions']) for g in items if g['termination'] == 'terminal'),
                'families': len({g['familyId'] for g in items}), 'outcomes': dict(Counter(g['outcome']['status'] for g in items)),
                'medianDecisions': statistics.median([len(g['decisions']) for g in items]) if items else None, **describe(rows)}
    result = {'schema': 1, 'kind': 'development-learning-data', 'productionPromotion': False,
              'retainedArchives': group(games), 'distinctExactBeforeHashes': len(hashes), 'distinctTrajectories': len(trajectories),
              'byKind': {k: group(v) for k, v in sorted(by_kind.items())},
              'byFamily': {k: group(v) for k, v in sorted(by_family.items())},
              'byControllerPhase': {k: describe(v) for k, v in sorted(by_phase.items())},
              'bySearchReason': {k: describe(v) for k, v in sorted(by_reason.items())},
              'exposure': exposure(events, games, inherited_ids),
              'limitations': ['Archive metrics exclude unfinished games; attempted work is reported separately.',
                             'No inference, training or new acceptance threshold. Differences from model priors are not strength gains.',
                             'Retained archives include historical games and must not be divided by this allocation duration.']}
    if charged is not None:
        result['observedAllocation'] = throughput_report(events, charged)
        accepted = {e['id'] for e in events if e.get('type') == 'game'}
        retained = [g for g in games if g['id'] in accepted]
        counts = group(retained); hours = charged / 3600
        result['retainedAllocation'] = {k: counts[k] for k in ('games', 'terminalGames', 'policySupervised', 'valuePositions') if k in counts}
        result['retainedAllocation']['perChargedHour'] = {k: counts.get(k, 0) / hours if hours else None for k in ('terminalGames', 'policySupervised', 'valuePositions')}
        result['retainedAllocation']['scope'] = 'Accepted in observed allocation and retained in selected checkpoint; not an independent fresh-data health audit.'
    return result


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--checkpoint', type=Path, required=True); p.add_argument('--output', type=Path, required=True)
    p.add_argument('--run-directory', type=Path); args = p.parse_args()
    identity, archives = checkpoint_games(args.checkpoint)
    events = []; charged = None; inherited = None
    if args.run_directory:
        if args.run_directory.resolve() != args.checkpoint.resolve().parent.parent:
            raise ValueError('run directory must own checkpoint')
        path = args.run_directory / 'runner-events.jsonl'
        events, identity['eventsSnapshot'] = journal_snapshot(path)
        charged, identity['accountingSnapshot'] = accounting_snapshot(args.run_directory)
        inherited = inherited_games(args.run_directory, identity)
    output = report([a['game'] for a in archives], events, charged, inherited)
    identity.update(sourceRevision=subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip(),
                    sourceDirty=bool(subprocess.check_output(['git', 'status', '--porcelain'], cwd=ROOT, text=True).strip()),
                    reportSourceSha256=sha(__file__))
    output['identity'] = identity
    immutable_json(args.output, output)
    print(json.dumps({'output': str(args.output), 'games': len(archives), 'kind': output['kind']}))


if __name__ == '__main__': main()
