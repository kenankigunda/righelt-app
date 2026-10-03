import json
from pathlib import Path
import tempfile
import time
import unittest
from unittest.mock import patch
from righelt_training.replay import partition_for_family
from righelt_training.arena import freeze_plan,open_plan,run_arena,play_game
from righelt_training.config import CONFIG_SHA256

class ArenaTest(unittest.TestCase):
    def plan(self,partition='final'):
        entry={'checkpointSha256':'a'*64,'profileVersion':'test','profile':{'simulations':8,'temperature':0,'maxValueGap':0}}
        return {'configSha256':CONFIG_SHA256,'partition':partition,'purpose':'difficulty','candidate':entry,'opponent':entry,
                'pairs':[{'id':str(i),'seed':seed,'kind':'normal' if i<50 else 'heldout','initialState':{'placeholderForProtocolTest':True},'openingActions':[{'type':'pass'}]} for i,seed in enumerate([s for s in range(10000) if partition_for_family(f'normal:{s}')==partition][:100])]}
    def test_sealed_plan_cannot_be_reopened_or_changed(self):
        with tempfile.TemporaryDirectory() as d:
            p=Path(d)/'plan.json'
            with patch('righelt_training.arena.engine_command',side_effect=[{'type':'opening-verified','initial':False,'fingerprint':str(i)} for i in range(50)]):freeze_plan(p,self.plan())
            open_plan(p)
            with self.assertRaises(FileExistsError):open_plan(p)
            data=json.loads(p.read_text());data['plan']['candidate']['profile']['simulations']=16;p.write_text(json.dumps(data))
            with self.assertRaises(ValueError):open_plan(p)
    def test_missing_pairs_or_duplicate_seeds_rejected(self):
        with tempfile.TemporaryDirectory() as d:
            p=Path(d)/'plan.json';plan=self.plan();plan['pairs'][1]['seed']=plan['pairs'][0]['seed']
            with self.assertRaises(ValueError):freeze_plan(p,plan)

    def frozen(self,directory,partition='validation'):
        path=Path(directory)/'plan.json';plan=self.plan(partition)
        plan['opponent']={**plan['opponent'],'checkpointSha256':'b'*64,'profileVersion':'opponent'}
        with patch('righelt_training.arena.engine_command',side_effect=[{'type':'opening-verified','initial':False,'fingerprint':str(i)} for i in range(50)]):freeze_plan(path,plan)
        runtime={'manifestSha256':'manifest','startedMonotonic':time.monotonic(),'deadlineMonotonic':time.monotonic()+600}
        (Path(directory)/'runtime.json').write_text(json.dumps(runtime))
        (Path(directory)/'allocation.json').write_text(json.dumps({'paused':False,'workers':2,'stop':False}))
        return path,runtime

    def player(self,job,models,deadline,device,**kwargs):
        candidate_seat='P1' if job['id'].endswith(':P1') else 'P2'
        self.assertEqual(models[candidate_seat],'candidate-model')
        self.assertEqual(job['modelVersions'][candidate_seat],'a'*64)
        self.assertLessEqual(deadline,time.monotonic()+601)
        return {'status':'completed','game':{**job,'decisions':[],'termination':'terminal',
            'outcome':{'status':'p1_win' if candidate_seat=='P1' else 'p2_win'}}}

    def test_validation_resumes_partial_pair_without_replaying_completed_side(self):
        with tempfile.TemporaryDirectory() as d:
            path,runtime=self.frozen(d);calls=[]
            def stop_after_one(*args,**kwargs):
                calls.append(args[0]['id'])
                return self.player(*args,**kwargs) if len(calls)==1 else {'status':'unfinished','reason':'budget'}
            models={'candidate':'candidate-model','opponent':'opponent-model'}
            first=run_arena(path,d,models,'cpu',player=stop_after_one)
            self.assertEqual(first['status'],'inconclusive');self.assertEqual(first['completedGames'],1)
            self.assertEqual(first['completePairs'],0);self.assertIsNone(first['statistics'])
            resumed=[]
            def resume(*args,**kwargs):resumed.append(args[0]['id']);return self.player(*args,**kwargs)
            result=run_arena(path,d,models,'cpu',player=resume)
            self.assertEqual(len(resumed),199);self.assertNotIn(calls[0],resumed)
            self.assertEqual(result['status'],'completed');self.assertEqual(result['completePairs'],100)
            self.assertTrue(result['statistics']['passed'])
            self.assertEqual(json.loads((Path(d)/'runtime.json').read_text()),runtime)
            runtime['deadlineMonotonic']+=1;(Path(d)/'runtime.json').write_text(json.dumps(runtime))
            with self.assertRaises(ValueError):run_arena(path,d,models,'cpu',player=resume)

    def test_final_incomplete_partition_cannot_resume(self):
        with tempfile.TemporaryDirectory() as d:
            path,_=self.frozen(d,'final')
            result=run_arena(path,d,{'candidate':None,'opponent':None},'cpu',player=lambda *a,**k:{'status':'unfinished','reason':'budget'})
            self.assertEqual(result['status'],'inconclusive')
            with self.assertRaises(FileExistsError):run_arena(path,d,{'candidate':None,'opponent':None},'cpu')

    def test_frozen_identity_mismatch_and_modified_archive_fail_closed(self):
        with tempfile.TemporaryDirectory() as d:
            path,_=self.frozen(d)
            def wrong(*args,**kwargs):
                result=self.player(*args,**kwargs);result['game']['seed']+=1;return result
            with self.assertRaises(ValueError):run_arena(path,d,{'candidate':'candidate-model','opponent':'opponent-model'},'cpu',player=wrong)
        with tempfile.TemporaryDirectory() as d:
            path,_=self.frozen(d);calls=[]
            def one(*args,**kwargs):
                calls.append(True)
                return self.player(*args,**kwargs) if len(calls)==1 else {'status':'unfinished','reason':'budget'}
            models={'candidate':'candidate-model','opponent':'opponent-model'}
            run_arena(path,d,models,'cpu',player=one)
            archive=next((Path(d)/'evaluations').glob('*/games/*.gz'))
            archive.write_bytes(archive.read_bytes()+b'tampered')
            with self.assertRaisesRegex(ValueError,'archive changed'):run_arena(path,d,models,'cpu',player=self.player)

    def test_expired_game_does_not_spawn_and_profile_cannot_override_deadline(self):
        with patch('righelt_training.arena.subprocess.Popen') as spawn:
            result=play_game({}, {},time.monotonic(),'cpu')
            self.assertEqual(result['status'],'unfinished');spawn.assert_not_called()
        with tempfile.TemporaryDirectory() as d:
            plan=self.plan();plan['candidate']['profile']['deadlineMs']=999999
            with patch('righelt_training.arena.engine_command',side_effect=[{'type':'opening-verified','initial':False,'fingerprint':str(i)} for i in range(50)]):
                with self.assertRaises(ValueError):freeze_plan(Path(d)/'plan.json',plan)

if __name__=='__main__':unittest.main()
