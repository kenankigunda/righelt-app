import json
import shutil
from pathlib import Path
import tempfile
import time
import unittest
from unittest.mock import patch
from righelt_training.replay import partition_for_family
from righelt_training.arena import freeze_plan,open_plan,run_arena,play_game
from righelt_training.config import CONFIG_SHA256
from righelt_training.curriculum import family_for_root, simple_root

class ArenaTest(unittest.TestCase):
    def setUp(self):
        self.archive=tempfile.TemporaryDirectory();self.addCleanup(self.archive.cleanup)
        self.root_patch=patch('righelt_training.arena.ROOT',Path(self.archive.name))
        self.root_patch.start();self.addCleanup(self.root_patch.stop)

    def plan(self,partition='final'):
        entry={'checkpointSha256':'a'*64,'profileVersion':'test','profile':{'simulations':8,'temperature':0,'maxValueGap':0}}
        roots=[]
        for n in range(10000):
            a,b=divmod(n,100)
            if a==b:continue
            root={'pieces':[{'owner':'P1','kind':'commander','position':{'row':a//10,'col':a%10}},
                            {'owner':'P2','kind':'commander','position':{'row':b//10,'col':b%10}}]}
            if partition_for_family(family_for_root(root))==partition:roots.append(root)
            if len(roots)==50:break
        seeds=[s for s in range(10000) if partition_for_family(f'normal:{s}')==partition][:100]
        return {'configSha256':CONFIG_SHA256,'partition':partition,'purpose':'difficulty','candidate':entry,'opponent':entry,
                'pairs':[{'id':str(i),'seed':seed,'kind':'normal' if i<50 else 'heldout',
                          'initialState':None if i<50 else roots[i-50],'openingActions':[{'type':'pass'}]} for i,seed in enumerate(seeds)]}
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
        runtime={'allocationId':'allocation','manifestSha256':'manifest','startedMonotonic':time.monotonic(),'deadlineMonotonic':time.monotonic()+600}
        (Path(directory)/'runtime.json').write_text(json.dumps(runtime))
        (Path(directory)/'allocation.json').write_text(json.dumps({'paused':False,'workers':2,'stop':False,'observedAt':time.time()}))
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
            prior=len(resumed)
            self.assertEqual(run_arena(path,d,models,'cpu',player=resume)['status'],'completed')
            self.assertEqual(len(resumed),prior)
            runtime['allocationId']='other';(Path(d)/'runtime.json').write_text(json.dumps(runtime))
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

    def test_startup_pause_waits_before_consuming_final(self):
        with tempfile.TemporaryDirectory() as d:
            path,_=self.frozen(d,'final')
            allocation=Path(d)/'allocation.json'
            allocation.write_text(json.dumps({'paused':True,'workers':0,'reason':'device-memory-unknown','observedAt':time.time()}))
            waits=[]
            def ready(_):
                ledger=json.loads((Path(self.archive.name)/'.ai-runs/evaluation-partitions.json').read_text())
                self.assertFalse(any(record.get('consumedBy') for record in ledger['identities'].values()))
                self.assertTrue((Path(d)/'device-memory.json').exists())
                waits.append(True)
                allocation.write_text(json.dumps({'paused':False,'workers':2,'observedAt':time.time(),
                    'reason':'initial-conservative' if len(waits)==1 else 'usable'}))
            with patch('righelt_training.arena.time.sleep',side_effect=ready) as sleep:
                result=run_arena(path,d,{'candidate':None,'opponent':None},'cpu',player=lambda *a,**k:{'status':'unfinished','reason':'budget'})
            self.assertEqual(sleep.call_count,2);self.assertEqual(result['reason'],'budget')
            with self.assertRaises(FileExistsError):open_plan(path)

    def test_expiry_before_startup_readiness_does_not_consume_final(self):
        with tempfile.TemporaryDirectory() as d:
            path,runtime=self.frozen(d,'final')
            result=run_arena(path,d,{},'cpu',clock=lambda:runtime['deadlineMonotonic']+1)
            self.assertEqual(result['status'],'inconclusive')
            self.assertEqual(result['completedGames'],0)
            open_plan(path)  # Still sealed and usable in a separately approved run.

    def test_copy_or_refreeze_cannot_reopen_consumed_families(self):
        with tempfile.TemporaryDirectory() as d:
            path,_=self.frozen(d,'final');open_plan(path)
            copied=Path(d)/'copied.json';shutil.copy(path,copied)
            with self.assertRaises(FileExistsError):open_plan(copied)
            plan=json.loads(path.read_text())['plan']
            plan['candidate']['checkpointSha256']='c'*64
            plan['candidate']['profileVersion']='changed';plan['candidate']['profile']['simulations']=16
            altered=Path(d)/'changed-profile.json'
            with patch('righelt_training.arena.engine_command',side_effect=[{'initial':False,'fingerprint':str(i)} for i in range(50)]):freeze_plan(altered,plan)
            with self.assertRaises(FileExistsError):open_plan(altered)

    def test_opening_family_cannot_use_unrelated_normal_seed_split(self):
        with tempfile.TemporaryDirectory() as d:
            plan=self.plan('validation')
            train_root=next(simple_root(s) for s in range(1000) if partition_for_family(family_for_root(simple_root(s)))=='train')
            plan['pairs'][50]['initialState']=train_root
            with self.assertRaisesRegex(ValueError,'family belongs'):freeze_plan(Path(d)/'bad.json',plan)
            # An authoritative fingerprint previously frozen for final cannot
            # reappear in validation even if a defective provider returns it.
            self.frozen(d,'final')
            other=self.plan('validation')
            with patch('righelt_training.arena.engine_command',side_effect=[{'initial':False,'fingerprint':str(i)} for i in range(50)]):
                with self.assertRaisesRegex(ValueError,'across partitions'):freeze_plan(Path(d)/'validation.json',other)

    def test_expired_game_does_not_spawn_and_profile_cannot_override_deadline(self):
        with patch('righelt_training.arena.subprocess.Popen') as spawn:
            result=play_game({}, {},time.monotonic(),'cpu')
            self.assertEqual(result['status'],'unfinished');spawn.assert_not_called()
        with tempfile.TemporaryDirectory() as d:
            plan=self.plan();plan['candidate']['profile']['deadlineMs']=999999
            with patch('righelt_training.arena.engine_command',side_effect=[{'type':'opening-verified','initial':False,'fingerprint':str(i)} for i in range(50)]):
                with self.assertRaises(ValueError):freeze_plan(Path(d)/'plan.json',plan)

if __name__=='__main__':unittest.main()
