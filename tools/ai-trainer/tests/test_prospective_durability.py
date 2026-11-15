"""Faults at the executed raw/remote/replay boundaries; no game replacement."""
import copy
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import unittest
from unittest.mock import Mock,patch
from righelt_training.prospective_durability import consume_and_qualify,sha
from righelt_training.arena import play_game


class Barrier:
    def __init__(self):self.records={};self.generation=1;self.fail=False
    def evaluation_claim(self,namespace,identity,*,create):
        key=(namespace,identity)
        if key in self.records:return {'created':False,**copy.deepcopy(self.records[key])}
        if not create:return {'created':False,'unclaimed':True}
        self.records[key]={'record':{'generation':self.generation}}
        return {'created':True}
    def settle(self,namespace,identity,value):
        if self.fail:raise RuntimeError('uncertain settlement')
        record=self.records[(namespace,identity)]
        if record['record']['generation']!=self.generation:raise ValueError('generation ownership')
        if 'result' in record and record['result']!=value:raise ValueError('immutable result')
        record['result']=copy.deepcopy(value)


class ProspectiveDurabilityTest(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        self.barrier=Barrier();self.play=Mock();self.verify=Mock();self.start=Mock()
        self.job={'id':'j','seed':7,'familyId':'f','partition':'validation','kind':'normal','startIdentity':{'stateHash':'f'*64}}
        self.game={'id':'j','seed':7,'familyId':'f','partition':'validation','kind':'normal','modelVersions':{'P1':'a'},'profileVersions':{'P1':'v'},'outcome':{'status':'p1_win'}}
        self.play.side_effect=lambda save:(save(self.game) or {'status':'completed','game':self.game})
        self.options={'job':self.job,'base':{'jobId':'j','startIdentity':self.job['startIdentity']},
            'execution':{'generation':1,'sourceRevision':'a'*40},'namespace':'n','directory':self.temp.name,
            'deadline':time.monotonic()+100,'barrier':self.barrier,'play':self.play,'verify':self.verify,
            'start_verify':self.start,'model_versions':{'P1':'a'},'profile_versions':{'P1':'v'}}
    def run_attempt(self,**changes):return consume_and_qualify(**{**self.options,**changes})
    def recover(self,**changes):
        self.barrier.generation=2
        fresh=Path(self.temp.name)/'restored'
        return self.run_attempt(execution={'generation':2,'sourceRevision':'a'*40},directory=fresh,**changes)
    def test_raw_local_and_remote_exist_before_any_verifier(self):
        def check(*args,**kwargs):
            raw=self.barrier.records[('n','j')]['result']
            self.assertEqual(raw['status'],'raw-complete');self.assertEqual(raw['rawOutcome'],'p1_win')
            files=list(Path(self.temp.name).glob('raw/*/*.json'));self.assertEqual(len(files),1)
            self.assertEqual(json.loads(files[0].read_bytes()),raw)
        self.start.side_effect=check;self.verify.side_effect=check
        row,paths=self.run_attempt();self.assertEqual(row['status'],'complete');self.assertEqual(len(paths),2)
        self.assertEqual(self.barrier.records[('n','j')]['result']['status'],'raw-complete')
        self.assertTrue(self.barrier.records[('n:verification:1','j')]['result']['engineReplayVerified'])
    def test_timeout_keeps_raw_outcome_unscored_and_recovery_never_plays(self):
        self.verify.side_effect=TimeoutError('budget')
        row,_=self.run_attempt();self.assertEqual(row['status'],'unfinished');self.assertNotIn('outcome',row)
        self.assertEqual(row['rawOutcome'],'p1_win');self.assertFalse(row['engineReplayVerified'])
        self.play.reset_mock();self.play.side_effect=AssertionError('consumed game replayed')
        self.verify.side_effect=None
        row,_=self.recover();self.assertEqual(row['status'],'complete');self.play.assert_not_called()
    def test_crash_after_raw_is_restored_before_reverification(self):
        self.start.side_effect=KeyboardInterrupt('crash')
        with self.assertRaises(KeyboardInterrupt):self.run_attempt()
        self.assertEqual(self.barrier.records[('n','j')]['result']['status'],'raw-complete')
        self.play.reset_mock();self.start.side_effect=None
        row,_=self.recover();self.assertEqual(row['status'],'complete');self.play.assert_not_called()
    def test_uncertain_raw_settle_stops_before_verification_and_never_replays(self):
        self.barrier.fail=True
        with self.assertRaisesRegex(RuntimeError,'uncertain'):self.run_attempt()
        self.start.assert_not_called();self.verify.assert_not_called()
        self.assertEqual(len(list(Path(self.temp.name).glob('raw/*/*.json'))),1)
        self.barrier.fail=False;self.play.reset_mock()
        row,_=self.recover();self.assertEqual(row['reason'],'consumed-without-settlement');self.play.assert_not_called()
    def test_wrong_start_remains_durable_and_cannot_score(self):
        self.start.side_effect=ValueError('wrong authoritative root')
        with self.assertRaisesRegex(ValueError,'wrong authoritative'):self.run_attempt()
        self.assertIn('result',self.barrier.records[('n','j')]);self.verify.assert_not_called()
        self.assertNotIn(('n:verification:1','j'),self.barrier.records)
    def test_bound_proof_reused_without_new_budget_or_player(self):
        self.run_attempt();self.play.reset_mock();self.verify.reset_mock();self.start.reset_mock()
        row,_=self.recover(deadline=time.monotonic()-1)
        self.assertEqual(row['status'],'complete');self.play.assert_not_called();self.verify.assert_not_called();self.start.assert_not_called()
        with self.assertRaisesRegex(ValueError,'identity mismatch'):
            self.recover(deadline=time.monotonic()-1,model_versions={'P1':'changed frozen model'})
    def test_wrapped_start_timeout_keeps_raw_unscored(self):
        try:raise subprocess.TimeoutExpired('start',1)
        except subprocess.TimeoutExpired as cause:
            error=ValueError('authoritative start timeout');error.__cause__=cause
        self.start.side_effect=error
        row,_=self.run_attempt();self.assertEqual(row['status'],'unfinished');self.assertFalse(row['engineReplayVerified'])
        self.verify.assert_not_called();self.assertIn('result',self.barrier.records[('n','j')])
    def test_source_or_raw_corruption_cannot_reuse_cached_proof(self):
        self.run_attempt()
        with self.assertRaisesRegex(ValueError,'binding differs'):
            self.run_attempt(execution={'generation':2,'sourceRevision':'b'*40})
        self.barrier.records[('n','j')]['result']['game']['seed']=8
        with self.assertRaisesRegex(ValueError,'hash differs'):self.recover()
    def test_malformed_original_generation_rejects_before_creating_any_restored_path(self):
        self.run_attempt()
        for value in ('../../unexpected',0,-1,True,1.5,9):
            self.barrier.records[('n','j')]['result']['originalGeneration']=value
            destination=Path(self.temp.name)/('restore-'+str(type(value).__name__)+str(len(str(value))))
            with self.subTest(value=value),self.assertRaisesRegex(ValueError,'generation bounds'):
                self.run_attempt(execution={'generation':2,'sourceRevision':'a'*40},directory=destination)
            self.assertFalse(destination.exists())
        self.assertFalse((Path(self.temp.name)/'unexpected').exists())
    def test_prospective_arena_returns_raw_before_checkpoint_or_verifier(self):
        real_popen=subprocess.Popen
        payload=json.dumps({'type':'game','game':self.game})
        def spawn(*args,**kwargs):return real_popen([sys.executable,'-c',
            'import sys;sys.stdin.readline();print('+repr(payload)+',flush=True)'],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
        events=[]
        with patch('righelt_training.arena.subprocess.Popen',side_effect=spawn),patch('righelt_training.arena.verify_game',side_effect=AssertionError('premature verify')):
            result=play_game({'id':'j','prospectiveEvaluation':True,'gameSeconds':60},{},time.monotonic()+90,'cpu',
                checkpoint=lambda:events.append('checkpoint'),raw_complete=lambda game:events.append('durable'))
        self.assertEqual(result['game'],self.game);self.assertEqual(events[-1],'durable')
        with patch('righelt_training.arena.subprocess.Popen',side_effect=spawn),patch('righelt_training.arena.verify_game') as historical_verify:
            result=play_game({'id':'j'}, {},time.monotonic()+90,'cpu')
        self.assertEqual(result['status'],'completed');historical_verify.assert_called_once()

if __name__=='__main__':unittest.main()
