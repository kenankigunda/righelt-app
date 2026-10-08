import json,hashlib,subprocess,sys
from contextlib import nullcontext
from righelt_training.allocation import Allocation,append
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
import unittest
from unittest.mock import patch
from righelt_training.stage import execute


class StageTests(unittest.TestCase):
    def run_case(self,fail=None,healthy=True,resume=False,repeat=False,incomplete_arena=False,diagnostic=False,continuation=False,arena_reason='budget',exhausted_process=False,development=False,phase='six-hour',tamper_finished=False,checkpoint_count=2):
        with TemporaryDirectory() as tmp:
            root=Path(tmp);run=root/'run';calls=[]
            args=SimpleNamespace(run_dir=run,activity_file=root/'activity',gate_report=root/'gates',parity_corpus=root/'corpus',stage='initial',seed=107,resume=root/'old.pt' if resume else None)
            args.gate_report.write_text(json.dumps({'sourceRevision':'test'}))
            if development:
                args.development_cases=root/'development-cases.json';args.development_cases.write_text('{}')
            if continuation:
                args.continuation=root/'contract.json'
                args.continuation.write_text(json.dumps({'sequenceId':'approved','phase':phase,'recoveryCheckpoint':str(root/'old.pt')}))
            if exhausted_process:
                run.mkdir();allocation=Allocation(root,run);allocation.create('initial')
            def invoke(argv):
                if exhausted_process and '--prepare-arena' in argv:
                    interval,_,_=allocation.begin('simulated-last-computation')
                    append(allocation.path,{'event':'finished','allocation':allocation.key,'id':interval['id'],'chargedSeconds':21600,'reason':'completed'})
                    code="from pathlib import Path; import sys; from righelt_training.allocation import Allocation; from righelt_training.supervisor import begin_phase; p=Path(sys.argv[1]); assert begin_phase(Allocation(p.parent,p),'prepare-arena',p,'test') is None"
                    subprocess.run([sys.executable,'-c',code,str(run)],check=True,timeout=10)
                    calls.append(argv);return
                calls.append(argv);run.mkdir(exist_ok=True)
                (run/'supervisor-result.json').write_text(json.dumps({'reason':'runner-failed' if len(calls)==fail else 'completed'}))
                (run/'canary-report.json').write_text(json.dumps({'passed':True}))
                (run/'runner-result.json').write_text(json.dumps({'reason':'validation-handoff'}))
                (run/'latest.pt').write_bytes(b'trained')
                (run/'latest.json').write_text(json.dumps({'checkpoint':str(run/'latest.pt'),'sha256':hashlib.sha256(b'trained').hexdigest()}))
                (run/'trained-export-parity.json').write_text(json.dumps({'complete':True,'numericPassed':True}))
                if development and '--export-parity' in argv:
                    proof=run/'dev-proof.json';report=run/'dev-report.json'
                    proof.write_text(json.dumps({'complete':False}));report.write_text(json.dumps({'status':'incomplete'}))
                    (run/'development-latest.json').write_text(json.dumps({'complete':False,'reason':'budget',
                        'casesSha256':hashlib.sha256(args.development_cases.read_bytes()).hexdigest(),
                        'proof':str(proof),'proofSha256':hashlib.sha256(proof.read_bytes()).hexdigest(),
                        'report':str(report),'reportSha256':hashlib.sha256(report.read_bytes()).hexdigest()}))
                (run/'health-report.json').write_text(json.dumps({'complete':True,'healthy':healthy,'checkpoints':[{'path':str(run/'latest.pt'),'weightsSha256':'new'},{'path':str(run/'first.pt'),'weightsSha256':'old'}][:checkpoint_count]}))
                (run/'prepare-arena-result.json').write_text(json.dumps({'status':'completed','plan':str(run/'plan.json'),'planSha256':'frozen'}))
                proof=run/'evaluations'/'frozen';proof.mkdir(parents=True,exist_ok=True)
                (proof/'report.json').write_text(json.dumps({'mode':'diagnostic' if diagnostic else 'strict','reason':arena_reason if incomplete_arena else 'completion evidence incomplete','status':'inconclusive' if incomplete_arena else 'completed','completePairs':99 if incomplete_arena else 100,'completedGames':198 if incomplete_arena else 200,'identity':{'planSha256':'frozen'}}))
            with (nullcontext() if exhausted_process else patch('righelt_training.stage.remaining_budget',return_value=500)):result=execute(args,invoke)
            if repeat:
                if tamper_finished:
                    (run/'stage-result.json').write_text('{}')
                calls.clear()
                with (nullcontext() if exhausted_process else patch('righelt_training.stage.remaining_budget',return_value=500)):result=execute(args,invoke)
            return result,calls

    def test_eight_hour_result_is_terminal_without_repeating_final_work(self):
        for healthy in (True,False):
            result,calls=self.run_case(continuation=True,phase='eight-hour',healthy=healthy,repeat=True)
            self.assertTrue(result['experimentComplete']);self.assertEqual(calls,[])
            self.assertFalse(result['advancementEligible']);self.assertFalse(result['continuationAllowed'])
            self.assertEqual(result['health']['healthy'],healthy)
        for healthy in (True,False):
            result,calls=self.run_case(continuation=True,phase='eight-hour',healthy=healthy,incomplete_arena=True,repeat=True)
            self.assertTrue(result['experimentComplete']);self.assertEqual(calls,[])
        result,calls=self.run_case(continuation=True,phase='eight-hour',healthy=False)
        self.assertTrue(any('--arena-plan' in c for c in calls))
        self.assertFalse(result['healthPassed'])

    def test_finished_eight_hour_report_cannot_be_changed_then_reentered(self):
        with self.assertRaisesRegex(ValueError,'evidence changed'):
            self.run_case(continuation=True,phase='eight-hour',repeat=True,tamper_finished=True)

    def test_eight_hour_zero_or_one_new_checkpoint_is_reported_honestly(self):
        result,calls=self.run_case(continuation=True,phase='eight-hour',healthy=False,checkpoint_count=0)
        self.assertTrue(result['experimentComplete']);self.assertFalse(result['healthPassed'])
        self.assertEqual(result['strengthEvaluation']['reason'],'no-fresh-trained-candidate')
        self.assertFalse(any('--arena-plan' in c for c in calls))
        result,calls=self.run_case(continuation=True,phase='eight-hour',healthy=False,checkpoint_count=0,repeat=True)
        self.assertEqual(calls,[]);self.assertTrue(result['experimentComplete'])
        result,calls=self.run_case(continuation=True,phase='eight-hour',healthy=False,checkpoint_count=1)
        self.assertTrue(any('--arena-plan' in c for c in calls));self.assertTrue(result['experimentComplete'])

    def test_eight_hour_correctness_failure_is_not_a_completed_experiment(self):
        result,_=self.run_case(continuation=True,phase='eight-hour',incomplete_arena=True,arena_reason='correctness-failure')
        self.assertFalse(result['experimentComplete']);self.assertFalse(result['advancementEligible'])

    def test_exhausted_supervisor_result_and_crash_resume_preserve_health(self):
        result,calls=self.run_case(continuation=True,exhausted_process=True)
        self.assertTrue(result['advancementEligible'])
        self.assertIn('budget-exhausted-before-phase',result['reason'])
        result,calls=self.run_case(continuation=True,exhausted_process=True,repeat=True)
        self.assertTrue(result['advancementEligible']);self.assertEqual(calls,[])

    def test_one_allocation_all_phases(self):
        result,calls=self.run_case()
        self.assertEqual(result['status'],'phases-finished');self.assertEqual(len(calls),6)
        self.assertNotIn('--resume',calls[0])
        for command in calls:
            self.assertEqual(command[command.index('--stage')+1],'initial')
        self.assertIn('--export-parity',calls[2]);self.assertIn('--health',calls[3])
        self.assertIn('--prepare-arena',calls[4]);self.assertIn('--arena-plan',calls[5])
        for command in calls[2:]:self.assertIn('--resume',command)

    def test_optional_development_check_uses_export_only_and_partial_does_not_block_health(self):
        result,calls=self.run_case(development=True)
        self.assertEqual(result['status'],'phases-finished')
        self.assertEqual(result['developmentObservation']['status'],'incomplete')
        self.assertEqual(sum('--development-cases' in command for command in calls),1)
        self.assertIn('--development-cases',calls[2])
        _,calls=self.run_case(development=True,repeat=True)
        self.assertEqual(calls,[])

    def test_healthy_continuation_allows_inconclusive_strength_only(self):
        result,calls=self.run_case(continuation=True,incomplete_arena=True)
        self.assertTrue(result['advancementEligible']);self.assertEqual(result['phase'],'six-hour')
        self.assertFalse(any('--canary' in c for c in calls))
        self.assertTrue(all('--continuation' in c for c in calls))
        result,_=self.run_case(continuation=True,incomplete_arena=True,arena_reason='correctness-failure')
        self.assertFalse(result['advancementEligible'])
        result,_=self.run_case(continuation=True,healthy=False)
        self.assertFalse(result.get('advancementEligible',False))

    def test_failure_never_restarts_or_advances(self):
        for phase in range(1,7):
            result,calls=self.run_case(fail=phase)
            self.assertEqual(result['status'],'inconclusive');self.assertEqual(len(calls),phase)

    def test_unhealthy_stops_before_arena(self):
        result,calls=self.run_case(healthy=False)
        self.assertEqual(len(calls),4);self.assertEqual(result['reason'],'pipeline health gate unmet')

    def test_explicit_resume_preserved(self):
        _,calls=self.run_case(resume=True)
        self.assertIn('--resume',calls[1])

    def test_completed_phases_are_not_reentered_on_resume(self):
        result,calls=self.run_case(repeat=True)
        self.assertEqual(result['status'],'phases-finished');self.assertEqual(calls,[])

    def test_interrupted_export_resumes_export_without_training(self):
        _,calls=self.run_case(fail=3,repeat=True)
        self.assertIn('--export-parity',calls[0])
        self.assertFalse(any('--canary' in command for command in calls))

    def test_unfinished_arena_is_reentered(self):
        result,calls=self.run_case(incomplete_arena=True,repeat=True)
        self.assertEqual(result["status"],"inconclusive")
        self.assertEqual(len(calls),1)
        self.assertIn("--arena-plan",calls[0])

    def test_complete_diagnostic_cannot_substitute_for_learning_evaluation(self):
        result,_=self.run_case(diagnostic=True)
        self.assertEqual(result['status'],'inconclusive')
        self.assertIn('completion evidence incomplete',result['reason'])
