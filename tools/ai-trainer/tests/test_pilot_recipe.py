"""Model-free contracts for fresh replay, fixed teachers and update accounting."""
import ast
from contextlib import nullcontext
import copy
import gzip
import hashlib
import json
from pathlib import Path
import subprocess
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import Mock
from righelt_training.pilot_recipe import checked_recipe,teaching_job,recipe_hash,finite_new_updates,DEFINITION,DEFINITION_SHA256,curriculum_slot
from righelt_training.config import ROOT


def recipe():
    return {'schema':1,'kind':'followup-teaching-v1','definitionSha256':DEFINITION_SHA256,
            'pretrainRounds':16,'curriculum':DEFINITION['curriculum'],
            'teacher':{'path':'/frozen/baseline.pt','sha256':'a'*64,'manifestSha256':'b'*64}}


class PilotRecipeTest(unittest.TestCase):
    def test_recipe_and_teacher_identity_are_explicit(self):
        value=recipe();checked_recipe(value)
        for change in ({'pretrainRounds':0},{'pretrainRounds':33},{'pretrainRounds':True},
                       {'definitionSha256':'c'*64},{'teacher':None},{'curriculum':{'normal':100}}):
            with self.assertRaises(ValueError):checked_recipe({**value,**change})
        self.assertNotEqual(recipe_hash(value),recipe_hash({**value,'pretrainRounds':8}))

    def test_each_curriculum_slot_sees_every_teacher_role(self):
        by_slot={}
        for index in range(16):
            job=teaching_job(recipe(),index,'learner-checkpoint')
            by_slot.setdefault(index%4,set()).add(tuple(job['roles'].values()))
            self.assertEqual(job['models']['teacher'],'a'*64)
        self.assertTrue(all(len(roles)==4 for roles in by_slot.values()))
        self.assertEqual([curriculum_slot(i)for i in range(4)],['production','normal','normal','contact'])

    def test_python_jobs_match_actual_javascript_validator(self):
        jobs=[teaching_job(recipe(),i,'learner-checkpoint')for i in range(16)]
        script="import {validateTeaching,teachingDecision}from './tools/ai-trainer/training-teaching.mjs';let raw='';for await(const x of process.stdin)raw+=x;for(const job of JSON.parse(raw)){validateTeaching(job);for(const seat of['P1','P2'])if(teachingDecision(job,seat).modelVersion!==job.models[job.roles[seat]])throw Error('Wrong teacher model');}console.log('ok');"
        output=subprocess.run(['/opt/homebrew/opt/node@22/bin/node','--input-type=module','-e',script],input=json.dumps(jobs),capture_output=True,text=True,cwd=ROOT,timeout=10,check=True)
        self.assertEqual(output.stdout.strip(),'ok')

    def test_new_updates_exclude_inherited_optimizer_steps(self):
        self.assertTrue(finite_new_updates({'updates':15451,'inheritedUpdates':15448,'nonzeroUpdates':3}))
        self.assertTrue(finite_new_updates({'updates':3,'nonzeroUpdates':3}))
        self.assertFalse(finite_new_updates({'updates':15448,'inheritedUpdates':15448,'nonzeroUpdates':0}))
        self.assertFalse(finite_new_updates({'updates':15451,'inheritedUpdates':15448,'nonzeroUpdates':15451}))
        with self.assertRaises(ValueError):finite_new_updates({'updates':2,'inheritedUpdates':3,'nonzeroUpdates':0})

    def test_actual_inference_router_uses_frozen_teacher_only_for_teacher_seat(self):
        source=ROOT/'tools/ai-trainer/righelt_training/runner.py'
        cls=next(n for n in ast.parse(source.read_text()).body if isinstance(n,ast.ClassDef)and n.name=='Runner')
        method=next(n for n in cls.body if isinstance(n,ast.FunctionDef)and n.name=='_infer')
        class Tensor:
            def __init__(self,value):self.value=value
            def reshape(self,*_):return self
            def all(self):return True
            def cpu(self):return self
            def tolist(self):return self.value
        learner=Mock(return_value=(Tensor([[11]]),Tensor([.1])))
        teacher=Mock(return_value=(Tensor([[22]]),Tensor([.2])))
        torch=SimpleNamespace(inference_mode=nullcontext,tensor=lambda value,**_:Tensor(value),float32='float',isfinite=lambda _:Tensor(True))
        namespace={'torch':torch,'time':SimpleNamespace(monotonic=lambda:100.),'CONFIG':{'inputPlanes':46,'boardSize':10},'json':json}
        exec(compile(ast.Module(body=[method],type_ignores=[]),str(source),'exec'),namespace)
        job={'teaching':teaching_job(recipe(),1,'learner')}
        first=SimpleNamespace(stdin=Mock());second=SimpleNamespace(stdin=Mock())
        requests=[({'process':first,'job':job},{'id':1,'modelSeat':'P1','input':[0]}),({'process':second,'job':job},{'id':2,'modelSeat':'P2','input':[0]})]
        self_obj=SimpleNamespace(inference_bound=30.,device='fake',model=learner,teacher=teacher,report_device_memory=Mock(),event=Mock())
        self.assertTrue(namespace['_infer'](self_obj,requests,200.))
        self.assertEqual(json.loads(first.stdin.write.call_args.args[0])['policyLogits'],[22])
        self.assertEqual(json.loads(second.stdin.write.call_args.args[0])['policyLogits'],[11])
        self.assertEqual(learner.call_count,1);self.assertEqual(teacher.call_count,1)

    def test_actual_warm_learning_rate_changes_once_and_is_verified_on_resume(self):
        source=ROOT/'tools/ai-trainer/righelt_training/runner.py'
        cls=next(n for n in ast.parse(source.read_text()).body if isinstance(n,ast.ClassDef)and n.name=='Runner')
        method=next(n for n in cls.body if isinstance(n,ast.FunctionDef)and n.name=='configure_pilot_learning_rate')
        namespace={'DEFINITION':DEFINITION}
        exec(compile(ast.Module(body=[method],type_ignores=[]),str(source),'exec'),namespace)
        obj=SimpleNamespace(state={},manifest={'manifest':{'warmStart':{}}},optimizer=SimpleNamespace(param_groups=[{'lr':.001}]))
        obj.manifest['manifest']['warmStart']={'path':'parent'}
        configure=namespace['configure_pilot_learning_rate'];configure(obj)
        self.assertEqual(obj.optimizer.param_groups[0]['lr'],.0001)
        configure(obj)
        obj.optimizer.param_groups[0]['lr']=.001
        with self.assertRaisesRegex(ValueError,'Recovered optimizer'):configure(obj)

    def seed_method(self,inspect):
        source=ROOT/'tools/ai-trainer/righelt_training/runner.py'
        cls=next(n for n in ast.parse(source.read_text()).body if isinstance(n,ast.ClassDef)and n.name=='Runner')
        method=next(n for n in cls.body if isinstance(n,ast.FunctionDef)and n.name=='seed_replay')
        namespace={'Path':Path,'hashlib':hashlib,'gzip':gzip,'json':json,'inspect_checkpoint':inspect}
        exec(compile(ast.Module(body=[method],type_ignores=[]),str(source),'exec'),namespace)
        return namespace['seed_replay']

    def test_actual_fresh_initializer_imports_replay_without_loading_parent_weights(self):
        with tempfile.TemporaryDirectory()as folder:
            root=Path(folder);checkpoint=root/'checkpoints/base.pt';checkpoint.parent.mkdir();checkpoint.write_bytes(b'opaque-parent')
            archive=root/'game.json.gz'
            with gzip.open(archive,'wt')as stream:json.dump({'id':'verified-game'},stream)
            binding={'path':str(checkpoint),'sha256':hashlib.sha256(checkpoint.read_bytes()).hexdigest(),'manifestSha256':'b'*64}
            learner=object();optimizer=object();buffer=SimpleNamespace(positions=[1],append=Mock())
            self_obj=SimpleNamespace(pilot_recipe={**recipe(),'teacher':binding},manifest={'manifest':{}},buffer=buffer,state={'archives':[],'updates':0,'nonzeroUpdates':0},operation=lambda *_:nullcontext(),model=learner,optimizer=optimizer)
            inspect=Mock(return_value={'recovery':{'state':{'archives':[str(archive)]}}})
            self.seed_method(inspect)(self_obj,binding)
            self.assertIs(self_obj.model,learner);self.assertIs(self_obj.optimizer,optimizer)
            self.assertEqual(self_obj.state['updates'],0);self.assertEqual(self_obj.state['nonzeroUpdates'],0)
            self.assertEqual(self_obj.state['initialReplayRoundsRemaining'],16)
            self.assertEqual(self_obj.state['phase'],'training')
            buffer.append.assert_called_once_with({'id':'verified-game'})
            self.assertTrue(inspect.call_args.kwargs['require_recovery'])

if __name__=='__main__':unittest.main()
