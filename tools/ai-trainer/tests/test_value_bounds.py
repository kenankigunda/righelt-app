import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import numpy as np
import onnx
from onnx import numpy_helper
import onnxruntime as ort
import torch

from righelt_training.export import export_onnx
from righelt_training.model import PolicyValueNet


class ValueBoundsTest(unittest.TestCase):
    def setUp(self):
        torch.manual_seed(12)
        torch.set_num_threads(1)
        self.model = PolicyValueNet().eval()
        self.input = torch.zeros(1, 46, 10, 10)

    def test_fp32_endpoint_roundoff_is_bounded_but_nan_is_preserved(self):
        # Reproduce the observed WASM tanh overshoot without requiring a
        # particular runtime kernel or trained checkpoint in unit tests.
        for endpoint in (-1., 1.):
            rounded = torch.nextafter(torch.tensor(endpoint), torch.tensor(endpoint * float('inf')))
            with patch('righelt_training.model.torch.tanh', return_value=rounded.reshape(1, 1)):
                _, value = self.model(self.input)
            self.assertEqual(value.item(), endpoint)
        with patch('righelt_training.model.torch.tanh', return_value=torch.tensor([[float('nan')]])):
            _, value = self.model(self.input)
        self.assertTrue(torch.isnan(value).all())

    def test_real_export_preserves_range_and_checkpoint_structure(self):
        keys = tuple(self.model.state_dict())
        with torch.no_grad():
            self.model.value_out.weight.zero_()
        with tempfile.TemporaryDirectory() as directory:
            for bias in (-20., -.5, 0., .5, 20.):
                with self.subTest(bias=bias), torch.no_grad():
                    self.model.value_out.bias.fill_(bias)
                    _, expected = self.model(self.input)
                    path = Path(directory) / 'model.onnx'
                    export_onnx(self.model, path)
                    graph = onnx.load(path).graph
                    nodes = {output: node for node in graph.node for output in node.output}
                    constants = {node.output[0]: numpy_helper.to_array(node.attribute[0].t)
                                 for node in graph.node if node.op_type == 'Constant'}
                    squeeze = nodes['value']
                    self.assertEqual(squeeze.op_type, 'Squeeze')
                    clip = nodes[squeeze.input[0]]
                    self.assertEqual(clip.op_type, 'Clip')
                    self.assertEqual(nodes[clip.input[0]].op_type, 'Tanh')
                    self.assertEqual(float(constants[clip.input[1]]), -1.)
                    self.assertEqual(float(constants[clip.input[2]]), 1.)
                    options = ort.SessionOptions()
                    options.intra_op_num_threads = options.inter_op_num_threads = 1
                    session = ort.InferenceSession(str(path), sess_options=options, providers=['CPUExecutionProvider'])
                    policy, value = session.run(None, {'state': self.input.numpy()})
                    self.assertEqual(policy.shape, (1, 2801))
                    self.assertEqual(value.shape, (1,))
                    self.assertTrue(np.isfinite(policy).all() and np.isfinite(value).all())
                    self.assertTrue((np.abs(value) <= 1).all())
                    np.testing.assert_allclose(value, expected.numpy(), atol=1e-5, rtol=1e-4)
                    self.assertLessEqual(abs(expected.item()), 1.)
        self.assertEqual(tuple(self.model.state_dict()), keys)
        self.assertEqual(sum(parameter.numel() for parameter in self.model.parameters()), 101216)


if __name__ == '__main__':
    unittest.main()
