import copy
import time
import unittest
import torch
from righelt_training.model import PolicyValueNet, training_loss
from righelt_training.trainer import train_round, make_optimizer, tensor_batch
from righelt_training.replay import ReplayBuffer, partition_for_family


class FallbackTrainingTest(unittest.TestCase):
    def setUp(self):
        torch.set_num_threads(1)

    def position(self, terminal=True):
        return {'id':'fallback','encoded':[0.]*4600,'legal':[0,2800], 'policy':[],
                'policyMask':False,'terminalMask':terminal,'terminalValue':1.}

    def test_terminal_fallback_trains_value_without_policy_target(self):
        model=PolicyValueNet();result=train_round(model,make_optimizer(model),[self.position()],
            device='cpu',seed=107,deadline=time.monotonic()+60)
        self.assertEqual(result['updates'],1)
        self.assertEqual(result['batches'][0]['policyLoss'],0.)
        self.assertEqual(result['batches'][0]['policyPositions'],0)
        self.assertEqual(result['batches'][0]['valuePositions'],1)
        self.assertGreater(result['batches'][0]['parameterDelta'],0.)

    def test_truncated_fallback_only_batch_does_not_update_or_apply_weight_decay(self):
        model=PolicyValueNet();optimizer=make_optimizer(model);before=copy.deepcopy(model.state_dict())
        result=train_round(model,optimizer,[self.position(False)],device='cpu',seed=107,deadline=time.monotonic()+60)
        self.assertEqual(result['updates'],0);self.assertEqual(result['skippedUnsupervisedBatches'],1)
        self.assertFalse(optimizer.state)
        self.assertTrue(all(torch.equal(before[k],v) for k,v in model.state_dict().items()))

    def test_masked_rows_do_not_dilute_policy_loss_or_supply_policy_gradients(self):
        logits=torch.tensor([[2.,0.],[0.,2.]],requires_grad=True)
        values=torch.tensor([0.,0.],requires_grad=True)
        args=(logits,values,torch.ones(2,2,dtype=torch.bool),torch.tensor([[1.,0.],[0.,0.]]),
              torch.tensor([0.,1.]),torch.tensor([False,True]),torch.tensor([True,False]))
        loss,policy,value=training_loss(*args)
        self.assertAlmostEqual(policy.item(),torch.nn.functional.cross_entropy(logits[:1],torch.tensor([0])).item())
        self.assertEqual(value.item(),1.);loss.backward()
        self.assertTrue(torch.equal(logits.grad[1],torch.zeros(2)))
        self.assertNotEqual(values.grad[1].item(),0.)

    def test_empty_legacy_target_and_fabricated_fallback_policy_are_rejected(self):
        bad=self.position(False);bad['legal']=[]
        with self.assertRaises(ValueError):tensor_batch([bad],'cpu')
        p=self.position();p.pop('policyMask');batch=tensor_batch([p],'cpu')
        inputs,legal,targets,values,terminal,policy=batch
        with self.assertRaises(ValueError):training_loss(torch.zeros(1,2801),torch.zeros(1),legal,targets,values,terminal,policy)
        p=self.position();p['policy']=[{'index':0,'probability':1.}]
        with self.assertRaises(ValueError):tensor_batch([p],'cpu')

    def test_replay_preserves_fallback_masks_and_legacy_targets(self):
        family=next(f'family:{n}' for n in range(100) if partition_for_family(f'family:{n}')=='train')
        d={'id':'d','legal':[0],'policy':[],'policyMask':False,
           'fallback':{'schemaVersion':1,'reason':'safety-incomplete'}}
        game={'id':'g','partition':'train','familyId':family,'termination':'terminal','outcome':{'status':'p1_win'},'decisions':[d]}
        buffer=ReplayBuffer();buffer.append(game);self.assertFalse(buffer.positions[0]['policyMask'])
        self.assertTrue(buffer.positions[0]['terminalMask']);self.assertEqual(buffer.positions[0]['terminalValue'],1.)
        legacy=copy.deepcopy(game);legacy['id']='old';legacy['decisions']=[{'id':'old:d','legal':[0],'policy':[{'index':0,'probability':1.}]}]
        buffer.append(legacy);self.assertNotIn('policyMask',buffer.positions[1])
        invalid=copy.deepcopy(game);invalid['id']='bad';invalid['decisions'][0]['policyMask']=True
        with self.assertRaises(ValueError):buffer.append(invalid)

if __name__=='__main__':unittest.main()
