import copy
import time
import unittest
import torch
from righelt_training.model import create_model
from righelt_training.architecture import architecture_binding
from righelt_training.trainer import train_round,make_optimizer
from righelt_training.sequence_targets import TARGET_COUNT
from righelt_training.pilot_recipe import teaching_job,DEFINITION,DEFINITION_SHA256

class AttentionMethodRuntimeTest(unittest.TestCase):
    def test_existing_auxiliary_objective_trains_only_when_observed_mask_exists(self):
        torch.set_num_threads(1);torch.manual_seed(18)
        row={'id':'synthetic-only','encoded':[0.]*(46*100),'legal':[0], 'policy':[],'policyMask':False,'terminalValue':0.,'terminalMask':False,
             'futureFacts':{'values':[1.]*TARGET_COUNT,'mask':[True]+[False]*(TARGET_COUNT-1)}}
        model=create_model(architecture_binding('board-attention-48x2-v1'));optimizer=make_optimizer(model)
        before=model.future_facts.weight.detach().clone()
        result=train_round(model,optimizer,[row],device='cpu',seed=7,deadline=time.monotonic()+120)
        self.assertEqual(result['updates'],1)
        self.assertEqual(result['batches'][0]['policyPositions'],0)
        self.assertEqual(result['batches'][0]['valuePositions'],0)
        self.assertEqual(result['batches'][0]['futureFactLabels'],1)
        self.assertGreater(result['batches'][0]['headGradientL1']['futureFacts'],0)
        self.assertFalse(torch.equal(before,model.future_facts.weight))
        row['futureFacts']['mask']=[False]*TARGET_COUNT
        before=copy.deepcopy(model.state_dict())
        result=train_round(model,optimizer,[row],device='cpu',seed=7,deadline=time.monotonic()+120)
        self.assertEqual(result['updates'],0)
        for key,value in before.items():self.assertTrue(torch.equal(value,model.state_dict()[key]))
    def test_actual_local_teacher_curriculum_roles_and_profiles(self):
        recipe={'schema':1,'kind':DEFINITION['kind'],'pretrainRounds':16,'definitionSha256':DEFINITION_SHA256,'curriculum':DEFINITION['curriculum'],
                'teacher':{'path':'/original/teacher.pt','sha256':'a'*64,'manifestSha256':'b'*64}}
        jobs=[teaching_job(recipe,i,'c'*64) for i in range(4)]
        self.assertEqual([j['roles'] for j in jobs],[{'P1':'current','P2':'current'},{'P1':'teacher','P2':'current'},{'P1':'current','P2':'teacher'},{'P1':'teacher','P2':'teacher'}])
        self.assertEqual([j['profiles']['P1']['simulations'] for j in jobs],[8,32,32,32])
        self.assertEqual(DEFINITION['learningRates']['continuation'],.0001)

if __name__=='__main__':unittest.main()
