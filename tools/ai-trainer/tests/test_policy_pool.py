"""Disposable source-pool transport fixtures. No campaign or strength evidence."""
import copy
import gzip
import hashlib
import json
from pathlib import Path
import tempfile
import time
import unittest
from unittest.mock import patch
import torch
from righelt_training.policy_pool import prepare_pool,work_id
from righelt_training.canary import canary_roots,selfplay
from righelt_training.hosted_canary import Monitor
from righelt_training.model import create_model
from righelt_training.architecture import architecture_binding
from righelt_training.runner import default_state,engine_command,Runner
from righelt_training.replay import ReplayBuffer,save_game
from righelt_training.checkpoint import save_checkpoint,load_checkpoint
from righelt_training.trainer import make_optimizer,train_round
from righelt_training.hosted_science import apply_policy_refresh,recovered_adoption,qualify_refresh_start

class PolicyPoolTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        torch.set_num_threads(1);torch.manual_seed(107)
        parent=Path.cwd()/'.ai-runs';parent.mkdir(exist_ok=True)
        cls.temp=tempfile.TemporaryDirectory(dir=parent);cls.addClassCleanup(cls.temp.cleanup)
        cls.root=Path(cls.temp.name);cls.model=create_model(architecture_binding('board-attention-48x2-v1')).eval()
        cls.optimizer=make_optimizer(cls.model)
        for group in cls.optimizer.param_groups:group['lr']=.0001
        cls.game=None
        for i,(state,family) in enumerate(list(canary_roots())[:2]):
            game=selfplay({'command':'generate','id':'pool-fixture-'+str(i),'partition':'train','kind':'simple','familyId':family,'initialState':state,'seed':107+i,'modelVersion':'a'*64},cls.model,'cpu',time.monotonic()+90,Monitor())
            buffer=ReplayBuffer();buffer.append(game)
            eligible=[j for j,d in enumerate(game['decisions']) if d.get('policyMask',True) and len(d['legal'])>1]
            if eligible:cls.game=game;cls.buffer=buffer;cls.index=eligible[0];break
        if cls.game is None:raise AssertionError('generated fixture must have a genuine unforced policy row')
        archive=save_game(cls.root/'games',cls.game);cls.reference=str(archive.relative_to(cls.root));cls.archive_sha=hashlib.sha256(archive.read_bytes()).hexdigest()
        result=train_round(cls.model,cls.optimizer,list(cls.buffer.positions),device='cpu',seed=107,deadline=time.monotonic()+90)
        cls.state=default_state();cls.state.update(phase='training',round=1,updates=result['updates'],archives=[cls.reference],inheritedBoundary={'inheritedReplayCount':0})
        cls.cp=cls.root/'checkpoints'/'common.pt'
        cls.cp_sha=save_checkpoint(cls.cp,cls.model,cls.optimizer,round_index=1,updates=result['updates'],replay_ids=[cls.reference],manifest_sha256='synthetic-common-fixture',recovery_state=cls.state)
        load_checkpoint(cls.cp,cls.model,cls.optimizer,manifest_sha256='synthetic-common-fixture',require_recovery=True)
    def binding(self,name,value):
        path=self.root/name;path.write_text(json.dumps(value,sort_keys=True));return {'path':str(path),'sha256':hashlib.sha256(path.read_bytes()).hexdigest()}
    def pool(self):
        execution={'sourceRevision':'a'*40,'scientific':{'stage':'calibration','arm':'shared'},'seed':107}
        proof={'kind':'training-proof','execution':execution,'checkpointSha256':self.cp_sha,'recoveryPassed':True}
        proof_ref=self.binding('source-proof.json',proof)
        source={'kind':'compute-result','disposition':'complete','allWorkComplete':True,'execution':execution,'artifacts':[{'role':'checkpoint','sha256':self.cp_sha},{**proof_ref,'role':'proof'}]}
        result_ref=self.binding('source-result.json',source);guards=self.binding('guards.json',{'encodingHashes':[],'familyIds':[]})
        identity=work_id(self.archive_sha,self.index)
        pool={'schema':1,'kind':'shared-calibration-policy-pool','sourceCheckpoint':{'path':str(self.cp),'sha256':self.cp_sha},'sourceResult':result_ref,'guards':guards,
              'selections':[{'workId':identity,'archiveReference':self.reference,'index':self.index}],'inventorySeconds':30}
        context={'sourceRevision':'a'*40,'inputCheckpointSha256':self.cp_sha,'manifestSha256':'d'*64,'phase':'teacher-refresh'}
        return pool,context,[identity]
    def test_rows_come_from_executed_game_inventory_not_declared_flags(self):
        pool,context,ids=self.pool();calls=[]
        def actual_inventory(job,**kwargs):calls.append(job['game']['id']);return engine_command(job,**kwargs)
        settled=[]
        with patch('righelt_training.hosted_receipts.settle',side_effect=lambda namespace,key,result:settled.append(result)):
            rows,proofs=prepare_pool(pool,context,ids,guard_sha256=pool['guards']['sha256'],inventory=actual_inventory)
        with patch('righelt_training.hosted_receipts.evaluation_claim',return_value={'created':False,'result':settled[0]}) as claim:
            cached,_=prepare_pool(pool,context,ids,guard_sha256=pool['guards']['sha256'],deadline=time.monotonic()-1,inventory=lambda *a,**k:(_ for _ in ()).throw(AssertionError('cached verification must not replay')))
        self.assertFalse(claim.call_args.kwargs['create']);self.assertEqual(cached,rows)
        original=self.game['decisions'][self.index]
        self.assertEqual(calls,[self.game['id']]);self.assertEqual(len(proofs),1)
        self.assertEqual((rows[0]['id'],rows[0]['stateHash'],rows[0]['controller']),(original['id'],original['beforeHash'],original['controller']))
        self.assertEqual(rows[0]['policy'],original['policy']);self.assertEqual(rows[0]['legal'],original['legal'])
        self.assertEqual(rows[0]['sourceQualification']['archiveSha256'],self.archive_sha)
        self.assertEqual(rows[0]['workId'],ids[0])
        with self.assertRaisesRegex(ValueError,'hand-labelled'):prepare_pool({'rows':[{'targetOrigin':'fresh-self-play'}]},context,ids,guard_sha256=pool['guards']['sha256'])
        bad=copy.deepcopy(pool);bad['selections'][0]['archiveReference']='historical-human.json.gz'
        with self.assertRaisesRegex(ValueError,'fresh shared'):prepare_pool(bad,context,ids,guard_sha256=pool['guards']['sha256'],inventory=lambda *a,**k:(_ for _ in ()).throw(AssertionError('no engine call expected')))
    def test_actual_sampled_policy_replacements_are_durable_and_missing_ids_block(self):
        position=copy.deepcopy(list(self.buffer.positions)[self.index]);replacement=copy.deepcopy(position)
        replacement['encoded']=list(replacement['encoded']);replacement['originalPolicy']=copy.deepcopy(position['policy'])
        replacement['policy']=[{'index':position['legal'][-1],'probability':1.}]
        binding=self.binding('refresh.json',[replacement])
        with self.assertRaisesRegex(ValueError,'absent'):apply_policy_refresh([],binding,require_all=True)
        model=create_model(architecture_binding('board-attention-48x2-v1'));optimizer=make_optimizer(model)
        runner=Runner.__new__(Runner);runner.state=default_state();runner.maybe_checkpoint=lambda:None;runner.event=lambda *a,**k:None
        qualify_refresh_start(runner.state,[position],binding,'e'*64)
        with patch('righelt_training.execution_recipe.verify_runtime',return_value={'settings':{'policyRefresh':binding}}):
            result=train_round(model,optimizer,[position],device='cpu',seed=107,deadline=time.monotonic()+90,on_batch=runner.record_training_batch)
        self.assertEqual(result['updates'],1)
        adoption=runner.state['policyRefreshAdoption'];self.assertEqual(adoption['ids'],[position['id']]);self.assertEqual(adoption['positions'],1)
        retained=self.root/'checkpoints'/'adoption.pt'
        save_checkpoint(retained,model,optimizer,round_index=0,updates=runner.state['updates'],replay_ids=[],manifest_sha256='synthetic-adoption-fixture',recovery_state=runner.state)
        restored=create_model(architecture_binding('board-attention-48x2-v1'));restored_optimizer=make_optimizer(restored)
        recovered=load_checkpoint(retained,restored,restored_optimizer,manifest_sha256='synthetic-adoption-fixture',require_recovery=True)
        self.assertEqual(recovered_adoption(recovered['recovery']['state'],runner.state),adoption)
        qualify_refresh_start(recovered['recovery']['state'],[],binding,'e'*64,resume=True)
        missing=copy.deepcopy(recovered['recovery']['state']);missing['policyRefreshInputQualified']['ids']=[]
        with self.assertRaisesRegex(ValueError,'original shared-replay'):qualify_refresh_start(missing,[],binding,'e'*64,resume=True)
        with self.assertRaisesRegex(ValueError,'recovered policy adoption'):recovered_adoption({},runner.state)
        changed=copy.deepcopy(runner.state);changed['policyRefreshAdoption']['positions']=0
        with self.assertRaisesRegex(ValueError,'recovered policy adoption'):recovered_adoption(changed,runner.state)

if __name__=='__main__':unittest.main()
