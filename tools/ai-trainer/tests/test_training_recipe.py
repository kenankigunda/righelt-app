import copy
import functools
import hashlib
import json
from pathlib import Path
import random
import tempfile
import unittest
from unittest.mock import patch
import torch
from righelt_training.checkpoint import save_checkpoint, inspect_checkpoint, load_checkpoint
from righelt_training.config import CONFIG_SHA256
from righelt_training.manifest import write_manifest, active_manifest, amend_manifest, PROOF_PATHS
from righelt_training.replay import ReplayBuffer, partition_for_family
from righelt_training.training_recipe import recipe_binding, validate_recipe, record_recipe, CATALOG


class TrainingRecipeTest(unittest.TestCase):
    def setUp(self):
        # Torch's lazy optimizer import inspects this function's __wrapped__.
        @functools.wraps(torch.backends.mps.is_available)
        def no_mps():
            return False
        self.enterContext(patch('torch.backends.mps.is_available', new=no_mps))
        self.python_rng = random.getstate()
        self.torch_rng = torch.get_rng_state()
        self.addCleanup(random.setstate, self.python_rng)
        self.addCleanup(torch.set_rng_state, self.torch_rng)

    def test_identity_is_separate_and_legacy_absence_is_explicit_baseline(self):
        self.assertEqual(CONFIG_SHA256, 'f433dd71f410c451fd6523946b224df710919be5008abe507cbc80aca97a374d')
        self.assertEqual(record_recipe({}), recipe_binding())
        self.assertIn('packages/computer-player/config/training-recipes-v1.json', PROOF_PATHS)
        for recipe in CATALOG['recipes']:
            self.assertEqual(validate_recipe(recipe_binding(recipe['id']))['sha256'], recipe['sha256'])
        for bad in [None, {}, {'id': None, 'sha256': recipe_binding()['sha256']},
                    {'id': 'unknown', 'sha256': 'x'}, {**recipe_binding(), 'sha256': '0' * 64},
                    {**recipe_binding(), 'extra': True}]:
            with self.assertRaises(ValueError):
                record_recipe({'trainingRecipe': bad})
        with patch.dict(CATALOG['recipes'][0]['definition'], {'rootExploration': True}):
            with self.assertRaisesRegex(ValueError, 'catalog checksum'):
                recipe_binding()

    def checkpoint(self, directory, recipe=None):
        path = Path(directory) / 'checkpoints' / 'fixture.pt'
        model = torch.nn.Linear(2, 1)
        optimizer = torch.optim.AdamW(model.parameters())
        # CPU-only fixture gives the optimizer nonempty state to verify restoration.
        model(torch.ones(1, 2)).sum().backward()
        optimizer.step()
        archive = Path(directory) / 'archive.json'
        archive.write_text('immutable replay fixture')
        state = {'archives': ['archive.json'], 'updates': 1, 'round': 1}
        save_checkpoint(path, model, optimizer, round_index=1, updates=1, replay_ids=['archive.json'],
                        manifest_sha256='fixture', recovery_state=state, training_recipe=recipe)
        return path, model, optimizer

    def rewrite_fixture(self, path, mutate):
        data = torch.load(path, map_location='cpu', weights_only=True)
        meta = json.loads(path.with_suffix('.json').read_text())
        mutate(data, meta)
        torch.save(data, path)
        digest = hashlib.sha256(path.read_bytes()).hexdigest()
        meta['sha256'] = digest
        path.with_suffix('.json').write_text(json.dumps(meta))
        sidecar = json.loads(path.with_suffix('.runner.json').read_text())
        sidecar['checkpointSha256'] = digest
        path.with_suffix('.runner.json').write_text(json.dumps(sidecar))

    def test_legacy_checkpoint_preserves_optimizer_rng_archives_and_model_compatibility(self):
        with tempfile.TemporaryDirectory() as directory:
            path, model, optimizer = self.checkpoint(directory)
            self.rewrite_fixture(path, lambda data, meta: (data.pop('trainingRecipe'), meta.pop('trainingRecipe')))
            before = path.read_bytes()
            data = inspect_checkpoint(path, manifest_sha256='fixture', require_recovery=True, training_recipe=recipe_binding())
            restored = torch.nn.Linear(2, 1)
            restored_optimizer = torch.optim.AdamW(restored.parameters())
            random.seed(42)
            torch.manual_seed(42)
            load_checkpoint(path, restored, restored_optimizer, manifest_sha256='fixture', require_recovery=True,
                            training_recipe=recipe_binding())
            self.assertEqual(path.read_bytes(), before)
            self.assertEqual(data['configSha256'], CONFIG_SHA256)
            self.assertEqual(random.getstate(), data['pythonRng'])
            self.assertTrue(torch.equal(torch.get_rng_state(), data['torchRng']))
            for key, value in model.state_dict().items():
                self.assertTrue(torch.equal(restored.state_dict()[key], value))
            for key, state in optimizer.state_dict()['state'].items():
                for name, value in state.items():
                    self.assertTrue(torch.equal(restored_optimizer.state_dict()['state'][key][name], value))
            with self.assertRaisesRegex(ValueError, 'training recipe mismatch'):
                inspect_checkpoint(path, manifest_sha256='fixture', training_recipe=recipe_binding('root-dirichlet-v1'))
            (Path(directory) / 'archive.json').write_text('altered replay')
            with self.assertRaisesRegex(ValueError, 'archive checksum'):
                inspect_checkpoint(path, manifest_sha256='fixture', require_recovery=True)

    def test_new_checkpoint_rejects_altered_unknown_or_partial_recipe_binding(self):
        for corruption in ['unknown', 'changed-hash', 'metadata-missing', 'payload-missing']:
            with self.subTest(corruption=corruption), tempfile.TemporaryDirectory() as directory:
                recipe = recipe_binding('root-dirichlet-v1')
                path, _, _ = self.checkpoint(directory, recipe)
                data = inspect_checkpoint(path, manifest_sha256='fixture', training_recipe=recipe, require_recovery=True)
                self.assertEqual(data['trainingRecipe'], recipe)
                def mutate(data, meta):
                    if corruption == 'unknown':
                        data['trainingRecipe']['id'] = 'unknown'
                        meta['trainingRecipe'] = data['trainingRecipe']
                    elif corruption == 'changed-hash':
                        data['trainingRecipe']['sha256'] = '0' * 64
                        meta['trainingRecipe'] = data['trainingRecipe']
                    else:
                        (meta if corruption == 'metadata-missing' else data).pop('trainingRecipe')
                self.rewrite_fixture(path, mutate)
                with self.assertRaisesRegex(ValueError, 'recipe'):
                    inspect_checkpoint(path, manifest_sha256='fixture', training_recipe=recipe, require_recovery=True)

    def test_recipe_source_amendment_preserves_legacy_original_and_cannot_retune(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            legacy = {'sourceRevision': 'old', 'configSha256': CONFIG_SHA256, 'seed': 107, 'stage': 'initial', 'seconds': 21600}
            write_manifest(root / 'manifest.json', legacy)
            original = (root / 'manifest.json').read_bytes()
            repair = {'cause': 'fixture repair', 'regressionEvidence': 'fixture', 'reviewEvidence': 'fixture', 'artifactDisposition': 'compatible'}
            amended = amend_manifest(root, {**legacy, 'sourceRevision': 'new', 'trainingRecipe': recipe_binding()}, repair)
            self.assertEqual(active_manifest(root), amended)
            self.assertEqual((root / 'manifest.json').read_bytes(), original)
            with self.assertRaisesRegex(ValueError, 'changes training recipe'):
                amend_manifest(root, {**amended['manifest'], 'trainingRecipe': recipe_binding('root-dirichlet-v1')}, repair)
            with self.assertRaisesRegex(ValueError, 'recipe'):
                write_manifest(root / 'invalid.json', {**legacy, 'trainingRecipe': None})

    def test_replay_preserves_recipe_and_rejects_bad_bindings_before_any_append(self):
        family = next(str(i) for i in range(100) if partition_for_family(str(i)) == 'train')
        game = {'id': 'fixture', 'partition': 'train', 'familyId': family, 'termination': 'terminal',
                'outcome': {'status': 'p1_win'}, 'decisions': [{'id': 'legacy'}, {'id': 'new', 'trainingRecipe': recipe_binding()}]}
        buffer = ReplayBuffer()
        buffer.append(game)
        self.assertEqual(buffer.positions[1]['trainingRecipe'], recipe_binding())
        for bad in [None, {'id': 'unknown', 'sha256': '0' * 64}, recipe_binding('root-dirichlet-v1')]:
            changed = copy.deepcopy(game)
            changed['decisions'][1]['trainingRecipe'] = bad
            candidate = ReplayBuffer()
            with self.assertRaises(ValueError):
                candidate.append(changed)
            self.assertEqual(len(candidate.positions), 0)


if __name__ == '__main__':
    unittest.main()
