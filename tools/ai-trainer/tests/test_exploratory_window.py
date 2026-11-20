import copy
import json
from pathlib import Path
import tempfile
import unittest

from righelt_training import exploratory_contract as contract
from righelt_training import fresh_health
from righelt_training.checkpoint import inspect_checkpoint,atomic_json
import test_fresh_health as fixtures
import test_resource_recovery as resource_fixtures
from unittest.mock import patch


class ExploratoryContractTest(unittest.TestCase):
    def plan(self):
        ref={'path':'.ai-runs/input','sha256':'a'*64}
        return {'schema':1,'kind':'attention-exploratory-window','lane':'A','seed':17,'stage':'initial',
            'runDir':'.ai-runs/tonight-A','trainingStopWall':1795183200,'artifactDeadlineWall':1795190400,
            'authorizationReference':'Kenan approved overnight training','sourceRevision':'b'*40,
            'nativeManifest':{'sourceRevision':'b'*40,'seed':17,'stage':'initial','warmStart':ref,'executionBackend':'mps',
                'modelArchitecture':{'id':'board-attention-48x2-v1'}},
            **{key:copy.deepcopy(ref) for key in ('checkpoint','trainingRecipe','executionRecipe','portableClosure')}}

    def test_exact_dates_and_contained_run_are_required(self):
        self.assertEqual(contract.validate(self.plan())['trainingStopWall'],1795183200)
        for field,value in [('trainingStopWall',1795183201),('artifactDeadlineWall',1795190401),
                            ('runDir','/tmp/escape'),('runDir','.ai-runs/../escape'),('seed',True)]:
            plan=self.plan();plan[field]=value
            with self.subTest(field=field,value=value),self.assertRaises(ValueError):contract.validate(plan)

    def test_two_resumes_are_consumed_durably_without_resetting_deadline(self):
        with tempfile.TemporaryDirectory() as temporary:
            path=Path(temporary)
            contract.consume_resume(path,'resource-pressure-stop',1795179600)
            contract.consume_resume(path,'transport-interruption',1795179660)
            with self.assertRaisesRegex(ValueError,'allowance exhausted'):
                contract.consume_resume(path,'resource-pressure-stop',1795179720)
            rows=[json.loads(line) for line in (path/'exploratory-recovery.jsonl').read_text().splitlines() if json.loads(line)['event']=='resume-consumed']
            self.assertEqual([r['ordinal'] for r in rows],[1,2])
            self.assertTrue(all(r['trainingStopWall']==1795183200 for r in rows))
            with self.assertRaisesRegex(ValueError,'unclassified'):
                contract.consume_resume(path,'correctness',1795179720)

    def test_expired_resume_cannot_reopen_training(self):
        with tempfile.TemporaryDirectory() as temporary:
            with self.assertRaises(ValueError):contract.consume_resume(temporary,'resource-pressure-stop',1795183200)
            self.assertFalse((Path(temporary)/'exploratory-recovery.jsonl').exists())

    def test_repair_wait_is_bounded_but_healthy_training_does_not_consume_repair(self):
        with tempfile.TemporaryDirectory() as temporary:
            contract.start_repair(temporary,100)
            contract.finish_repair(temporary,200)
            contract.check_repair(temporary,10000)
            contract.start_repair(temporary,10000)
            with self.assertRaisesRegex(ValueError,'repair window exhausted'):contract.check_repair(temporary,17100)

    def test_launch_gate_uses_bound_backend_proof_without_terminal_or_tactical_counts(self):
        import hashlib
        from righelt_training.config import CONFIG_SHA256
        with tempfile.TemporaryDirectory() as temporary:
            proof=Path(temporary)/'backend-proof.json';numeric=Path(temporary)/'numeric.json'
            plan={'checkpoint':{'sha256':'c'*64},'executionRecipe':{'sha256':'d'*64}}
            def bind(path):return {'path':str(path),'sha256':hashlib.sha256(path.read_bytes()).hexdigest()}
            numeric.write_text(json.dumps({'schema':2,'referenceDevice':'mps','numericPassed':True,
                'onnxSha256':'e'*64,'inputShape':[32,46,10,10],'arithmetic':{'policyApplied':True},
                'batches':[{'comparisons':{key:{'passed':True,
                    'outputs':[{'abiPassed':True,'finite':True},{'abiPassed':True,'finite':True}]}
                    for key in ('torchCpuToOrtCpu','torchReferenceToTorchCpu','torchReferenceToOrtCpu')}}]}))
            report={'schema':1,'kind':'disposable-local-mps-preflight','passed':True,'backend':'mps',
                'sourceRevision':'a'*40,'configSha256':CONFIG_SHA256,'inputCheckpointSha256':'c'*64,
                'executionRecipeSha256':'d'*64,'updates':1,'parameterDelta':.5,'teacherLoaded':True,
                'freshBaselineInitialized':True,'checkpointRecoveryPassed':True,'numericParityPassed':True,
                'abiPassed':True,'originalCheckpointUnchanged':True,'numericReport':bind(numeric),
                'export':{'sha256':'e'*64,'dtype':'float32','opset':17,'configSha256':CONFIG_SHA256}}
            proof.write_text(json.dumps(report));evidence=bind(proof)
            gate={'schema':1,'kind':'exploratory-launch-gate','sourceRevision':'a'*40,'configSha256':CONFIG_SHA256,
                  'proofDependencies':{'fixture':'b'*64},'checks':{name:{'passed':True,'evidence':evidence}
                      for name in ('coreTests','trainerTests','exactReplay','targetBackend')}}
            gate['checks']['targetBackend'].update(backend='mps',restorePassed=True,checkpointRecoveryPassed=True,
                finiteUpdatePassed=True,numericPassed=True,abiPassed=True)
            with patch('righelt_training.manifest.dependency_inventory',return_value={'fixture':'b'*64}):
                self.assertEqual(contract.validate_gate(gate,'a'*40,'mps',plan),gate)
                with self.assertRaises(ValueError):contract.validate_gate(gate,'a'*40,'cuda',plan)
                for field,value in [('backend','cuda'),('inputCheckpointSha256','f'*64),
                                    ('executionRecipeSha256','f'*64),('sourceRevision','f'*40)]:
                    bad=copy.deepcopy(report);bad[field]=value;proof.write_text(json.dumps(bad))
                    evidence.update(bind(proof))
                    with self.subTest(field=field),self.assertRaisesRegex(ValueError,'planned continuation'):
                        contract.validate_gate(gate,'a'*40,'mps',plan)
                proof.write_text('{"unrelated":"proof"}');evidence.update(bind(proof))
                with self.assertRaisesRegex(ValueError,'planned continuation'):contract.validate_gate(gate,'a'*40,'mps',plan)
                proof.write_text(json.dumps(report));evidence.update(bind(proof))
                proof.write_text('changed')
                with self.assertRaisesRegex(ValueError,'checksum'):contract.validate_gate(gate,'a'*40,'mps',plan)


