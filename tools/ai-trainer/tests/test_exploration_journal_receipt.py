import copy
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from righelt_training.allocation import Allocation, append
from righelt_training.development_probe import reference
from righelt_training.exploration_journal import Journal, observations
from righelt_training.exploration_receipt import ScreenBudget, accounting, publish, recover_publication, resolve_publication, terminal_baseline, repair_baseline, validate_receipt
from righelt_training.sequence import immutable
from test_exploration_plan_metrics import fixture_plan


GRANT = {'workers': 2, 'memory_gib': 16, 'paused': False, 'stop': False, 'reason': 'fixture'}


def proof(plan, slot):
    root = plan['seedPlan']['roots'][slot['rootOrdinal']]
    record = {'id': slot['id'], 'seed': slot['seed'], 'controller': root['controller'], 'beforeHash': root['stateHash'],
              'afterHash': 'after', 'trainingRecipe': plan['seedPlan']['recipes'][slot['arm']],
              'legal': [0, 1], 'legality': {'complete': True, 'indices': [0, 1]}, 'policyMask': True, 'fallback': None,
              'actionIndex': 0, 'policy': [{'index': 0, 'probability': .5}, {'index': 1, 'probability': .5}],
              'search': {'reason': 'search', 'actions': [{'index': 0, 'visits': 32}, {'index': 1, 'visits': 32}]},
              'rootExploration': {'recipe': plan['seedPlan']['recipes'][slot['arm']], 'applied': False}}
    return {'kind': 'exploration-decision-proof', 'partition': 'development', 'trainingData': False, 'record': record,
            'model': {'checkpoint': plan['seedPlan']['checkpoint'], 'audit': {**plan['seedPlan']['checkpoint'],
                      'checkpoint': plan['seedPlan']['checkpoint']['path'], 'updates': 3309},
                      'weightsSha256': 'a' * 64, 'recoveryReferences': [reference(__file__)]},
            'replay': {'passed': True, 'beforeHash': root['stateHash'], 'afterHash': 'after'}}


