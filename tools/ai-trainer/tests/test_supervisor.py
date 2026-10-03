import json
import tempfile
import sys
import time
from pathlib import Path
import unittest
from righelt_training.supervisor import supervise,validate_gate_report,claim_stage,arena_arguments,request_validation_handoff,validation_boundary,validate_training_window
from righelt_training.processes import start_group
from righelt_training.budget import Budget
from righelt_training.resources import AdaptivePolicy,Sample,GIB
from righelt_training.config import CONFIG_SHA256

class QuietTelemetry:
    def sample(self):
        now=time.time()
        return Sample(now,None,None,0,'normal',GIB,40*GIB,500*GIB,0)

class SupervisorTest(unittest.TestCase):
    def test_automatic_handoff_uses_original_boundary_once(self):
        with tempfile.TemporaryDirectory() as d:
            runtime={'startedMonotonic':100,'deadlineMonotonic':21700,'command':'training','manifestSha256':'manifest'}
            self.assertEqual(validation_boundary(runtime),18100)
            self.assertFalse(request_validation_handoff(d,runtime,18099))
            self.assertTrue(request_validation_handoff(d,runtime,18100))
            path=Path(d)/'handoff-request.json';first=path.read_bytes();mtime=path.stat().st_mtime_ns
            self.assertEqual(json.loads(first)['reason'],'validation')
            self.assertFalse(request_validation_handoff(d,runtime,18101))
            self.assertEqual(path.read_bytes(),first);self.assertEqual(path.stat().st_mtime_ns,mtime)
            # Resuming does not create a new training window or rewrite the request.
            with self.assertRaisesRegex(ValueError,'training window ended'):validate_training_window(runtime,18101)
            validate_training_window(runtime,18099)
            overnight={**runtime,'deadlineMonotonic':43300}
            self.assertEqual(validation_boundary(overnight),36100)
            for phase in ('health','arena','prepare-arena'):
                other={**runtime,'command':phase}
                validate_training_window(other,20000)
                self.assertFalse(request_validation_handoff(d,other,20000))

    def test_pending_manual_handoff_is_preserved_but_consumed_marker_cannot_disable_reserve(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);runtime={'startedMonotonic':0,'deadlineMonotonic':600,'command':'training','manifestSha256':'manifest'}
            path=root/'handoff-request.json';manual={'schema':1,'id':'manual','reason':'reporting','manifestSha256':'manifest'}
            path.write_text(json.dumps(manual));original=path.read_bytes()
            self.assertFalse(request_validation_handoff(root,runtime,500));self.assertEqual(path.read_bytes(),original)
            checkpoint=root/'checkpoint.pt'
            (root/'latest.json').write_text(json.dumps({'checkpoint':str(checkpoint)}))
            checkpoint.with_suffix('.runner.json').write_text(json.dumps({'state':{'lastHandoffId':'manual'}}))
            self.assertTrue(request_validation_handoff(root,runtime,501))
            self.assertNotEqual(json.loads(path.read_text())['id'],'manual')
            self.assertFalse(request_validation_handoff(root,runtime,502))

    def test_watchdog_requests_handoff_without_coordinator(self):
        from unittest.mock import Mock,patch
        with tempfile.TemporaryDirectory() as d:
            now=[499.9];process=Mock(pid=123,returncode=0)
            process.poll.side_effect=[None,None,0]
            runtime={'startedMonotonic':0,'deadlineMonotonic':600,'command':'training','manifestSha256':'manifest'}
            with patch('righelt_training.supervisor.stop_group'):
                result=supervise(process,Budget(0,600),AdaptivePolicy(),QuietTelemetry(),Path(d),
                    clock=lambda:now[0],sleep=lambda seconds:now.__setitem__(0,now[0]+seconds),runtime=runtime)
            self.assertEqual(result,'completed');self.assertTrue((Path(d)/'handoff-request.json').exists())

    def test_blocked_training_cannot_consume_validation_reserve(self):
        from unittest.mock import Mock,patch
        with tempfile.TemporaryDirectory() as d:
            process=Mock(pid=123);process.poll.return_value=None
            runtime={'startedMonotonic':0,'deadlineMonotonic':600,'command':'training','manifestSha256':'manifest'}
            with patch('righelt_training.supervisor.stop_group') as stop:
                result=supervise(process,Budget(0,600),AdaptivePolicy(),QuietTelemetry(),Path(d),clock=lambda:560,runtime=runtime)
            self.assertEqual(result,'validation-handoff-timeout');self.assertTrue(stop.called)

    def test_arena_cannot_claim_fresh_budget_or_external_checkpoint(self):
        from argparse import Namespace
        from unittest.mock import patch
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);run=root/'run';run.mkdir()
            args=Namespace(arena_plan=run/'plan.json',run_dir=run,resume=None,candidate_checkpoint=root/'a.pt',opponent_checkpoint=root/'b.pt')
            with self.assertRaises(ValueError):arena_arguments(args,root)
            args.resume=root/'a.pt';args.opponent_checkpoint=Path('/outside/b.pt')
            with self.assertRaises(ValueError):arena_arguments(args,root)
            args.opponent_checkpoint=root/'b.pt'
            with patch('righelt_training.arena.read_frozen_plan',return_value=({},'frozen')):
                self.assertEqual(arena_arguments(args,root),'frozen')
    def test_fresh_directory_cannot_reset_approved_stage(self):
        with tempfile.TemporaryDirectory() as d:
            claim_stage(d,'initial',Path(d)/'first')
            claim_stage(d,'initial',Path(d)/'first')
            with self.assertRaises(ValueError):claim_stage(d,'initial',Path(d)/'second')
            claim_stage(d,'overnight',Path(d)/'overnight')

    def test_deadline_kills_noncooperative_child(self):
        with tempfile.TemporaryDirectory() as d:
            process=start_group([sys.executable,'-c','while True: pass'])
            begin=time.monotonic()
            result=supervise(process,Budget(begin,.1),AdaptivePolicy(),QuietTelemetry(),Path(d),sample_seconds=.05)
            self.assertEqual(result,'budget-expired')
            self.assertIsNotNone(process.returncode)
            self.assertLess(time.monotonic()-begin,2)

    def test_unknown_activity_stays_conservative(self):
        with tempfile.TemporaryDirectory() as d:
            process=start_group([sys.executable,'-c','import time; time.sleep(.1)'])
            result=supervise(process,Budget(time.monotonic(),2),AdaptivePolicy(),QuietTelemetry(),Path(d))
            self.assertEqual(result,'completed')
            import json
            allocation=json.loads((Path(d)/'allocation.json').read_text())
            self.assertEqual(allocation['workers'],2)
            self.assertEqual(allocation['memory_gib'],16)

    def test_missing_machine_telemetry_stops_instead_of_guessing(self):
        class Missing:
            def sample(self): raise RuntimeError('unavailable')
        with tempfile.TemporaryDirectory() as d:
            process=start_group([sys.executable,'-c','while True: pass'])
            result=supervise(process,Budget(time.monotonic(),2),AdaptivePolicy(),Missing(),Path(d))
            self.assertEqual(result,'telemetry-failed')
            self.assertIsNotNone(process.returncode)

    def test_resume_with_old_device_file_does_not_signal_unready_process(self):
        import json
        from dataclasses import replace
        class Starting(QuietTelemetry):
            def sample(self):return replace(super().sample(),device_memory_known=False)
        with tempfile.TemporaryDirectory() as d:
            (Path(d)/'device-memory.json').write_text(json.dumps({'schema':1,'pid':999999,'observedAt':time.time(),'driverBytes':1024}))
            process=start_group([sys.executable,'-c','import time; time.sleep(5)'])
            result=supervise(process,Budget(time.monotonic(),.15),AdaptivePolicy(),Starting(),Path(d))
            self.assertEqual(result,'budget-expired')
            self.assertEqual(process.returncode,-9)

    def test_stale_or_smoke_only_gate_report_rejected(self):
        report={'sourceRevision':'rev','configSha256':CONFIG_SHA256,'checks':{k:{'passed':True,'evidence':'test'} for k in ('coreTests','trainerTests','exactReplay','exportParity')}}
        with self.assertRaises(ValueError):validate_gate_report(report,'rev','initial')
        report['checks']['exportParity'].update(heldoutStates=1000,legalMasksPassed=True,tacticalParityPassed=True)
        validate_gate_report(report,'rev','initial')
        with self.assertRaises(ValueError):validate_gate_report(report,'changed','initial')
        with self.assertRaises(ValueError):validate_gate_report(report,'rev','overnight')

if __name__=='__main__':unittest.main()
