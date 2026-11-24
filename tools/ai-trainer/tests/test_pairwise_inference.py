"""Candidate-only FP32 reductions retain the trained mathematical model."""
import math
import unittest
import torch
from righelt_training.board_attention import BoardAttentionNet,PairwiseLayerNorm,pairwise_mean,PAIRWISE_INFERENCE
from righelt_training.architecture import architecture_binding
from righelt_training.checkpoint import weights_sha256


class PairwiseInferenceTest(unittest.TestCase):
    def setUp(self):torch.set_num_threads(1);torch.manual_seed(37)
    def test_normalization_uses_population_variance_epsilon_and_affine_terms(self):
        layer=PairwiseLayerNorm(4,eps=1e-5)
        with torch.no_grad():layer.weight.copy_(torch.tensor([1.,2.,3.,4.]));layer.bias.copy_(torch.tensor([.5,.25,0.,-.5]))
        values=layer(torch.tensor([[1.,2.,3.,4.]]))
        expected=[(v-2.5)/math.sqrt(1.25+1e-5)*w+b for v,w,b in zip([1.,2.,3.,4.],[1.,2.,3.,4.],[.5,.25,0.,-.5])]
        torch.testing.assert_close(values,torch.tensor([expected]),atol=1e-6,rtol=1e-6)
    def test_pooling_keeps_odd_terms_and_all_one_hundred_tokens(self):
        torch.testing.assert_close(pairwise_mean(torch.tensor([[1.,3.,8.]]),1),torch.tensor([4.]))
        x=torch.arange(100,dtype=torch.float32).reshape(1,100,1)
        torch.testing.assert_close(pairwise_mean(x,1),torch.tensor([[49.5]]))
        self.assertEqual(pairwise_mean(torch.tensor([[1e8,1.,-1e8,1.]]),1).item(),0.)
    def test_inference_copy_preserves_weights_architecture_and_native_model(self):
        model=BoardAttentionNet(architecture_binding('board-attention-48x2-v1'))
        before=weights_sha256(model.state_dict());x=torch.randn(2,46,10,10)
        with torch.no_grad():native=model(x)
        fixed=model.for_inference(PAIRWISE_INFERENCE)
        self.assertEqual(weights_sha256(fixed.state_dict()),before)
        self.assertEqual(fixed.model_architecture,model.model_architecture)
        self.assertTrue(model.training);self.assertFalse(fixed.training)
        self.assertTrue(all(p.requires_grad for p in model.parameters()))
        self.assertTrue(all(not p.requires_grad for p in fixed.parameters()))
        with torch.no_grad():
            unchanged=model(x);actual=fixed(x)
        for a,b,c in zip(native,unchanged,actual):
            self.assertTrue(torch.equal(a,b))
            torch.testing.assert_close(c,a,atol=1e-5,rtol=1e-4)
        self.assertEqual(actual[0].shape,(2,2801));self.assertEqual(actual[1].shape,(2,))
        self.assertTrue(all(torch.isfinite(y).all() for y in actual))
        model.load_state_dict(fixed.state_dict(),strict=True)
        with self.assertRaises(ValueError):model.for_inference('unpublished')
