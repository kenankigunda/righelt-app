"""One explicit replacement allocation; no real model work in these fixtures."""
import fcntl
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

from righelt_training import continuation_policy as policy
from righelt_training.allocation import Allocation, append, validate_continuation, validate_contract
from righelt_training.sequence import Sequence, immutable, read
from exploration_fixture import publish_selection, receipt_fixture_validation
import test_sequence


def setup(root):
    sequence, receipt, snapshot = test_sequence.SequenceTest().setup_sequence(root)
    sequence.claim(receipt, snapshot)
    raw = root / 'diagnostic' / 'result.json'
    immutable(raw, {'diagnosticGatePassed': False, 'allAttemptsAccounted': True, 'terminalGames': 15,
                    'scheduledGames': 20, 'workload': 'restart-diagnostic-20-v1',
                    'reason': 'diagnostic-incomplete-matches', 'sourceRevision': 'a' * 40})
    sequence.complete('diagnostic', raw)
    checkpoint = Path(sequence.config['recoveryCheckpoint'])
    immutable(checkpoint.with_suffix('.json'), {'sha256': policy.digest(checkpoint)})
    immutable(checkpoint.with_suffix('.runner.json'), {'fixture': 'bound recovery state'})
    audit = root / 'audit.json'
    immutable(audit, {'passed': True, 'checkpoint': str(checkpoint), 'sha256': policy.digest(checkpoint),
                      'optimizerRestored': True, 'randomStateRestored': True})
    authority = root / 'authority.json'
    immutable(authority, {'verifiedHumanInstruction': True, 'threadId': 'human-thread',
                          'messageId': 'human-instruction', 'instruction': 'One eight-hour experiment, then stop.'})
    review = root / 'review.json'; immutable(review, {'passed': True, 'scope': 'fixture'})
    regression = root / 'regression.json'; immutable(regression, {'passed': True, 'scope': 'fixture'})
    bridge = root / 'bridge.json'
    immutable(bridge, {'schema': 1, 'passed': True, 'fromRevision': 'a' * 40, 'toRevision': 'b' * 40,
                      'compatibleModelProof': True, 'reviewEvidence': [policy.reference(review)],
                      'regressionEvidence': [policy.reference(regression)]})
    allocation = Allocation(root, root / 'diagnostic')
    value = {'schema': 1, 'kind': policy.KIND, 'sequenceId': sequence.config['sequenceId'],
             'phase': 'eight-hour', 'stopAfter': True, 'budgetSeconds': 28800, 'reserveSeconds': 3600,
             'explorationSeconds': 1800, 'exception': 'terminal-games-15-of-16',
             'supersedes': ['six-hour', 'twelve-hour'], 'sequenceConfig': policy.reference(sequence.path),
             'runDirectory': str(root / 'restart-eight-hour-r1'),
             'diagnosticReport': policy.reference(sequence.report_path('diagnostic')),
             'diagnosticEvidence': policy.reference(raw), 'diagnosticAllocationId': 'evaluation',
             'diagnosticAccountingSha256': policy.accounting_hash(allocation.events()),
             'recoveryCheckpoint': policy.reference(checkpoint),
             'recoveryMetadata': policy.reference(checkpoint.with_suffix('.json')),
             'recoverySidecar': policy.reference(checkpoint.with_suffix('.runner.json')),
             'recoveryAudit': policy.reference(audit), 'authority': policy.reference(authority),
             'sourceLineage': {'diagnosticRevision': 'a' * 40, 'preparedRevision': 'b' * 40,
                               'reviewedBridge': policy.reference(bridge)}}
    amendment = root / 'amendment.json'; immutable(amendment, value)
    return sequence, receipt, snapshot, amendment


