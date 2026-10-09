"""Fixed-denominator mechanical adoption rule. No strength/learning inference."""
from collections import Counter, defaultdict
from itertools import combinations
import math

from .exploration_plan import KIND, LIMITS
from .training_recipe import recipe_binding


def finite_nonnegative(value):
    return type(value) in (int, float) and math.isfinite(value) and value >= 0


def diversity(rows):
    # Missing/forced/fallback slots retain the six-seed (or three-seed) denominator.
    pairs = list(combinations(rows, 2))
    credit = [(a, b) for a, b in pairs if all(row and row['status'] == 'verified' and row.get('policyUsable') is True
               and row.get('searchReason') == 'search' for row in (a, b)) and a['actionIndex'] != b['actionIndex']]
    return len(credit) / len(pairs), credit


def summarize(plan, results, *, common_seconds, total_charged_seconds):
    if not finite_nonnegative(common_seconds) or not finite_nonnegative(total_charged_seconds):
        raise ValueError('invalid screen time attribution')
    slots = plan['slots']; expected = {slot['id']: slot for slot in slots}
    if len(slots) != 240 or len(expected) != 240:
        raise ValueError('screen requires all 240 scheduled identities')
    observed = {}
    for row in results:
        identity = row.get('slotId')
        if identity in observed or identity not in expected:
            raise ValueError('duplicate or unscheduled screen result')
        if row.get('status') not in ('verified', 'failed', 'unfinished', 'unstarted', 'quarantined', 'correctness-error'):
            raise ValueError('unknown screen disposition')
        if not finite_nonnegative(row.get('activeSeconds')) or not finite_nonnegative(row.get('pauseSeconds')):
            raise ValueError('invalid screen arm durations')
        if row.get('policyUsable') is True and (row['status'] != 'verified' or row.get('fallback') is not False or
                type(row.get('actionIndex')) is not int):
            raise ValueError('invalid policy-usable slot')
        if row['status'] == 'correctness-error':
            raise ValueError('screen correctness failure requires repair')
        observed[identity] = row
    roots = plan['seedPlan']['roots']
    arms = {}; indexed = {}; reasons = []
    for arm in ('off', 'on'):
        chosen = [slot for slot in slots if slot['arm'] == arm]
        rows = [observed.get(slot['id']) for slot in chosen]
        indexed[arm] = {(slot['rootOrdinal'], slot['replicate']): row for slot, row in zip(chosen, rows, strict=True)}
        status = Counter(row['status'] if row else 'unstarted' for row in rows)
        active = sum(row['activeSeconds'] for row in rows if row)
        pauses = sum(row['pauseSeconds'] for row in rows if row)
        usable = sum(bool(row and row.get('policyUsable') is True) for row in rows)
        fallback = sum(bool(row and row.get('fallback') is True) for row in rows)
        failed = sum(count for key, count in status.items() if key in ('failed', 'unfinished', 'quarantined'))
        charged = active + pauses + common_seconds / 2
        arms[arm] = {'scheduled': 120, 'attempted': 120 - status['unstarted'], 'verified': status['verified'],
                     'policyUsable': usable, 'fallback': fallback, 'failed': failed, 'unfinished': status['unfinished'],
                     'unstarted': status['unstarted'], 'quarantined': status['quarantined'], 'activeSeconds': active,
                     'pauseSeconds': pauses, 'commonSeconds': common_seconds / 2, 'chargedSeconds': charged,
                     'usablePerActiveHour': usable * 3600 / active if active > 0 else None,
                     'usablePerChargedHour': usable * 3600 / charged if charged > 0 else None}
        if status['unstarted'] or status['quarantined']:
            reasons.append(arm + ': missing or quarantined scheduled attempts')
        if usable < 96:
            reasons.append(arm + ': fewer than 96 policy-usable decisions')
    attributed = sum(arm['chargedSeconds'] for arm in arms.values())
    if abs(attributed - total_charged_seconds) > 1e-6:
        raise ValueError('screen attributed time differs from charged accounting')
    if total_charged_seconds > LIMITS['screenSeconds']:
        reasons.append('screen exceeded aggregate allowance')
    if any(row.get('comparable') is not True for row in observed.values() if row['status'] != 'unstarted'):
        reasons.append('resource envelope or evidence changed within a pair')
    if arms['on']['failed'] > arms['off']['failed'] or arms['on']['fallback'] > arms['off']['fallback']:
        reasons.append('exploration increased failed or fallback slots')
    ratios = {}
    for kind in ('Active', 'Charged'):
        key = 'usablePer' + kind + 'Hour'
        base, on = arms['off'][key], arms['on'][key]
        ratio = on / base if base and on is not None else None
        ratios[kind.lower()] = ratio
        if ratio is None or ratio + 1e-12 < .9:
            reasons.append(kind.lower() + ' usable throughput below 90% or unmeasurable')
    root_reports = []
    for index, root in enumerate(roots):
        rates = {}; credits = {}
        for arm in ('off', 'on'):
            rows = [indexed[arm][index, replicate] for replicate in range(6)]
            rates[arm], credits[arm] = diversity(rows)
            rates[arm + 'Halves'] = [diversity(rows[start:start + 3])[0] for start in (0, 3)]
        improvement = rates['on'] - rates['off']
        provenance = True
        if improvement > 1e-12:
            for pair in credits['on']:
                for row in pair:
                    slot = expected[row['slotId']]
                    baseline = indexed['off'][index, slot['replicate']]
                    if (row.get('explorationApplied') is not True or not baseline or baseline['status'] != 'verified' or
                            not row.get('rootVisits') or row['rootVisits'] == baseline.get('rootVisits')):
                        provenance = False
            if not provenance:
                reasons.append(root['id'] + ': positive diversity lacks applied-noise/changed-visit evidence')
        root_reports.append({'id': root['id'], 'familyId': root['familyId'], 'controller': root['controller'],
                             'categories': root['categories'], **rates, 'improvement': improvement,
                             'halvesImprovement': [a - b for a, b in zip(rates['onHalves'], rates['offHalves'], strict=True)],
                             'explorationEvidence': provenance})
    families = defaultdict(list)
    for row in root_reports:
        families[row['familyId']].append(row)
    if len(families) != 5:
        raise ValueError('screen family denominator changed')
    family_reports = [{'id': family, 'roots': len(rows), 'improvement': sum(row['improvement'] for row in rows) / len(rows),
                       'halvesImprovement': [sum(row['halvesImprovement'][half] for row in rows) / len(rows) for half in (0, 1)]}
                      for family, rows in sorted(families.items())]
    improvement = sum(row['improvement'] for row in family_reports) / 5
    halves = [sum(row['halvesImprovement'][half] for row in family_reports) / 5 for half in (0, 1)]
    if improvement + 1e-12 < .1 or any(value <= 1e-12 for value in halves) or sum(row['improvement'] > 1e-12 for row in family_reports) < 3:
        reasons.append('family-weighted diversity requirements unmet')
    # These are separate descriptive measurements, never a substitute adoption gate.
    for arm in ('off', 'on'):
        usable_rows = [row for row in indexed[arm].values() if row and row.get('policyUsable') is True]
        for key in ('visitedLegalCoverage', 'policyEntropy'):
            values = [row[key] for row in usable_rows if finite_nonnegative(row.get(key))]
            arms[arm][key] = sum(values) / len(values) if values else None
    return {'schema': 1, 'kind': KIND + '-report', 'adopted': not reasons,
            'selectedRecipe': recipe_binding('root-dirichlet-v1') if not reasons else recipe_binding(),
            'reasons': reasons, 'allAttemptsAccounted': len(observed) == 240,
            'arms': arms, 'roots': root_reports, 'families': family_reports, 'diversityImprovement': improvement,
            'threeSeedBlockImprovements': halves, 'throughputRatios': ratios,
            'chargedSeconds': total_charged_seconds, 'commonSeconds': common_seconds,
            'scope': 'fixed development-root mechanical proxy, not strength, terminal-game yield or value-supervised yield',
            'productionPromotion': False, 'trainingData': False}
