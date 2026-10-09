import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock, patch

from righelt_training import recovery_inspection as inspection
from righelt_training.budget import Budget


class RecoveryInspectionTests(unittest.TestCase):
    def setUp(self):
        self.root = Path(self.enterContext(tempfile.TemporaryDirectory())).resolve()
        self.checkpoint = self.root / 'checkpoints' / 'trained.pt'
        self.checkpoint.parent.mkdir(); self.checkpoint.write_bytes(b'fixture')
        self.checkpoint.with_suffix('.json').write_text(json.dumps({'manifestSha256': 'm'}))
        self.checkpoint.with_suffix('.runner.json').write_text('{}')
        self.latest = self.root / 'latest.json'
        self.latest.write_text(json.dumps({'updates': 42}))
        self.runtime = {'allocationId': 'new', 'allocationInterval': 'open', 'manifestSha256': 'm'}
        self.now = 0
        self.process = Mock(pid=123, returncode=0)
        self.process.poll.return_value = 0
        self.start = self.enterContext(patch.object(inspection, 'start_group', side_effect=self.finish))
        self.register = self.enterContext(patch.object(inspection, 'register_owned'))
        self.stop = self.enterContext(patch.object(inspection, 'stop_group'))
        self.cleanup = self.enterContext(patch.object(inspection, 'cleanup_owned'))

    def finish(self, argv, **kwargs):
        request = Path(argv[argv.index('--request') + 1])
        result = Path(argv[argv.index('--result') + 1])
        result.write_text(json.dumps({'passed': True, 'request': inspection.reference(request),
                                     'updates': 42, 'state': {'updates': 42}}))
        return self.process

    def sleep(self, seconds): self.now += seconds

    def run_inspection(self, seconds=900):
        return inspection.inspect_owned(self.root, self.runtime, Budget(0, seconds), self.checkpoint,
                                        latest=self.latest, clock=lambda: self.now, sleep=self.sleep)

    def test_passed_receipt_binds_exact_input_and_charged_interval(self):
        self.assertEqual(self.run_inspection()['state']['updates'], 42)
        request = json.loads(next(self.root.glob('recovery-inspections/*/request.json')).read_text())
        self.assertEqual(request['allocationInterval'], 'open')
        self.assertEqual(request['inputs']['checkpoint'], inspection.reference(self.checkpoint))
        self.register.assert_called_once_with(self.root, self.process)
        self.stop.assert_called_once_with(self.process); self.cleanup.assert_called_once_with(self.root)

    def test_hung_verifier_is_killed_at_300_seconds_or_remaining_budget(self):
        for seconds, bound in ((900, 300), (4, 4)):
            with self.subTest(seconds=seconds):
                self.now = 0; self.process.poll.return_value = None; self.stop.reset_mock()
                with self.assertRaisesRegex(TimeoutError, 'timed out'): self.run_inspection(seconds)
                self.assertEqual(self.now, bound); self.stop.assert_called_once_with(self.process)

    def test_no_open_interval_or_exhausted_budget_cannot_spawn(self):
        self.now = 900
        with self.assertRaises(TimeoutError): self.run_inspection()
        self.now = 0; self.runtime.pop('allocationInterval')
        with self.assertRaisesRegex(ValueError, 'charged interval'): self.run_inspection()
        self.start.assert_not_called()

    def test_bad_worker_exit_or_unbound_receipt_is_never_accepted(self):
        self.process.returncode = 1
        with self.assertRaisesRegex(RuntimeError, 'failed'): self.run_inspection()
        self.process.returncode = 0
        def unbound(argv, **kwargs):
            process = self.finish(argv, **kwargs)
            Path(argv[argv.index('--result')+1]).write_text(json.dumps({'passed': True, 'request': {}}))
            return process
        self.start.side_effect = unbound
        with self.assertRaisesRegex(ValueError, 'unbound'): self.run_inspection()

    def test_checkpoint_mutation_during_inspection_is_not_accepted(self):
        def changed(argv, **kwargs):
            process = self.finish(argv, **kwargs); self.checkpoint.write_bytes(b'changed'); return process
        self.start.side_effect = changed
        with self.assertRaisesRegex(ValueError, 'input changed'): self.run_inspection()

    def test_interruption_or_uncertain_cleanup_cannot_return_verified_state(self):
        self.process.poll.side_effect = KeyboardInterrupt
        with self.assertRaises(KeyboardInterrupt): self.run_inspection()
        self.stop.assert_called_once_with(self.process)
        self.process.poll.side_effect = None; self.process.poll.return_value = 0
        self.cleanup.side_effect = RuntimeError('cleanup uncertain')
        with self.assertRaisesRegex(RuntimeError, 'cleanup uncertain'): self.run_inspection()

    def test_full_worker_inspection_validates_recovery_before_returning_state(self):
        self.run_inspection()
        request = json.loads(next(self.root.glob('recovery-inspections/*/request.json')).read_text())
        with patch('righelt_training.manifest.manifest_hashes', return_value={'m'}), \
             patch('righelt_training.checkpoint.inspect_checkpoint', return_value={
                 'updates': 42, 'recovery': {'state': {'updates': 42}}}) as full:
            self.assertEqual(inspection.inspect_request(request)['updates'], 42)
            full.assert_called_once_with(self.checkpoint, manifest_sha256='m', require_recovery=True)
            full.return_value['updates'] = 43
            with self.assertRaisesRegex(ValueError, 'update count'): inspection.inspect_request(request)


if __name__ == '__main__': unittest.main()
