import json
from pathlib import Path
import tempfile
import time
import subprocess
import unittest
from unittest.mock import Mock,patch
import torch
from righelt_training.checkpoint import atomic_json,save_checkpoint,load_checkpoint,inspect_checkpoint
from righelt_training.recovery import RecoveryLedger
from righelt_training.runner import Runner,default_state
from righelt_training.runner_monitor import RunnerMonitor
from righelt_training.model import PolicyValueNet
from righelt_training.trainer import make_optimizer
from righelt_training.replay import ReplayBuffer
from righelt_training.config import ROOT

class RecoveryTest(unittest.TestCase):
    def setUp(self):torch.set_num_threads(1)
    def test_ledger_bootstraps_legacy_and_never_reuses_rollback_jobs(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);run=root/'legacy';(run/'checkpoints').mkdir(parents=True)
            atomic_json(run/'manifest.json',{'manifest':{'stage':'initial','seed':107}})
            atomic_json(run/'checkpoints/checkpoint-000020.runner.json',{'state':{'nextJob':9}})
            (run/'checkpoints/checkpoint-000020.pt').write_bytes(b'legacy')
            ledger=RecoveryLedger(root)
            self.assertEqual(ledger.job('initial',107,2),9)
            self.assertEqual(RecoveryLedger(root).job('initial',107,0),10)
            self.assertEqual(ledger.checkpoint(),20)
            self.assertEqual(RecoveryLedger(root).checkpoint(1),21)
            self.assertEqual((run/'checkpoints/checkpoint-000020.pt').read_bytes(),b'legacy')

    def runner(self,d):
        runner=Runner.__new__(Runner);runner.directory=Path(d);runner.device=torch.device('cpu')
        runner.manifest_hash='test';runner.runtime={};runner.state=default_state()
        runner.model=PolicyValueNet();runner.optimizer=make_optimizer(runner.model);runner.buffer=ReplayBuffer()
        return runner

    def test_rollback_checkpoint_append_only_and_generation_time_rebased(self):
        with tempfile.TemporaryDirectory() as d:
            runner=self.runner(d);runner.state['generationStartedMonotonic']=time.monotonic()-12
            runner.checkpoint();first=json.loads((Path(d)/'latest.json').read_text())['checkpoint']
            original=Path(first).read_bytes()
            runner.checkpoint();second=json.loads((Path(d)/'latest.json').read_text())['checkpoint']
            runner.restore(Path(first));runner.checkpoint();third=json.loads((Path(d)/'latest.json').read_text())['checkpoint']
            self.assertEqual(len({first,second,third}),3);self.assertEqual(Path(first).read_bytes(),original)
            self.assertLess(abs(time.monotonic()-runner.state['generationStartedMonotonic']-12),2)
            with self.assertRaises(FileExistsError):save_checkpoint(Path(first),runner.model,runner.optimizer,round_index=0,updates=0,replay_ids=[],manifest_sha256='test')

    def test_cursor_and_archive_tamper_rejected_before_weights_or_rng_restore(self):
        with tempfile.TemporaryDirectory() as d:
            runner=self.runner(d);archive=Path(d)/'archive.gz';archive.write_bytes(b'original')
            runner.state['archives']=['archive.gz'];runner.state['nextJob']=5;runner.checkpoint()
            path=Path(json.loads((Path(d)/'latest.json').read_text())['checkpoint'])
            other=PolicyValueNet();before=other.stem.weight.detach().clone();rng=torch.get_rng_state().clone()
            companion=path.with_suffix('.runner.json');original=companion.read_bytes();payload=json.loads(original)
            payload['state']['nextJob']=0;atomic_json(companion,payload)
            with self.assertRaisesRegex(ValueError,'sidecar binding'):load_checkpoint(path,other,manifest_sha256='test',require_recovery=True)
            self.assertTrue(torch.equal(before,other.stem.weight));self.assertTrue(torch.equal(rng,torch.get_rng_state()))
            companion.write_bytes(original);archive.write_bytes(b'changed')
            with self.assertRaisesRegex(ValueError,'archive checksum'):inspect_checkpoint(path,manifest_sha256='test',require_recovery=True)

    def test_independent_heartbeat_during_blocking_replay_and_watchdog(self):
        with tempfile.TemporaryDirectory() as d:
            with RunnerMonitor(d,interval=.01,query=lambda:123,expire=lambda:None) as monitor:
                with monitor.operation('restore-and-replay',1):
                    first=json.loads((Path(d)/'device-memory.json').read_text())['observedAt']
                    time.sleep(.06)
                    last=json.loads((Path(d)/'device-memory.json').read_text())
                    self.assertGreater(last['observedAt'],first);self.assertEqual(last['driverBytes'],123)
                    self.assertEqual(json.loads((Path(d)/'operation-status.json').read_text())['name'],'restore-and-replay')
            now=[0.];expire=Mock()
            with RunnerMonitor(d,query=lambda:0,clock=lambda:now[0],expire=expire) as monitor:
                with self.assertRaises(TimeoutError):
                    with monitor.operation('blocked',1):now[0]=2;monitor.publish()
                expire.assert_called_once()

    def test_heartbeat_failure_propagates(self):
        with tempfile.TemporaryDirectory() as d:
            calls=[0];expire=Mock()
            def query():
                calls[0]+=1
                if calls[0]>1:raise OSError('GPU telemetry failed')
                return 0
            with self.assertRaisesRegex(RuntimeError,'telemetry failed'):
                with RunnerMonitor(d,interval=.01,query=query,expire=expire):time.sleep(.05)
            expire.assert_called_once()
            self.assertEqual(json.loads((Path(d)/'operation-status.json').read_text())['status'],'monitor-failed')

    def test_root_model_allows_node_fallback_but_expired_request_stays_unfinished(self):
        script="""
import {createInitialState} from './packages/game-engine/src/index.ts';
import {selectMove} from './packages/computer-player/src/index.ts';
import {searchRecovery} from './tools/ai-trainer/search-recovery.mjs';
const state=createInitialState(),rows=[];
for(const limits of [{maxNodes:1},{deadlineMs:performance.now()-1}]){
 const result=await selectMove({state,seed:107,simulations:64,...limits},async()=>({policyLogits:new Float32Array(2801),value:0}));
 rows.push({result,recovery:searchRecovery(result,{id:'diagnostic',initialState:state,decisions:[],outcome:state.outcome})});
}
console.log(JSON.stringify(rows));
"""
        rows=json.loads(subprocess.check_output(['node','--import','tsx','--input-type=module','-e',script],cwd=ROOT,text=True,timeout=10))
        self.assertIsNone(rows[0]['recovery'])
        self.assertEqual(rows[0]['result']['fallback']['reason'],'safety-incomplete')
        self.assertFalse(rows[0]['result']['policyMask']);self.assertEqual(rows[0]['result']['policy'],[])
        row=rows[1]['recovery']
        self.assertEqual(row['search']['stopped'],'deadline')
        self.assertEqual(row['type'],'unfinished');self.assertEqual(row['game']['termination'],'unfinished')
        self.assertEqual(row['game']['decisions'],[])

if __name__=='__main__':unittest.main()
