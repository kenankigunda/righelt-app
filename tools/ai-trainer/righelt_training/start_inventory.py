"""Inventory training-only starts. No curriculum consumer or model execution."""
import argparse
from collections import Counter, defaultdict
import json
from pathlib import Path
import subprocess
import time

from .config import ROOT
from .fresh_health import immutable_json
from .learning_data import checkpoint_games, phase_of, sha, validate_game


def source_snapshot():
    from .manifest import dependency_inventory
    files = ('tools/ai-trainer/engine-worker.mjs', 'tools/ai-trainer/decision-replay.mjs',
             'tools/ai-trainer/decision-provenance.mjs', 'tools/ai-trainer/engine-operation-budget.mjs',
             'tools/ai-trainer/righelt_training/start_inventory.py', 'tools/ai-trainer/righelt_training/runner.py',
             'tools/ai-trainer/righelt_training/learning_data.py')
    return {**dependency_inventory(), **{name: sha(ROOT / name) for name in files}}


def candidates(archives, limit=16):
    if type(limit) is not int or not 1 <= limit <= 32: raise ValueError('inventory limit must be 1..32')
    groups = defaultdict(list); counts = Counter(); roots = set(); families = set()
    for archive in archives:
        game = archive['game']; validate_game(game); families.add(game['familyId'])
        roots.add(json.dumps(game['initialState'], sort_keys=True))
        for index, row in enumerate(game['decisions']):
            phase = phase_of(row); key = f"{row['controller']}|{phase}"
            counts[key] += 1
            groups[key].append({'gameId': game['id'], 'familyId': game['familyId'], 'partition': 'train',
                                'kind': game['kind'], 'index': index, 'decisionId': row['id'],
                                'beforeHash': row['beforeHash'], 'controller': row['controller'], 'phase': phase,
                                'archive': archive['path'], 'archiveSha256': archive['sha256'],
                                'gameDecisions': len(game['decisions'])})
    # Prefer short source games for bounded replay. This is an inventory sampling
    # rule, never the self-play start distribution. Keep every selection visible.
    for values in groups.values(): values.sort(key=lambda r: (r['gameDecisions'], r['index'], r['gameId']))
    selected = []; hashes = set(); chosen_families = Counter()
    while len(selected) < limit:
        progress = False
        for key in sorted(groups):
            available = [r for r in groups[key] if r['beforeHash'] not in hashes]
            if not available: continue
            row = min(available, key=lambda r: (chosen_families[r['familyId']], r['gameDecisions'], r['index'], r['gameId']))
            selected.append(row); hashes.add(row['beforeHash']); chosen_families[row['familyId']] += 1; progress = True
            if len(selected) == limit: break
        if not progress: break
    expected = {f'{owner}|{phase}' for owner in ('P1', 'P2') for phase in ('none', 'rush', 'retreat', 'follow')}
    return {'schema': 1, 'kind': 'training-start-inventory', 'adoptedByCurriculum': False,
            'archives': len(archives), 'families': len(families), 'exactInitialStates': len(roots),
            'availableDecisionsByControllerPhase': dict(sorted(counts.items())),
            'selected': selected, 'missingCoverage': sorted(expected - {f"{r['controller']}|{r['phase']}" for r in selected}),
            'selectionRule': 'Round-robin controller/phase, favor new families and shorter source games; deduplicate exact before hashes. Inventory only.'}


def verify_inventory(inventory, archives, seconds, *, engine=None, clock=time.monotonic):
    if not 0 < seconds <= 60: raise ValueError('inventory verification must be bounded to 60 seconds')
    if engine is None:
        from .runner import engine_command
        engine = engine_command
    dependencies = source_snapshot()
    start = clock(); deadline = start + seconds
    source = {a['path']: a for a in archives}; groups = defaultdict(list)
    for row in inventory['selected']: groups[row['archive']].append(row)
    verified = []; attempts = []
    for path, requested in groups.items():
        left = deadline - clock()
        if left <= .1:
            attempts.append({'archive': path, 'status': 'unattempted', 'reason': 'inventory-deadline'}); continue
        archive = source[path]
        if sha(path) != archive['sha256']: raise ValueError('inventory archive changed')
        bound = min(10., left)
        try:
            result = engine({'command': 'inventory', 'game': archive['game'],
                             'indices': [r['index'] for r in requested], 'budgetMs': bound * 1000}, timeout=bound)
        except (TimeoutError, subprocess.TimeoutExpired):
            attempts.append({'archive': path, 'status': 'unfinished', 'reason': 'deadline'}); continue
        if result.get('type') == 'unfinished':
            attempts.append({'archive': path, 'status': 'unfinished', 'reason': result.get('reason', 'unknown')}); continue
        if result.get('type') != 'inventoried' or result.get('hash') != archive['game']['finalHash']:
            raise ValueError('invalid independent inventory replay')
        states = {s['index']: s for s in result['states']}
        if len(states) != len(result['states']) or set(states) != {r['index'] for r in requested}:
            raise ValueError('inventory snapshot identities differ')
        for row in requested:
            state = states[row['index']]
            if (state['hash'] != row['beforeHash'] or state['controller'] != row['controller']
                    or state['decisionId'] != row['decisionId'] or state['state']['outcome']['status'] != 'ongoing'):
                raise ValueError('inventory snapshot does not match archive')
            verified.append({**row, 'state': state['state'], 'verification': 'authoritative-full-game-replay',
                             'rootState': archive['game'].get('rootState', archive['game']['initialState']),
                             'warmupActions': archive['game'].get('warmupActions', []),
                             'ancestorDecisionCount': row['index']})
        attempts.append({'archive': path, 'status': 'verified', 'states': len(requested)})
    if source_snapshot() != dependencies: raise ValueError('inventory source changed during replay')
    return {**inventory, 'verifiedStates': verified, 'verificationAttempts': attempts, 'sourceDependencies': dependencies,
            'verificationSeconds': clock() - start, 'verificationBudgetSeconds': seconds,
            'verifiedCoverage': sorted({f"{r['controller']}|{r['phase']}" for r in verified}),
            'limitations': ['No starts are adopted into self-play. All descendants must retain source family and archive lineage.',
                           'Unfinished/unattempted sources supply no verified states and are not replaced.',
                           'State values and outcome targets are not inferred from this inventory.']}


def main():
    from .processes import install_stop_handlers
    install_stop_handlers()
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--checkpoint', type=Path, required=True); p.add_argument('--output', type=Path, required=True)
    p.add_argument('--limit', type=int, default=16)
    p.add_argument('--verify-seconds', type=float, default=0)
    args = p.parse_args()
    if args.output.exists(): raise ValueError('inventory output already exists')
    if not 0 <= args.verify_seconds <= 60: raise ValueError('invalid verification bound')
    identity, archives = checkpoint_games(args.checkpoint)
    output = candidates(archives, args.limit)
    if args.verify_seconds:
        output = verify_inventory(output, archives, args.verify_seconds)
    else:
        output.update(verifiedStates=[], verificationAttempts=[], verificationSeconds=0,
                      limitations=['Index only; exact states require bounded authoritative replay before reuse.'])
    identity['sourceRevision'] = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip()
    identity['sourceDirty'] = bool(subprocess.check_output(['git', 'status', '--porcelain'], cwd=ROOT, text=True).strip())
    output['identity'] = identity
    immutable_json(args.output, output)
    print(json.dumps({'output': str(args.output), 'selected': len(output['selected']), 'verified': len(output['verifiedStates'])}))


if __name__ == '__main__': main()
