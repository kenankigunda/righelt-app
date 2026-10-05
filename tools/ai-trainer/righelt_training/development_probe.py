"""Freeze development cases and read retained proofs; never execute a model.

prepare --corpus FILE --output CASES
report --cases CASES [--proof COMPLETE_EVIDENCE] --output REPORT
compare --cases CASES --before REPORT --after REPORT --output COMPARISON

All outputs are immutable. Stage trained-export-parity.json alone lacks search
and checkpoint/source binding and produces an unsupported report. A missing
bootstrap proof produces a missing report, never a successful learning check.
This descriptive probe has no acceptance threshold or training targets.
"""
import argparse
import hashlib
import json
import math
from pathlib import Path
import re

from .bootstrap import PROFILE, STATES, validate_outputs
from .config import CONFIG, CONFIG_SHA256
from .replay import partition_for_family
from .sequence import digest, immutable, read

CATEGORIES = ('ordinary', 'push-available', 'rush', 'retreat', 'follow')
PER_BUCKET = 2


def checksum(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, allow_nan=False).encode()).hexdigest()


def reference(path):
    path = Path(path).resolve()
    return {'path': str(path), 'sha256': digest(path)}


def checked_ref(record):
    if (not isinstance(record, dict) or not Path(record.get('path', '')).is_absolute()
            or not re.fullmatch('[0-9a-f]{64}', record.get('sha256', ''))):
        raise ValueError('invalid evidence reference')
    if digest(record['path']) != record['sha256']:
        raise ValueError('evidence checksum changed: ' + record['path'])
    return Path(record['path'])


def tags(row):
    state = row['state']; continuation = state.get('continuation')
    if continuation:
        kind = 'rush' if continuation.get('type') == 'rush' else continuation.get('phase')
        if kind not in ('rush', 'retreat', 'follow'):
            raise ValueError('unknown continuation phase')
        return [kind]
    result = ['ordinary']
    push = CONFIG['actionChannels']['push']
    channels = CONFIG['passIndex'] // (CONFIG['boardSize'] ** 2)
    if any(index != CONFIG['passIndex'] and push <= index % channels < push + len(CONFIG['directions']['orthogonal'])
           for index in row['legal']):
        result.append('push-available')
    return result


def corpus_rows(path):
    corpus = read(path); rows = corpus.get('states', [])
    if corpus.get('kind') != 'export-validation' or len(rows) != STATES:
        raise ValueError('only the frozen 1000-state export-validation corpus is supported; no acceptance puzzles')
    ids = set(); hashes = set()
    for row in rows:
        family = row.get('familyId', '')
        if (row.get('partition') != 'validation' or partition_for_family(family) != 'validation'
                or not family.startswith('export-validation-') or not row.get('id', '').startswith(family + ':')):
            raise ValueError('sealed final, train or acceptance data cannot enter the development probe')
        legal = row.get('legal', [])
        if (row['id'] in ids or not row.get('hash') or row['hash'] in hashes
                or row.get('state', {}).get('sideToMove') not in ('P1', 'P2')
                or len(row.get('encoded', [])) != CONFIG['boardSize'] ** 2 * CONFIG['inputPlanes']
                or not legal or any(type(i) is not int or not 0 <= i < CONFIG['actionCount'] for i in legal)
                or len(set(legal)) != len(legal)):
            raise ValueError('invalid frozen corpus row')
        ids.add(row['id']); hashes.add(row['hash']); tags(row)
    return rows


def prepare(corpus):
    source = reference(corpus); rows = corpus_rows(corpus)
    coverage = {}; selected = set()
    for controller in ('P1', 'P2'):
        for category in CATEGORIES:
            indices = [i for i, row in enumerate(rows) if row['state']['sideToMove'] == controller and category in tags(row)]
            chosen = indices[:PER_BUCKET]; selected.update(chosen)
            coverage[controller + ':' + category] = {'available': len(indices), 'selected': [rows[i]['id'] for i in chosen],
                                                     'shortfall': max(0, PER_BUCKET - len(chosen))}
    result = {'schema': 1, 'kind': 'development-cases', 'partition': 'validation', 'corpus': source,
              'configSha256': CONFIG_SHA256, 'profile': PROFILE, 'selection': 'corpus-order-two-per-controller-category-v1',
              'coverage': coverage, 'missingCoverage': [key for key, value in coverage.items() if value['shortfall']],
              'engineVerification': 'requires retained complete bootstrap proof; preparation checks structure only',
              'cases': [{'id': rows[i]['id'], 'corpusIndex': i, 'rowSha256': checksum(rows[i]), 'stateHash': rows[i]['hash'],
                         'controller': rows[i]['state']['sideToMove'], 'categories': tags(rows[i])} for i in sorted(selected)]}
    checked_ref(source)
    return result


def load_cases(path):
    value = read(path)
    if value.get('kind') != 'development-cases' or value != prepare(checked_ref(value.get('corpus'))):
        raise ValueError('frozen cases or selection changed; no silent refreeze')
    return value