class EightHourTests(unittest.TestCase):
    def setUp(self):
        self.enterContext(receipt_fixture_validation())
        self.temp = self.enterContext(tempfile.TemporaryDirectory())
        self.root = Path(self.temp).resolve()
        self.sequence, self.receipt, self.snapshot, self.amendment = setup(self.root)

    def claim(self):
        policy.register(self.sequence.directory, self.amendment)
        return self.sequence.claim(self.receipt, self.snapshot)

    def test_no_amendment_retains_failed_gate_and_registration_does_not_rewrite_it(self):
        before = self.sequence.report_path('diagnostic').read_bytes()
        self.assertIsNone(self.sequence.next_phase())
        self.assertFalse((self.root / 'restart-eight-hour-r1').exists())
        ref = policy.register(self.sequence.directory, self.amendment)
        self.assertEqual(policy.register(self.sequence.directory, self.amendment), ref)
        self.assertEqual(self.sequence.next_phase(), 'eight-hour')
        self.assertEqual(self.sequence.report_path('diagnostic').read_bytes(), before)

    def test_allocation_survives_crash_before_contract_and_claim_publication(self):
        policy.register(self.sequence.directory, self.amendment)
        original = immutable
        def interrupted(path, value):
            if Path(path).name == 'eight-hour.json': raise RuntimeError('power loss')
            original(path, value)
        with patch('righelt_training.sequence.immutable', side_effect=interrupted):
            with self.assertRaises(RuntimeError): self.sequence.claim(self.receipt, self.snapshot)
        allocation = Allocation(self.root, self.root / 'restart-eight-hour-r1')
        identity = allocation.accounting()[0]['id']
        claim = Sequence(self.sequence.directory).claim(self.receipt, self.snapshot)
        self.assertEqual(allocation.accounting()[0]['id'], identity)
        self.assertEqual(claim, self.sequence.claim(self.receipt, self.snapshot))
        self.assertEqual((allocation.accounting()[0]['seconds'], allocation.accounting()[0]['stage']), (28800, 'initial'))

    def test_no_superseded_raw_contract_missing_reference_or_wrong_resume_destination(self):
        claim = self.claim(); contract = read(claim['contract'])
        for phase in ('six-hour', 'twelve-hour'):
            changed = {**contract, 'phase': phase, 'budgetSeconds': policy.LIMITS[phase][0],
                       'reserveSeconds': policy.LIMITS[phase][1]}
            changed.pop(policy.FIELD)
            with self.assertRaisesRegex(ValueError, 'registered eight-hour'):
                Allocation(self.root, self.root / phase).create_continuation(changed)
        changed = dict(contract); changed.pop(policy.FIELD)
        with self.assertRaises(ValueError): validate_contract(changed, self.root)
        changed = dict(contract); changed.pop('explorationProtocol')
        with self.assertRaises(ValueError): validate_contract(changed, self.root)
        with self.assertRaisesRegex(ValueError, 'destination'):
            Allocation(self.root, self.root / 'duplicate').create_continuation(contract)
        # Copying a created ledger row to another path cannot bypass resume admission.
        original = Allocation(self.root, claim['runDirectory']).accounting()[0]
        duplicate = self.root / 'duplicate'
        append(self.root / 'allocation-events.jsonl', {**original, 'allocation': str(duplicate)})
        with self.assertRaisesRegex(ValueError, 'destination'):
            validate_continuation(duplicate, {'continuation': contract, 'seconds': 28800})

    def test_tampered_authority_reports_recovery_or_config_rejects_resume(self):
        claim = self.claim(); contract = read(claim['contract']); value = read(self.amendment)
        for field in ('authority', 'diagnosticReport', 'diagnosticEvidence', 'recoverySidecar', 'sequenceConfig'):
            path = Path(value[field]['path']); before = path.read_bytes()
            try:
                path.write_text('{}')
                with self.assertRaises(ValueError): validate_contract(contract, self.root)
            finally: path.write_bytes(before)
        for field, wrong in (('budgetSeconds', 28801), ('reserveSeconds', 3599)):
            with self.assertRaises(ValueError): validate_contract({**contract, field: wrong}, self.root)

    def test_register_refuses_allocation_created_before_any_claim(self):
        append(self.root / 'allocation-events.jsonl', {'event': 'created', 'allocation': str(self.root / 'six'),
               'continuation': {'sequenceId': 'approved', 'phase': 'six-hour'}})
        with self.assertRaisesRegex(ValueError, 'already claimed'):
            policy.register(self.sequence.directory, self.amendment)

    def test_register_refuses_occupied_canonical_destination_from_another_sequence(self):
        append(self.root/'allocation-events.jsonl',{'event':'created','allocation':str(self.root/'restart-eight-hour-r1'),
                                                  'continuation':{'sequenceId':'unrelated','phase':'eight-hour'}})
        with self.assertRaisesRegex(ValueError,'already claimed'):
            policy.register(self.sequence.directory,self.amendment)

    def test_runtime_source_requires_bound_initial_revision_or_reviewed_repair(self):
        claim=self.claim();contract=read(claim['contract'])
        policy.validate_source(contract,self.root,claim['runDirectory'],'b'*40,{})
        with self.assertRaises(ValueError):
            policy.validate_source(contract,self.root,claim['runDirectory'],'c'*40,{})
        repair={'oldRevision':'b'*40,'sourceRevision':'c'*40,'cause':'reviewed repair',
                'artifactDisposition':'preserve compatible state','regressionEvidence':[policy.reference(self.root/'regression.json')],
                'reviewEvidence':[policy.reference(self.root/'review.json')]}
        policy.validate_source(contract,self.root,claim['runDirectory'],'c'*40,{'repair':repair})
        run=Path(claim['runDirectory']);run.mkdir(exist_ok=True)
        (run/'manifest.json').write_text('{}')
        with patch('righelt_training.manifest.active_manifest',return_value={'manifest':{'sourceRevision':'c'*40}}):
            with self.assertRaises(ValueError):
                policy.validate_source(contract,self.root,run,'b'*40,{})
        (run/'manifest.json').unlink()
        repair['oldRevision']='a'*40
        with self.assertRaises(ValueError):
            policy.validate_source(contract,self.root,claim['runDirectory'],'c'*40,{'repair':repair})

    def test_cli_registration_cannot_race_supervisor(self):
        with (self.root / 'supervisor.lock').open('a+') as lock:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            result = subprocess.run([sys.executable, '-m', 'righelt_training.sequence', '--directory',
                str(self.sequence.directory), 'register-amendment', '--evidence', str(self.amendment)],
                capture_output=True, text=True, timeout=15)
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse(policy.registry_path(self.root, 'approved').exists())

    def test_both_recipes_complete_and_stop_even_when_health_is_good(self):
        for enabled in (False, True):
            with self.subTest(enabled=enabled), tempfile.TemporaryDirectory() as d:
                root = Path(d).resolve(); sequence, receipt, snapshot, amendment = setup(root)
                policy.register(sequence.directory, amendment)
                claim = sequence.claim(receipt, snapshot); run = Path(claim['runDirectory'])
                allocation = Allocation(root, run)
                binding = publish_selection(allocation, enabled=enabled)
                from righelt_training.exploration_adoption import read_binding
                recipe = read_binding(binding)['trainingRecipe']
                proof = run / 'stage-result.json'
                immutable(proof, {'sequenceId': 'approved', 'phase': 'eight-hour', 'experimentComplete': True,
                    'advancementEligible': False, 'continuationAllowed': False, 'trainingRecipe': recipe,
                    'explorationAdoption': binding, 'health': {'healthy': True, 'freshHealthRequired': True,
                    'trainingRecipe': recipe, 'explorationAdoption': binding}})
                report = sequence.complete('eight-hour', proof)
                self.assertTrue(report['health']['healthy']); self.assertFalse(report['advancementEligible'])
                self.assertEqual(sequence.complete('eight-hour', proof), report)
                self.assertIsNone(sequence.next_phase())
                self.assertEqual(sequence.claim(receipt, snapshot)['action'], 'finished-or-gate-unmet')
                self.assertFalse((sequence.directory / 'claims' / 'twelve-hour.json').exists())
                self.assertEqual(sequence.mail('eight-hour', 'status')['status'], 'pending')

    def test_inconclusive_final_report_also_stops(self):
        claim = self.claim(); run = Path(claim['runDirectory']); run.mkdir(exist_ok=True)
        proof = run / 'stage-result.json'; immutable(proof, {'phase': 'eight-hour', 'status': 'inconclusive'})
        report = self.sequence.complete('eight-hour', proof)
        self.assertFalse(report['advancementEligible']); self.assertIsNone(self.sequence.next_phase())
        with self.assertRaisesRegex(ValueError,'finished'):
            Allocation(self.root,run).begin('training')

    def test_finished_stage_prevents_direct_compute_before_coordinator_seals_report(self):
        claim=self.claim();run=Path(claim['runDirectory']);run.mkdir(exist_ok=True)
        immutable(run/'stage-result.json',{'experimentComplete':True})
        with self.assertRaisesRegex(ValueError,'finished'):
            Allocation(self.root,run).begin('arena')

    def test_eight_hour_reserve_survives_elapsed_time_sleep_and_restart(self):
        from righelt_training.supervisor import validation_boundary,validate_training_window
        for charged in (0,1800,10000,25200):
            runtime={'command':'training','startedMonotonic':100-charged,
                     'deadlineMonotonic':100+28800-charged,'deadlineWall':100000+28800-charged,
                     'reserveSeconds':3600}
            with patch('righelt_training.supervisor.time.time',return_value=100000):
                self.assertEqual(validation_boundary(runtime,100),100+25200-charged)
            with patch('righelt_training.supervisor.time.time',return_value=100000+25200-charged):
                self.assertEqual(validation_boundary(runtime,100),100)
                with self.assertRaises(ValueError):validate_training_window(runtime,100)