class ExploratoryPolicyWitnessTest(unittest.TestCase):
    def setUp(self):
        self.fixture=fixtures.FreshHealthTest(methodName='runTest');self.fixture.setUp()
        self.addCleanup(self.fixture.doCleanups)
        _,self.runner,_=self.fixture.fixture()
        baseline=self.runner.fresh_baseline
        baseline['baseline']['continuation']['policyOnlyFresh']=True
        baseline['sha256']=fresh_health.digest(baseline['baseline'])
        self.runner.state[fresh_health.STATE_KEY]['baselineSha256']=baseline['sha256']
        atomic_json(self.runner.directory/fresh_health.BASELINE_NAME,baseline)

    def audit_selected(self):
        checkpoint=self.fixture.publish(self.runner)
        recovered=inspect_checkpoint(checkpoint,manifest_sha256=self.runner.manifest_hash,require_recovery=True)
        state=recovered['recovery']['state']
        games={name:fresh_health.read_game(self.runner.directory/name) for name in state['archives']}
        return fresh_health.audit_evidence(self.runner.directory,state,self.runner.fresh_baseline,games)

    def test_actual_truncated_policy_update_survives_checkpoint_without_terminal_target(self):
        record=fixtures.game(1,terminal=False);self.fixture.accept(self.runner,record)
        self.fixture.train(self.runner,[self.runner.buffer.positions[-1]])
        proof=self.audit_selected()
        self.assertTrue(proof['freshExamplesUsed'])
        self.assertEqual(proof['freshTerminalGames'],0)
        self.assertEqual(proof['freshValueExamples'],0)
        self.assertEqual(proof['freshPolicyExamples'],1)
        self.assertEqual(proof['freshPolicySamples'],1)
        self.assertGreater(proof['freshFiniteNonzeroUpdates'],0)
        self.assertFalse(self.runner.buffer.positions[-1]['terminalMask'])

    def test_masked_or_unsampled_fresh_decisions_do_not_qualify(self):
        self.fixture.accept(self.runner,fixtures.game(1,terminal=False,masked=True))
        self.fixture.accept(self.runner,fixtures.game(2,terminal=False))
        self.fixture.train(self.runner,[self.runner.buffer.positions[0]])
        proof=self.audit_selected()
        self.assertFalse(proof['freshExamplesUsed'])
        self.assertEqual(proof['freshPolicySamples'],0)

    def test_witness_cannot_invent_terminal_value_or_sample_count(self):
        self.fixture.accept(self.runner,fixtures.game(1,terminal=False))
        self.fixture.train(self.runner,[self.runner.buffer.positions[-1]])
        batch=self.runner.state[fresh_health.STATE_KEY]['batches'][-1]
        batch['valueExamples']=copy.deepcopy(batch['policyExamples']);batch['freshValueSampleCount']=1
        with self.assertRaisesRegex(ValueError,'masked or missing'):
            self.audit_selected()


