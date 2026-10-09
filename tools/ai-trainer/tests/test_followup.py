"""Follow-up authority and deadline fixtures. No trained models or live games."""
import copy
import hashlib
import json
from pathlib import Path
import tempfile
import time
import unittest
from unittest.mock import Mock, patch

from righelt_training import followup_policy as followup
from righelt_training.allocation import Allocation, append, validate_contract
from righelt_training.continuation_policy import stage_for_phase
from righelt_training.sequence import immutable
from righelt_training.arena import freeze_plan, run_arena
import test_arena


def fixture(root):
    def save(name, value):
        p=root/name; immutable(p,value); return followup.reference(p)
    predecessor=root/'restart-eight-hour-r1'; predecessor.mkdir()
    checkpoint=predecessor/'checkpoints/checkpoint-001262.pt';checkpoint.parent.mkdir();checkpoint.write_bytes(b'fixture trained recovery')
    origin={'seed':107,'stage':'initial'}
    digest=hashlib.sha256(json.dumps(origin,sort_keys=True,allow_nan=False).encode()).hexdigest()
    save('restart-eight-hour-r1/manifest.json',{'manifest':origin,'sha256':digest})
    save('restart-eight-hour-r1/checkpoints/checkpoint-001262.json',{'sha256':followup.reference(checkpoint)['sha256'],'manifestSha256':digest})
    save('restart-eight-hour-r1/checkpoints/checkpoint-001262.runner.json',{'state':'fixture exact retained cursor'})
    creation={'event':'created','allocation':str(predecessor),'stage':'initial','seconds':28800,'id':'prior'}
    append(root/'allocation-events.jsonl',creation)
    adoption=save('restart-eight-hour-r1/recipe-adoption.json',{'fixture':'unaltered adoption'})
    recipe={'id':'baseline-v1','sha256':'c'*64}
    stage={'phase':'eight-hour','sequenceId':'sequence','experimentComplete':True,'healthAudited':True,'healthPassed':False,
           'continuationAllowed':False,'advancementEligible':False,'recoveryCheckpoint':str(checkpoint),
           'recoverySha256':followup.reference(checkpoint)['sha256'],'explorationAdoption':adoption,'trainingRecipe':recipe,
           'health':{'explorationAdoption':adoption,'trainingRecipe':recipe}}
    stage_ref=save('restart-eight-hour-r1/stage-result.json',stage)
    save('restart-eight-hour-r1/experiment-finished.json',{'result':stage_ref})
    prior=save('sequence/reports/eight-hour.json',{**stage,'evidence':stage_ref['path'],'evidenceSha256':stage_ref['sha256'],
                                                'allocationId':'prior','chargedSeconds':0})
    cleanup=save('cleanup.json',{'observedAt':100,'allocation':{'id':'prior','chargedSeconds':0,'openIntervals':[]},
                               'processes':[{'matchingLive':False}],'locks':{'coordinator':'free','supervisor':'free'}})
    authority=save('authority.json',{'source':'Direct human message fixture','requestText':'One follow-up after evaluation, then stop.',
                                   'authorization':{'followupRuns':1,'followupBudgetSeconds':28800}})
    design=save('design.json',{'status':'frozen','selectedAt':101,'predecessor':prior,'authority':authority,'policy':followup.POLICY})
    review=save('review.json',{'passed':True,'design':design})
    value={'schema':1,'kind':followup.KIND,'sequenceId':'sequence','phase':followup.PHASE,'stopAfter':True,
           'budgetSeconds':28800,'reserveSeconds':7200,'runDirectory':str(root/'followup-eight-hour-r1'),
           'authority':authority,'predecessorReport':prior,'predecessorCleanup':cleanup,'recoveryCheckpoint':followup.reference(checkpoint),
           'recoveryMetadata':followup.reference(checkpoint.with_suffix('.json')),
           'recoverySidecar':followup.reference(checkpoint.with_suffix('.runner.json')),'design':design,'designReview':review,
           'explorationAdoption':adoption,'trainingRecipe':recipe,
           'sourceLineage':{'preparedRevision':'a'*40,'regressionEvidence':[review],'reviewEvidence':[review]}}
    evidence=root/'authorization.json';immutable(evidence,value)
    return value,evidence


