import json
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
import unittest
from righelt_training.stage import execute


class StageTests(unittest.TestCase):
    def run_case(self,fail=None,healthy=True,resume=False,repeat=False):
        with TemporaryDirectory() as tmp:
            root=Path(tmp);run=root/'run';calls=[]
            args=SimpleNamespace(run_dir=run,activity_file=root/'activity',gate_report=root/'gates',parity_corpus=root/'corpus',stage='initial',seed=107,resume=root/'old.pt' if resume else None)
            args.gate_report.write_text(json.dumps({'sourceRevision':'test'}))
            def invoke(argv):
                calls.append(argv);run.mkdir(exist_ok=True)
                (run/'supervisor-result.json').write_text(json.dumps({'reason':'runner-failed' if len(calls)==fail else 'completed'}))
                (run/'canary-report.json').write_text(json.dumps({'passed':True}))
                (run/'runner-result.json').write_text(json.dumps({'reason':'validation-handoff'}))
                (run/'latest.json').write_text(json.dumps({'checkpoint':str(run/'latest.pt')}))
                (run/'trained-export-parity.json').write_text(json.dumps({'complete':True,'numericPassed':True}))
                (run/'health-report.json').write_text(json.dumps({'complete':True,'healthy':healthy,'checkpoints':[{'path':str(run/'latest.pt'),'weightsSha256':'new'},{'path':str(run/'first.pt'),'weightsSha256':'old'}]}))
                (run/'prepare-arena-result.json').write_text(json.dumps({'status':'completed','plan':str(run/'plan.json')}))
            result=execute(args,invoke)
            if repeat:
                calls.clear();result=execute(args,invoke)
            return result,calls

    def test_one_allocation_all_phases(self):
        result,calls=self.run_case()
        self.assertEqual(result['status'],'phases-finished');self.assertEqual(len(calls),6)
        self.assertNotIn('--resume',calls[0])
        for command in calls:
            self.assertEqual(command[command.index('--stage')+1],'initial')
        self.assertIn('--export-parity',calls[2]);self.assertIn('--health',calls[3])
        self.assertIn('--prepare-arena',calls[4]);self.assertIn('--arena-plan',calls[5])
        for command in calls[2:]:self.assertIn('--resume',command)

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
