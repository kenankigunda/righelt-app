"""CPU tensor/process doubles only; no neural model, MPS, export or engine runs."""
from contextlib import ExitStack
from pathlib import Path
import unittest
from unittest.mock import patch

import torch

from righelt_training import development_collect as collect
from righelt_training import development_probe as probe
from righelt_training.config import CONFIG_SHA256
import test_development_probe as fixtures


class FakeModel:
    training = False

    def __init__(self): self.calls = 0; self.weight = torch.tensor([1.])
    def state_dict(self): return {'weight': self.weight}
    def __call__(self, inputs):
        self.calls += 1
        return torch.zeros((1, 2801)), torch.tensor([.25])


class DevelopmentCollectTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls): fixtures.DevelopmentProbeTest.setUpClass()
    @classmethod
    def tearDownClass(cls): fixtures.DevelopmentProbeTest.tearDownClass()

    def setUp(self):
        fixture = fixtures.DevelopmentProbeTest
        self.directory = fixture.root / self._testMethodName; self.directory.mkdir()
        self.corpus = fixture.corpus; self.cases = fixture.cases; self.model = FakeModel(); self.clock = [100.]
        self.source = {'sourceRevision': 'c' * 40, 'configSha256': CONFIG_SHA256,
                       'proofDependencies': {'engine.ts': 'a' * 64},
                       'bootstrapDependencies': {name: 'b' * 64 for name in probe.SEARCH_DEPENDENCIES}}
        self.runtime = {'python': 'fixture', 'onnxruntime-web': 'fixture'}
        manifest = {'manifest': {'sourceRevision': self.source['sourceRevision']}}
        manifest['sha256'] = probe.checksum(manifest['manifest'])
        fixtures.write(self.directory / 'manifest.json', manifest)
        self.checkpoint = self.directory / 'checkpoint.pt'
        torch.save({'configSha256': CONFIG_SHA256, 'updates': 1, 'model': self.model.state_dict()}, self.checkpoint)
        checkpoint_sha = probe.digest(self.checkpoint)
        asset = self.directory / 'trained-export' / (checkpoint_sha + '.onnx'); asset.parent.mkdir(); asset.write_bytes(b'fake ONNX')
        fixtures.write(self.directory / 'runtime.json', {'command': 'export-parity', 'supervisorPid': 41,
                        'manifestSha256': manifest['sha256'], 'parityCorpusSha256': probe.digest(self.corpus),
                        'developmentCasesSha256': probe.digest(self.cases), 'deadlineMonotonic': 200.})
        fixtures.write(self.directory / 'trained-export-parity.json', {
            'complete': True, 'numericPassed': True, 'trainedCheckpoint': True, 'referenceDevice': 'mps',
            'configSha256': CONFIG_SHA256, 'heldoutStates': 1000, 'checkpointSha256': checkpoint_sha,
            'manifestSha256': manifest['sha256'], 'sourceRevision': self.source['sourceRevision'],
            'corpusSha256': probe.digest(self.corpus), 'export': {'sha256': probe.digest(asset)}})
        self.rows = probe.corpus_rows(self.corpus); self.calls = []
        stack = self.enterContext(ExitStack())
        for target, value in (('source_identity', self.source), ('runtime_identity', self.runtime), ('model_device', 'mps')):
            stack.enter_context(patch.object(collect, target, return_value=value))
        stack.enter_context(patch('os.getppid', return_value=41)); stack.enter_context(patch('os.getpid', return_value=42))
        stack.enter_context(patch('os.getpgrp', return_value=42))
        stack.enter_context(patch.object(collect, 'search_reference', side_effect=self.search))

    def search(self, state, model, device, seed, profile, bound_seconds):
        self.calls.append((seed, profile, bound_seconds)); self.clock[0] += .1
        frozen = self.rows[seed - 107]
        inputs = torch.tensor(frozen['encoded'], dtype=torch.float32).reshape(1, 46, 10, 10)
        model(inputs)
        return {'status': 'ready', 'stopped': 'complete', 'actionIndex': frozen['legal'][0], 'value': .25,
                'legality': {'complete': True, 'indices': frozen['legal']}, 'actions': [],
                'reason': 'search', 'policyMask': True, 'fallback': None}

    def run_collect(self, **kwargs):
        return collect.collect(self.model, self.checkpoint, self.corpus, self.cases, self.directory,
                               kwargs.pop('deadline', 200.), clock=lambda: self.clock[0],
                               resource_check=kwargs.pop('resource_check', lambda: True), **kwargs)

    def test_complete_collection_reuses_root_forward_and_preserves_input_snapshots(self):
        result = self.run_collect(); count = len(probe.read(self.cases)['cases'])
        self.assertTrue(result['complete']); self.assertEqual(self.model.calls, count)
        self.assertEqual(len(self.calls), count); self.assertTrue(all(call[2] <= 10 for call in self.calls))
        value = probe.read(result['report']); self.assertEqual(value['status'], 'complete')
        self.assertEqual(len(value['observations']), count)
        self.assertIsNone(value['acceptanceDecision'])
        fixtures.write(self.directory / 'runtime.json', {'command': 'later health'})
        fixtures.write(self.directory / 'trained-export-parity.json', {'later': 'export'})
        self.assertEqual(probe.report(self.cases, result['proof']), value)
        self.assertEqual(probe.read(self.directory / 'operation-status.json')['status'], 'idle')

    def test_all_work_uses_phase_remaining_and_incomplete_attempts_are_not_replaced(self):
        result = self.run_collect(deadline=105.)
        self.assertFalse(result['complete']); self.assertEqual(probe.read(result['report'])['status'], 'incomplete')
        self.assertLessEqual(max((call[2] for call in self.calls), default=0), 1.)
        second = self.run_collect(deadline=105.)
        self.assertNotEqual(result['proof'], second['proof'])
        self.assertTrue(Path(result['proof']).exists())

    def test_resource_pause_before_start_executes_no_forward(self):
        result = self.run_collect(resource_check=lambda: False)
        self.assertFalse(result['complete']); self.assertEqual(self.model.calls, 0)
        self.assertEqual(self.calls, [])
        self.assertIn('resource', result['reason'])

    def test_raising_resource_callback_contract_and_runtime_deadline_are_honored(self):
        result = self.run_collect(resource_check=lambda: None)
        self.assertTrue(result['complete'])
        runtime_path = self.directory / 'runtime.json'; runtime = probe.read(runtime_path)
        runtime['deadlineMonotonic'] = self.clock[0] + 3; fixtures.write(runtime_path, runtime)
        self.calls.clear()
        result = self.run_collect(deadline=999999.)
        self.assertFalse(result['complete']); self.assertEqual(self.calls, [])

    def test_resource_pause_is_checked_before_each_search_forward(self):
        checks = [0]
        def resource(): checks[0] += 1; return checks[0] <= 3
        result = self.run_collect(resource_check=resource)
        self.assertFalse(result['complete']); self.assertEqual(self.model.calls, 0)
        self.assertEqual(len(self.calls), 1)

    def test_bounded_search_recovery_is_incomplete_but_invalid_output_raises(self):
        with patch.object(collect, 'search_reference', return_value={'status': 'recovery', 'stopped': 'node-limit'}):
            result = self.run_collect()
        self.assertFalse(result['complete']); self.assertEqual(probe.read(result['report'])['observations'], [])
        with patch.object(collect, 'search_reference', return_value={'status': 'failed'}):
            with self.assertRaises((ValueError, TypeError)): self.run_collect()
        failed = [probe.read(p) for p in (self.directory / 'development').glob('*/proof.json')]
        self.assertTrue(any(p.get('failed') for p in failed))

    def test_guard_rejects_wrong_root_encoding_and_nonfinite_or_out_of_range_output(self):
        frozen = self.rows[0]; guarded = collect.GuardedModel(self.model, frozen, lambda: None)
        inputs = torch.ones((1, 46, 10, 10))
        with self.assertRaisesRegex(ValueError, 'encoding'): guarded(inputs)
        inputs.zero_()
        for value in (float('nan'), 2.):
            guarded = collect.GuardedModel(lambda _: (torch.zeros((1, 2801)), torch.tensor([value])), frozen, lambda: None)
            with self.assertRaisesRegex(ValueError, 'output'): guarded(inputs)

    def test_root_encoding_uses_exact_fp32_conversion_including_fractional_counters(self):
        frozen = {**self.rows[0], 'encoded': [.1] + self.rows[0]['encoded'][1:]}
        inputs = torch.tensor(frozen['encoded'], dtype=torch.float32).reshape(1, 46, 10, 10)
        guarded = collect.GuardedModel(self.model, frozen, lambda: None)
        guarded(inputs)
        self.assertIsNotNone(guarded.raw)
        for invalid in (inputs.double(), inputs.flatten()):
            with self.assertRaisesRegex(ValueError, 'shape, dtype'):
                collect.GuardedModel(self.model, frozen, lambda: None)(invalid)

    def test_checkpoint_model_mismatch_and_source_change_fail_without_success(self):
        self.model.weight += 1
        with self.assertRaisesRegex(ValueError, 'loaded development model'): self.run_collect()
        self.model.weight -= 1
        with patch.object(collect, 'source_identity', side_effect=[self.source, {**self.source, 'sourceRevision': 'd' * 40}]):
            with self.assertRaisesRegex(ValueError, 'source or runtime changed'): self.run_collect()

    def test_interruption_preserves_failure_receipt_and_external_watchdog_bound(self):
        captured = []
        def interrupted(*args, **kwargs):
            captured.append(probe.read(self.directory / 'operation-status.json'))
            raise KeyboardInterrupt()
        with patch.object(collect, 'search_reference', side_effect=interrupted), self.assertRaises(KeyboardInterrupt):
            self.run_collect()
        self.assertEqual(captured[0]['deadlineMonotonic'], 160.)
        attempts = list((self.directory / 'development').glob('*/proof.json'))
        self.assertEqual(len(attempts), 1); self.assertFalse(probe.read(attempts[0])['complete'])
        self.assertTrue(probe.read(attempts[0])['failed'])

    def test_complete_stage_proof_rejects_altered_case_export_and_profile(self):
        result = self.run_collect(); proof_path = Path(result['proof']); proof = probe.read(proof_path)
        receipt = Path(proof['receipts'][0]['path']); original = receipt.read_bytes()
        try:
            data = probe.read(receipt); data['raw']['value'] = .75; fixtures.write(receipt, data)
            with self.assertRaisesRegex(ValueError, 'checksum'): probe.report(self.cases, proof_path)
        finally: receipt.write_bytes(original)
        changed = {**proof, 'profile': {**probe.PROFILE, 'simulations': 20}}; fixtures.write(proof_path, changed)
        with self.assertRaisesRegex(ValueError, 'incompatible'): probe.report(self.cases, proof_path)

    def test_mixed_bootstrap_stage_compare_uses_common_native_dependencies(self):
        historical = fixtures.DevelopmentProbeTest.proofs[0]
        original = historical.read_bytes()
        try:
            data = probe.read(historical); data['identity']['bootstrapDependencies'] = {**self.source['bootstrapDependencies'], 'browser-only.js': 'f' * 64}
            fixtures.write(historical, data)
            bootstrap_report = self.directory / 'bootstrap-report.json'; fixtures.write(bootstrap_report, probe.report(self.cases, historical))
            result = self.run_collect()
            compared = probe.compare(self.cases, bootstrap_report, result['report'])
            self.assertEqual(compared['status'], 'complete')
            self.assertEqual(compared['sourceRevisions'], ['a' * 40, 'c' * 40])
        finally: historical.write_bytes(original)


if __name__ == '__main__': unittest.main()
