import hashlib
import json
from pathlib import Path
import tempfile
import time
import unittest
from unittest.mock import patch
from righelt_training.prepare_arena import prepare, checkpoint_identity, PROFILE
from righelt_training.config import CONFIG_SHA256
from righelt_training.curriculum import simple_root, family_for_root
from righelt_training.replay import partition_for_family
from righelt_training.runner import engine_command
from righelt_training.supervisor import arena_arguments
from argparse import Namespace


class PrepareArenaTest(unittest.TestCase):
    def test_restart_preparation_cannot_reuse_strict_workload(self):
        with tempfile.TemporaryDirectory() as d:
            root,_,paths=self.setup_run(d)
            state=next(simple_root(s) for s in range(1000) if partition_for_family(family_for_root(simple_root(s)))=='validation')
            def generate(job,timeout):
                return {'type':'opening-generated','state':{**state,'turnIndex':job['seed']},'actions':[{'type':'pass'}],
                        'initial':False,'fingerprint':str(job['seed'])}
            with patch('righelt_training.arena.engine_command',side_effect=lambda job,timeout:{'initial':False,'fingerprint':str(job['state']['turnIndex'])}):
                strict=prepare(root,*paths,command=generate,experiment_root=root/'registry')
                diagnostic=prepare(root,*paths,command=generate,experiment_root=root/'registry',diagnostic=True)
            self.assertNotEqual(strict['planSha256'],diagnostic['planSha256'])
            plan=json.loads(Path(diagnostic['plan']).read_text())['plan']
            self.assertEqual(diagnostic['preparedPairs'],10)
            self.assertEqual(plan['mode'],'diagnostic');self.assertFalse(plan['decisionCache'])
            self.assertEqual(sum(p['kind']=='heldout' for p in plan['pairs']),5)

    def setup_run(self,d):
        root=Path(d);now=time.monotonic()
        runtime={'allocationId':'allocation','seed':107,'manifestSha256':'test','deadlineMonotonic':now+600}
        (root/'runtime.json').write_text(json.dumps(runtime))
        (root/'allocation.json').write_text(json.dumps({'paused':False,'workers':2,'observedAt':time.time(),'reason':'usable'}))
        paths=[]
        for name in ('candidate','opponent'):
            path=root/(name+'.pt');path.write_bytes(name.encode())
            path.with_suffix('.json').write_text(json.dumps({'sha256':hashlib.sha256(path.read_bytes()).hexdigest(),'configSha256':CONFIG_SHA256}))
            paths.append(path)
        return root,runtime,paths

    def test_complete_plan_freezes_checkpoints_profiles_and_opening_families(self):
        with tempfile.TemporaryDirectory() as d:
            root,runtime,paths=self.setup_run(d)
            state=next(simple_root(s) for s in range(1000) if partition_for_family(family_for_root(simple_root(s)))=='validation')
            def generate(job,timeout):
                self.assertLessEqual(timeout,5)
                return {'type':'opening-generated','state':{**state,'turnIndex':job['seed']},'actions':[{'type':'pass'}], 'initial':False,'fingerprint':str(job['seed'])}
            with patch('righelt_training.arena.engine_command',side_effect=lambda job,timeout:{'initial':False,'fingerprint':str(job['state']['turnIndex'])}):
                result=prepare(root,*paths,command=generate,experiment_root=root/'registry')
            self.assertEqual(result['status'],'completed')
            plan=json.loads(Path(result['plan']).read_text())['plan']
            self.assertEqual(plan['partition'],'validation');self.assertEqual(plan['purpose'],'incumbent')
            self.assertEqual(plan['candidate']['profile'],PROFILE);self.assertEqual(plan['opponent']['profile'],PROFILE)
            self.assertEqual(len(plan['pairs']),100)
            self.assertTrue(all(partition_for_family(p['familyId'])=='validation' for p in plan['pairs']))
            self.assertEqual(len({p['openingFingerprint'] for p in plan['pairs'][50:]}),50)
            self.assertEqual(json.loads((root/'runtime.json').read_text()),runtime)
            runtime['deadlineMonotonic']+=10;runtime['manifestSha256']='repaired-source'
            (root/'runtime.json').write_text(json.dumps(runtime))
            with patch('righelt_training.prepare_arena.engine_command',side_effect=AssertionError('must reuse plan')):
                resumed=prepare(root,*paths,command=lambda *a,**k:self.fail('must not regenerate'),experiment_root=root/'registry')
            self.assertEqual(resumed['planSha256'],result['planSha256'])

    def test_expiry_is_explicit_and_no_work_starts(self):
        with tempfile.TemporaryDirectory() as d:
            root,runtime,paths=self.setup_run(d)
            result=prepare(root,*paths,clock=lambda:runtime['deadlineMonotonic'],command=lambda *a,**k:self.fail('expired'))
            self.assertEqual(result['status'],'inconclusive');self.assertNotIn('plan',result)
            self.assertEqual(json.loads((root/'prepare-arena-result.json').read_text())['status'],'inconclusive')
            self.assertTrue((root/'device-memory.json').exists())

    def test_partial_generation_resumes_and_checkpoint_tampering_rejected(self):
        with tempfile.TemporaryDirectory() as d:
            root,runtime,paths=self.setup_run(d);now=[time.monotonic()]
            def timeout(job,timeout):
                now[0]=runtime['deadlineMonotonic']-10
                raise TimeoutError('bounded generation')
            result=prepare(root,*paths,clock=lambda:now[0],command=timeout)
            self.assertEqual(result['status'],'inconclusive');self.assertEqual(result['preparedPairs'],50)
            state=json.loads(Path(result['progress']).read_text())
            self.assertGreater(state['nextSeed'],state['pairs'][-1]['seed'])
            validation_root=next(simple_root(s) for s in range(1000) if partition_for_family(family_for_root(simple_root(s)))=='validation')
            seeds=[]
            def resume(job,timeout):
                seeds.append(job['seed'])
                return {'type':'opening-generated','state':{**validation_root,'turnIndex':job['seed']},
                        'actions':[{'type':'pass'}],'initial':False,'fingerprint':str(job['seed'])}
            with patch('righelt_training.arena.engine_command',side_effect=lambda job,timeout:{'initial':False,'fingerprint':str(job['state']['turnIndex'])}):
                resumed=prepare(root,*paths,command=resume,experiment_root=root/'registry')
            self.assertEqual(resumed['status'],'completed')
            self.assertEqual(seeds[0],state['nextSeed']);self.assertEqual(len(seeds),50)
            paths[0].write_bytes(b'changed')
            with self.assertRaises(ValueError):checkpoint_identity(paths[0])

    def test_supervisor_preparation_requires_original_run_and_exclusive_phase(self):
        with tempfile.TemporaryDirectory() as d:
            root,_,paths=self.setup_run(d)
            args=Namespace(run_dir=root,resume=paths[0],prepare_arena=True,arena_plan=None,health=False,
                           candidate_checkpoint=paths[0],opponent_checkpoint=paths[1])
            self.assertIsNone(arena_arguments(args,root))
            for field,value in [('health',True),('arena_plan',root/'plan.json'),('resume',None),('opponent_checkpoint',None)]:
                previous=getattr(args,field);setattr(args,field,value)
                with self.assertRaises(ValueError):arena_arguments(args,root)
                setattr(args,field,previous)

    def test_real_engine_generated_opening_replays_exactly(self):
        opening=engine_command({'command':'generate-opening','seed':107,'budgetMs':3000},timeout=4)
        self.assertEqual(opening['type'],'opening-generated')
        proof=engine_command({'command':'validate-opening','state':opening['state'],'actions':opening['actions'],'budgetMs':3000},timeout=4)
        self.assertEqual(proof['fingerprint'],opening['fingerprint'])

if __name__=='__main__':unittest.main()
