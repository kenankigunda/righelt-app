import copy
import json
from pathlib import Path
import tempfile
import time
import unittest
from unittest.mock import Mock,patch
from righelt_training.admission import estimate,observe,restore_observations
from righelt_training.curriculum import Curriculum
from righelt_training.runner import Runner,default_state,CONFIG


class AdmissionTest(unittest.TestCase):
    def test_complete_and_censored_observations_bound_each_kind_independently(self):
        with tempfile.TemporaryDirectory() as directory:
            state={}
            self.assertEqual(estimate(state,'normal')['requiredSeconds'],90)
            for seconds,censored in ((100,False),(1,False),(180,True)):
                observe(state,directory,job_id=str(seconds),kind='normal',phase='generation',seconds=seconds,censored=censored)
            observe(state,directory,job_id='replay',kind='normal',phase='replay',seconds=32,censored=False)
            self.assertEqual(estimate(state,'normal')['requiredSeconds'],275)
            self.assertEqual(estimate(state,'simple')['requiredSeconds'],90)
            self.assertEqual(state['admissionDurations']['normal:generation']['completedCount'],2)
            self.assertEqual(state['admissionDurations']['normal:generation']['censoredCount'],1)

    def test_journal_restores_uncheckpointed_evidence_once_after_rollback(self):
        with tempfile.TemporaryDirectory() as directory:
            state={};restore_observations(state,directory);checkpoint=copy.deepcopy(state)
            observe(state,directory,job_id='g',kind='normal',phase='generation',seconds=200,censored=True)
            restore_observations(checkpoint,directory);restore_observations(checkpoint,directory)
            self.assertEqual(state,checkpoint)
            self.assertEqual(checkpoint['admissionDurations']['normal:generation']['censoredCount'],1)
            Path(directory,'admission-durations.jsonl').write_text('')
            with self.assertRaisesRegex(ValueError,'truncated'):restore_observations(checkpoint,directory)

    def runner(self,directory):
        runner=Runner.__new__(Runner);runner.directory=Path(directory);runner.state=default_state()
        runner.seed=2;runner.stage='initial';runner.model_version='weights';runner.curriculum=Curriculum(2)
        runner.deadline=time.monotonic()+3600;runner.checkpoint=Mock()
        runner.runtime={'startedMonotonic':runner.deadline-3600,'deadlineMonotonic':runner.deadline,'reserveSeconds':600}
        return runner

    def test_deferred_seed_and_kind_persist_then_launch_with_replay_reserve(self):
        with tempfile.TemporaryDirectory() as directory:
            runner=self.runner(directory)
            self.assertIsNone(runner.next_generation_job(time.monotonic()+30))
            pending=copy.deepcopy(runner.state['pendingGenerationJob'])
            self.assertEqual(runner.state['nextJob'],1);self.assertEqual(runner.state['generationLaunched'],0)
            runner.state=json.loads(json.dumps(runner.state))  # Checkpoint restoration.
            runner.curriculum=Mock(side_effect=AssertionError('cannot substitute a start'))
            runner.state['round']+=1
            job=runner.next_generation_job(time.monotonic()+120)
            self.assertEqual((job['id'],job['kind'],job['seed']),(pending['id'],pending['kind'],pending['seed']))
            self.assertIsNone(runner.state['pendingGenerationJob']);self.assertEqual(runner.state['nextJob'],1)
            self.assertEqual(runner.state['generationLaunched'],1)
            self.assertGreater(job['budgetMs'],80000);self.assertLess(job['budgetMs'],90001)
            self.assertEqual(runner.state['admissionDeferrals'],{pending['kind']:1})

    def test_unfinished_lower_bound_extends_round_without_clipping_or_replacing_job(self):
        with tempfile.TemporaryDirectory() as directory:
            runner=self.runner(directory)
            self.assertIsNone(runner.next_generation_job(time.monotonic()+30))
            pending=runner.state['pendingGenerationJob']
            observe(runner.state,directory,job_id='slow',kind=pending['kind'],phase='generation',seconds=570,censored=True)
            self.assertIsNone(runner.next_generation_job(time.monotonic()+600))
            self.assertNotIn('admissionStop',runner.state)
            self.assertEqual(runner.state['pendingGenerationJob'],pending)
            evidence=copy.deepcopy(runner.state['admissionDurations'])
            runner.state=json.loads(json.dumps(runner.state))
            runner.curriculum=Mock(side_effect=AssertionError('cannot substitute a start'))
            deadline=runner.generation_round_deadline()
            job=runner.next_generation_job(deadline)
            for field in ('id','kind','seed','initialState','familyId','partition'):
                self.assertEqual(job.get(field),pending.get(field))
            self.assertGreater(job['budgetMs'],710000)
            self.assertLess(job['budgetMs'],723000)
            self.assertEqual(runner.state['admissionDurations'],evidence)
            self.assertEqual(runner.state['nextJob'],1)

    def test_extended_round_uses_saved_elapsed_time_and_does_not_renew_when_polled(self):
        with tempfile.TemporaryDirectory() as directory:
            runner=self.runner(directory)
            observe(runner.state,directory,job_id='slow',kind='simple',phase='generation',seconds=570,censored=True)
            runner.deadline=10000
            runner.runtime={'startedMonotonic':0,'deadlineMonotonic':10000,'reserveSeconds':3600}
            runner.state['generationStartedMonotonic']=100
            with patch('righelt_training.runner.time.monotonic',return_value=500):
                self.assertEqual(runner.generation_round_deadline(),852.5)
            # Restored start is now minus saved elapsed (400), not a fresh round.
            runner.state=json.loads(json.dumps(runner.state))
            runner.state['generationStartedMonotonic']=2000-400
            with patch('righelt_training.runner.time.monotonic',return_value=2000):
                self.assertEqual(runner.generation_round_deadline()-2000,352.5)
            with patch('righelt_training.runner.time.monotonic',return_value=2100):
                self.assertEqual(runner.generation_round_deadline()-2100,252.5)

    def test_round_and_job_admission_preserve_final_validation_reserve(self):
        with tempfile.TemporaryDirectory() as directory:
            runner=self.runner(directory)
            runner.deadline=5000
            runner.runtime={'startedMonotonic':0,'deadlineMonotonic':5000,'reserveSeconds':3600}
            with patch('righelt_training.runner.time.monotonic',return_value=1350):
                deadline=runner.generation_round_deadline()
                self.assertEqual(deadline,1390)
                self.assertIsNone(runner.next_generation_job(deadline))
            self.assertEqual(runner.state['admissionStop'],'insufficient-generation-runway')
            self.assertEqual(runner.state['generationLaunched'],0)
            self.assertIsNotNone(runner.state['pendingGenerationJob'])
            # Reaching the boundary cannot fall through to training old data.
            with patch('righelt_training.runner.time.monotonic',return_value=1400):
                runner.generate_round()
            self.assertEqual(runner.state['admissionStop'],'insufficient-generation-runway')
            self.assertEqual(runner.deadline,5000)

    def test_no_runway_waits_for_handoff_or_resource_stop_without_training_old_data(self):
        for stop in (False,True):
            with self.subTest(stop=stop),tempfile.TemporaryDirectory() as directory:
                runner=self.runner(directory);runner.started=0;runner.deadline=5000
                runner.runtime={'startedMonotonic':0,'deadlineMonotonic':5000,'reserveSeconds':3600}
                runner.maybe_checkpoint=Mock();runner.buffer=Mock(positions=[1]);runner.curriculum=Mock()
                runner.curriculum.observe.return_value=False
                pending=runner.curriculum.job.return_value={'id':'fixed','kind':'simple','seed':17}
                runner.handoff_requested=Mock(side_effect=[None,None,None,None,{'id':'handoff','reason':'validation'}])
                runner.allocation=Mock(side_effect=[{'paused':False,'stop':False}]*3+[{'paused':False,'stop':stop}])
                def no_runway():
                    runner.state['pendingGenerationJob']=pending
                    runner.state['admissionStop']='insufficient-generation-runway'
                runner.generate_round=Mock(side_effect=no_runway)
                ticks=[1350.]
                with patch('righelt_training.runner.time.monotonic',side_effect=lambda:ticks[0]), \
                     patch('righelt_training.runner.time.sleep',side_effect=lambda seconds:ticks.__setitem__(0,ticks[0]+seconds)) as sleep, \
                     patch('righelt_training.runner.train_round') as train:
                    runner.run()
                train.assert_not_called();runner.generate_round.assert_called_once()
                self.assertGreaterEqual(sleep.call_count,2)
                self.assertTrue(all(call.args[0]==1 for call in sleep.call_args_list))
                self.assertEqual(runner.state['pendingGenerationJob'],pending)
                self.assertEqual(runner.deadline,5000)
                result=json.loads(Path(directory,'runner-result.json').read_text())
                self.assertEqual(result['reason'],'insufficient-generation-runway' if stop else 'validation-handoff')

    def test_recovered_wait_with_expired_round_does_not_fall_through_to_training(self):
        with tempfile.TemporaryDirectory() as directory:
            runner=self.runner(directory);runner.started=0;runner.deadline=4900
            runner.runtime={'startedMonotonic':0,'deadlineMonotonic':4900,'reserveSeconds':3600}
            pending={'id':'initial-game-107-363','kind':'simple','seed':3621781493}
            runner.state.update(pendingGenerationJob=pending,generationStartedMonotonic=0,
                                generationElapsedSeconds=1000,admissionStop='insufficient-generation-runway')
            observe(runner.state,directory,job_id='slow',kind='simple',phase='generation',seconds=570,censored=True)
            runner.state=json.loads(json.dumps(runner.state))
            runner.maybe_checkpoint=Mock();runner.buffer=Mock(positions=[1]);runner.curriculum=Mock()
            runner.curriculum.observe.return_value=False
            runner.allocation=Mock(return_value={'paused':False,'stop':False})
            runner.handoff_requested=Mock(side_effect=[None,None,None,{'id':'handoff','reason':'validation'}])
            with patch('righelt_training.runner.time.monotonic',return_value=1000), \
                 patch('righelt_training.runner.time.sleep') as sleep, \
                 patch('righelt_training.runner.train_round') as train, \
                 patch.object(runner,'next_generation_job') as generate:
                runner.run()
            train.assert_not_called();generate.assert_not_called();self.assertEqual(sleep.call_count,2)
            self.assertEqual(runner.state['pendingGenerationJob'],pending)
            self.assertEqual(json.loads(Path(directory,'runner-result.json').read_text())['reason'],'validation-handoff')

    def test_rollback_to_deferred_checkpoint_cannot_relaunch_consumed_id(self):
        with tempfile.TemporaryDirectory() as directory:
            runner=self.runner(directory)
            runner.next_generation_job(time.monotonic()+30)
            checkpoint=copy.deepcopy(runner.state)
            launched=runner.next_generation_job(time.monotonic()+120)
            runner.state=checkpoint
            runner.restore_admission_claims()
            self.assertEqual(runner.state['admissionUnobservedClaims'],[launched['id']])
            resumed=runner.next_generation_job(time.monotonic()+120)
            self.assertNotEqual(resumed['id'],launched['id'])
            events=[json.loads(line) for line in Path(directory,'runner-events.jsonl').read_text().splitlines()]
            self.assertTrue(any(e['type']=='admission-pending-consumed' and e['id']==launched['id'] for e in events))
            self.assertNotIn('admissionDurations',runner.state)  # No invented duration or success.

    def test_recovered_completed_duration_is_not_reported_unobserved(self):
        with tempfile.TemporaryDirectory() as directory:
            runner=self.runner(directory);job=runner.next_generation_job(time.monotonic()+120)
            observe(runner.state,directory,job_id=job['id'],kind=job['kind'],phase='generation',seconds=5,censored=False)
            runner.restore_admission_claims()
            self.assertEqual(runner.state['admissionUnobservedClaims'],[])

    def test_global_runway_stops_and_checkpoint_overrun_does_not_spawn(self):
        with tempfile.TemporaryDirectory() as directory:
            runner=self.runner(directory);runner.deadline=time.monotonic()+70
            self.assertIsNone(runner.next_generation_job(runner.deadline-10))
            self.assertEqual(runner.state['admissionStop'],'insufficient-generation-runway')
            runner.deadline=1000
            with patch('righelt_training.runner.time.monotonic',side_effect=[100,125]):
                self.assertIsNone(runner.next_generation_job(200))
            self.assertEqual(runner.state['generationLaunched'],0)
            self.assertIsNotNone(runner.state['pendingGenerationJob'])

    def test_invalid_observation_never_appends(self):
        with tempfile.TemporaryDirectory() as directory:
            for seconds in (float('nan'),float('inf'),-1):
                with self.assertRaises(ValueError):
                    observe({},directory,job_id='x',kind='normal',phase='generation',seconds=seconds,censored=True)
            self.assertFalse(Path(directory,'admission-durations.jsonl').exists())


if __name__=='__main__':unittest.main()
