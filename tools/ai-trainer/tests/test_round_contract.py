import copy
import unittest
from datetime import datetime,timezone
from righelt_training.round_contract import validate_round,bound_runtime,require_round_match,validate_workload
from righelt_training.budget import Budget

def iso(t):return datetime.fromtimestamp(t,timezone.utc).isoformat()

class RoundContractTest(unittest.TestCase):
    def setUp(self):
        self.start=1000.;self.end=self.start+86400
        self.contract={'schema':1,'kind':'followup-round-24h-v1','executionStartedAt':iso(self.start),
            'deadline':iso(self.end),'phase':'pilot','phaseDeadline':iso(self.start+8*3600),
            'checkpointReserveSeconds':60}
        self.state={'followupTraining':{'executionStartedAt':iso(self.start),'deadline':iso(self.end)}}

    def test_contract_rejects_future_start_reset_or_expired_phase(self):
        for now in (self.start-1,self.start+8*3600):
            with self.assertRaises(ValueError):validate_round(self.contract,self.state,now)
        c={**self.contract,'deadline':iso(self.end+1)}
        with self.assertRaises(ValueError):validate_round(c,self.state,self.start)

    def test_main_must_leave_five_hours_for_evaluation_release(self):
        c={**self.contract,'phase':'main','phaseDeadline':iso(self.end-5*3600)}
        validate_round(c,self.state,self.start)
        with self.assertRaises(ValueError):validate_round({**c,'phaseDeadline':iso(self.end-5*3600+1)},self.state,self.start)

    def test_child_start_is_never_reset_and_deadline_is_clamped(self):
        runtime={'command':'training','startedMonotonic':10.,'deadlineMonotonic':100000.,'deadlineWall':self.end+1000}
        old=Budget(10.,100000.,self.end+1000)
        new=bound_runtime(runtime,old,self.contract,state=self.state,wall_now=self.start+60,monotonic_now=70.)
        self.assertEqual(new.started,10.)
        self.assertEqual(runtime['deadlineWall'],self.start+8*3600)
        self.assertEqual(runtime['reserveSeconds'],60)
        self.assertEqual(runtime['deadlineMonotonic'],70+8*3600-60)

    def test_resume_cannot_replace_phase_and_repeated_clamp_never_extends(self):
        runtime={'command':'training','startedMonotonic':10.,'deadlineMonotonic':100000.,'deadlineWall':self.end+1000}
        old=Budget(10.,100000.,self.end+1000)
        first=bound_runtime(runtime,old,self.contract,state=self.state,wall_now=self.start,monotonic_now=10.)
        deadline=runtime['deadlineMonotonic']
        again=bound_runtime(runtime,first,self.contract,state=self.state,wall_now=self.start+100,monotonic_now=110.)
        self.assertEqual(runtime['deadlineMonotonic'],deadline)
        self.assertEqual(again.started,10.)
        changed={**self.contract,'phaseDeadline':iso(self.start+7*3600)}
        with self.assertRaisesRegex(ValueError,'Resume changed'):bound_runtime(runtime,again,changed,state=self.state,wall_now=self.start+100,monotonic_now=110.)

    def test_resume_requires_original_contract_even_when_cli_omitted(self):
        with self.assertRaises(ValueError):require_round_match({'roundContract':self.contract},None)
        require_round_match({'roundContract':self.contract},copy.deepcopy(self.contract))

    def test_evaluation_and_handoff_do_not_allow_canary_updates(self):
        for phase in ('evaluation','handoff-proof'):
            c={**self.contract,'phase':phase}
            with self.assertRaises(ValueError):validate_workload(c,'canary')
        with self.assertRaises(ValueError):validate_workload({**self.contract,'phase':'evaluation'},'training')
        validate_workload({**self.contract,'phase':'handoff-proof'},'training')

    def test_persisted_anchor_survives_legacy_runtime_overwrite_and_wall_rollback(self):
        runtime={'command':'training','startedMonotonic':10.,'deadlineMonotonic':100000.,'deadlineWall':self.end}
        old=Budget(10.,100000.,self.end)
        first=bound_runtime(runtime,old,self.contract,state=self.state,wall_now=self.start+100,monotonic_now=110.,boot_identity=1)
        anchor=runtime['deadlineMonotonic']
        runtime.update(deadlineMonotonic=200000.,deadlineWall=self.end)
        bound_runtime(runtime,old,self.contract,state=self.state,wall_now=self.start+10,monotonic_now=200.,boot_identity=1)
        self.assertEqual(runtime['deadlineMonotonic'],anchor)
        with self.assertRaisesRegex(ValueError,'Reboot'):bound_runtime(runtime,old,self.contract,state=self.state,wall_now=self.start+10,monotonic_now=200.,boot_identity=2)

if __name__=='__main__':unittest.main()
