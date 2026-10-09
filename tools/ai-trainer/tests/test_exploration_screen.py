"""Coordinator tests use protocol doubles only: no model, MPS or live screen."""
import copy
import json
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from righelt_training.development_probe import reference
from righelt_training.exploration_screen import Screen
from righelt_training.exploration_receipt import validate_receipt
from righelt_training.resources import Sample, GIB
from righelt_training.sequence import immutable
from test_exploration_journal_receipt import ScreenFixture, proof


class ExplorationScreenTests(ScreenFixture):
    def fixture(self, *, fail=None):
        self.launch_path.unlink()  # The receipt-unit fixture is not a live launch contract.
        fixture = self; calls = []; live = []; slots = {}; failures = fail or {}
        class Worker:
            def __init__(self, directory, launch, session):
                self.session = Path(session); self.session.mkdir(parents=True)
                self.process = SimpleNamespace(pid=99999); self.started = fixture.now; self.command = None
                self.stopped = False; self.pending = None; live.append(self)
                self.assert_single()
            def assert_single(self):
                fixture.assertEqual(sum(not worker.stopped for worker in live), 1)
            def send(self, command, seconds, check):
                check()
                self.command = command
                if command['type'] == 'select':
                    self.pending = command['slot']; slots[self.pending['id']] = self.pending
                    calls.append(self.pending['id'])
                    fixture.assertTrue(fixture.screen.journal.path(self.pending, 'start').exists())
            def receive(self, seconds, check):
                check(); fixture.advance(.1)
                if self.command is None:
                    return {'type': 'ready', 'checkpoint': fixture.plan['seedPlan']['checkpoint'],
                            'audit': {'checkpoint': fixture.contract['recoveryCheckpoint'],
                                      'sha256': fixture.contract['recoverySha256'], 'updates': 3309},
                            'weightsSha256': 'a' * 64, 'recoveryReferences': [reference(__file__)]}
                slot = self.pending
                if self.command['type'] == 'select':
                    failure = failures.get(slot['id'])
                    if failure: raise failure
                    return {'type': 'selected', 'slotId': slot['id'], 'answer': {'type': 'searched', 'result': {'status': 'ready'}}}
                data = proof(fixture.plan, slot)
                # Deliberately synthetic outcomes exercise coordinator/adoption
                # contracts; actual search→record→replay is covered by Node tests.
                record = data['record']
                if slot['arm'] == 'on':
                    record['actionIndex'] = slot['replicate'] % 2; record['rootExploration']['applied'] = True
                else:
                    record['search']['actions'][0]['visits'] = 48; record['search']['actions'][1]['visits'] = 16
                    record['policy'][0]['probability'] = .75; record['policy'][1]['probability'] = .25
                return {'type': 'recorded', 'slotId': slot['id'], 'answer': {'type': 'exploration-recorded', 'proof': data}}
            def stop(self): self.stopped = True; fixture.advance(.05)
        audit = self.directory / 'audit.json'; immutable(audit, {'passed': True, 'updates': 3309})
        gate = self.directory / 'gate.json'; immutable(gate, {'resumeCheckpoint': {
            'checkpoint': self.contract['recoveryCheckpoint'], 'sha256': self.contract['recoverySha256'],
            'auditPath': str(audit), 'auditSha256': reference(audit)['sha256']}})
        self.screen = Screen(self.allocation, self.plan_path, gate, self.directory / 'activity.json', process_factory=Worker)
        mocks = [patch('righelt_training.exploration_screen.validate'),
                 patch('righelt_training.exploration_screen.compatible_source', return_value=True),
                 patch('righelt_training.exploration_screen.validate_contract', return_value=self.contract),
                 patch('righelt_training.exploration_screen.cleanup_owned'),
                 patch('righelt_training.exploration_screen.corpus_rows', return_value=[{'state': {'fixture': i}} for i in range(20)]),
                 patch('righelt_training.exploration_screen.checked_ref', side_effect=lambda ref: Path(ref['path'])),
                 patch('righelt_training.exploration_screen.Telemetry.sample', side_effect=lambda: Sample(
                     self.now, self.now, True, 0., 'normal', 0, 16 * GIB, 500 * GIB, 0)),
                 patch('righelt_training.exploration_receipt.validate')]
        for mock in mocks: mock.start(); self.addCleanup(mock.stop)
        return calls, live

    def test_direct_eight_hour_screen_checks_source_before_opening_interval(self):
        calls,live=self.fixture()
        creation,charged,pending=self.allocation.accounting()
        changed={**creation,'continuation':{**creation['continuation'],'phase':'eight-hour'}}
        with patch.object(self.allocation,'accounting',return_value=(changed,charged,pending)), \
             patch('righelt_training.exploration_screen.source_identity',return_value={'sourceRevision':'wrong'}), \
             patch('righelt_training.continuation_policy.validate_source',side_effect=ValueError('source bridge missing')) as admission, \
             patch.object(self.allocation,'begin') as begin:
            with self.assertRaisesRegex(ValueError,'source bridge'):self.screen.run()
            admission.assert_called_once();begin.assert_not_called()
        self.assertFalse(calls);self.assertFalse(live)

    def test_full_fixed_screen_publishes_atomic_choice_and_reuses_it_without_second_dispatch(self):
        calls, live = self.fixture()
        receipt = self.screen.run()
        self.assertEqual(calls, [slot['id'] for slot in self.plan['slots']])
        self.assertTrue(receipt['report']['adopted']); self.assertEqual(receipt['selectedRecipe']['id'], 'root-dirichlet-v1')
        self.assertEqual(receipt['report']['arms']['off']['policyUsable'], 120)
        self.assertEqual(receipt['report']['arms']['on']['policyUsable'], 120)
        self.assertTrue(all(worker.stopped for worker in live))
        self.assertEqual(self.screen.run(), receipt); self.assertEqual(len(calls), 240)
        self.assertFalse((self.allocation.directory / 'replay').exists())
        self.assertFalse((self.allocation.directory / 'latest.json').exists())

    def test_expected_timeout_restores_model_without_repeating_failed_slot(self):
        failed = self.plan['slots'][0]['id']; calls, live = self.fixture(fail={failed: TimeoutError('blocked model fixture')})
        receipt = self.screen.run()
        self.assertEqual(len(calls), 240); self.assertEqual(calls.count(failed), 1); self.assertEqual(len(live), 2)
        self.assertEqual(receipt['report']['arms']['off']['failed'], 1)
        self.assertEqual(receipt['report']['arms']['off']['unfinished'], 1)

    def test_correctness_failure_stops_and_retains_failed_attempt_without_receipt(self):
        failed = self.plan['slots'][0]['id']; calls, live = self.fixture(fail={failed: ValueError('invalid model output fixture')})
        with self.assertRaisesRegex(ValueError, 'invalid model'): self.screen.run()
        self.assertEqual(calls, [failed]); self.assertTrue(all(worker.stopped for worker in live))
        self.assertFalse((self.directory / 'receipt.json').exists())
        rows, _ = self.screen.journal.results(); self.assertEqual(rows[0]['status'], 'correctness-error')
        self.assertFalse(self.allocation.accounting()[2])
        with self.assertRaisesRegex(ValueError, 'unresolved'): self.screen.run()
        self.assertEqual(calls, [failed])

    def test_insufficient_pair_budget_preserves_all_unstarted_slots(self):
        calls, _ = self.fixture()
        interval, _, _ = self.allocation.begin('exploration-screen'); self.advance(1730)
        self.allocation.finish(interval['id'], reason='fixture recovery')
        receipt = self.screen.run()
        self.assertFalse(calls); self.assertFalse(receipt['report']['adopted'])
        self.assertEqual(receipt['report']['arms']['off']['unstarted'], 120)
        self.assertEqual(receipt['report']['arms']['on']['unstarted'], 120)
        self.assertGreater(receipt['report']['chargedSeconds'], 1740)

    def test_compatible_repair_reuses_original_gate_and_launch_without_rewriting(self):
        calls, _ = self.fixture()
        original_gate = self.screen.gate_path
        immutable(self.launch_path, {'schema': 1, 'plan': reference(self.plan_path), 'gate': reference(original_gate),
                                     'allocation': str(self.allocation.directory), 'contract': self.contract})
        original = self.launch_path.read_bytes()
        supplied = self.directory / 'later-gate.json'; immutable(supplied, {'different': 'unused gate'})
        self.screen.gate_path = supplied
        result = self.screen.run()
        self.assertTrue(result['report']['adopted']); self.assertEqual(len(calls), 240)
        self.assertEqual(self.screen.gate_path, original_gate)
        self.assertEqual(self.launch_path.read_bytes(), original)