class ScreenFixture(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(); self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        checkpoint = self.root / 'fixture.pt'; checkpoint.write_bytes(b'fixture, never a model')
        self.plan, _, _ = fixture_plan(checkpoint=reference(checkpoint))
        self.allocation = Allocation(self.root, self.root / 'six-hour')
        self.allocation.directory.mkdir()
        self.contract = {'sequenceId': 'screen-fixture', 'phase': 'six-hour', 'reserveSeconds': 3600,
                         'recoveryCheckpoint': self.plan['seedPlan']['checkpoint']['path'],
                         'recoverySha256': self.plan['seedPlan']['checkpoint']['sha256']}
        append(self.allocation.path, {'event': 'created', 'allocation': self.allocation.key, 'id': 'fixture-allocation',
                                    'seconds': 21600, 'continuation': self.contract})
        self.now = 1000.
        for target, value in [('righelt_training.allocation.psutil.boot_time', 1.),
                              ('righelt_training.allocation.identity', {'pid': 1, 'created': 1})]:
            mock = patch(target, return_value=value); mock.start(); self.addCleanup(mock.stop)
        for target in ('righelt_training.allocation.time.time', 'righelt_training.allocation.time.monotonic'):
            mock = patch(target, side_effect=lambda: self.now); mock.start(); self.addCleanup(mock.stop)
        self.directory = self.allocation.directory / 'exploration-screen'
        self.journal = Journal(self.directory, self.plan)
        self.plan_path = self.directory / 'plan.json'; immutable(self.plan_path, self.plan)
        self.launch_path = self.directory / 'launch.json'; immutable(self.launch_path, {'fixture': True})

    def advance(self, seconds): self.now += seconds

    def open(self):
        self.budget = ScreenBudget(self.allocation, self.plan); self.budget.begin(); return self.budget

    def complete(self, slot, seconds=1, status='verified', pauses=0):
        self.journal.start(slot, charged=self.budget.state()['screen'], interval=self.budget.interval['id'], resources=GRANT)
        self.advance(seconds)
        self.journal.complete(slot, charged=self.budget.state()['screen'], status=status, pauses=pauses,
                              proof=proof(self.plan, slot) if status == 'verified' else None)


class ExplorationJournalTests(ScreenFixture):
    def test_replayed_record_derives_metrics_and_rejects_changed_identity_or_policy(self):
        slot = self.plan['slots'][0]; record = proof(self.plan, slot)
        record['policyUsable'] = False; record['rootVisits'] = 'untrusted'
        derived = observations(self.plan, slot, record)
        self.assertTrue(derived['policyUsable']); self.assertEqual(derived['rootVisits'], [[0, 32], [1, 32]])
        for mutate in (lambda r: r['record'].update(seed=3), lambda r: r['replay'].update(afterHash='changed'),
                       lambda r: r['record']['policy'][0].update(probability=.2),
                       lambda r: r['record']['search']['actions'][0].update(visits=2)):
            changed = copy.deepcopy(record); mutate(changed)
            with self.assertRaises(ValueError): observations(self.plan, slot, changed)

    def test_durable_slots_expected_failures_no_retries_and_resource_envelope(self):
        self.open(); first, second = self.plan['slots'][:2]
        self.complete(first, status='unfinished')
        with self.assertRaisesRegex(ValueError, 'already dispatched'):
            self.journal.start(first, charged=1, interval='again', resources=GRANT)
        self.journal.start(second, charged=1, interval=self.budget.interval['id'], resources=GRANT)
        self.advance(2)
        self.journal.complete(second, charged=3, status='verified', proof=proof(self.plan, second),
                              resource_history=[{**GRANT, 'workers': 3}])
        rows, _ = self.journal.results()
        self.assertEqual(len(rows), 240); self.assertEqual(rows[0]['status'], 'unfinished')
        self.assertFalse(rows[0]['comparable']); self.assertFalse(rows[1]['comparable'])
        self.assertEqual(sum(row['status'] == 'unstarted' for row in rows), 238)

    def test_interrupted_arm_charges_uncertainty_once_and_quarantines_both_arms(self):
        self.open(); first, second = self.plan['slots'][:2]
        self.complete(first)
        self.journal.start(second, charged=1, interval=self.budget.interval['id'], resources=GRANT)
        self.advance(30); self.budget.finish('interrupted')
        self.journal.interrupted(self.budget.state()['screen']); self.journal.interrupted(self.budget.state()['screen'])
        rows, _ = self.journal.results(); self.assertEqual(rows[1]['activeSeconds'], 30)
        amendment = self.directory / 'amendment.json'; immutable(amendment, {'cause': 'fixture repair'})
        self.journal.quarantine(first['pair'], cause='invalid semantics', amendment=reference(amendment))
        rows, _ = self.journal.results(); self.assertEqual([row['status'] for row in rows[:2]], ['quarantined'] * 2)

    def test_reviewed_quarantine_can_close_evidence_rejected_by_repaired_validator(self):
        self.open(); self.complete(self.plan['slots'][0]); self.budget.finish('repair')
        current = {**self.plan['seedPlan']['source'], 'sourceRevision': 'b' * 40}
        amendment = self.directory / 'amendment.json'
        immutable(amendment, {'oldSourceRevision': self.plan['seedPlan']['source']['sourceRevision'],
                             'newSourceRevision': current['sourceRevision'], 'cause': 'repaired proof validation',
                             'artifactDisposition': 'quarantine-screen-pairs', 'reviewEvidence': [reference(__file__)],
                             'regressionEvidence': [reference(__file__)]})
        original = self.journal.path(self.plan['slots'][0], 'proof').read_bytes()
        with patch('righelt_training.exploration_journal.observations', side_effect=ValueError('old proof invalid')):
            with self.assertRaisesRegex(ValueError, 'old proof invalid'): self.journal.results()
            with patch('righelt_training.exploration_receipt.validate'):
                result = repair_baseline(self.directory, self.plan_path, self.allocation, reference(amendment), current)
                self.assertEqual(validate_receipt(self.directory / 'receipt-repair.json', self.allocation), result)
        self.assertFalse(result['report']['adopted']); self.assertEqual(result['report']['arms']['off']['quarantined'], 1)
        self.assertEqual(result['report']['arms']['off']['policyUsable'], 0)
        self.assertEqual(self.journal.path(self.plan['slots'][0], 'proof').read_bytes(), original)

    def test_current_recipe_proof_and_adapter_files_are_explicit_dependencies(self):
        from righelt_training.manifest import SCREEN_PROOF_PATHS
        expected = ('exploration_screen.py', 'exploration_worker.py', 'exploration_receipt.py',
                    'exploration_journal.py', 'exploration_metrics.py', 'exploration_plan.py')
        for name in expected:
            self.assertIn('tools/ai-trainer/righelt_training/' + name, SCREEN_PROOF_PATHS)
        self.assertIn('tools/ai-trainer/exploration-record.mjs', SCREEN_PROOF_PATHS)
        for name in ('test_exploration_screen.py', 'test_exploration_process.py', 'test_exploration_journal_receipt.py'):
            self.assertIn('tools/ai-trainer/tests/' + name, SCREEN_PROOF_PATHS)


class ExplorationBudgetReceiptTests(ScreenFixture):
    def foreign_allocation(self):
        other = Allocation(self.root, self.root / 'other-six-hour'); other.directory.mkdir()
        append(other.path, {'event': 'created', 'allocation': other.key, 'id': 'different-allocation',
                            'seconds': 21600, 'continuation': self.contract})
        return other

    def repair_amendment(self):
        current = {**self.plan['seedPlan']['source'], 'sourceRevision': 'b' * 40}
        path = self.directory / 'identity-repair.json'
        immutable(path, {'oldSourceRevision': self.plan['seedPlan']['source']['sourceRevision'],
                         'newSourceRevision': current['sourceRevision'], 'cause': 'fixture repair',
                         'artifactDisposition': 'quarantine-screen-pairs', 'reviewEvidence': [reference(__file__)],
                         'regressionEvidence': [reference(__file__)]})
        return reference(path), current

    def test_terminal_publication_rejects_a_different_allocation(self):
        other = self.foreign_allocation(); interval, _, _ = other.begin('exploration-screen')
        self.advance(1800); other.finish(interval['id'], reason='fixture')
        with self.assertRaisesRegex(ValueError, 'initial|canonical'):
            terminal_baseline(other.directory / 'exploration-screen', self.plan_path, other, verify_plan=False)

    def test_repair_publication_and_validator_reject_a_different_allocation(self):
        other = self.foreign_allocation(); amendment, current = self.repair_amendment()
        with patch('righelt_training.exploration_receipt.validate'):
            with self.assertRaisesRegex(ValueError, 'initial|canonical'):
                repair_baseline(other.directory / 'exploration-screen', self.plan_path, other, amendment, current)
            repair_baseline(self.directory, self.plan_path, self.allocation, amendment, current)
            with self.assertRaisesRegex(ValueError, 'initial|canonical'):
                validate_receipt(self.directory / 'receipt-repair.json', other)

    def test_relocated_normal_receipt_is_not_valid_for_the_original_allocation(self):
        self.open(); publish(self.plan_path, self.launch_path, self.journal, self.budget)
        moved = self.root / 'moved'; moved.mkdir()
        path = moved / 'receipt.json'; path.write_bytes((self.directory / 'receipt.json').read_bytes())
        with self.assertRaisesRegex(ValueError, 'canonical'):
            validate_receipt(path, self.allocation, verify_plan=False)

    def test_normal_publication_rejects_noncanonical_journal_before_writing(self):
        self.open(); moved = self.root / 'moved-publication'; journal = Journal(moved, self.plan)
        with self.assertRaisesRegex(ValueError, 'canonical'):
            publish(self.plan_path, self.launch_path, journal, self.budget)
        self.assertFalse((moved / 'publication-intent.json').exists())

    def test_recovery_refuses_foreign_allocation_before_charging_publication_floor(self):
        self.open()
        with patch.object(self.budget, 'finish', side_effect=RuntimeError('crash')):
            with self.assertRaises(RuntimeError): publish(self.plan_path, self.launch_path, self.journal, self.budget)
        other = self.foreign_allocation()
        with self.assertRaisesRegex(ValueError, 'initial|canonical'):
            recover_publication(self.directory, other)
        self.assertFalse(any(row['event'] == 'charge-floor' for row in other.events()))

    def test_normal_receipt_rejects_changed_allocation_contract(self):
        self.open(); publish(self.plan_path, self.launch_path, self.journal, self.budget)
        original = self.allocation.path.read_text(); rows = [json.loads(line) for line in original.splitlines()]
        changes = [{'id': 'another-allocation'}, {'seconds': 43200},
                   {'continuation': {**self.contract, 'phase': 'twelve-hour'}},
                   {'continuation': {**self.contract, 'reserveSeconds': 7200}},
                   {'continuation': {**self.contract, 'recoverySha256': 'f' * 64}},
                   {'continuation': {**self.contract, 'recoveryCheckpoint': '/other/checkpoint.pt'}}]
        for change in changes:
            with self.subTest(change=change):
                altered = copy.deepcopy(rows); altered[0].update(change)
                self.allocation.path.write_text(''.join(json.dumps(row) + '\n' for row in altered))
                try:
                    with self.assertRaisesRegex(ValueError, 'initial'):
                        validate_receipt(self.directory / 'receipt.json', self.allocation, verify_plan=False)
                finally: self.allocation.path.write_text(original)

    def test_aggregate_resumption_excludes_stopped_repair_and_protects_both_caps(self):
        self.open(); self.advance(1700); self.budget.finish('repair')
        self.advance(5000); self.open()
        self.assertEqual(self.budget.remaining(), 100); self.assertTrue(self.budget.admit_pair())
        self.advance(21); self.assertFalse(self.budget.admit_pair()); self.assertEqual(self.budget.bound(100), 64)
        self.budget.finish('repair')
        interval, _, _ = self.allocation.begin('generation'); self.advance(16200); self.allocation.finish(interval['id'], reason='fixture')
        self.open(); self.assertEqual(self.budget.remaining(), 79)
        self.advance(70); self.assertEqual(self.budget.bound(20), 0)

    def test_exclusive_accounting_ownership(self):
        self.allocation.begin('training')
        with self.assertRaisesRegex(ValueError, 'cannot nest'): ScreenBudget(self.allocation, self.plan)

    def test_atomic_receipt_is_recomputed_and_floor_charged_before_admission(self):
        self.open(); self.complete(self.plan['slots'][0], seconds=2, pauses=.5)
        self.advance(3)
        receipt = publish(self.plan_path, self.launch_path, self.journal, self.budget)
        self.assertFalse(receipt['report']['adopted'])
        self.assertEqual(receipt['report']['chargedSeconds'], 15)
        self.assertEqual(receipt['report']['commonSeconds'], 13)
        self.assertEqual(self.allocation.accounting()[1], 15)
        self.assertEqual(validate_receipt(self.directory / 'receipt.json', self.allocation, verify_plan=False), receipt)
        outcome = self.journal.path(self.plan['slots'][0], 'outcome')
        changed = json.loads(outcome.read_text()); changed['chargedEnd'] += .1; outcome.write_text(json.dumps(changed))
        with self.assertRaisesRegex(ValueError, 'evidence|receipt'):
            validate_receipt(self.directory / 'receipt.json', self.allocation, verify_plan=False)

    def test_crash_after_publication_preserves_floor_and_does_not_repeat_slots(self):
        self.open(); self.complete(self.plan['slots'][0]); self.advance(1)
        with patch.object(self.budget, 'finish', side_effect=RuntimeError('crash')):
            with self.assertRaisesRegex(RuntimeError, 'crash'): publish(self.plan_path, self.launch_path, self.journal, self.budget)
        with self.assertRaisesRegex(ValueError, 'not settled'):
            validate_receipt(self.directory / 'receipt.json', self.allocation, verify_plan=False)
        self.advance(2); recover_publication(self.directory, self.allocation)
        cleaned = []
        with patch('righelt_training.allocation.alive', return_value=False):
            self.allocation.recover_abandoned(lambda path: cleaned.append(path))
        self.assertEqual(cleaned, [self.allocation.directory]); self.assertEqual(self.allocation.accounting()[1], 12)
        result = validate_receipt(self.directory / 'receipt.json', self.allocation, verify_plan=False)
        self.assertEqual(result['report']['arms']['off']['attempted'], 1)

    def test_floor_never_hides_elapsed_and_invalid_floor_rejected(self):
        self.open(); interval = self.budget.interval['id']
        for value in (-1, float('nan'), float('inf'), True, 21601):
            with self.assertRaises(ValueError): self.allocation.set_charge_floor(interval, value, reason='test')
        self.allocation.set_charge_floor(interval, 10, reason='test'); self.advance(15); self.budget.finish('done')
        self.assertEqual(self.allocation.accounting()[1], 15)
        events = self.allocation.path.read_text().splitlines()
        self.allocation.path.write_text('\n'.join(line for line in events if json.loads(line)['event'] != 'charge-floor') + '\n')
        with self.assertRaisesRegex(ValueError, 'floor changed'): accounting(self.allocation)

    def test_publication_overrun_retains_cost_and_rejects_adoption(self):
        self.open(); original = self.budget.finish
        def slow(reason): self.advance(11); return original(reason)
        with patch.object(self.budget, 'finish', side_effect=slow):
            with self.assertRaisesRegex(ValueError, 'exceeded reserved charge'):
                publish(self.plan_path, self.launch_path, self.journal, self.budget)
        self.assertEqual(self.allocation.accounting()[1], 11)
        self.assertTrue((self.directory / 'receipt.json').exists())
        original = (self.directory / 'receipt.json').read_bytes()
        resolved = resolve_publication(self.directory, self.allocation, verify_plan=False)
        self.assertFalse(resolved['report']['adopted']); self.assertEqual(resolved['report']['chargedSeconds'], 11)
        self.assertEqual(resolved['selectedRecipe']['id'], 'baseline-v1')
        self.assertEqual((self.directory / 'receipt.json').read_bytes(), original)
        self.assertEqual(resolve_publication(self.directory, self.allocation, verify_plan=False), resolved)

    def test_crash_after_intent_before_floor_recovery_preserves_allowance_and_baseline_resolution(self):
        self.open(); self.complete(self.plan['slots'][0])
        with patch.object(self.allocation, 'set_charge_floor', side_effect=RuntimeError('crash before floor')):
            with self.assertRaisesRegex(RuntimeError, 'before floor'):
                publish(self.plan_path, self.launch_path, self.journal, self.budget)
        self.assertFalse((self.directory / 'receipt.json').exists())
        self.advance(20)
        intent = recover_publication(self.directory, self.allocation)
        self.assertEqual(self.allocation.charge_floor(intent['interval'])['minimumSeconds'], 11)
        with patch('righelt_training.allocation.alive', return_value=False):
            self.allocation.recover_abandoned(lambda _: None)
        resolved = resolve_publication(self.directory, self.allocation, verify_plan=False)
        self.assertEqual(resolved['report']['chargedSeconds'], 21)
        self.assertEqual(resolved['report']['arms']['off']['attempted'], 1)
        self.assertIsNone(resolved['originalReceipt'])

    def test_exhausted_publication_recovery_is_terminal_baseline_without_fresh_budget(self):
        self.open()
        with patch.object(self.budget, 'finish', side_effect=RuntimeError('crash')):
            with self.assertRaises(RuntimeError): publish(self.plan_path, self.launch_path, self.journal, self.budget)
        self.advance(22000); recover_publication(self.directory, self.allocation)
        with patch('righelt_training.allocation.alive', return_value=False):
            self.allocation.recover_abandoned(lambda _: None)
        resolved = resolve_publication(self.directory, self.allocation, verify_plan=False)
        self.assertFalse(resolved['report']['adopted']); self.assertEqual(resolved['report']['chargedSeconds'], 22000)
        self.assertEqual(ScreenBudget(self.allocation, self.plan).remaining(), 0)

    def test_cleanup_overrun_without_intent_ends_with_durable_terminal_baseline(self):
        self.open(); self.complete(self.plan['slots'][0]); self.advance(1793)
        self.budget.finish('cleanup-overrun')
        result = terminal_baseline(self.directory, self.plan_path, self.allocation, verify_plan=False)
        self.assertEqual(result['report']['chargedSeconds'], 1794)
        self.assertFalse(result['report']['adopted']); self.assertEqual(result['report']['arms']['off']['attempted'], 1)
        self.assertFalse((self.directory / 'publication-intent.json').exists())
        self.assertEqual(validate_receipt(self.directory / 'receipt-terminal.json', self.allocation, verify_plan=False), result)


if __name__ == '__main__': unittest.main()
