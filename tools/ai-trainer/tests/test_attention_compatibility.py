"""Disposable random-model smoke checks. Never candidate or strength evidence."""
import tempfile
from pathlib import Path
import unittest

import numpy as np
import onnx
import onnxruntime as ort
import torch

from righelt_training.architecture import architecture_binding
from righelt_training.checkpoint import load_checkpoint, save_checkpoint
from righelt_training.export import export_onnx, numeric_parity
from righelt_training.model import create_model, model_from_record


class AttentionCompatibilityTest(unittest.TestCase):
    def setUp(self):
        torch.set_num_threads(1)
        torch.manual_seed(17)

    def test_disposable_attention_checkpoint_and_wrong_architecture_rejection(self):
        for width in (48, 64):
            with self.subTest(width=width), tempfile.TemporaryDirectory() as directory:
                binding = architecture_binding(f'board-attention-{width}x2-v1')
                model = create_model(binding)
                optimizer = torch.optim.AdamW(model.parameters())
                policy, value = model(torch.randn(2, 46, 10, 10))
                self.assertEqual(tuple(policy.shape), (2, 2801))
                self.assertEqual(tuple(value.shape), (2,))
                self.assertTrue(torch.isfinite(policy).all() and torch.isfinite(value).all())
                # One synthetic step populates optimizer state for recovery.
                (policy.square().mean() + value.square().mean()).backward()
                optimizer.step()
                path = Path(directory) / 'disposable.pt'
                save_checkpoint(path, model, optimizer, round_index=1, updates=1,
                                replay_ids=[], manifest_sha256='synthetic-smoke-only')
                restored = model_from_record({'modelArchitecture': binding})
                restored_optimizer = torch.optim.AdamW(restored.parameters())
                load_checkpoint(path, restored, restored_optimizer,
                                manifest_sha256='synthetic-smoke-only')
                for name, parameter in model.state_dict().items():
                    self.assertTrue(torch.equal(parameter, restored.state_dict()[name]), name)
                self.assertEqual(len(optimizer.state), len(restored_optimizer.state))
                for wrong in (create_model(), create_model(architecture_binding(
                        f'board-attention-{64 if width == 48 else 48}x2-v1'))):
                    with self.assertRaisesRegex(ValueError, 'architecture'):
                        load_checkpoint(path, wrong, manifest_sha256='synthetic-smoke-only')

    def test_disposable_attention_export_dynamic_batches_and_public_outputs(self):
        for width in (48, 64):
            with self.subTest(width=width), tempfile.TemporaryDirectory() as directory:
                binding = architecture_binding(f'board-attention-{width}x2-v1')
                model = create_model(binding)
                path = Path(directory) / 'disposable.onnx'
                report = export_onnx(model, path)
                self.assertEqual(report['modelArchitecture'], binding)
                graph = onnx.load(path).graph
                self.assertEqual([output.name for output in graph.output], ['policy', 'value'])
                self.assertFalse(any('future_facts' in weight.name for weight in graph.initializer))
                options = ort.SessionOptions()
                options.intra_op_num_threads = options.inter_op_num_threads = 1
                session = ort.InferenceSession(str(path), sess_options=options,
                                               providers=['CPUExecutionProvider'])
                self.assertEqual([item.name for item in session.get_inputs()], ['state'])
                for batch in (1, 2, 8):
                    states = np.random.default_rng(batch).normal(size=(batch, 46, 10, 10)).astype(np.float32)
                    policy, value = session.run(None, {'state': states})
                    self.assertEqual(policy.shape, (batch, 2801))
                    self.assertEqual(value.shape, (batch,))
                    result = numeric_parity(model, path, states, reference_device='cpu')
                    self.assertTrue(result['numericPassed'])
                    self.assertFalse(result['acceptancePassed'])


if __name__ == '__main__':
    unittest.main()