def finite(value):
    return type(value) in (int, float) and math.isfinite(value)


def observations(case, frozen, raw, searched):
    legal = frozen['legal']; logits = raw.get('policyLogits', []); result = searched['result']
    if (raw.get('legal') != legal or len(logits) != CONFIG['actionCount'] or not all(map(finite, logits))
            or not finite(raw.get('value')) or abs(raw['value']) > 1
            or not finite(result.get('value')) or abs(result['value']) > 1
            or type(result.get('actionIndex')) is not int or result['actionIndex'] not in legal):
        raise ValueError('invalid legal numeric/search observations')
    ordered = sorted(legal, key=lambda i: (-logits[i], i))
    best = [i for i in ordered if logits[i] == logits[ordered[0]]]
    actions = result.get('actions', []); indices = [row.get('index') for row in actions]
    if len(set(indices)) != len(indices) or any(type(i) is not int or i not in legal for i in indices):
        raise ValueError('search action evidence is not in frozen legal set')
    answers = {'winning': [], 'losing': [], 'drawing': []}
    for action in actions:
        evidence = set()
        if action.get('immediate') == 'win' or action.get('tactical') == 'proven-win': evidence.add('winning')
        if action.get('immediate') == 'losing' or action.get('tactical') == 'proven-loss': evidence.add('losing')
        if action.get('tactical') == 'proven-draw': evidence.add('drawing')
        if len(evidence) > 1: raise ValueError('contradictory terminal proof')
        for key in evidence: answers[key].append(action['index'])
    sign = 1 if case['controller'] == 'P1' else -1
    target = sign if answers['winning'] else None
    return {'id': case['id'], 'controller': case['controller'], 'categories': case['categories'],
            'raw': {'preferredLegalActions': best, 'topLegalLogits': [{'index': i, 'logit': logits[i]} for i in ordered[:3]],
                    'valueP1': raw['value'], 'valueController': sign * raw['value']},
            'searched': {'actionIndex': result['actionIndex'], 'valueP1': result['value'],
                         'valueController': sign * result['value'], 'reason': result.get('reason'),
                         'stopped': result['stopped'], 'seed': searched['seed'],
                         'policyMask': result.get('policyMask'), 'fallback': result.get('fallback')},
            'rawPreferenceMatchesSearch': result['actionIndex'] in best,
            'authoritative': {'status': 'terminal-proven-subset' if any(answers.values()) else 'unproven',
                              'actions': {key: sorted(value) for key, value in answers.items()},
                              'exhaustive': False, 'rootValueP1': target,
                              'rawValueAbsoluteError': None if target is None else abs(raw['value'] - target),
                              'scope': 'terminal-only rules proof; unlisted actions are unknown, not incorrect'}}


def retained_proof(path, cases):
    proof = read(path); identity = proof['identity']; attempt = Path(path).resolve().parent
    if (not re.fullmatch('[0-9a-f]{40}', identity.get('sourceRevision', ''))
            or identity.get('configSha256') != cases['configSha256'] or identity.get('corpus') != cases['corpus']):
        raise ValueError('proof source/config/corpus identity mismatch')
    for name in ('proofDependencies', 'bootstrapDependencies'):
        inventory = identity.get(name)
        if not isinstance(inventory, dict) or not inventory or any(not re.fullmatch('[0-9a-f]{64}', v) for v in inventory.values()):
            raise ValueError('missing source dependency inventory')
    if not isinstance(identity.get('runtime'), dict) or not identity['runtime']:
        raise ValueError('missing runtime identity')
    for name in ('sequence', 'checkpoint', 'staticProof', 'recoveryAudit', 'corpus', 'legacyGate'):
        checked_ref(identity.get(name))
    static = read(identity['staticProof']['path']); audit = read(identity['recoveryAudit']['path'])
    if (any(static.get(k) != identity[k] for k in ('sourceRevision', 'configSha256', 'proofDependencies'))
            or audit.get('passed') is not True or audit.get('sourceRevision') != identity['sourceRevision']
            or audit.get('checkpoint') != identity['checkpoint']['path'] or audit.get('sha256') != identity['checkpoint']['sha256']):
        raise ValueError('static proof or checkpoint audit does not bind this source/checkpoint')
    for name, record in proof.get('artifacts', {}).items():
        if Path(record.get('path', '')).resolve() != attempt / name or not (attempt / name).resolve().is_relative_to(attempt):
            raise ValueError('proof artifact path mismatch')
        checked_ref(record)
    if validate_outputs(attempt, identity) != proof:
        raise ValueError('complete proof does not match retained outputs')
    raw = read(attempt / 'native-raw.json'); search = read(attempt / 'native-search.json')
    if raw.get('configSha256') != CONFIG_SHA256 or search.get('configSha256') != CONFIG_SHA256:
        raise ValueError('numeric/search config identity mismatch')
    return proof, raw, search


