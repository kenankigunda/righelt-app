import hashlib
import json
import os
from pathlib import Path
import random
import tempfile
import unittest
from unittest.mock import patch
import torch
from righelt_training.execution_recipe import settings, verify_runtime
from righelt_training.evaluation import prospective_report

class HostedContractsTest(unittest.TestCase):
    def test_runtime_recipe_checks_full_settings_without_consuming_rng(self):
        with tempfile.TemporaryDirectory() as d:
            path=Path(d)/'execution.json'
            record={'schema':1,'kind':'execution-recipe','settings':settings('ordinary-continuation')}
            def env():
                path.write_text(json.dumps(record))
                return {'RIGHELT_HOSTED':'1','RIGHELT_EXECUTION_RECIPE_PATH':str(path), 'RIGHELT_EXECUTION_RECIPE_SHA256':hashlib.sha256(path.read_bytes()).hexdigest()}
            before=random.getstate(); torch_before=torch.get_rng_state().clone()
            with patch.dict(os.environ,env()): verify_runtime()
            self.assertEqual(before,random.getstate()); self.assertTrue(torch.equal(torch_before,torch.get_rng_state()))
            record['settings']['losses']['futureFacts']=.1
            with patch.dict(os.environ,env()),self.assertRaisesRegex(ValueError,'runtime differs'):verify_runtime()
            record['settings']=settings('ordinary-continuation');record['settings']['teaching']='deeper'
            with patch.dict(os.environ,env()),self.assertRaisesRegex(ValueError,'runtime differs'):verify_runtime()

    def test_equal_trajectories_and_missing_diagnostic_do_not_discard_candidate_pair(self):
        jobs=[{'id':seat,'pairId':'pair','candidateSeat':seat,'profile':'horus','familyId':'family','role':'candidate'} for seat in ('P1','P2')]
        jobs.append({**jobs[0],'id':'diagnostic','role':'baseline-baseline'})
        records=[{**j,'jobId':j['id'],'receiptId':j['id'],'status':'complete','outcome':'p1_win','trajectorySha256':'same'} for j in jobs[:2]]
        result=prospective_report(jobs,records)
        self.assertEqual(result['completeCandidatePairs'],1);self.assertEqual(result['unstarted'],1)
        self.assertEqual(result['candidateScoreBounds'],[.5,.5])
        with self.assertRaisesRegex(ValueError,'reused'):prospective_report(jobs,[records[0],{**records[1],'receiptId':'P1'}])
        result=prospective_report(jobs,[records[0],{**records[1],'status':'unfinished','outcome':'timeout'}])
        self.assertEqual(result['candidateScoreBounds'],[.5,1.]);self.assertEqual(result['completeCandidatePairs'],0)
        with self.assertRaisesRegex(ValueError,'terminal'):prospective_report(jobs,[{**records[0],'outcome':'timeout'}])

    def test_fixture_rejects_changed_seed_partial_work_and_zero_roots(self):
        from righelt_training.hosted_canary import prepare, validate_fixture, FIXTURE
        from righelt_training.canary import canary_roots
        expected={'kind':'generated-canary-fixtures','seed':107,'roots':[{'state':s,'family':f} for s,f in list(canary_roots())[:2]]}
        validate_fixture(expected,{'execution':{'seed':107},'completedWorkIds':FIXTURE['workIds']})
        with self.assertRaisesRegex(ValueError,'seed'):prepare(Path('/unused'),seed=108)
        with self.assertRaisesRegex(ValueError,'corpus'):validate_fixture({**expected,'roots':expected['roots'][:1]},{'execution':{'seed':107},'completedWorkIds':FIXTURE['workIds']})
        with self.assertRaisesRegex(ValueError,'workload'):validate_fixture(expected,{'execution':{'seed':107},'completedWorkIds':['fixture-game-0']})

        with self.assertRaisesRegex(ValueError,'execution seed'):validate_fixture(expected,{'execution':{'seed':108},'completedWorkIds':FIXTURE['workIds']})

    def test_wrong_runtime_weights_fail_even_with_correct_checkpoint_metadata(self):
        from righelt_training.checkpoint import save_checkpoint
        from righelt_training.model import PolicyValueNet
        from righelt_training.trainer import make_optimizer
        from righelt_training.execution_recipe import record, verify_start
        with tempfile.TemporaryDirectory() as d:
            root=Path(d); cp=root/'initial.pt'; model=PolicyValueNet(); optimizer=make_optimizer(model)
            save_checkpoint(cp,model,optimizer,round_index=0,updates=0,replay_ids=[],manifest_sha256='incumbent')
            recipe=record(cp,'d'*64,mode='ordinary-continuation'); recipe_path=root/'recipe.json';recipe_path.write_text(json.dumps(recipe))
            context=root/'context.json'; context.write_text(json.dumps({'execution':{'inputCheckpointSha256':recipe['incumbent']['checkpointSha256'],'dataSha256':'d'*64},'recoveryFiles':[]}))
            env={'RIGHELT_HOSTED':'1','RIGHELT_EXECUTION_RECIPE_PATH':str(recipe_path),'RIGHELT_EXECUTION_RECIPE_SHA256':hashlib.sha256(recipe_path.read_bytes()).hexdigest(),'RIGHELT_EXECUTION_CONTEXT':str(context)}
            with patch.dict(os.environ,env):
                verify_start(cp,model,optimizer)
                with torch.no_grad():model.stem.weight.add_(1.)
                with self.assertRaisesRegex(ValueError,'weights differ'):verify_start(cp,model,optimizer)
