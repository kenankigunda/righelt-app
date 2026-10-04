import unittest
import tempfile
from pathlib import Path
from unittest.mock import patch
import test_arena
from righelt_training.arena import RESTART_WORKLOAD,freeze_plan,read_frozen_plan,run_arena,diagnostic_gate

class RestartDiagnosticTest(unittest.TestCase):
    setUp=test_arena.ArenaTest.setUp
    frozen=test_arena.ArenaTest.frozen
    player=test_arena.ArenaTest.player
    def plan(self,partition='validation'):
        plan=test_arena.ArenaTest.plan(self,partition)
        plan.update(purpose='incumbent',mode='diagnostic',workload=RESTART_WORKLOAD,decisionCache=False)
        plan['pairs']=plan['pairs'][:5]+plan['pairs'][50:55]
        return plan

    # Inherited legacy tests are tested in ArenaTest; this fixture deliberately
    # changes the workload and only the restart tests below apply here.
    def test_restart_80_percent_and_no_retries(self):
        with tempfile.TemporaryDirectory() as d:
            path,_=self.frozen(d);calls=[]
            def player(*args,**kwargs):
                calls.append(args[0]['id'])
                if len(calls)<=4:return {'status':'unfinished','reason':'node-limit'}
                return self.player(*args,**kwargs)
            models={'candidate':'candidate-model','opponent':'opponent-model'}
            report=run_arena(path,d,models,'cpu',player=player)
            self.assertEqual(len(calls),20);self.assertEqual(report['terminalGames'],16)
            self.assertTrue(report['diagnosticGatePassed']);self.assertFalse(report['strengthAcceptanceEligible'])
            report=run_arena(path,d,models,'cpu',player=lambda *a,**k:self.fail('retry'))
            self.assertTrue(report['diagnosticGatePassed'])

    def test_restart_not_terminal_or_not_attempted_does_not_pass(self):
        plan=self.plan();attempts=[{'pairId':p['id'],'candidateSeat':seat,'status':'completed'} for p in plan['pairs'] for seat in ('P1','P2')]
        records={str(i):{'outcome':'p1_win' if i<16 else 'truncated'} for i in range(20)}
        self.assertTrue(diagnostic_gate(plan,records,attempts)['diagnosticGatePassed'])
        self.assertFalse(diagnostic_gate(plan,records,attempts[:-1])['diagnosticGatePassed'])
        records['15']['outcome']='truncated'
        self.assertFalse(diagnostic_gate(plan,records,attempts)['diagnosticGatePassed'])

    def test_restart_constraints(self):
        with tempfile.TemporaryDirectory() as d:
            for field,value in [('partition','final'),('mode','strict'),('decisionCache',True)]:
                plan=self.plan();plan[field]=value
                with self.assertRaises(ValueError):freeze_plan(Path(d)/'bad.json',plan)
            plan=self.plan()
            with patch('righelt_training.arena.engine_command',side_effect=[{'initial':False,'fingerprint':str(i)} for i in range(5)]):
                freeze_plan(Path(d)/'good.json',plan)
            self.assertEqual(len(read_frozen_plan(Path(d)/'good.json')[0]['pairs']),10)

