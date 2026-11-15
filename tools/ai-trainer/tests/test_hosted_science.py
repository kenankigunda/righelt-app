import copy
import hashlib
import json
import tempfile
from pathlib import Path
import unittest
from unittest.mock import patch
from righelt_training.hosted_science import validate_adapter_stage,teacher
from righelt_training.hosted_science import refreshed_policy,apply_policy_refresh,validate_schedule

class HostedScienceTest(unittest.TestCase):
    def example(self):
        profile={'simulations':64,'temperature':1,'maxValueGap':.1}
        row={'id':'fresh-1','gameId':'g1','targetOrigin':'fresh-self-play','partition':'train','controller':'P1','stateHash':'a'*64,
             'policyMask':True,'policy':[{'index':1,'probability':1.0}],'terminalMask':False,'terminalValue':0.,'encoded':[0.,1.], 'legal':[1,2]}
        answer={'status':'ready','stopped':'complete','fallback':None,'policyMask':True,'legality':{'complete':True,'indices':[1,2]},
                'simulations':64,'policy':[{'index':2,'probability':1.0}],'value':.7,'nodes':65,'engineBudget':{},
                'searchIdentity':{'requestedProfile':profile,'stateHash':'a'*64,'controller':'P1','valuePerspective':'P1'}}
        return row,answer,profile
    def test_policy_refresh_preserves_actual_observed_values_and_masks(self):
        row,answer,profile=self.example();before=copy.deepcopy(row)
        result=refreshed_policy(row,answer,profile)
        self.assertEqual(row,before)
        self.assertEqual(result['policy'],[{'index':2,'probability':1.0}])
        self.assertEqual((result['terminalValue'],result['terminalMask'],result['policyMask']),(0.,False,True))
        self.assertEqual(result['teacherEstimatedValue'],.7)
        with tempfile.TemporaryDirectory() as temp:
            path=Path(temp)/'targets.json';path.write_text(json.dumps([result]));binding={'path':str(path),'sha256':hashlib.sha256(path.read_bytes()).hexdigest()}
            out=apply_policy_refresh([row],binding)
            self.assertEqual(out,[{**before,'policy':[{'index':2,'probability':1.0}]}])
            result['terminalMask']=True;path.write_text(json.dumps([result]));binding['sha256']=hashlib.sha256(path.read_bytes()).hexdigest()
            with self.assertRaisesRegex(ValueError,'observed label or mask'):apply_policy_refresh([row],binding)
    def test_cutoff_forced_historical_incomplete_wrong_controller_cannot_be_target(self):
        for change in ('cutoff','forced','historical','partial','controller','work'):
            row,answer,profile=self.example()
            if change=='cutoff':answer['stopped']='node-limit'
            if change=='forced':row['legal']=[1]
            if change=='historical':row['targetOrigin']='human-archive'
            if change=='partial':answer['legality']['complete']=False
            if change=='controller':answer['searchIdentity']['controller']='P2'
            if change=='work':answer['simulations']=32
            with self.subTest(change=change),self.assertRaises(ValueError):refreshed_policy(row,answer,profile)
    def test_prospective_schedule_requires_all_profiles_both_seats_and_locked_candidate(self):
        profiles={'schema':1,'sourceSha256':'f'*64,'profiles':{name:{'simulations':n} for name,n in [('babs',8),('tau',32),('horus',128)]}}
        jobs=[{'id':name+seat,'pairId':name,'profile':name,'candidateSeat':seat,'role':'candidate','partition':'validation','familyId':'family1','sourceFamily':'source1','seed':12,'gameSeconds':900} for name in profiles['profiles'] for seat in ('P1','P2')]
        plan={'schema':1,'kind':'prospective-public-profile-evaluation','profiles':profiles,'candidateSha256':'a'*64,'schedule':jobs}
        temp=tempfile.TemporaryDirectory();self.addCleanup(temp.cleanup)
        families=Path(temp.name)/'families.json';families.write_text(json.dumps({'schema':1,'families':[{'id':'family1','partition':'validation','sourceFamily':'source1'}]}))
        binding={'path':str(families),'sha256':hashlib.sha256(families.read_bytes()).hexdigest()}
        plan['familyInventory']=binding
        execution={'scientific':{'candidateSha256':'a'*64,'familyInventorySha256':binding['sha256']}}
        self.assertEqual(validate_schedule(plan,profiles,[j['id'] for j in jobs],execution),jobs)
        for change in ('seat','profile','candidate'):
            bad=copy.deepcopy(plan)
            if change=='seat':bad['schedule'][1]['candidateSeat']='P1'
            if change=='profile':bad['schedule']=bad['schedule'][:-2]
            if change=='candidate':bad['candidateSha256']='b'*64
            with self.subTest(change=change),self.assertRaises(ValueError):validate_schedule(bad,profiles,[j['id'] for j in bad['schedule']],execution)

    def test_stage_and_nested_final_material_cannot_escape_adapter(self):
        for command,stage,plan in [('training','evaluation',{}),('teacher','training',{}),('training','calibration',{'nativeManifest':{'finalFamilies':{}}}),('teacher','teacher-screen',{'nested':[{'partition':'final'}]})]:
            with self.subTest(command=command,stage=stage),self.assertRaises(ValueError):validate_adapter_stage({'scientific':{'stage':stage}},command,plan)
        validate_adapter_stage({'scientific':{'stage':'calibration'}},'training',{})
        validate_adapter_stage({'scientific':{'stage':'calibration'}},'evaluation',{})

    def test_settled_teacher_result_is_recovered_with_no_new_search_runway(self):
        class Model:
            def to(self,*args):return self
            def eval(self):return self
        root=Path.cwd()/'.ai-runs';root.mkdir(exist_ok=True)
        with tempfile.TemporaryDirectory(dir=root) as temp:
            run=Path(temp);row={'id':'devcase','partition':'validation','stateHash':'a'*64,'controller':'P1','legal':[1,2]}
            rows=run/'rows.json';rows.write_text(json.dumps([row]))
            cp=run/'teacher.pt';cp.write_bytes(b'tensor-dependency-stub');cp.with_suffix('.json').write_text(json.dumps({'manifestSha256':'old'}))
            profile={'simulations':64,'temperature':1,'maxValueGap':.1}
            binding={'path':str(cp),'sha256':hashlib.sha256(cp.read_bytes()).hexdigest()}
            plan={'kind':'policy-only-teacher-refresh','mode':'screen','rows':{'path':str(rows),'sha256':hashlib.sha256(rows.read_bytes()).hexdigest()},'teacher':binding,'profile':profile,'searchSeconds':30}
            execution={'scientific':{'stage':'teacher-screen','experimentSha256':'a'*64},'generation':2,'sourceRevision':'b'*40,'manifestSha256':'c'*64,'phase':'screen'}
            retained={'id':'devcase','teacherSha256':binding['sha256'],'sourceRevision':execution['sourceRevision'],'requestedProfile':profile,'mode':'screen','status':'complete','answer':{'status':'ready','stopped':'complete','simulations':64,'legality':{'complete':True,'indices':[1,2]},'searchIdentity':{'stateHash':'a'*64,'controller':'P1','valuePerspective':'P1','requestedProfile':profile}}}
            with patch('righelt_training.model.model_from_record',return_value=Model()),patch('righelt_training.checkpoint.load_checkpoint'),patch('righelt_training.device.selected_device',return_value='cpu'),patch('righelt_training.hosted_receipts.evaluation_claim',return_value={'created':False,'result':retained}) as claim,patch('righelt_training.search_parity.search_reference',side_effect=AssertionError('new search forbidden')) as search:
                result=teacher(plan,run,execution,['devcase'],seconds=.01)
            self.assertEqual(result['completedWorkIds'],['devcase']);self.assertTrue(result['allWorkComplete'])
            self.assertFalse(claim.call_args.kwargs['create']);search.assert_not_called()

    def test_entrypoint_rejects_plan_bytes_that_differ_from_bound_execution(self):
        from righelt_training.hosted_science import main
        import os
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);plan=root/'plan.json';plan.write_text('{}')
            context=root/'context.json';context.write_text(json.dumps({'execution':{'scientific':{'stage':'evaluation'},'planSha256':'f'*64},'completedWorkIds':[]}))
            with patch.dict(os.environ,{'RIGHELT_EXECUTION_CONTEXT':str(context)}),patch('sys.argv',['hosted_science','evaluation','--plan',str(plan),'--run-dir',str(root/'out'),'--seconds','1']):
                with self.assertRaisesRegex(ValueError,'plan differs'):main()

if __name__=='__main__':unittest.main()