class FollowupAuthorityTests(unittest.TestCase):
    def setUp(self):
        self.tmp=self.enterContext(tempfile.TemporaryDirectory());self.root=Path(self.tmp).resolve()
        self.value,self.evidence=fixture(self.root)

    def test_one_registration_is_idempotent_but_cannot_authorize_third_or_reopen_old(self):
        old=(self.root/'restart-eight-hour-r1/stage-result.json').read_bytes()
        ref=followup.register(self.root,self.evidence)
        self.assertEqual(ref,followup.register(self.root,self.evidence))
        contract=followup.contract_for(self.value,ref)
        # Authorization dispatch is independent of the old, already closed amendment.
        self.assertEqual(followup.authorize(contract,self.root,self.value['runDirectory']),self.value)
        self.assertEqual(stage_for_phase(contract['phase']),'initial')
        with patch('righelt_training.exploration_adoption.validate',return_value={'sequenceId':'sequence','trainingRecipe':self.value['trainingRecipe']}):
            validate_contract(contract,self.root,self.value['runDirectory'])
            allocation=Allocation(self.root,self.value['runDirectory'])
            created=allocation.create_continuation(contract)
            self.assertEqual(created['stage'],'initial');self.assertEqual(created['seconds'],28800)
            self.assertEqual(created,allocation.create_continuation(contract))
            interval,remaining,charged=allocation.begin('training')
            self.assertEqual((remaining,charged),(28800,0))
            allocation.finish(interval['id'],reason='fixture-completed')
            with self.assertRaises(ValueError):Allocation(self.root,self.root/'third').create_continuation(contract)
        with self.assertRaisesRegex(ValueError,'destination'):
            followup.authorize(contract,self.root,self.root/'third')
        with self.assertRaisesRegex(ValueError,'contract differs'):
            followup.authorize({**contract,'budgetSeconds':32400},self.root)
        with self.assertRaisesRegex(ValueError,'contract differs'):
            followup.authorize({**contract,'explorationAdoption':{'path':'different','sha256':'f'*64}},self.root)
        self.assertEqual(old,(self.root/'restart-eight-hour-r1/stage-result.json').read_bytes())

    def test_seed_and_stage_rejected_before_launch(self):
        contract=followup.contract_for(self.value,followup.reference(self.evidence))
        followup.validate_launch(contract,107,'initial')
        for seed,stage in ((108,'initial'),(107,'overnight')):
            with self.assertRaisesRegex(ValueError,'seed 107'):followup.validate_launch(contract,seed,stage)
        with self.assertRaisesRegex(ValueError,'seed 107'):followup.validate_launch({**contract,'seed':108},107,'initial')
        with self.assertRaisesRegex(ValueError,'contract differs'):
            followup.register(self.root,self.evidence)
            followup.authorize({**contract,'seed':108},self.root)

    def test_changed_predecessor_or_authority_never_passes_a_receipt_check(self):
        for field in ('authority','predecessorReport','predecessorCleanup','recoveryCheckpoint','recoverySidecar','design','designReview'):
            with self.subTest(field=field):
                changed=copy.deepcopy(self.value);changed[field]['sha256']='0'*64
                with self.assertRaises(ValueError):followup.validate(changed,self.root)

    def test_live_or_unsettled_predecessor_is_rejected(self):
        a=Allocation(self.root,self.root/'restart-eight-hour-r1')
        append(a.path,{'event':'started','allocation':a.key,'id':'unsettled'})
        with self.assertRaisesRegex(ValueError,'not settled'):followup.validate(self.value,self.root)

    def test_selection_before_terminal_cleanup_and_unreviewed_design_are_rejected(self):
        design=Path(self.value['design']['path']);data=json.loads(design.read_text());data['selectedAt']=99;design.write_text(json.dumps(data))
        value=copy.deepcopy(self.value);value['design']=followup.reference(design)
        review=Path(value['designReview']['path']);review.write_text(json.dumps({'passed':True,'design':value['design']}));value['designReview']=followup.reference(review)
        with self.assertRaisesRegex(ValueError,'selected after'):followup.validate(value,self.root)
        data['selectedAt']=101;design.write_text(json.dumps(data));value['design']=followup.reference(design)
        review.write_text(json.dumps({'passed':False,'design':value['design']}));value['designReview']=followup.reference(review)
        with self.assertRaisesRegex(ValueError,'independently reviewed'):followup.validate(value,self.root)

    def test_completed_followup_has_no_new_compute_even_with_unused_budget(self):
        run=self.root/'followup-eight-hour-r1';run.mkdir()
        followup.ensure_open(run)
        immutable(run/'stage-result.json',{'experimentComplete':True,'healthPassed':False})
        with self.assertRaisesRegex(ValueError,'no further'):followup.ensure_open(run)
        (run/'stage-result.json').unlink();immutable(run/'experiment-finished.json',{'fixture':'terminal'})
        with self.assertRaisesRegex(ValueError,'no further'):followup.ensure_open(run)


