"""Executed checkpoint, local-authority and development acceptance contracts."""
import copy
from datetime import datetime,timedelta,timezone
import hashlib
import json
import os
from pathlib import Path
import random
import tempfile
import unittest
from unittest.mock import patch

from righelt_training.local_episode import validate,consume_resume,resource_stop
from righelt_training.certificate_teacher import accepted,validate_packet


class LocalAuthorityTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.root=Path(self.temp.name)
        kickoff=datetime(2026,11,24,4,20,22,tzinfo=timezone.utc)
        self.authority={'schema':1,'kind':'approved-local-24hour-program','authority':'explicit human implementation',
            'kickoff':kickoff.isoformat(),'boundaries':{k:(kickoff+timedelta(hours=h)).isoformat() for k,h in
                [('preparation',3),('broad',10),('targeted',15),('trainingStop',20),('delivery',24)]},
            'baseline':{'sha256':'a'*64},'caps':{'experimentalSeconds':21600,'repairSeconds':10800,
                'automaticResumes':2,'repairAttemptsPerFailure':2,'newRunBytes':96*1024**3,
                'freeDiskBytes':50*1024**3,'initialWorkers':2,'maximumWorkers':4},
            'authorityScope':{'cloud':False,'defaultPromotion':False}}
        self.path=self.root/'authority.json';self.path.write_text(json.dumps(self.authority))
        self.plan={'schema':3,'seed':2026112401,'localAuthority':{'path':str(self.path),
            'sha256':hashlib.sha256(self.path.read_bytes()).hexdigest()},'checkpoint':{'sha256':'a'*64},
            'trainingStopWall':kickoff.timestamp()+72000,'artifactDeadlineWall':kickoff.timestamp()+86400,
            'nativeManifest':{'executionBackend':'mps'}}
        (self.root/'plan.json').write_text(json.dumps(self.plan))
    def tearDown(self):self.temp.cleanup()
    def test_fixed_clock_and_caps_reject_extension(self):
        self.assertEqual(validate(self.plan)['caps']['automaticResumes'],2)
        for field in ('trainingStopWall','artifactDeadlineWall'):
            changed=copy.deepcopy(self.plan);changed[field]+=1
            with self.assertRaises(ValueError):validate(changed)
    def test_two_resumes_share_durable_counter_third_and_wrong_reason_do_not_append(self):
        before=self.plan['trainingStopWall']-1000
        consume_resume(self.root,'resource-pressure-stop',before)
        consume_resume(self.root,'resource-pressure-stop',before+1)
        p=self.root/'exploratory-recovery.jsonl';original=p.read_bytes()
        for reason,now in [('resource-pressure-stop',before+2),('unknown',before+3),
                           ('resource-pressure-stop',self.plan['trainingStopWall'])]:
            with self.assertRaises(ValueError):consume_resume(self.root,reason,now)
            self.assertEqual(p.read_bytes(),original)
    def test_stricter_disk_and_artifact_caps_are_used(self):
        from types import SimpleNamespace
        sample=SimpleNamespace(artifact_bytes=94*1024**3,disk_free_bytes=52*1024**3)
        self.assertIsNone(resource_stop(self.root,sample))
        sample.disk_free_bytes=50*1024**3;self.assertEqual(resource_stop(self.root,sample),'local-disk-reserve')
        sample.disk_free_bytes=52*1024**3;sample.artifact_bytes=95*1024**3
        self.assertEqual(resource_stop(self.root,sample),'local-artifact-cap')