def recheck(proof):
    for name in ('sequence', 'checkpoint', 'staticProof', 'recoveryAudit', 'corpus', 'legacyGate'):
        checked_ref(proof['identity'][name])
    for record in proof['artifacts'].values(): checked_ref(record)


def report(cases_path, proof_path=None):
    cases_ref = reference(cases_path); cases = load_cases(cases_path)
    result = {'schema': 1, 'kind': 'development-report', 'cases': cases_ref, 'casesSha256': checksum(cases),
              'profile': cases['profile'], 'corpusSha256': cases['corpus']['sha256'], 'configSha256': cases['configSha256'],
              'status': 'missing', 'proof': None, 'requestedProof': str(Path(proof_path).resolve()) if proof_path else None,
              'reason': 'complete bootstrap evidence not supplied', 'observations': [], 'acceptanceDecision': None}
    if not proof_path or not Path(proof_path).is_file(): return result
    result['proof'] = reference(proof_path); proof = read(proof_path)
    if 'identity' not in proof or 'artifacts' not in proof:
        result.update(status='unsupported', reason='numeric/export output alone lacks complete bound search proof')
        return result
    if proof.get('complete') is not True or proof.get('passed') is not True:
        result.update(status='incomplete', reason='retained proof is not complete and passed')
        return result
    try:
        proof, raw, search = retained_proof(proof_path, cases)
    except FileNotFoundError as error:
        result.update(status='missing', reason='retained proof input or output missing: ' + str(error.filename))
        return result
    rows = corpus_rows(cases['corpus']['path'])
    result.update(status='complete', reason=None, provenance={**proof['identity'], 'modelSha256': proof['modelSha256'],
                                                             'browserVersion': proof['browserVersion']},
                  observations=[observations(case, rows[case['corpusIndex']], raw['states'][case['corpusIndex']],
                                             search['states'][case['corpusIndex']]) for case in cases['cases']])
    recheck(proof); checked_ref(result['proof']); checked_ref(cases_ref)
    return result


def compare(cases_path, before_path, after_path):
    cases = load_cases(cases_path); reports = []
    for path in (before_path, after_path):
        value = read(path)
        if (value.get('kind') != 'development-report' or value.get('casesSha256') != checksum(cases)
                or value != report(cases_path, value.get('requestedProof'))):
            raise ValueError('report changed or belongs to different frozen cases')
        reports.append(value)
    before, after = reports
    result = {'schema': 1, 'kind': 'development-comparison', 'cases': reference(cases_path),
              'before': reference(before_path), 'after': reference(after_path), 'status': 'incomplete',
              'inputStatuses': [r['status'] for r in reports], 'changes': [], 'acceptanceDecision': None}
    if any(r['status'] != 'complete' for r in reports): return result
    left = before['provenance']; right = after['provenance']
    if any(left[key] != right[key] for key in ('proofDependencies', 'bootstrapDependencies', 'configSha256', 'runtime', 'browserVersion')):
        raise ValueError('comparison requires the same dependency footprint, config and runtime')
    if left['checkpoint']['sha256'] == right['checkpoint']['sha256']:
        raise ValueError('comparison requires distinct checkpoint identities, not renamed copies')
    result.update(status='complete', checkpoints=[left['checkpoint'], right['checkpoint']],
                  sourceRevisions=[left['sourceRevision'], right['sourceRevision']],
                  sameExportedModel=left['modelSha256'] == right['modelSha256'],
                  changes=[{'id': a['id'], 'rawPreferredBefore': a['raw']['preferredLegalActions'],
                            'rawPreferredAfter': b['raw']['preferredLegalActions'],
                            'rawValueP1Delta': b['raw']['valueP1'] - a['raw']['valueP1'],
                            'searchedBefore': a['searched']['actionIndex'], 'searchedAfter': b['searched']['actionIndex'],
                            'authoritativeBefore': a['authoritative'], 'authoritativeAfter': b['authoritative']}
                           for a, b in zip(before['observations'], after['observations'], strict=True)])
    return result


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='command', required=True)
    prepare_parser = commands.add_parser('prepare'); prepare_parser.add_argument('--corpus', required=True)
    report_parser = commands.add_parser('report'); report_parser.add_argument('--proof')
    compare_parser = commands.add_parser('compare')
    for name in ('before', 'after'): compare_parser.add_argument('--' + name, required=True)
    for command in (report_parser, compare_parser): command.add_argument('--cases', required=True)
    for command in (prepare_parser, report_parser, compare_parser): command.add_argument('--output', required=True)
    args = parser.parse_args(argv)
    if args.command == 'prepare': value = prepare(args.corpus)
    elif args.command == 'report': value = report(args.cases, args.proof)
    else: value = compare(args.cases, args.before, args.after)
    immutable(args.output, value)
    print(json.dumps({'output': str(Path(args.output).resolve()), 'sha256': digest(args.output),
                      'status': value.get('status', 'prepared')}, sort_keys=True))


if __name__ == '__main__': main()