class FollowupArenaTests(unittest.TestCase):
    def frozen(self,root,seconds=7200):
        plan=test_arena.ArenaTest().plan('validation');pairs=plan['pairs'];plan.update(mode='diagnostic',purpose='incumbent',
            workload=followup.POLICY['workload'],decisionCache=False,pairs=[pairs[i] for i in (0,50,1,51)])
        for who in ('candidate','opponent'):
            plan[who]={**plan[who],'profile':followup.POLICY['profile'],'profileVersion':followup.POLICY['profileVersion']}
        plan['opponent']={**plan['opponent'],'checkpointSha256':'b'*64}
        path=root/'plan.json'
        with patch('righelt_training.arena.engine_command',side_effect=[{'initial':False,'fingerprint':str(i)} for i in range(2)]):
            freeze_plan(path,plan,experiment_root=root)
        now=time.monotonic();runtime={'allocationId':'followup','manifestSha256':'m','continuationPhase':followup.PHASE,
            'deadlineMonotonic':now+seconds,'startedMonotonic':now}
        (root/'runtime.json').write_text(json.dumps(runtime));(root/'allocation.json').write_text(json.dumps({'paused':False,'workers':2,'observedAt':time.time()}))
        return path,[now]

    def game(self,job):
        self.assertEqual(job['evaluationWorkload'],followup.POLICY['workload'])
        self.assertEqual(job['profiles']['P1'],job['profiles']['P2'])
        return {'status':'completed','game':{**job,'termination':'terminal','decisions':[],'outcome':{'status':'draw'}}}

    def test_pair_admission_preserves_cleanup_floor_and_reports_unstarted_mix(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);plan,clock=self.frozen(root);calls=[]
            def player(job,*args,**kwargs):
                calls.append(job['id']);clock[0]+=900;return self.game(job)
            result=run_arena(plan,root,{'candidate':'a','opponent':'b'},'cpu',clock=lambda:clock[0],player=player)
            self.assertEqual(len(calls),4);self.assertEqual(result['completedPairMix'],{'normal':1,'heldout':1})
            self.assertEqual(result['unstartedGames'],4);self.assertEqual(result['reason'],'budget')
            self.assertEqual(result['status'],'inconclusive');self.assertIsNone(result['statistics'])
            self.assertFalse(result['strengthAcceptanceEligible']);self.assertEqual(result['cleanupSeconds'],300)

    def test_no_game_launch_when_a_whole_pair_cannot_fit(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);plan,clock=self.frozen(root,seconds=3959);player=Mock(side_effect=AssertionError('must not start'))
            result=run_arena(plan,root,{'candidate':'a','opponent':'b'},'cpu',clock=lambda:clock[0],player=player)
            player.assert_not_called();self.assertEqual(result['unstartedGames'],8)

    def test_expected_unfinished_is_preserved_without_retry_or_strength_statistics(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);plan,clock=self.frozen(root,seconds=20000);calls=[]
            def player(job,*args,**kwargs):
                calls.append(job['id'])
                return {'status':'unfinished','reason':'inference-budget'} if len(calls)==1 else self.game(job)
            result=run_arena(plan,root,{'candidate':'a','opponent':'b'},'cpu',clock=lambda:clock[0],player=player)
            self.assertEqual(len(calls),8);self.assertEqual(result['completedGames'],7);self.assertEqual(result['unfinishedByReason'],{'inference-budget':1})
            self.assertIsNone(result['statistics']);self.assertFalse(result['strengthAcceptanceEligible'])
            never=Mock(side_effect=AssertionError('completed sweep cannot be replayed'))
            again=run_arena(plan,root,{'candidate':'a','opponent':'b'},'cpu',clock=lambda:clock[0],player=never)
            never.assert_not_called();self.assertEqual(again['completedGames'],7)

    def test_wrong_allocation_and_asymmetric_search_settings_rejected(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);plan,clock=self.frozen(root);runtime=json.loads((root/'runtime.json').read_text());runtime['continuationPhase']='eight-hour'
            (root/'runtime.json').write_text(json.dumps(runtime))
            with self.assertRaisesRegex(ValueError,'own authorized allocation'):
                run_arena(plan,root,{},'cpu',player=Mock())
            raw=json.loads(plan.read_text())['plan'];raw['candidate']['profile']={**raw['candidate']['profile'],'simulations':8}
            with self.assertRaisesRegex(ValueError,'identical and frozen'):freeze_plan(root/'bad.json',raw,experiment_root=root)