class CompactRecoveryTests(unittest.TestCase):
    def test_full_restore_legacy_compact_and_counter_bootstrap(self):
        import torch
        from righelt_training.model import PolicyValueNet
        from righelt_training.checkpoint import save_checkpoint,load_checkpoint,weights_sha256,read_recovery_sidecar
        from righelt_training.trainer import make_optimizer
        from righelt_training.recovery import RecoveryLedger
        torch.set_num_threads(1)
        with tempfile.TemporaryDirectory() as name:
            root=Path(name);directory=root/'run';directory.mkdir()
            (directory/'manifest.json').write_text(json.dumps({'manifest':{'seed':7,'stage':'initial'}}))
            model=PolicyValueNet();optimizer=make_optimizer(model)
            sum(p.square().sum() for p in model.parameters()).backward();optimizer.step()
            state={'updates':1,'round':2,'archives':[],'nextJob':17,'nested':{'ids':['x'*1000]*100}}
            expected_optimizer=copy.deepcopy(optimizer.state_dict());weights=weights_sha256(model.state_dict())
            for compact in (False,True):
                path=directory/'checkpoints'/('checkpoint-000002.pt' if compact else 'checkpoint-000001.pt')
                with patch.dict(os.environ,{'RIGHELT_COMPACT_RECOVERY':'1' if compact else '0'}):
                    save_checkpoint(path,model,optimizer,round_index=2,updates=1,replay_ids=[],manifest_sha256='a'*64,recovery_state=state)
                expected_rng=(random.getstate(),torch.get_rng_state().clone())
                restored=PolicyValueNet();opt=make_optimizer(restored)
                data=load_checkpoint(path,restored,opt,manifest_sha256='a'*64,require_recovery=True)
                self.assertEqual(weights_sha256(restored.state_dict()),weights)
                self.assertEqual(data['recovery']['state'],state)
                self.assertEqual(random.getstate(),expected_rng[0]);self.assertTrue(torch.equal(torch.get_rng_state(),expected_rng[1]))
                self.assertEqual(opt.state_dict()['param_groups'],expected_optimizer['param_groups'])
                for key,values in expected_optimizer['state'].items():
                    for field,value in values.items():self.assertTrue(torch.equal(opt.state_dict()['state'][key][field],value))
                self.assertEqual(read_recovery_sidecar(path.with_suffix('.runner.json'))['state'],state)
                with self.assertRaises(FileExistsError):
                    save_checkpoint(path,model,optimizer,round_index=2,updates=1,replay_ids=[],manifest_sha256='a'*64,recovery_state=state)
            # No retained ledger: both companion formats must enforce the same consumed-job floor.
            self.assertEqual(RecoveryLedger(root).job('initial',7),17)
            path=directory/'checkpoints/checkpoint-000002.runner.json';record=json.loads(path.read_text())
            self.assertLess(path.stat().st_size,3000)
            record['schema']=2;path.write_text(json.dumps(record))
            with self.assertRaisesRegex(ValueError,'schema'):read_recovery_sidecar(path)


class TeachingAcceptanceTests(unittest.TestCase):
    def test_double_policy_weight_leaves_value_masked(self):
        import torch
        from righelt_training.trainer import train_round
        import time,math
        class SmallModel(torch.nn.Module):
            def __init__(self):
                super().__init__();self.policy=torch.nn.Parameter(torch.zeros(2801))
            def forward(self,x):return self.policy.expand(len(x),-1),self.policy.sum().expand(len(x))*0
        row={'encoded':[0]*4600,'legal':[1,2],'policy':[{'index':1,'probability':1}],
            'terminalMask':False,'terminalValue':0,'policyMask':True,'certificateEvidence':{'scoped':True}}
        losses=[]
        for weight in (1,2):
            model=SmallModel();optimizer=torch.optim.AdamW(model.parameters(),lr=.0001)
            result=train_round(model,optimizer,[row],device='cpu',seed=7,deadline=time.monotonic()+60,
                certificate_policy_weight=weight)
            self.assertEqual(result['updates'],1);metrics=result['batches'][0]
            self.assertEqual(metrics['valueLoss'],0);self.assertEqual(metrics['valuePositions'],0)
            losses.append(metrics['loss'])
        self.assertAlmostEqual(losses[0],math.log(2),places=6)
        self.assertAlmostEqual(losses[1],2*math.log(2),places=6)
    def test_unknown_is_not_improvement_and_a_regression_rejects(self):
        def result(a,b='certified-safe-complete-prefix'):
            return {'cases':[{'caseId':'S10','knownDeficient':True,'disposition':a},
                             {'caseId':'S05-01','knownDeficient':False,'disposition':b}]}
        before=result('known-losing-completed-turn')
        self.assertFalse(accepted(before,result('UNKNOWN')))
        self.assertTrue(accepted(before,result('certified-safe-complete-prefix')))
        self.assertFalse(accepted(before,result('certified-safe-complete-prefix','UNKNOWN')))
        self.assertFalse(accepted(result('UNKNOWN'),result('certified-safe-complete-prefix')))
    def test_certificate_rows_cannot_gain_terminal_or_future_values(self):
        row={'encoded':[0]*4600,'legal':[1,2],'policyMask':True,'terminalMask':False,
             'policy':[{'index':1,'probability':1}],'futureFacts':{'mask':[False]*24}}
        packet={'schema':1,'kind':'certificate-policy-demonstrations','rows':[copy.deepcopy(row) for _ in range(7)],
                'proofs':[{'proof':{'disposition':'complete'}} for _ in range(3)]}
        validate_packet(packet)
        for key,value in [('terminalMask',True),('futureFacts',{'mask':[True]*24}),('policyMask',False)]:
            changed=copy.deepcopy(packet);changed['rows'][0][key]=value
            with self.assertRaises(ValueError):validate_packet(changed)


if __name__=='__main__':unittest.main()
