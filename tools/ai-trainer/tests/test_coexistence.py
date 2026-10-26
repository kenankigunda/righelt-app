"""Pure/mocked admission tests. No model weights, inference or MPS calls."""
import hashlib
import json
import os
from pathlib import Path
import tempfile
import unittest
import ast
import time
import subprocess
from types import SimpleNamespace
from dataclasses import replace
from datetime import datetime, timezone
from unittest.mock import Mock, patch
from dataclasses import asdict

from righelt_training.coexistence import LeaseGuard, timestamp
from righelt_training.coexistence import atomic
from righelt_training.coexistence import UnsafeResources,RESOURCE_SYSTEM
from righelt_training.resources import AdaptivePolicy, Sample, GIB


def iso(t):
    return datetime.fromtimestamp(t, timezone.utc).isoformat()


def sample(**changes):
    return replace(Sample(1000, 1000, True, 100, 'normal', 4*GIB, 24*GIB,
                          500*GIB, 0, ramp_authorized=True), **changes)


def observation(**changes):
    return dict({'observedAt': iso(1000), 'subject': 'model', 'coexistenceVerified': True,
                 'decision': 'continue', 'blockers': [], 'modelBytes': 4*GIB,
                 'foreignRssBytes': GIB}, **changes)


class CoexistencePolicyTest(unittest.TestCase):
    def test_active_app_stays_active_with_separate_bounded_capability(self):
        s = sample()
        self.assertTrue(AdaptivePolicy().decide(s).paused)
        assigned = AdaptivePolicy().decide(s, coexistence=observation())
        self.assertFalse(assigned.paused)
        self.assertEqual((assigned.workers, assigned.memory_gib), (2, 16))
        self.assertTrue(s.development_active)
        self.assertTrue(s.ramp_authorized)

    def test_unknown_stale_or_overcap_observations_never_admit(self):
        for o in ({}, observation(observedAt=iso(994)), observation(observedAt=iso(1001)),
                  observation(blockers=['unknown-heavy']), observation(subject='guard-canary'),
                  observation(modelBytes=17*GIB), observation(foreignRssBytes=13*GIB),
                  observation(modelBytes=True), observation(decision='backoff')):
            with self.subTest(o=o):
                a = AdaptivePolicy().decide(sample(), coexistence=o)
                self.assertTrue(a.paused)
                self.assertEqual(a.workers, 0)

    def test_real_critical_disk_device_swap_and_headroom_gates_remain(self):
        for changes in ({'memory_pressure':'critical'}, {'memory_pressure':'unknown'},
                        {'disk_free_bytes':GIB}, {'artifact_bytes':101*GIB},
                        {'device_memory_known':False}, {'available_bytes':10*GIB},
                        {'experiment_bytes':17*GIB}, {'swap_used_bytes':None},
                        {'activity_observed_at':None}):
            with self.subTest(changes=changes):
                a = AdaptivePolicy().decide(sample(**changes), coexistence=observation())
                self.assertTrue(a.paused)
                self.assertEqual(a.workers, 0)

    def test_explicit_exclusive_proof_can_bound_unknown_chat_activity_without_faking_idle(self):
        s=sample(activity_observed_at=None,development_active=None)
        receipt=observation(exclusiveVerified=True,foreignRssBytes=0,rootGrantId='root-exclusive')
        self.assertFalse(AdaptivePolicy().decide(s,coexistence=receipt).paused)
        self.assertIsNone(s.development_active)
        self.assertTrue(AdaptivePolicy().decide(s,coexistence={**receipt,'rootGrantId':''}).paused)
        self.assertTrue(AdaptivePolicy().decide(s,coexistence={**receipt,'foreignRssBytes':1}).paused)
        self.assertTrue(AdaptivePolicy().decide(replace(s,memory_pressure='critical'),coexistence=receipt).stop)

    def test_coexistence_never_ramps_with_idle_activity(self):
        p = AdaptivePolicy()
        for t in range(1000, 2000, 5):
            a = p.decide(sample(now=t, activity_observed_at=t, development_active=False),
                         coexistence=observation(observedAt=iso(t)))
            self.assertEqual((a.workers, a.memory_gib), (2,16))


class LeaseTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()
        self.now = 1000
        self.reader = self.root/'reader.mjs'
        self.reader.write_text('// test reader, never executed')
        self.checkpoint = self.root/'checkpoint.bin'
        self.checkpoint.write_bytes(b'opaque mocked recovery bundle')
        self.state_path = self.root/'state.json'
        self.permit_path = self.root/'permit.json'
        self.permit = {'subject':'model', 'grantId':'root-test', 'grantRecordedAt':iso(900),
                       'expiresAt':iso(1200), 'overallDeadline':iso(900+86400),
                       'model':{'sourceRevision':'a'*40},
                       'readerSha256':self.sha(self.reader)}
        self.permit_path.write_text(json.dumps(self.permit))
        self.grant = {'active':True, 'subject':'model', 'grantId':'root-test',
                      'recordedAt':iso(900), 'expiresAt':iso(1200),
                      'permitSha256':self.sha(self.permit_path), 'maxWorkers':2,
                      'maxMemoryGiB':16, 'rampAuthorized':False}
        self.state = {'followupTraining':{'executionStartedAt':iso(900),
                      'deadline':iso(900+86400), 'currentResourceGrant':self.grant}}
        self.write_state()
        manifest={'sourceRevision':'a'*40}
        self.manifest_sha=hashlib.sha256(json.dumps(manifest,sort_keys=True,allow_nan=False).encode()).hexdigest()
        (self.root/'manifest.json').write_text(json.dumps({'manifest':manifest,'sha256':self.manifest_sha}))
        self.runtime = {'manifestSha256':self.manifest_sha, 'deadlineWall':900+86400,
                        'parentCheckpoint':str(self.checkpoint)}
        self.binding = {'runDirectory':str(self.root), 'manifestSha256':self.manifest_sha,
                        'sourceRevision':'a'*40, 'checkpoint':{'path':str(self.checkpoint),
                        'sha256':self.sha(self.checkpoint)}, 'statePath':str(self.state_path),
                        'permitPath':str(self.permit_path), 'permitSha256':self.sha(self.permit_path),
                        'readerPath':str(self.reader), 'readerSha256':self.sha(self.reader),
                        'executionStartedAt':iso(900), 'deadline':iso(900+86400)}

    def sha(self, p):
        return hashlib.sha256(p.read_bytes()).hexdigest()

    def write_state(self):
        self.state_path.write_text(json.dumps(self.state))

    def guard(self, execute=None):
        return LeaseGuard(self.binding, self.runtime, self.root, clock=lambda:self.now,
                          monotonic=lambda:self.now,
                          execute=execute or Mock(side_effect=AssertionError('No reader expected')))

    def test_revocation_prevents_reader_and_next_admission(self):
        execute=Mock()
        g=self.guard(execute)
        self.grant['active']=False
        self.write_state()
        with self.assertRaisesRegex(ValueError,'withdrawn'):g.observe(sample())
        execute.assert_not_called()

    def test_expiry_reserve_requests_manifest_bound_checkpoint_once(self):
        g=self.guard()
        self.now=1140
        with self.assertRaisesRegex(ValueError,'handoff reserve'):g.check()
        g.request_handoff('lease reserve')
        first=(self.root/'handoff-request.json').read_bytes()
        self.assertEqual(json.loads(first)['manifestSha256'],self.runtime['manifestSha256'])
        self.assertEqual(json.loads((self.root/'allocation.json').read_text())['workers'],0)
        self.now=1150
        g.request_handoff('duplicate')
        self.assertEqual(first,(self.root/'handoff-request.json').read_bytes())
        self.assertFalse(g.cleanup_due())
        self.now=1200
        self.assertTrue(g.cleanup_due())

    def test_deadline_reset_future_clock_and_checkpoint_change_reject(self):
        for change in ('clock','future','checkpoint','manifest','source'):
            with self.subTest(change=change):
                if change=='clock':
                    self.state['followupTraining']['deadline']=iso(900+86401)
                    self.write_state()
                elif change=='future':
                    self.state['followupTraining']['executionStartedAt']=iso(1100)
                    self.state['followupTraining']['deadline']=iso(1100+86400)
                    self.write_state()
                elif change=='checkpoint':self.checkpoint.write_bytes(b'changed')
                elif change=='manifest':self.runtime['manifestSha256']='c'*64
                elif change=='source':self.binding['sourceRevision']='d'*40
                with self.assertRaises(ValueError):self.guard()
                # Each following case starts from the original fixture.
                self.tearDown_fixture()

    def tearDown_fixture(self):
        self.state['followupTraining']['executionStartedAt']=iso(900)
        self.state['followupTraining']['deadline']=iso(900+86400)
        self.write_state()
        self.checkpoint.write_bytes(b'opaque mocked recovery bundle')
        self.runtime['manifestSha256']=self.manifest_sha
        self.binding['sourceRevision']='a'*40

    def test_actual_reader_receipt_binding_is_required(self):
        execute=Mock(return_value=Mock(stdout=json.dumps({**observation(),
                     'permitSha256':self.binding['permitSha256']})))
        g=self.guard(execute)
        with patch.dict(os.environ,{'RIGHELT_RESOURCE_RUN':'test-own-run'}):
            self.assertEqual(g.observe(sample())['subject'],'model')
        self.assertEqual(execute.call_args.kwargs['timeout'],5)
        execute.return_value.stdout=json.dumps({**observation(),'permitSha256':'wrong'})
        with patch.dict(os.environ,{'RIGHELT_RESOURCE_RUN':'test-own-run'}):
            with self.assertRaisesRegex(ValueError,'observation mismatch'):g.observe(sample())

    def exclusive_fixture(self):
        registry=self.root/'.local/state/righelt/resources'
        registry.mkdir(parents=True)
        (registry/'own-run.json').write_text(json.dumps({'cwd':str(self.root),'kind':'heavy','pgid':os.getpgrp()}))
        self.permit.update(mode='exclusive',registryPath=str(registry),model={'sourceRevision':'a'*40,'cwd':str(self.root)})
        self.permit_path.write_text(json.dumps(self.permit))
        self.binding['permitSha256']=self.sha(self.permit_path)
        self.binding['exclusiveInputs']={str(self.reader):self.sha(self.reader),str(RESOURCE_SYSTEM.resolve()):self.sha(RESOURCE_SYSTEM)}
        self.grant.update(mode='exclusive',permitSha256=self.binding['permitSha256'])
        self.write_state()
        return registry

    def test_exclusive_actual_binding_closes_over_source_and_owned_registry(self):
        self.exclusive_fixture()
        def execute(args,**kwargs):
            if args[:2]==['git','rev-parse']:return SimpleNamespace(stdout='a'*40)
            if args[:2]==['git','status']:return SimpleNamespace(stdout='')
            return SimpleNamespace(stdout=json.dumps({'exclusiveVerified':True,'blockers':[]}))
        with patch.object(Path,'home',return_value=self.root),patch.object(Path,'cwd',return_value=self.root),patch.dict(os.environ,{'RIGHELT_RESOURCE_RUN':'own-run'},clear=False):
            g=self.guard(execute)
            self.assertTrue(g.observe(sample())['exclusiveVerified'])
            self.reader.write_text('changed source')
            with self.assertRaises(UnsafeResources):g.observe(sample())

    def test_exclusive_unsafe_memory_stops_before_any_reader(self):
        self.exclusive_fixture();execute=Mock(side_effect=AssertionError('No unsafe read'))
        with patch.object(Path,'home',return_value=self.root),patch.object(Path,'cwd',return_value=self.root),patch.dict(os.environ,{'RIGHELT_RESOURCE_RUN':'own-run'},clear=False):
            g=self.guard(execute)
            for change in ({'experiment_bytes':17*GIB},{'experiment_bytes':float('nan')},{'memory_pressure':'unknown'},{'available_bytes':5*GIB}):
                with self.assertRaises(UnsafeResources):g.observe(sample(**change))
        execute.assert_not_called()

    def test_exclusive_all_calls_share_single_observation_deadline(self):
        self.exclusive_fixture();elapsed=[1000.]
        def execute(args,**kwargs):
            elapsed[0]+=3
            return SimpleNamespace(stdout='a'*40 if args[:2]==['git','rev-parse']else'')
        with patch.object(Path,'home',return_value=self.root),patch.object(Path,'cwd',return_value=self.root),patch.dict(os.environ,{'RIGHELT_RESOURCE_RUN':'own-run'},clear=False):
            g=self.guard(execute);g.monotonic=lambda:elapsed[0]
            with self.assertRaisesRegex(UnsafeResources,'timed out'):g.observe(sample())

    def test_exclusive_closing_checkout_change_fails_closed(self):
        self.exclusive_fixture();calls=[]
        def execute(args,**kwargs):
            calls.append(args)
            if args[:2]==['git','rev-parse']:return SimpleNamespace(stdout='a'*40)
            if args[:2]==['git','status']:return SimpleNamespace(stdout=''if len(calls)<5 else' M changed')
            return SimpleNamespace(stdout=json.dumps({'exclusiveVerified':True,'blockers':[]}))
        with patch.object(Path,'home',return_value=self.root),patch.object(Path,'cwd',return_value=self.root),patch.dict(os.environ,{'RIGHELT_RESOURCE_RUN':'own-run'},clear=False):
            with self.assertRaisesRegex(UnsafeResources,'checkout changed'):self.guard(execute).observe(sample())

    def test_naive_dates_fail_closed(self):
        with self.assertRaises(ValueError):timestamp('2026-10-25T12:00:00')

    def test_real_manifest_envelope_is_bound_to_runtime_checksum(self):
        record=json.loads((self.root/'manifest.json').read_text())
        record['manifest']['sourceRevision']='f'*40
        (self.root/'manifest.json').write_text(json.dumps(record))
        with self.assertRaisesRegex(ValueError,'[Mm]anifest file checksum'):self.guard()

    def test_outstanding_manual_handoff_is_preserved(self):
        prior={'schema':1,'id':'manual-review','reason':'reporting',
               'manifestSha256':self.runtime['manifestSha256']}
        (self.root/'handoff-request.json').write_text(json.dumps(prior))
        self.guard().request_handoff('lease reserve')
        self.assertEqual(json.loads((self.root/'handoff-request.json').read_text()),prior)

    def supervisor_function(self, stop):
        # Execute the actual watchdog function with explicit fake services,
        # without importing supervisor's Torch-dependent launch machinery.
        source=Path(__file__).parents[1]/'righelt_training/supervisor.py'
        tree=ast.parse(source.read_text())
        node=next(n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name=='supervise')
        namespace={'time':SimpleNamespace(time=lambda:self.now,monotonic=lambda:self.now,sleep=time.sleep),
                   'LIMITS':{'sampleSeconds':5,'startupHeartbeatSeconds':30,'minMemoryGiB':16,'pauseAvailableGiB':6},
                   'Path':Path,'json':json,'os':os,'subprocess':subprocess,
                   'stop_group':stop,'asdict':asdict,'atomic_json':atomic,'replace':replace,
                   'UnsafeResources':UnsafeResources,'read_device_memory':Mock(return_value=(0,False)),'signal':SimpleNamespace(SIGUSR1=10)}
        exec(compile(ast.Module(body=[node],type_ignores=[]),str(source),'exec'),namespace)
        return namespace['supervise']

    def test_actual_reader_receipt_after_host_sample_admits_with_fresh_clock(self):
        self.now=1000.2
        g=Mock()
        g.handoff_at=None
        g.cleanup_due.return_value=False
        g.observe.return_value=observation(observedAt=iso(1000.1))
        g.request_handoff.side_effect=AssertionError('Healthy receipt must not request handoff')
        process=Mock()
        process.pid=123
        process.returncode=None
        process.poll.side_effect=lambda:process.returncode
        stop=Mock()
        telemetry=Mock()
        telemetry.sample.return_value=sample(now=1000,activity_observed_at=1000)
        budget=Mock()
        budget.remaining.return_value=1000
        def finish(_):process.returncode=0
        result=self.supervisor_function(stop)(process,budget,AdaptivePolicy(),telemetry,self.root,
                      guard=g,clock=lambda:self.now,sleep=finish)
        self.assertEqual(result,'completed')
        self.assertEqual(json.loads((self.root/'allocation.json').read_text())['workers'],2)
        self.assertTrue(telemetry.sample.return_value.development_active)

    def test_actual_watchdog_unknown_initial_heartbeat_gets_no_workers_then_recovers(self):
        g=Mock();g.handoff_at=None;g.cleanup_due.return_value=False
        g.observe.side_effect=lambda s:observation(observedAt=iso(self.now))
        process=Mock();process.pid=123;process.returncode=None;process.poll.side_effect=lambda:process.returncode
        telemetry=Mock();telemetry.sample.side_effect=lambda:sample(now=self.now,activity_observed_at=self.now,device_memory_known=self.now>1000)
        allocations=[]
        def tick(_):
            allocations.append(json.loads((self.root/'allocation.json').read_text()))
            if self.now>=1005:process.returncode=0
            self.now+=5
        budget=Mock();budget.remaining.return_value=1000
        self.assertEqual(self.supervisor_function(Mock())(process,budget,AdaptivePolicy(),telemetry,self.root,guard=g,clock=lambda:self.now,sleep=tick),'completed')
        self.assertEqual(allocations[0]['workers'],0)
        self.assertEqual(allocations[-1]['workers'],2)
        g.request_handoff.assert_not_called()

    def test_actual_watchdog_lost_established_heartbeat_stops_owned_process(self):
        g=Mock();g.handoff_at=None;g.cleanup_due.return_value=False
        g.observe.side_effect=lambda s:observation(observedAt=iso(self.now))
        process=Mock();process.pid=123;process.returncode=None;process.poll.side_effect=lambda:process.returncode
        telemetry=Mock();telemetry.sample.side_effect=lambda:sample(now=self.now,activity_observed_at=self.now,device_memory_known=self.now==1000)
        budget=Mock();budget.remaining.return_value=1000
        def tick(_):self.now+=5
        stop=Mock()
        self.assertEqual(self.supervisor_function(stop)(process,budget,AdaptivePolicy(),telemetry,self.root,guard=g,clock=lambda:self.now,sleep=tick),'resource-pressure-stop')
        self.assertEqual(self.now,1010)
        self.assertEqual(json.loads((self.root/'allocation.json').read_text())['workers'],0)
        self.assertTrue(stop.called)

    def test_actual_watchdog_revocation_requests_checkpoint_and_cleans(self):
        g=self.guard()
        self.grant['active']=False
        self.write_state()
        process=Mock()
        process.pid=123
        process.returncode=None
        process.poll.side_effect=lambda:process.returncode
        stop=Mock()
        checkpoint=Mock()
        def consume(_):
            request=json.loads((self.root/'handoff-request.json').read_text())
            self.assertEqual(request['manifestSha256'],self.runtime['manifestSha256'])
            self.assertEqual(json.loads((self.root/'allocation.json').read_text())['workers'],0)
            checkpoint(request)
            process.returncode=0
        budget=Mock()
        budget.remaining.return_value=1000
        telemetry=Mock()
        telemetry.sample.return_value=sample()
        result=self.supervisor_function(stop)(process,budget,AdaptivePolicy(),telemetry,self.root,
                      guard=g,clock=lambda:self.now,sleep=consume)
        self.assertEqual(result,'completed')
        checkpoint.assert_called_once()
        telemetry.sample.assert_called_once()
        stop.assert_called_once_with(process)

    def test_actual_watchdog_stuck_checkpoint_stops_exact_group_by60seconds(self):
        g=self.guard()
        self.grant['active']=False
        self.write_state()
        process=Mock()
        process.pid=123
        process.poll.return_value=None
        stop=Mock()
        def tick(_):self.now+=1
        budget=Mock()
        budget.remaining.return_value=1000
        telemetry=Mock()
        telemetry.sample.return_value=sample()
        result=self.supervisor_function(stop)(process,budget,AdaptivePolicy(),telemetry,self.root,
                      guard=g,clock=lambda:self.now,sleep=tick)
        self.assertEqual(result,'coexistence-handoff-timeout')
        self.assertEqual(self.now,1050)
        self.assertTrue(all(c.args==(process,) for c in stop.call_args_list))

    def test_revoked_grant_keeps_critical_host_pressure_stop_during_checkpoint(self):
        g=self.guard()
        self.grant['active']=False
        self.write_state()
        process=Mock()
        process.pid=123
        process.poll.return_value=None
        stop=Mock()
        telemetry=Mock()
        telemetry.sample.return_value=sample(memory_pressure='critical')
        budget=Mock()
        budget.remaining.return_value=1000
        result=self.supervisor_function(stop)(process,budget,AdaptivePolicy(),telemetry,self.root,
                      guard=g,clock=lambda:self.now,sleep=Mock())
        self.assertEqual(result,'memory-pressure')
        self.assertEqual(json.loads((self.root/'allocation.json').read_text())['workers'],0)
        self.assertEqual(self.now,1000)

    def test_critical_pressure_stops_before_failing_reader(self):
        g=Mock()
        g.handoff_at=None
        g.cleanup_due.return_value=False
        g.observe.side_effect=UnsafeResources('reader would fail')
        process=Mock()
        process.pid=123
        process.poll.return_value=None
        stop=Mock()
        telemetry=Mock()
        telemetry.sample.return_value=sample(memory_pressure='critical')
        budget=Mock()
        budget.remaining.return_value=1000
        result=self.supervisor_function(stop)(process,budget,AdaptivePolicy(),telemetry,self.root,
                      guard=g,clock=lambda:self.now,sleep=Mock())
        self.assertEqual(result,'memory-pressure')
        g.observe.assert_not_called()
        g.request_handoff.assert_not_called()
        self.assertTrue(all(c.args==(process,) for c in stop.call_args_list))

    def test_reader_safety_failure_stops_without_grace(self):
        g=Mock()
        g.handoff_at=None
        g.cleanup_due.return_value=False
        g.observe.side_effect=UnsafeResources('unknown actual pressure')
        process=Mock()
        process.pid=123
        process.poll.return_value=None
        stop=Mock()
        telemetry=Mock()
        telemetry.sample.return_value=sample()
        budget=Mock()
        budget.remaining.return_value=1000
        result=self.supervisor_function(stop)(process,budget,AdaptivePolicy(),telemetry,self.root,
                      guard=g,clock=lambda:self.now,sleep=Mock())
        self.assertEqual(result,'coexistence-resource-stop')
        g.request_handoff.assert_not_called()

    def test_clock_rollback_cannot_extend_checkpoint_cleanup_window(self):
        elapsed=[1000]
        g=LeaseGuard(self.binding,self.runtime,self.root,clock=lambda:self.now,
                     monotonic=lambda:elapsed[0])
        g.request_handoff('withdrawn')
        self.now=500
        elapsed[0]=1050
        self.assertTrue(g.cleanup_due())

    def test_actual_phase_does_not_retry_under_old_grant_after_device_loss(self):
        source=Path(__file__).parents[1]/'righelt_training/supervisor.py'
        node=next(n for n in ast.parse(source.read_text()).body
                  if isinstance(n,ast.FunctionDef) and n.name=='run_phase')
        process=Mock()
        guard=Mock()
        wait=Mock(return_value='resources-ready')
        supervise=Mock(return_value='resource-pressure-stop')
        cleanup=Mock()
        namespace={'time':time,'Path':Path,'AdaptivePolicy':Mock(),'coexistence_guard':Mock(return_value=guard),
                   'wait_for_resources':wait,'Telemetry':Mock(),'validate_training_window':Mock(),
                   'atomic_json':atomic,'LIMITS':{'minMemoryGiB':16},'start_group':Mock(return_value=process),
                   'ROOT':self.root,'register_owned':Mock(),'supervise':supervise,
                   'stop_group':Mock(),'cleanup_owned':cleanup}
        exec(compile(ast.Module(body=[node],type_ignores=[]),str(source),'exec'),namespace)
        result=namespace['run_phase'](['test-runner'],{},Mock(),Mock(),
                     {**self.runtime,'command':'training'},self.root,self.root,self.root/'activity.json')
        self.assertEqual(result,('resource-pressure-stop',process))
        self.assertEqual(wait.call_count,1)
        self.assertEqual(supervise.call_count,1)
        cleanup.assert_called_once_with(self.root)


if __name__ == '__main__':
    unittest.main()
