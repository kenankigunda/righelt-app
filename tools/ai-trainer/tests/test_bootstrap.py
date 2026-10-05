"""CPU fixtures only: no MPS, ONNX export, browser, training or evaluation."""
from contextlib import ExitStack
import fcntl
import json
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

from righelt_training import bootstrap
from righelt_training.activity import observation
from righelt_training.allocation import Allocation, append
from righelt_training.checkpoint import atomic_json
from righelt_training.config import CONFIG_SHA256
from righelt_training.sequence import PREREQUISITE, digest, read


class BootstrapTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(); self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name).resolve(); self.control = self.root/'sequence'; self.control.mkdir()
        self.directory = self.root/'diagnostic'; self.directory.mkdir()
        self.clock = [1000.]
        self.source = {'sourceRevision': 'current', 'configSha256': CONFIG_SHA256,
                       'proofDependencies': {'engine.ts': 'current'}, 'bootstrapDependencies': {'bootstrap.py': 'current'}}
        self.runtime = {'python': 'fixture', 'onnxruntime-web': 'fixture'}
        self.checkpoint = self.root/'prior'/'checkpoints'/'checkpoint-000942.pt'
        self.checkpoint.parent.mkdir(parents=True); self.checkpoint.write_bytes(b'942')
        atomic_json(self.checkpoint.with_suffix('.json'), {'manifestSha256': 'prior'})
        opponent = self.root/'opponent.pt'; opponent.write_bytes(b'842')
        config = {'sequenceId': 'restart', 'diagnosticDirectory': str(self.directory), 'sixHourDirectory': str(self.root/'six'),
                  'twelveHourDirectory': str(self.root/'twelve'), 'recoveryCheckpoint': str(self.checkpoint),
                  'recoverySha256': digest(self.checkpoint), 'opponentCheckpoint': str(opponent), 'opponentSha256': digest(opponent),
                  'diagnosticAllocationId': 'existing', 'prerequisiteThreadIds': [PREREQUISITE, 'second-task']}
        atomic_json(self.control/'sequence.json', config)
        self.receipts = {'receipts': [{'threadId': task, 'completed': True, 'evidence': 'completion notice', 'alertId': task}
                                     for task in config['prerequisiteThreadIds']]}
        snapshot = {'observedAt': self.clock[0], 'projectId': 'righelt', 'excludedThreadId': 'self',
                    'expectedThreadIds': config['prerequisiteThreadIds'],
                    'snapshot': {'threads': [{'id': task, 'kind': 'codex', 'projectId': 'righelt', 'status': 'idle'}
                                            for task in config['prerequisiteThreadIds']]}}
        self.args = {name: self.root/(name+'.json') for name in
                     ('static_proof', 'recovery_audit', 'corpus', 'legacy_gate', 'completion', 'snapshot', 'activity_file')}
        atomic_json(self.args['completion'], self.receipts); atomic_json(self.args['snapshot'], snapshot)
        atomic_json(self.args['activity_file'], observation(snapshot, self.clock[0]))
        checks = {}
        for name in ('coreTests', 'trainerTests', 'exactReplay'):
            log = self.root/(name+'.log'); log.write_text('fixture proof')
            checks[name] = {'passed': True, 'evidence': str(log), 'sha256': digest(log)}
        atomic_json(self.args['static_proof'], {**self.source, 'checks': checks})
        atomic_json(self.args['recovery_audit'], {'passed': True, 'sourceRevision': 'current', 'checkpoint': str(self.checkpoint),
                    'sha256': digest(self.checkpoint), 'updates': 3309, 'recoverySha256': 'recovery'})
        atomic_json(self.args['corpus'], {'states': [{'id': str(i)} for i in range(1000)]})
        self.health = {'terminalGames': 205, 'distinctRecoverableTrainedCheckpoints': 2, 'finiteNonzeroUpdates': True,
                       'unresolvedCorrectnessFailures': 0, 'trainedExportParityPassed': True,
                       'unfinishedAttempts': [], 'progressReportPublished': True}
        atomic_json(self.args['legacy_gate'], {'sourceRevision': 'historical', 'configSha256': CONFIG_SHA256,
                                             'health': self.health, 'progressReport': {'path': 'historical-report'}})
        self.allocation = Allocation(self.root, self.directory)
        append(self.allocation.path, {'event': 'created', 'allocation': str(self.directory), 'id': 'existing',
                                     'seconds': 7200, 'stage': 'overnight'})
        append(self.allocation.path, {'event': 'started', 'allocation': str(self.directory), 'id': 'prior',
                   'phase': 'arena', 'wall': 100, 'monotonic': 100, 'boot': 0, 'owner': {'pid': -1, 'created': 1}})
        append(self.allocation.path, {'event': 'finished', 'allocation': str(self.directory), 'id': 'prior',
                                     'chargedSeconds': 458.080072, 'reason': 'completed'})
        self.policy = bootstrap.Policy(archive=str(self.root), allocation_name='diagnostic', allocation_id='existing',
                                       checkpoint_relative='prior/checkpoints/checkpoint-000942.pt', checkpoint_sha256=digest(self.checkpoint))
        self.cleanup = Mock(); self.process = Mock(side_effect=self.fake_phase)
        stack = self.enterContext(ExitStack())
        for target, options in [
            ('righelt_training.bootstrap.source_identity', {'return_value': self.source}),
            ('righelt_training.bootstrap.runtime_identity', {'return_value': self.runtime}),
            ('righelt_training.bootstrap.manifest_hashes', {'return_value': {'prior'}}),
            ('righelt_training.bootstrap.inspect_checkpoint', {'return_value': {'updates': 3309, 'optimizer': {'state': 'retained'}, 'recoverySha256': 'recovery'}}),
            ('righelt_training.bootstrap.cleanup_owned', {'new': self.cleanup}),
            ('righelt_training.bootstrap.run_phase', {'new': self.process}),
            ('righelt_training.supervisor.dependency_inventory', {'return_value': self.source['proofDependencies']}),
            ('righelt_training.allocation.identity', {'return_value': {'pid': -1, 'created': 1}}),
            ('righelt_training.allocation.alive', {'return_value': False}),
            ('psutil.boot_time', {'return_value': 0}),
            ('time.time', {'side_effect': lambda: self.clock[0]}),
            ('time.monotonic', {'side_effect': lambda: self.clock[0]}),
        ]: stack.enter_context(patch(target, **options))

    def mutate(self, path, function):
        value = read(path); function(value); atomic_json(path, value)

    def fake_phase(self, argv, env, log, budget, runtime, directory, root, activity):
        self.assertEqual(argv[1:4], ['-m', 'righelt_training.bootstrap_worker', '--attempt'])
        self.assertEqual(runtime['command'], 'bootstrap-proof')
        self.assertAlmostEqual(budget.seconds, 7200-self.allocation.accounting()[1])
        self.assertAlmostEqual(runtime['deadlineMonotonic']-runtime['startedMonotonic'], budget.seconds)
        self.assertEqual(len(self.allocation.accounting()[2]), 1)
        # A bounded process double: resource wait and proof both advance the
        # same original allocation clock, with no inherited reserve subtraction.
        self.clock[0] += 30
        attempt = Path(argv[-1]); plan = read(attempt/'plan.json')
        self.outputs(attempt, plan['identity'])
        atomic_json(attempt/'worker-complete.json', {'identity': plan['identity'], 'complete': True, 'runtime': self.runtime})
        return 'completed', SimpleNamespace(returncode=0)

    def outputs(self, attempt, identity):
        corpus_sha = identity['corpus']['sha256']; model = attempt/'numeric/model.onnx'
        model.parent.mkdir(); model.write_bytes(b'fixed ONNX fixture'); model_sha = digest(model)
        (attempt/'native-search.onnx').write_bytes(model.read_bytes())
        ids = [str(i) for i in range(1000)]
        atomic_json(attempt/'corpus-check.json', {'passed': True, 'states': 1000, 'corpusSha256': corpus_sha})
        atomic_json(attempt/'numeric/parity-report.json', {'numericPassed': True, 'states': 1000, 'heldoutStates': 1000,
                    'referenceDevice': 'mps', 'trainedCheckpoint': True, 'configSha256': CONFIG_SHA256,
                    'corpusSha256': corpus_sha, 'atol': 1e-5, 'rtol': 1e-4, 'maxAbsoluteError': [0., 0.], 'export': {'sha256': model_sha}})
        atomic_json(attempt/'native-raw.json', {'modelSha256': model_sha, 'referenceDevice': 'mps', 'corpusSha256': corpus_sha,
                                              'states': [{'id': identity} for identity in ids]})
        atomic_json(attempt/'native-search.json', {'complete': True, 'referenceDevice': 'mps', 'modelSha256': model_sha,
                    'corpusSha256': corpus_sha, 'profile': bootstrap.PROFILE,
                    'states': [{'id': identity, 'seed': 107+i, 'result': {'status': 'ready', 'stopped': 'complete'}} for i, identity in enumerate(ids)]})
        atomic_json(attempt/'browser-numeric.json', {'numericParityPassed': True, 'legalMasksIdentical': True, 'states': 1000,
                    'referenceDevice': 'mps', 'backend': 'wasm', 'threads': 1, 'corpusSha256': corpus_sha,
                    'modelSha256': model_sha, 'browserVersion': 'fixture'})
        atomic_json(attempt/'browser-raw.json', {'fixture': True})
        atomic_json(attempt/'browser-search.json', {'modelVersion': model_sha, 'results': [{'id': identity} for identity in ids]})
        atomic_json(attempt/'browser-search-proof.json', {'states': 1000, 'tacticalOutcomesVerified': True,
                    'modelSha256': model_sha, 'referenceDevice': 'mps', 'browserVersion': 'fixture'})
        built = attempt/'benchmark'; built.mkdir(); (built/'model.onnx').write_bytes(model.read_bytes())
        assets = {'model': {'path': 'model.onnx', 'sha256': model_sha}}
        for name in ('worker', 'corpus', 'runtimeMjs', 'runtimeWasm'):
            (built/name).write_bytes(name.encode()); assets[name] = {'path': name, 'sha256': digest(built/name)}
        atomic_json(built/'manifest.json', {'modelVersion': model_sha, 'runtimeVersion': 'fixture',
                                          'assets': assets})

    def run_bootstrap(self):
        return bootstrap.run(self.control, **self.args, policy=self.policy)

    def test_charged_fixed_proof_reuses_allocation_and_preserves_historical_health(self):
        with patch.object(Allocation, 'create', side_effect=AssertionError('cannot create')):
            report = self.run_bootstrap()
        gate = read(report['gate']); proof = read(gate['bootstrapEvidence']['path'])
        self.assertTrue(proof['passed']); self.assertEqual(proof['heldoutStates'], 1000)
        self.assertEqual(gate['health'], self.health)
        self.assertEqual(gate['inheritedHealthEvidence']['sourceRevision'], 'historical')
        self.assertEqual(gate['sourceRevision'], 'current')
        self.assertFalse(gate['productionPromotion'])
        self.assertAlmostEqual(report['chargedSeconds'], 488.080072)
        self.assertAlmostEqual(report['remainingSeconds'], 6711.919928)
        self.assertEqual(self.cleanup.call_count, 1)
        self.assertEqual(self.allocation.accounting()[2], [])

    def test_hold_and_each_completion_receipt_and_live_activity_block_before_charging(self):
        config = self.control/'sequence.json'; original = config.read_bytes()
        self.mutate(config, lambda value: value.update(launchHold='additional task identity pending'))
        with self.assertRaisesRegex(ValueError, 'launch held'): self.run_bootstrap()
        config.write_bytes(original)
        self.mutate(self.args['completion'], lambda value: value['receipts'].pop())
        with self.assertRaisesRegex(ValueError, 'completion receipt'): self.run_bootstrap()
        atomic_json(self.args['completion'], self.receipts)
        self.mutate(self.args['snapshot'], lambda value: value['snapshot']['threads'][0].update(status='active'))
        with self.assertRaisesRegex(ValueError, 'project work active'): self.run_bootstrap()
        self.assertEqual(self.allocation.accounting()[1], 458.080072)
        self.process.assert_not_called()

    def test_stale_snapshot_and_mismatched_activity_rejected(self):
        self.mutate(self.args['activity_file'], lambda value: value.update(developmentActive=True))
        with self.assertRaisesRegex(ValueError, 'activity file'): self.run_bootstrap()
        self.clock[0] += 10000
        with self.assertRaisesRegex(ValueError, 'stale'): self.run_bootstrap()
        self.process.assert_not_called()

    def test_static_source_recovery_and_inherited_health_proof_cannot_be_relabelled(self):
        cases = [('static_proof', lambda x: x.update(sourceRevision='old'), 'static proof'),
                 ('recovery_audit', lambda x: x.update(recoverySha256='wrong'), 'recovery audit'),
                 ('legacy_gate', lambda x: x['health'].update(terminalGames=99), 'inherited initial health')]
        for name, mutation, error in cases:
            original = self.args[name].read_bytes(); self.mutate(self.args[name], mutation)
            with self.assertRaisesRegex(ValueError, error): self.run_bootstrap()
            self.args[name].write_bytes(original)
        (self.root/'coreTests.log').write_text('changed')
        with self.assertRaisesRegex(ValueError, 'changed static proof'): self.run_bootstrap()
        self.process.assert_not_called()

    def test_both_locks_exclude_another_coordinator_or_supervisor(self):
        for name in ('coordinator.lock', 'supervisor.lock'):
            with (self.root/name).open('a+') as lock:
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
                with self.assertRaises(BlockingIOError): self.run_bootstrap()
        self.process.assert_not_called()

    def test_partial_twenty_state_or_failed_parity_never_publishes_gate(self):
        original = self.fake_phase
        for name, mutation in [('native-search.json', lambda x: x.update(states=x['states'][:20])),
                               ('browser-numeric.json', lambda x: x.update(numericParityPassed=False)),
                               ('corpus-check.json', lambda x: x.update(passed=False))]:
            def partial(*args):
                result = original(*args); self.mutate(Path(args[0][-1])/name, mutation); return result
            self.process.side_effect = partial
            with self.assertRaises(ValueError): self.run_bootstrap()
        self.assertEqual(list(self.directory.glob('bootstrap/*/gate.json')), [])
        self.assertEqual(self.allocation.accounting()[2], [])
        self.assertAlmostEqual(self.allocation.accounting()[1], 548.080072)

    def test_failed_process_or_resource_stop_is_charged_without_automatic_retry(self):
        for reason in ('runner-failed', 'resource-restart-review-required', 'budget-expired'):
            def failed(*args):
                self.clock[0] += 2
                return reason, SimpleNamespace(returncode=1)
            self.process.side_effect = failed
            with self.assertRaisesRegex(RuntimeError, 'did not complete'): self.run_bootstrap()
        self.assertEqual(self.process.call_count, 3)
        self.assertEqual(list(self.directory.glob('bootstrap/*/gate.json')), [])
        self.assertAlmostEqual(self.allocation.accounting()[1], 464.080072)

    def test_cleanup_uncertainty_stays_open_until_recovery_and_cannot_extend_budget(self):
        self.cleanup.side_effect = RuntimeError('cleanup uncertain')
        with self.assertRaisesRegex(RuntimeError, 'cleanup uncertain'): self.run_bootstrap()
        self.assertEqual(len(self.allocation.accounting()[2]), 1)
        self.assertEqual(list(self.directory.glob('bootstrap/*/gate.json')), [])
        self.cleanup.side_effect = None; self.clock[0] += 40
        self.mutate(self.args['snapshot'], lambda value: value.update(observedAt=self.clock[0]))
        atomic_json(self.args['activity_file'], observation(read(self.args['snapshot']), self.clock[0]))
        self.process.side_effect = lambda *args: ('budget-expired', None)
        with self.assertRaisesRegex(RuntimeError, 'did not complete'): self.run_bootstrap()
        self.assertEqual(self.allocation.accounting()[2], [])
        self.assertAlmostEqual(self.allocation.accounting()[1], 528.080072)

    def test_exhausted_original_budget_cannot_create_reset_or_launch(self):
        append(self.allocation.path, {'event': 'started', 'allocation': str(self.directory), 'id': 'used', 'owner': {'pid': -1, 'created': 1}})
        append(self.allocation.path, {'event': 'finished', 'allocation': str(self.directory), 'id': 'used', 'chargedSeconds': 6741.919928})
        with self.assertRaisesRegex(ValueError, 'budget exhausted'): self.run_bootstrap()
        self.process.assert_not_called()

    def test_inputs_changed_during_work_do_not_get_a_passed_gate(self):
        def changed(*args):
            result = self.fake_phase(*args)
            self.args['corpus'].write_text('{}')
            return result
        self.process.side_effect = changed
        with self.assertRaisesRegex(ValueError, 'input changed'): self.run_bootstrap()
        self.assertEqual(list(self.directory.glob('bootstrap/*/gate.json')), [])

    def test_budget_overrun_after_process_completion_cannot_publish_gate(self):
        def overrun(*args):
            result = self.fake_phase(*args); self.clock[0] += 7200; return result
        self.process.side_effect = overrun
        with self.assertRaisesRegex(ValueError, 'budget exhausted'): self.run_bootstrap()
        self.assertEqual(list(self.directory.glob('bootstrap/*/gate.json')), [])

    def test_actual_source_or_runtime_change_is_rejected_before_publication(self):
        def changed(*args):
            result = self.fake_phase(*args)
            self.source = {**self.source, 'sourceRevision': 'changed'}
            return result
        self.process.side_effect = changed
        with patch.object(bootstrap, 'source_identity', side_effect=lambda: self.source):
            with self.assertRaisesRegex(ValueError, 'source, dependencies or runtime changed'): self.run_bootstrap()
        self.assertEqual(list(self.directory.glob('bootstrap/*/gate.json')), [])

    def test_artifact_mutation_during_cleanup_is_charged_and_never_published(self):
        def mutate(directory):
            self.clock[0] += 2
            path = next(directory.glob('bootstrap/*/browser-numeric.json'))
            self.mutate(path, lambda value: value.update(states=20))
        self.cleanup.side_effect = mutate
        with self.assertRaisesRegex(ValueError, 'browser numeric'): self.run_bootstrap()
        self.assertAlmostEqual(self.allocation.accounting()[1], 490.080072)
        self.assertEqual(self.allocation.accounting()[2], [])
        self.assertEqual(list(self.directory.glob('bootstrap/*/gate.json')), [])

    def test_copied_allocation_id_cannot_authorize_another_directory(self):
        self.mutate(self.control/'sequence.json', lambda value: value.update(diagnosticDirectory=str(self.root/'copied')))
        with self.assertRaisesRegex(ValueError, 'diagnostic directory changed'): self.run_bootstrap()
        self.process.assert_not_called()


if __name__ == '__main__': unittest.main()
