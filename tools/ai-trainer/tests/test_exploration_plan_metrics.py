import copy
import unittest
from collections import Counter

from righelt_training.config import CONFIG_SHA256
from righelt_training.development_probe import checksum
from righelt_training.exploration_plan import freeze, derived_seed, PROFILE
from righelt_training.exploration_metrics import summarize, diversity


def fixture_plan(checkpoint=None):
    rows = []; cases = []
    for index in range(20):
        # Same 12/2/2/2/2 family imbalance as the actual development workload.
        family = 0 if index < 12 else 1 + (index - 12) // 2
        row = {'id': f'export-validation-{family}:{index}', 'hash': str(index), 'partition': 'validation',
               'familyId': f'export-validation-{family}', 'state': {'sideToMove': 'P1' if index % 2 else 'P2'}}
        rows.append(row)
        cases.append({'id': row['id'], 'corpusIndex': index, 'rowSha256': checksum(row), 'stateHash': row['hash'],
                      'controller': row['state']['sideToMove'], 'categories': ['follow' if index >= 16 else 'ordinary']})
    cases = {'cases': cases, 'configSha256': CONFIG_SHA256, 'missingCoverage': [],
             'corpus': {'path': '/fixture/corpus.json', 'sha256': 'c' * 64}}
    plan = freeze(cases, rows, cases_ref={'path': '/fixture/cases.json', 'sha256': 'd' * 64},
                  checkpoint=checkpoint or {'path': '/fixture/checkpoint.pt', 'sha256': 'e' * 64}, allocation_id='fixture-allocation',
                  source={'sourceRevision': 'a' * 40, 'configSha256': CONFIG_SHA256,
                          'proofDependencies': {'fixture': 'b' * 64}, 'bootstrapDependencies': {'fixture': 'f' * 64}},
                  runtime={'python': 'fixture', 'node': 'fixture'})
    return plan, cases, rows


def fixture_results(plan):
    return [{'slotId': slot['id'], 'status': 'verified', 'policyUsable': True, 'fallback': False,
             'actionIndex': slot['replicate'] % 3 if slot['arm'] == 'on' else 0,
             'searchReason': 'search', 'activeSeconds': 1., 'pauseSeconds': 0., 'comparable': True,
             'explorationApplied': slot['arm'] == 'on', 'rootVisits': [[0, 12], [1, 20], [2, 32]] if slot['arm'] == 'on' else [[0, 64]],
             'visitedLegalCoverage': 1., 'policyEntropy': 1.} for slot in plan['slots']]


def report(plan, results, common=0):
    return summarize(plan, results, common_seconds=common,
                     total_charged_seconds=common + sum(row['activeSeconds'] + row['pauseSeconds'] for row in results))


