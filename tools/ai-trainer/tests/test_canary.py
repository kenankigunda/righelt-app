from contextlib import nullcontext
import hashlib
import json
from pathlib import Path
import subprocess
import tempfile
import time
import unittest
from unittest.mock import Mock,patch
import torch
from righelt_training.canary import canary_roots,train_and_recover,run,main
from righelt_training.curriculum import family_for_root
from righelt_training.replay import partition_for_family
from righelt_training.model import PolicyValueNet
from righelt_training.runner_monitor import RunnerMonitor
from righelt_training.config import ROOT
from righelt_training.checkpoint import atomic_json

class CanaryTest(unittest.TestCase):
    def setUp(self):torch.set_num_threads(1)
    def test_generated_roots_are_train_only_and_have_authoritative_immediate_wins(self):
        roots=list(canary_roots())[:2];self.assertEqual(len(roots),2)
        for state,family in roots:
            self.assertEqual(family,family_for_root(state));self.assertEqual(partition_for_family(family),'train')
        script="""
import{normalizeState,resolveToStability}from'./packages/game-engine/src/index.ts';
import{legalActionMap,transition,terminalValue}from'./packages/computer-player/src/index.ts';
let input='';for await(const chunk of process.stdin)input+=chunk;
console.log(JSON.stringify(JSON.parse(input).map(raw=>{
 const state=resolveToStability(normalizeState(raw));
 return {ongoing:state.outcome.status==='ongoing',wins:[...legalActionMap(state).values()].filter(a=>terminalValue(transition(state,a))===1).length};
})));
"""
        result=subprocess.run(['node','--import','tsx','--input-type=module','-e',script],cwd=ROOT,input=json.dumps([state for state,_ in roots]),text=True,capture_output=True,check=True,timeout=10)
        for proof in json.loads(result.stdout):self.assertTrue(proof['ongoing']);self.assertGreater(proof['wins'],0)

    def test_cpu_toy_two_updates_recover_optimizer_rng_without_production_artifacts(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);attempt=root/'canaries'/'toy';attempt.mkdir(parents=True)
            positions=[{'encoded':[0.0]*4600,'legal':[0,2800],'policy':[{'index':0,'probability':1.0}],
                        'terminalValue':1.0,'terminalMask':True}]
            with RunnerMonitor(root,query=lambda:0) as monitor:
                _,report=train_and_recover(attempt,PolicyValueNet(),positions,[],'toy','cpu',time.monotonic()+90,monitor)
            self.assertEqual(report['updates'],2);self.assertTrue(report['recoveryPassed'])
            self.assertTrue(all(row['parameterDelta']>0 for row in report['batches']))
            self.assertFalse((root/'latest.json').exists());self.assertFalse((root/'checkpoints').exists());self.assertFalse((root/'games').exists())

    def test_expired_canary_is_inconclusive_and_does_not_invoke_generator(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);atomic_json(root/'runtime.json',{'deadlineMonotonic':time.monotonic()-1})
            generator=Mock(side_effect=AssertionError('no self-play'))
            with patch('righelt_training.runner_monitor.torch.backends.mps.is_available',return_value=False):
                report=run(root,root/'unused.json',device='cpu',generator=generator)
            self.assertFalse(report['passed']);self.assertFalse(report['complete']);generator.assert_not_called()
            self.assertFalse(report['countsTowardHealth']);self.assertFalse((root/'latest.json').exists())

    def test_unsupervised_cli_cannot_launch(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);atomic_json(root/'runtime.json',{'command':'training'})
            with patch('sys.argv',['canary','--run-dir',str(root),'--corpus',str(root/'corpus.json')]),patch('righelt_training.canary.run') as launch:
                with self.assertRaises(ValueError):main()
                launch.assert_not_called()

    def test_cpu_toy_orchestration_remains_disposable_and_cannot_pass_mps_gate(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);corpus=root/'corpus.json';corpus.write_text('{}')
            atomic_json(root/'runtime.json',{'deadlineMonotonic':time.monotonic()+120,
                'parityCorpusSha256':hashlib.sha256(corpus.read_bytes()).hexdigest()})
            atomic_json(root/'manifest.json',{'sha256':'toy','manifest':{}})
            atomic_json(root/'allocation.json',{'paused':False,'workers':2,'reason':'usable'})
            def generator(job,*args):
                return {**job,'termination':'terminal','outcome':{'status':'p1_win'},'decisions':[
                    {'encoded':[0.0]*4600,'legal':[0,2800],'policy':[{'index':0,'probability':1.0}]}]}
            with patch('righelt_training.canary.verify_game'),patch('righelt_training.canary.verify_corpus',return_value=[{'encoded':[0.0]*4600}]*1000),patch('righelt_training.canary.export_onnx'),patch('righelt_training.canary.RunnerMonitor',side_effect=lambda directory:RunnerMonitor(directory,query=lambda:0)):
                report=run(root,corpus,device='cpu',generator=generator,checker=lambda *a,**k:{'numericPassed':True,'maxAbsoluteError':[0.,0.]})
            self.assertTrue(report['complete'],report);self.assertFalse(report['passed'])
            self.assertEqual(report['terminalGames'],2);self.assertEqual(report['updates'],2);self.assertEqual(report['parityStates'],1000)
            self.assertFalse((root/'latest.json').exists());self.assertFalse((root/'checkpoints').exists());self.assertFalse((root/'games').exists())

if __name__=='__main__':unittest.main()
