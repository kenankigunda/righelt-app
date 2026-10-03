import tempfile
from pathlib import Path
import unittest
import torch
from righelt_training.model import PolicyValueNet,training_loss
from righelt_training.checkpoint import save_checkpoint,load_checkpoint

class ModelTest(unittest.TestCase):
    def setUp(self):torch.manual_seed(12);torch.set_num_threads(1)
    def test_shapes_finite_update_and_truncated_value_mask(self):
        m=PolicyValueNet();x=torch.randn(2,46,10,10)
        p,v=m(x)
        self.assertEqual(tuple(p.shape),(2,2801));self.assertEqual(tuple(v.shape),(2,))
        self.assertEqual(sum(t.numel() for t in m.parameters()),101216)
        legal=torch.zeros_like(p,dtype=torch.bool);legal[:,[1,2800]]=True
        target=legal.float()/2
        loss,_,value=training_loss(p,v,legal,target,torch.tensor([float('nan'),float('nan')]),torch.tensor([False,False]))
        self.assertEqual(value.item(),0)
        loss.backward()
        self.assertTrue(torch.isfinite(m.stem.weight.grad).all())
        self.assertGreater(m.stem.weight.grad.abs().sum().item(),0)
        with self.assertRaises(ValueError):training_loss(p,v,legal,torch.ones_like(p),v,torch.tensor([True,True]))

    def test_checkpoint_restart_and_corruption(self):
        m=PolicyValueNet();o=torch.optim.AdamW(m.parameters())
        with tempfile.TemporaryDirectory() as d:
            p=Path(d)/'checkpoint.pt';save_checkpoint(p,m,o,round_index=1,updates=2,replay_ids=['a'],manifest_sha256='test')
            other=PolicyValueNet();load_checkpoint(p,other,manifest_sha256='test')
            for a,b in zip(m.parameters(),other.parameters()):self.assertTrue(torch.equal(a,b))
            with self.assertRaises(ValueError):load_checkpoint(p,other,manifest_sha256='other')
            p.write_bytes(p.read_bytes()+b'bad')
            with self.assertRaises(ValueError):load_checkpoint(p,other,manifest_sha256='test')

if __name__=='__main__':unittest.main()
