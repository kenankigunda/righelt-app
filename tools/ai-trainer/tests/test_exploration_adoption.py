"""Selection-to-training contracts with CPU-only fixtures and no experiment work."""
import copy
import functools
import json
from pathlib import Path
import random
import subprocess
import sys
import tempfile
import time
from types import SimpleNamespace
import unittest
from unittest.mock import patch
import torch

from righelt_training import exploration_adoption as adoption, stage
from righelt_training.allocation import Allocation, validate_contract
from righelt_training.checkpoint import save_checkpoint, load_checkpoint, inspect_checkpoint
from righelt_training.development_probe import reference
from righelt_training.manifest import write_manifest, amend_manifest
from righelt_training.sequence import immutable
from righelt_training.training_recipe import recipe_binding
from exploration_fixture import publish_selection, receipt_fixture_validation


class AdoptionTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(); self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name).resolve()
        self.enterContext(receipt_fixture_validation())
        @functools.wraps(torch.backends.mps.is_available)
        def no_mps(): return False
        self.enterContext(patch('torch.backends.mps.is_available', new=no_mps))
        self.py_rng = random.getstate(); self.torch_rng = torch.get_rng_state()
        self.addCleanup(random.setstate, self.py_rng); self.addCleanup(torch.set_rng_state, self.torch_rng)

    def fixture(self, *, enabled=False):
        model = torch.nn.Linear(2, 1); optimizer = torch.optim.AdamW(model.parameters())
        model(torch.ones(1, 2)).sum().backward(); optimizer.step()
        source = self.root / 'old' / 'checkpoints' / 'old.pt'
        source.parent.parent.mkdir(); archive = source.parent.parent / 'archive.json'; archive.write_text('retained')
        state = {'archives': ['archive.json'], 'updates': 1, 'round': 3, 'trainingBatch': 7, 'nextJob': 19}
        save_checkpoint(source, model, optimizer, round_index=3, updates=1, replay_ids=state['archives'],
                        manifest_sha256='old', recovery_state=state)
        evidence = self.root / 'diagnostic.json'
        immutable(evidence, {'workload': 'restart-diagnostic-20-v1', 'diagnosticGatePassed': True,
                             'allAttemptsAccounted': True, 'terminalGames': 16, 'scheduledGames': 20})
        contract = {'sequenceId': 'test', 'phase': 'six-hour', 'budgetSeconds': 21600, 'reserveSeconds': 3600,
                    'preserveState': True, 'freshHealth': True, 'explorationProtocol': adoption.PROTOCOL,
                    'recoveryCheckpoint': str(source), 'recoverySha256': reference(source)['sha256'],
                    'predecessorEvidence': str(evidence), 'predecessorEvidenceSha256': reference(evidence)['sha256']}
        allocation = Allocation(self.root, self.root / 'six'); allocation.create_continuation(contract)
        binding = publish_selection(allocation, enabled=enabled)
        return allocation, contract, binding, source, model, optimizer

    def test_read_only_recovery_then_exclusive_admission_preserves_charge(self):
        allocation, contract, binding, *_ = self.fixture()
        before = allocation.accounting()[1]
        interval, _, _ = allocation.begin('training')
        args = SimpleNamespace(run_dir=allocation.directory)
        with patch('righelt_training.stage.invoke_supervisor') as invoke:
            self.assertEqual(stage.prepare_exploration(args, contract, invoke), binding)
            self.assertEqual(adoption.report(allocation.directory, binding)['trainingRecipe'], recipe_binding())
            invoke.assert_not_called()
        self.assertEqual(allocation.accounting()[2][0]['id'], interval['id'])
        with self.assertRaisesRegex(ValueError, 'not settled'): adoption.admission(allocation.directory, contract)
        with patch('righelt_training.allocation.alive', return_value=True):
            with self.assertRaisesRegex(ValueError, 'still alive'): allocation.recover_abandoned(lambda _: None)
        cleaned = []
        with patch('righelt_training.allocation.alive', return_value=False): allocation.recover_abandoned(cleaned.append)
        self.assertEqual(cleaned, [allocation.directory]); self.assertGreaterEqual(allocation.accounting()[1], before)
        receipt = adoption.admission(allocation.directory, contract)
        self.assertEqual(receipt[adoption.FIELD], binding)
        self.assertEqual(adoption.admission(allocation.directory, contract), receipt)
        interval, _, _ = allocation.begin('exploration-screen')
        with self.assertRaisesRegex(ValueError, 'not settled'): adoption.validate(binding, mode='provenance')
        allocation.finish(interval['id'], reason='fixture')

    def test_original_checkpoint_exact_exception_and_new_recovery_bindings(self):
        allocation, contract, binding, source, model, optimizer = self.fixture(enabled=True)
        recipe = adoption.read_binding(binding)['trainingRecipe']
        self.assertEqual(recipe, recipe_binding('root-dirichlet-v1'))
        original = source.read_bytes()
        expected = inspect_checkpoint(source, manifest_sha256='old', require_recovery=True)
        restored = torch.nn.Linear(2, 1); restored_optimizer = torch.optim.AdamW(restored.parameters())
        validate = lambda p: lambda data: adoption.checkpoint_recipe(p, data, recipe=recipe, binding=binding, continuation=contract)
        data = load_checkpoint(source, restored, restored_optimizer, manifest_sha256='old', require_recovery=True,
                               validate_state=validate(source))
        self.assertEqual(source.read_bytes(), original); self.assertEqual(data['recovery']['state']['nextJob'], 19)
        self.assertEqual(random.getstate(), expected['pythonRng']); self.assertTrue(torch.equal(torch.get_rng_state(), expected['torchRng']))
        for name, value in model.state_dict().items(): self.assertTrue(torch.equal(restored.state_dict()[name], value))
        for key, entry in optimizer.state_dict()['state'].items():
            for name, value in entry.items(): self.assertTrue(torch.equal(restored_optimizer.state_dict()['state'][key][name], value))
        with self.assertRaisesRegex(ValueError, 'recovery changed'):
            adoption.checkpoint_recipe(self.root / 'copied.pt', data, recipe=recipe, binding=binding, continuation=contract)
        new = allocation.directory / 'checkpoints' / 'new.pt'; state = {'archives': [], 'updates': 1, 'round': 3}
        save_checkpoint(new, model, optimizer, round_index=3, updates=1, replay_ids=[], manifest_sha256='new',
                        recovery_state=state, training_recipe=recipe, exploration_adoption=binding)
        loaded = load_checkpoint(new, restored, restored_optimizer, manifest_sha256='new', require_recovery=True,
                                 validate_state=validate(new))
        self.assertEqual(loaded[adoption.FIELD], binding)
        before = copy.deepcopy(restored.state_dict()); rng = torch.get_rng_state()
        with self.assertRaisesRegex(ValueError, 'recipe differs'):
            load_checkpoint(new, restored, restored_optimizer, manifest_sha256='new', require_recovery=True,
                validate_state=lambda d: adoption.checkpoint_recipe(new,d,recipe=recipe_binding(),binding=None))
        self.assertTrue(torch.equal(torch.get_rng_state(), rng))
        for name in before: self.assertTrue(torch.equal(restored.state_dict()[name], before[name]))
        meta = json.loads(new.with_suffix('.json').read_text()); meta.pop(adoption.FIELD)
        new.with_suffix('.json').write_text(json.dumps(meta))
        with self.assertRaisesRegex(ValueError, 'adoption metadata'): inspect_checkpoint(new, manifest_sha256='new')

    def test_manifest_amendment_preserves_one_choice_and_original(self):
        allocation, contract, binding, *_ = self.fixture()
        manifest = {'sourceRevision': 'old', 'configSha256': 'fixture', 'seed': 107, 'stage': 'initial',
                    'seconds': 21600, 'continuation': contract, 'trainingRecipe': recipe_binding(), adoption.FIELD: binding}
        write_manifest(allocation.directory / 'manifest.json', manifest)
        original = (allocation.directory / 'manifest.json').read_bytes()
        repair = dict(cause='fixture', regressionEvidence='fixture', reviewEvidence='fixture', artifactDisposition='compatible')
        amended = amend_manifest(allocation.directory, {**manifest, 'sourceRevision': 'new'}, repair)
        self.assertEqual(adoption.manifest_binding(allocation.directory, amended['manifest']), binding)
        self.assertEqual((allocation.directory / 'manifest.json').read_bytes(), original)
        for field, value in [('trainingRecipe', recipe_binding('root-dirichlet-v1')), (adoption.FIELD, None)]:
            with self.assertRaisesRegex(ValueError, 'recipe'): amend_manifest(allocation.directory, {**amended['manifest'], field: value}, repair)
        with self.assertRaisesRegex(ValueError, 'manifest differs'):
            adoption.manifest_binding(allocation.directory, {**manifest, adoption.FIELD: None})
        with self.assertRaisesRegex(ValueError, 'non-baseline'):
            adoption.manifest_binding(allocation.directory, {'trainingRecipe': recipe_binding('root-dirichlet-v1')})

    def test_receipt_mutation_blocks_admission_and_no_new_selection(self):
        allocation, contract, binding, *_ = self.fixture()
        path = Path(adoption.read_binding(binding)['receipt']['path']); original = path.read_bytes()
        path.write_text('{}')
        with self.assertRaises(ValueError): adoption.admission(allocation.directory, contract)
        path.write_bytes(original)
        self.assertEqual(adoption.for_allocation(allocation.directory, contract), binding)
        with self.assertRaises(ValueError): adoption.validate(binding, mode='anything')

    def test_deferred_jobs_keep_identity_but_reject_bound_recipe_changes(self):
        allocation, contract, binding, *_ = self.fixture(enabled=True)
        recipe = adoption.read_binding(binding)['trainingRecipe']
        job = {'command': 'generate', 'partition': 'train', 'id': 'reserved-19', 'seed': 91, 'kind': 'continuation', 'modelVersion': 'frozen'}
        authorized = adoption.authorize_job(job, recipe, binding)
        self.assertTrue(job.items() <= authorized.items()); self.assertNotIn('trainingRecipe', job)
        self.assertEqual(adoption.authorize_job(authorized, recipe, binding), authorized)
        for field, value in [('trainingRecipe', recipe_binding()), (adoption.FIELD, None), ('command', 'arena')]:
            with self.assertRaises(ValueError): adoption.authorize_job({**authorized, field: value}, recipe, binding)
        decision = {'trainingRecipe': recipe, adoption.FIELD: binding, 'rootExploration': {'recipe': recipe, 'applied': True}}
        game = {'partition': 'train', 'kind': 'normal', 'trainingRecipe': recipe, adoption.FIELD: binding, 'decisions': [decision]}
        adoption.validate_game(game, recipe, binding)
        for modified in [{**game, 'kind': 'exploration-screen'}, {**game, adoption.FIELD: None},
                         {**game, 'decisions': [{**decision, adoption.FIELD: None}]},
                         {**game, 'decisions': [{'trainingRecipe': recipe, adoption.FIELD: binding}]}]:
            with self.assertRaises(ValueError): adoption.validate_game(modified, recipe, binding)

    def test_invalid_screen_gate_never_dispatches_model_work(self):
        allocation, contract, binding, *_ = self.fixture()
        # Use a separate, not-yet-screened fixture allocation to exercise launch.
        other = Allocation(self.root, self.root / 'unselected')
        from righelt_training.allocation import append
        append(other.path, {**allocation.accounting()[0], 'allocation': other.key, 'id': 'another'})
        gate = self.root / 'gate.json'; immutable(gate, {'sourceRevision': 'stale'})
        args = SimpleNamespace(run_dir=other.directory, gate_report=gate)
        with patch('righelt_training.bootstrap.source_identity', return_value={'sourceRevision': 'current'}), patch.object(stage, 'invoke_supervisor') as invoke:
            with self.assertRaisesRegex(ValueError, 'gate report'): stage.prepare_exploration(args, contract, invoke)
            invoke.assert_not_called()
            self.assertFalse((other.directory / 'exploration-screen').exists())

    def test_source_repair_before_first_manifest_requires_reviewed_compatible_bridge(self):
        _, _, binding, *_ = self.fixture()
        manifest = {adoption.FIELD: binding, 'sourceRevision': 'b' * 40}
        with self.assertRaisesRegex(ValueError, 'source amendment'): adoption.first_manifest_source(manifest, {})
        repair = {'sourceRevision': 'b' * 40, 'screenSelectionCompatible': True,
                  'cause': 'fixture repair', 'artifactDisposition': 'compatible',
                  'regressionEvidence': [reference(__file__)], 'reviewEvidence': [reference(__file__)]}
        adoption.first_manifest_source(manifest, repair)
        self.assertEqual(manifest['explorationSourceAmendment']['oldSourceRevision'], 'a' * 40)
        self.assertEqual(manifest['explorationSourceAmendment']['newSourceRevision'], 'b' * 40)

    def test_stage_recovers_orphan_interval_and_reuses_completed_health_without_a_second_screen(self):
        allocation, contract, binding, checkpoint, *_ = self.fixture(enabled=True)
        recipe = adoption.read_binding(binding)['trainingRecipe']; directory = allocation.directory
        contract_path = self.root / 'contract.json'; immutable(contract_path, contract)
        gate = self.root / 'gate.json'; immutable(gate, {'sourceRevision': 'fixture'})
        args = SimpleNamespace(run_dir=directory, continuation=contract_path, gate_report=gate,
                               activity_file=self.root/'activity', parity_corpus=self.root/'corpus',
                               stage='initial', seed=107, resume=checkpoint)
        allocation.begin('training'); calls=[]
        def invoke(argv):
            calls.append(argv)
            self.assertNotIn('righelt_training.exploration_screen', argv)
            with patch('righelt_training.allocation.alive', return_value=False): allocation.recover_abandoned(lambda _: None)
            self.assertEqual(adoption.admission(directory, contract)[adoption.FIELD], binding)
            interval, _, _ = allocation.begin('training')
            # Supervisor protocol double writes proof fixtures, never launches a model.
            from righelt_training.checkpoint import atomic_json
            atomic_json(directory/'supervisor-result.json', {'reason':'completed'})
            atomic_json(directory/'runner-result.json', {'reason':'validation-handoff'})
            atomic_json(directory/'latest.json', {'checkpoint':str(checkpoint), 'sha256':reference(checkpoint)['sha256']})
            atomic_json(directory/'trained-export-parity.json', {'complete':True,'numericPassed':True})
            atomic_json(directory/'health-report.json', {'complete':True,'healthy':True,'freshHealthRequired':True,
                'trainingRecipe':recipe, adoption.FIELD:binding,'checkpoints':[{'path':str(checkpoint),'weightsSha256':'new'}]})
            atomic_json(directory/'prepare-arena-result.json', {'status':'completed','plan':'fixture','planSha256':'frozen'})
            atomic_json(directory/'evaluations'/'frozen'/'report.json', {'mode':'strict','status':'inconclusive','reason':'budget'})
            allocation.finish(interval['id'], reason='completed')
        result=stage.execute(args, invoke)
        self.assertTrue(result['advancementEligible'],result)
        self.assertEqual(result[adoption.FIELD],binding); self.assertEqual(result['trainingRecipe'],recipe)
        self.assertEqual(len(calls),5)
        charged=allocation.accounting()[1]; calls.clear()
        self.assertEqual(stage.execute(args, invoke),result)
        self.assertEqual(calls,[]); self.assertEqual(allocation.accounting()[1],charged)

    def test_module_entrypoints_import_independently(self):
        for module in ('development_probe', 'bootstrap', 'supervisor', 'exploration_adoption', 'runner', 'health', 'stage'):
            result = subprocess.run([sys.executable, '-c', 'import righelt_training.' + module], capture_output=True, text=True, timeout=10)
            self.assertEqual(result.returncode, 0, result.stderr)


if __name__ == '__main__': unittest.main()
