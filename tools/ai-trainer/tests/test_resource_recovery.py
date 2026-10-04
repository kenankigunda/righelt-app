import hashlib
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock,patch
from righelt_training import supervisor as s
from righelt_training.budget import Budget
from righelt_training.resources import Sample,GIB

class ResourceRecoveryTest(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        self.directory=Path(self.temp.name);self.now=0.
        self.runtime={'command':'training','startedMonotonic':0,'deadlineMonotonic':600,'manifestSha256':'manifest'}
        self.process=Mock(pid=123,returncode=-9)
        self.host=Mock();self.host.sample.return_value=self.sample()
        self.telemetry=[]
        def factory(*args):
            self.telemetry.append(args)
            return self.host if len(args)==2 else Mock()
        self.start=self.patch('start_group',return_value=self.process)
        self.patch('register_owned');self.cleanup=self.patch('cleanup_owned');self.patch('stop_group')
        self.patch('Telemetry',side_effect=factory)
        self.supervise=self.patch('supervise',side_effect=['resource-pressure-stop','completed'])
        self.latest=self.patch('latest_recovery',return_value=(self.directory/'latest.pt',{'updates':17}))
    def patch(self,name,**kwargs):
        patcher=patch.object(s,name,**kwargs);self.addCleanup(patcher.stop);return patcher.start()
    def sample(self,pressure='normal'):
        return Sample(1000+self.now,None,None,0,pressure,GIB,40*GIB,500*GIB,0,True)
    def sleep(self,seconds):self.now+=seconds
    def run_phase(self,seconds=600):
        return s.run_phase(['python','runner','--resume','old.pt'],{},None,Budget(0,seconds),self.runtime,
                           self.directory,self.directory,self.directory/'activity.json',clock=lambda:self.now,sleep=self.sleep)
    def test_pressure_wait_remains_charged_and_resumes_latest_checkpoint(self):
        self.host.sample.side_effect=[self.sample(),self.sample('warning'),self.sample()]
        result,_=self.run_phase()
        self.assertEqual(result,'completed');self.assertGreater(self.now,0)
        self.assertEqual(self.start.call_count,2);self.assertEqual(self.cleanup.call_count,2)
        argv=self.start.call_args.args[0]
        self.assertEqual(argv[argv.index('--resume')+1],str(self.directory/'latest.pt'))
        self.assertEqual(self.runtime['deadlineMonotonic'],600)
        self.assertEqual(self.supervise.call_args.args[1].remaining(self.now),600-self.now)
        events=[json.loads(line) for line in (self.directory/'resource-events.jsonl').read_text().splitlines()]
        self.assertTrue(any(e.get('cleanupVerified') for e in events))
    def test_persistent_host_pressure_consumes_budget_without_loading_model(self):
        self.host.sample.side_effect=lambda:self.sample('warning')
        reason,process=self.run_phase(seconds=10)
        self.assertEqual(reason,'budget-expired');self.assertIsNone(process)
        self.assertEqual(self.now,10);self.start.assert_not_called()
    def test_resource_wait_cannot_restart_training_past_validation_boundary(self):
        self.now=499
        self.host.sample.side_effect=[self.sample(),self.sample('warning')]
        reason,_=self.run_phase()
        self.assertEqual(reason,'completed');self.assertEqual(self.start.call_count,1)
        report=json.loads((self.directory/'runner-result.json').read_text())
        self.assertEqual(report['reason'],'validation-handoff');self.assertTrue(report['unfinishedWork'])
        self.assertEqual(report['state']['updates'],17)
    def test_dead_gpu_file_does_not_gate_host_wait_and_restart_requires_new_pid(self):
        (self.directory/'device-memory.json').write_text(json.dumps({'pid':999,'observedAt':0,'driverBytes':1}))
        self.run_phase()
        self.assertEqual([len(args) for args in self.telemetry],[2,4,2,4])
        self.assertTrue(all(args[-1]==123 for args in self.telemetry if len(args)==4))
        assigned=json.loads((self.directory/'allocation.json').read_text())
        self.assertTrue(assigned['paused']);self.assertEqual(assigned['reason'],'device-memory-unknown')
    def test_correctness_and_repair_failures_are_not_automatically_retried(self):
        for reason in ('runner-failed','operation-timeout','telemetry-failed','validation-handoff-timeout'):
            with self.subTest(reason=reason):
                self.supervise.side_effect=[reason];self.start.reset_mock()
                self.assertEqual(self.run_phase()[0],reason);self.assertEqual(self.start.call_count,1)
        self.latest.assert_not_called()
    def test_cleanup_failure_prevents_host_wait_and_restart(self):
        self.cleanup.side_effect=RuntimeError('owned compute did not stop')
        with self.assertRaisesRegex(RuntimeError,'did not stop'):self.run_phase()
        self.assertEqual(self.start.call_count,1);self.assertEqual(self.host.sample.call_count,1)
    def test_cancel_during_wait_never_restarts_compute(self):
        self.host.sample.side_effect=[self.sample(),self.sample('warning')]
        def cancel(_):raise SystemExit(143)
        with self.assertRaises(SystemExit):
            s.run_phase(['runner'],{},None,Budget(0,600),self.runtime,self.directory,self.directory,
                        self.directory/'activity',clock=lambda:self.now,sleep=cancel)
        self.assertEqual(self.start.call_count,1);self.cleanup.assert_called_once()

    def test_allocation_ledger_charges_wait_without_new_interval_and_excludes_repair(self):
        from righelt_training.allocation import Allocation
        self.host.sample.side_effect=[self.sample(),self.sample('warning'),self.sample()]
        with patch('righelt_training.allocation.time.monotonic',side_effect=lambda:self.now),patch('righelt_training.allocation.time.time',side_effect=lambda:1000+self.now),patch('righelt_training.allocation.psutil.boot_time',return_value=1),patch('righelt_training.allocation.identity',return_value={'pid':123,'created':2}):
            ledger=Allocation(self.directory,self.directory/'run');ledger.create('initial')
            interval,_,_=ledger.begin('training')
            self.assertEqual(self.run_phase()[0],'completed')
            events=ledger.events()
            self.assertEqual(len([e for e in events if e['event']=='started']),1)
            self.assertEqual(len(ledger.accounting()[2]),1)
            elapsed=self.now;self.assertGreater(elapsed,0)
            ledger.finish(interval['id'],reason='completed')
            self.now+=300  # stopped engineering/repair is excluded
            _,_,charged=ledger.begin('health')
            self.assertEqual(charged,elapsed)
            self.now+=7;pending=ledger.accounting()[2][0]
            ledger.finish(pending['id'],reason='completed')
            self.assertEqual(ledger.accounting()[1],elapsed+7)

    def test_prelaunch_boundary_without_checkpoint_is_inconclusive(self):
        self.now=499;self.host.sample.return_value=self.sample('warning')
        self.latest.side_effect=FileNotFoundError('no recoverable checkpoint')
        with self.assertRaises(FileNotFoundError):self.run_phase()
        self.start.assert_not_called()
        self.assertFalse((self.directory/'runner-result.json').exists())

    def test_wall_clock_reserve_jump_during_wait_never_starts_training(self):
        self.runtime['deadlineWall']=1600
        wall=[1000.];self.host.sample.return_value=self.sample('warning')
        def wake(seconds):self.now+=seconds;wall[0]=1501
        with patch.object(s.time,'time',side_effect=lambda:wall[0]):
            reason,_=s.run_phase(['runner'],{},None,Budget(0,600,1600),self.runtime,self.directory,
                self.directory,self.directory/'activity',clock=lambda:self.now,sleep=wake)
        self.assertEqual(reason,'completed');self.start.assert_not_called()
        self.assertLess(self.now,500)


class LatestRecoveryTest(unittest.TestCase):
    def test_checkpoint_hash_lineage_and_bound_recovery_are_required(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);(root/'checkpoints').mkdir();path=root/'checkpoints/new.pt';path.write_bytes(b'checkpoint')
            (root/'latest.json').write_text(json.dumps({'checkpoint':str(path),'sha256':hashlib.sha256(path.read_bytes()).hexdigest(),'updates':9}))
            path.with_suffix('.json').write_text(json.dumps({'manifestSha256':'old'}))
            with patch.object(s,'manifest_hashes',return_value={'old','new'}),patch('righelt_training.checkpoint.inspect_checkpoint',return_value={'updates':9,'recovery':{'state':{'updates':9}}}) as inspect:
                runtime={'manifestSha256':'new','deadlineMonotonic':600}
                checkpoint,state=s.latest_recovery(root,runtime)
                inspect.assert_called_once_with(path.resolve(),manifest_sha256='old',require_recovery=True)
                self.assertEqual(state['updates'],9);self.assertEqual(runtime['parentCheckpoint'],str(path.resolve()))
                self.assertEqual(runtime['deadlineMonotonic'],600)
                latest=json.loads((root/'latest.json').read_text());latest['updates']=10
                (root/'latest.json').write_text(json.dumps(latest))
                with self.assertRaisesRegex(ValueError,'update count'):s.latest_recovery(root,runtime)
                path.write_bytes(b'tamper')
                with self.assertRaisesRegex(ValueError,'changed'):s.latest_recovery(root,runtime)