class ExplorationPlanMetricsTest(unittest.TestCase):
    def test_fixed_slots_seeds_profile_and_balanced_sweeps(self):
        plan, cases, rows = fixture_plan()
        seed = plan['seedPlan']
        self.assertEqual(plan['seedPlanSha256'], checksum(seed))
        self.assertNotIn('slots', seed)
        self.assertEqual(seed['profile'], {'simulations': 64, 'temperature': 1, 'maxValueGap': .1, 'maxNodes': 2048, 'decisionCache': False})
        self.assertEqual(len(plan['slots']), 240)
        self.assertEqual(len({slot['id'] for slot in plan['slots']}), 240)
        for replicate in range(6):
            starts = [slot for index, slot in enumerate(plan['slots']) if slot['replicate'] == replicate and index % 2 == 0]
            self.assertEqual(Counter(slot['arm'] for slot in starts), {'on': 10, 'off': 10})
        for root in range(20):
            starts = [slot for index, slot in enumerate(plan['slots']) if slot['rootOrdinal'] == root and index % 2 == 0]
            self.assertEqual(Counter(slot['arm'] for slot in starts), {'on': 3, 'off': 3})
        for left, right in zip(plan['slots'][::2], plan['slots'][1::2], strict=True):
            self.assertEqual(left['seed'], right['seed'])
            self.assertEqual(left['seed'], derived_seed(plan['seedPlanSha256'], left['rootId'], left['replicate']))
            self.assertTrue(0 <= left['seed'] < 2 ** 32)
        self.assertEqual(Counter(root['familyId'] for root in seed['roots']).most_common(1)[0][1], 12)
        again, _, _ = fixture_plan()
        self.assertEqual(plan, again)

    def test_complete_mechanical_evidence_can_adopt_without_claiming_strength(self):
        plan, _, _ = fixture_plan(); result = report(plan, fixture_results(plan))
        self.assertTrue(result['adopted']); self.assertTrue(result['allAttemptsAccounted'])
        self.assertEqual(result['arms']['on']['policyUsable'], 120)
        self.assertAlmostEqual(result['diversityImprovement'], .8)
        self.assertFalse(result['productionPromotion']); self.assertFalse(result['trainingData'])
        self.assertIn('not strength', result['scope'])

    def test_failed_masked_forced_and_missing_outputs_keep_fifteen_pair_denominator(self):
        rows = [{'status': 'verified', 'policyUsable': True, 'searchReason': 'search', 'actionIndex': i} for i in range(6)]
        self.assertEqual(diversity(rows)[0], 1)
        rows[0] = None
        self.assertAlmostEqual(diversity(rows)[0], 10 / 15)
        rows[1]['searchReason'] = 'immediate-win'
        rows[2]['policyUsable'] = False
        self.assertAlmostEqual(diversity(rows)[0], 3 / 15)
        rows[3]['status'] = 'failed'
        self.assertAlmostEqual(diversity(rows)[0], 1 / 15)

    def test_minimum_usable_boundary_and_all_slots_must_run(self):
        plan, _, _ = fixture_plan(); data = fixture_results(plan)
        for arm in ('off', 'on'):
            chosen = [row for row, slot in zip(data, plan['slots'], strict=True) if slot['arm'] == arm]
            for row in chosen[:24]:
                row.update(status='failed', policyUsable=False, explorationApplied=False)
        self.assertTrue(report(plan, data)['adopted'])
        next(row for row, slot in zip(data, plan['slots'], strict=True) if slot['arm'] == 'on' and row['policyUsable']).update(status='failed', policyUsable=False)
        result = report(plan, data)
        self.assertFalse(result['adopted']); self.assertIn('on: fewer than 96 policy-usable decisions', result['reasons'])
        self.assertFalse(report(plan, fixture_results(plan)[:-1])['adopted'])
        with self.assertRaisesRegex(ValueError, 'duplicate'):
            report(plan, fixture_results(plan) + fixture_results(plan)[:1])

    def test_active_throughput_guard_cannot_be_hidden_by_common_wait(self):
        plan, _, _ = fixture_plan(); data = fixture_results(plan)
        for row, slot in zip(data, plan['slots'], strict=True):
            if slot['arm'] == 'on': row['activeSeconds'] = 1 / .9
        self.assertTrue(report(plan, data)['adopted'])
        for row, slot in zip(data, plan['slots'], strict=True):
            if slot['arm'] == 'on': row['activeSeconds'] = 1.2
        result = report(plan, data, 1000)
        self.assertGreater(result['throughputRatios']['charged'], .9)
        self.assertLess(result['throughputRatios']['active'], .9)
        self.assertFalse(result['adopted'])
        for row in data: row['activeSeconds'] = 0
        self.assertFalse(report(plan, data)['adopted'])

    def test_family_weighting_halves_and_applied_noise_are_independent_gates(self):
        plan, _, _ = fixture_plan(); data = fixture_results(plan)
        # Twelve roots from one family cannot dominate the five-family result.
        for row, slot in zip(data, plan['slots'], strict=True):
            if slot['rootOrdinal'] >= 12: row['actionIndex'] = 0
        result = report(plan, data)
        self.assertAlmostEqual(result['diversityImprovement'], .8 / 5)
        self.assertFalse(result['adopted'])  # fewer than three improving families
        data = fixture_results(plan)
        for row, slot in zip(data, plan['slots'], strict=True):
            if slot['replicate'] < 3: row['actionIndex'] = 0
        self.assertFalse(report(plan, data)['adopted'])
        for key, value in [('explorationApplied', False), ('rootVisits', [[0, 64]])]:
            data = fixture_results(plan)
            next(row for row, slot in zip(data, plan['slots'], strict=True) if slot['arm'] == 'on').update({key: value})
            self.assertFalse(report(plan, data)['adopted'])

    def test_more_fallbacks_resource_changes_corruption_or_only_more_coverage_cannot_adopt(self):
        plan, _, _ = fixture_plan()
        for changes in ({'fallback': True, 'policyUsable': False}, {'comparable': False}, {'status': 'quarantined', 'policyUsable': False}):
            data = fixture_results(plan)
            next(row for row, slot in zip(data, plan['slots'], strict=True) if slot['arm'] == 'on').update(changes)
            self.assertFalse(report(plan, data)['adopted'])
        data = fixture_results(plan)
        for row in data: row['actionIndex'] = 0
        self.assertFalse(report(plan, data)['adopted'])
        data[0]['status'] = 'correctness-error'; data[0]['policyUsable'] = False
        with self.assertRaisesRegex(ValueError, 'correctness'):
            report(plan, data)


if __name__ == '__main__': unittest.main()