class ExploratoryResourceResumeTest(unittest.TestCase):
    def test_resource_restart_refreshes_exact_checkpoint_context_before_second_spawn(self):
        fixture=resource_fixtures.ResourceRecoveryTest(methodName='runTest');fixture.setUp()
        self.addCleanup(fixture.doCleanups)
        fixture.runtime['exploratoryPlanSha256']='a'*64
        atomic_json(fixture.directory/'plan.json',{'checkpoint':{'sha256':'b'*64}})
        def recovered(*args,**kwargs):
            atomic_json(fixture.directory/'latest.json',{'checkpoint':str(fixture.directory/'new.pt'),'sha256':'c'*64})
            return fixture.directory/'new.pt',{'updates':17}
        fixture.latest.side_effect=recovered
        contexts=[]
        def started(*args,**kwargs):
            contexts.append(json.loads((fixture.directory/'exploratory-context.json').read_text()))
            return fixture.process
        fixture.start.side_effect=started
        from righelt_training import supervisor
        from righelt_training.budget import Budget
        with patch('righelt_training.execution_recipe.verify_runtime',return_value={'dataSha256':'d'*64}), \
             patch('righelt_training.supervisor.time.time',return_value=1795179600):
            reason,_=supervisor.run_phase(['python','runner','--resume','old.pt'],
                {'RIGHELT_EXPLORATORY_LOCAL':'1'},None,Budget(0,600),fixture.runtime,fixture.directory,
                fixture.directory,fixture.directory/'activity.json',clock=lambda:fixture.now,sleep=fixture.sleep)
        self.assertEqual(reason,'completed')
        self.assertEqual(contexts[0]['recoveryFiles'],[])
        self.assertEqual(contexts[1]['recoveryFiles'],[{'path':str(fixture.directory/'new.pt'),'sha256':'c'*64}])
        resumes=[r for r in (fixture.directory/'exploratory-recovery.jsonl').read_text().splitlines()
                 if json.loads(r)['event']=='resume-consumed']
        self.assertEqual(len(resumes),1)


if __name__=='__main__':unittest.main()
