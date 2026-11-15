import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import urllib.error
import torch
import hashlib

from righelt_training.device import selected_device, memory_bytes
from righelt_training.checkpoint import save_checkpoint, load_checkpoint
from righelt_training.model import PolicyValueNet
from righelt_training.trainer import make_optimizer
from righelt_training import hosted_receipts
from righelt_training.hosted_snapshot import snapshot
from righelt_training.training_recipe import recipe_binding


class HostedBackendTest(unittest.TestCase):
    def test_controller_contract_errors_and_infrastructure_errors_remain_distinct(self):
        env = {'COMPUTE_URL': 'https://compute.example', 'COMPUTE_ID': 'pilot', 'COMPUTE_GENERATION': '1', 'COMPUTE_WORKER_TOKEN': 'test'}
        with patch.dict(os.environ, env):
            for code, expected in [(409, ValueError), (429, hosted_receipts.HostedInfrastructureError), (503, hosted_receipts.HostedInfrastructureError)]:
                with self.subTest(code=code), patch('urllib.request.urlopen', side_effect=urllib.error.HTTPError('https://compute.example', code, 'failed', {}, None)):
                    with self.assertRaises(expected): hosted_receipts.request('claim', {'key': 'a'*64})

    def test_hosted_recipe_must_match_the_frozen_input_even_when_another_recipe_is_valid(self):
        with tempfile.TemporaryDirectory() as d:
            recipe = recipe_binding(); raw = json.dumps(recipe).encode(); path = Path(d)/'recipe.json'; path.write_bytes(raw)
            from righelt_training.execution_recipe import settings
            execution = Path(d)/'execution.json'
            execution.write_text(json.dumps({'schema':1,'kind':'execution-recipe','settings':settings('ordinary-continuation')}))
            with patch.dict(os.environ, {'RIGHELT_HOSTED': '1', 'RIGHELT_EXPECTED_RECIPE_PATH': str(path), 'RIGHELT_EXPECTED_RECIPE_SHA256': hashlib.sha256(raw).hexdigest(), 'RIGHELT_EXECUTION_RECIPE_PATH':str(execution),'RIGHELT_EXECUTION_RECIPE_SHA256':hashlib.sha256(execution.read_bytes()).hexdigest()}):
                hosted_receipts.verify_recipe(recipe)
                with self.assertRaisesRegex(ValueError, 'differs from approved'):
                    hosted_receipts.verify_recipe(recipe_binding('root-dirichlet-v1'))
                path.write_text('{}')
                with self.assertRaisesRegex(ValueError, 'differs from approved'):
                    hosted_receipts.verify_recipe(recipe)

    def test_cpu_is_explicit_and_unavailable_gpu_never_silently_falls_back(self):
        with patch.dict(os.environ, {'RIGHELT_TRAINING_DEVICE': 'cpu'}):
            self.assertEqual(selected_device().type, 'cpu')
            self.assertEqual(memory_bytes(), 0)
        with patch('torch.cuda.is_available', return_value=False):
            with self.assertRaisesRegex(RuntimeError, 'CUDA unavailable'):
                selected_device('cuda')
        with self.assertRaises(ValueError): selected_device('auto')

    def test_cuda_checkpoint_preserves_all_device_random_states(self):
        states = [torch.tensor([1, 2], dtype=torch.uint8)]
        with tempfile.TemporaryDirectory() as d:
            path = Path(d) / 'checkpoint.pt'; model = PolicyValueNet(); optimizer = make_optimizer(model)
            with patch('torch.backends.mps.is_available', return_value=False), patch('torch.cuda.is_available', return_value=True), patch('torch.cuda.get_rng_state_all', return_value=states):
                save_checkpoint(path, model, optimizer, round_index=1, updates=1, replay_ids=[], manifest_sha256='a'*64)
            with patch('torch.backends.mps.is_available', return_value=False), patch('torch.cuda.is_available', return_value=True), patch('torch.cuda.device_count', return_value=1), patch('torch.cuda.set_rng_state_all') as restore:
                load_checkpoint(path, model, optimizer, manifest_sha256='a'*64)
                self.assertTrue(torch.equal(restore.call_args.args[0][0], states[0]))

    def test_remote_claims_and_counters_are_opt_in_and_uncertainty_propagates(self):
        with patch.dict(os.environ, {'RIGHELT_HOSTED': '0'}), patch.object(hosted_receipts, 'request') as request:
            self.assertTrue(hosted_receipts.claim('game', 'one'))
            self.assertEqual(hosted_receipts.counter('checkpoint', 12), 12)
            request.assert_not_called()
        with patch.dict(os.environ, {'RIGHELT_HOSTED': '1'}), patch.object(hosted_receipts, 'request', return_value={'created': False}) as request:
            self.assertFalse(hosted_receipts.claim('game', 'one'))
            self.assertEqual(len(request.call_args.args[1]['key']), 64)
        with patch.dict(os.environ, {'RIGHELT_HOSTED': '1'}), patch.object(hosted_receipts, 'request', side_effect=RuntimeError('unavailable')):
            with self.assertRaises(RuntimeError): hosted_receipts.claim('game', 'one')

    def test_snapshot_rejects_symlinks_and_preserves_recovery_file_bytes(self):
        import shutil
        with tempfile.TemporaryDirectory() as d:
            root = Path(d); run = root / '.ai-runs/pilot'; run.mkdir(parents=True)
            (run / 'checkpoint.pt').write_bytes(b'trained-state')
            (run / 'latest.json').write_text(json.dumps({'checkpoint': str(run/'checkpoint.pt')}))
            copied = Path(snapshot(root, '.ai-runs/pilot'))
            try: self.assertEqual((copied/'.ai-runs/pilot/checkpoint.pt').read_bytes(), b'trained-state')
            finally: shutil.rmtree(copied)
            (run / 'escape').symlink_to(root)
            with self.assertRaisesRegex(ValueError, 'symlink'): snapshot(root, '.ai-runs/pilot')


if __name__ == '__main__': unittest.main()
