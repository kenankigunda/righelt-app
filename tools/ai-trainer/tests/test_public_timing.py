"""Synthetic contract tests. No model inference, engine execution, source supply or paid work."""
import copy
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from righelt_training import public_timing as timing
from righelt_training import hosted_receipts


class Barrier:
    def __init__(self):self.records={};self.generation=1;self.fail=False;self.after_claim=lambda:None
    def evaluation_claim(self,namespace,identity,*,create):
        key=(namespace,identity)
        if key in self.records:return {'created':False,**copy.deepcopy(self.records[key])}
        if not create:return {'created':False,'unclaimed':True}
        self.records[key]={'record':{'generation':self.generation}};self.after_claim()
        return {'created':True}
    def settle(self,namespace,identity,value):
        if self.fail:raise hosted_receipts.HostedInfrastructureError('synthetic uncertain settlement')
        record=self.records[(namespace,identity)]
        if 'result' in record and record['result']!=value:raise ValueError('immutable synthetic result')
        record['result']=copy.deepcopy(value)


class Model:
    runtime={'onnxruntime':'0.0.0-synthetic','kind':'exported-onnx','artifactSha256':'f5b0f38763f290eaecf7f1958738342bb327f42efe95b5021b1f59b2b78f8a0f','providers':['CPUExecutionProvider'],
        'inferenceDevice':'cpu','hostedGpuUsedForInference':False}
    def infer_export(self,_):return [0.],0.


class PublicTimingTest(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        self.root=Path(self.temp.name);self.patch=patch.object(timing,'ROOT',self.root);self.patch.start();self.addCleanup(self.patch.stop)
        self.now=0.;self.barrier=Barrier();self.calls=0;self.truncated=False
        self.profiles={'sourceSha256':'b'*64,'searchSourceSha256':'c'*64,'searchPolicyVersion':'synthetic-v1',
            'schema':1,'profiles':{name:{'version':'synthetic-'+name,'simulations':1} for name in ('babs','tau','horus')}}
        self.start={'schema':1,'startKind':'normal','kind':'normal','stateHash':'d'*64,'constructionSha256':'e'*64}
        self.plan={'schema':1,'kind':'original-incumbent-public-timing-plan','purpose':'public-performance-timing',
            'model':{'kind':'original-public-incumbent-onnx','id':'trained-20261029-1086','path':'.ai-runs/synthetic/model.onnx','sha256':'f5b0f38763f290eaecf7f1958738342bb327f42efe95b5021b1f59b2b78f8a0f','bytes':322842},
            'profiles':self.profiles,'qualifiedRuntimeSha256':'f'*64,'accountingReserveSeconds':10,
            'schedule':[{'id':name+'-'+seat,'profile':name,'referenceSeat':seat,'seed':i,'gameSeconds':30,
                'kind':'normal','startKind':'normal','startIdentity':self.start} for i,(name,seat) in enumerate((n,s) for n in ('babs','tau','horus') for s in ('P1','P2'))]}
        self.ids=[j['id'] for j in self.plan['schedule']]
        self.execution={'generation':1,'sourceRevision':'a'*40,'manifestSha256':'b'*64,'phase':'public-timing',
            'publicTiming':{'schema':1,'modelSha256':self.plan['model']['sha256']}}
        self.context={'phaseDeadline':1120000,'phaseSeconds':120,'inputArtifacts':[],'runtimeArtifact':{'sha256':'c'*64}}
    def clock(self):return self.now
    def start_verify(self,job,game,**_):
        self.assertEqual(game['rootState'],{'synthetic':True});self.assertEqual(game['warmupActions'],[])
        self.assertTrue(list(self.root.glob('.ai-runs/run/raw/*/*.json')))
        self.assertTrue(any(r.get('result',{}).get('status')=='raw-complete' for r in self.barrier.records.values()))
        return self.start
    def verify(self,game,_):self.assertEqual(game['finalHash'],'1'*64);self.now+=1
    def player(self,job,models,deadline,device,*,raw_complete):
        self.calls+=1;self.assertEqual(device,'cpu-onnxruntime');self.assertNotIn('partition',job);self.assertNotIn('familyId',job)
        self.assertEqual(job['modelVersions'],{seat:self.plan['model']['sha256'] for seat in ('P1','P2')})
        for seat in ('P1','P2'):models[seat].infer_export([0.]);self.now+=.001
        self.now+=5
        game={'id':job['id'],'purpose':'public-performance-timing','seed':job['seed'],'kind':'normal',
            'modelVersions':job['modelVersions'],'profileVersions':job['profileVersions'],
            'evaluationProfile':job['evaluationProfile'],'rootState':{'synthetic':True},'initialState':{'synthetic':True},'warmupActions':[],
            'termination':'truncated' if self.truncated else 'terminal','truncationReason':'decision-cap' if self.truncated else None,
            'outcome':{'status':'ongoing' if self.truncated else 'draw'},'finalHash':'1'*64}
        raw_complete(game)
        return {'status':'completed','game':game}
    def run_timing(self,**changes):
        options={'context':self.context,'seconds':120,'barrier':self.barrier,'profiles':self.profiles,
            'start_expected':lambda jobs,**_:[self.start for _ in jobs],'start_verify':self.start_verify,'verify':self.verify,
            'model_factory':lambda _:Model(),'player':self.player,'clock':self.clock,'wall':lambda:1000.+self.now}
        options.update(changes)
        with patch('righelt_training.prospective_durability.time.monotonic',self.clock):
            return timing.execute(self.plan,self.root/'.ai-runs/run',self.execution,self.ids,**options)
    def report(self):return json.loads((self.root/f".ai-runs/run/timing-report-{self.execution['generation']}.json").read_bytes())
    def test_public_all_profile_seat_accounting_and_raw_before_verification(self):
        result=self.run_timing();self.assertTrue(result['accountingComplete']);self.assertTrue(result['scopeCoverageComplete'])
        self.assertEqual(result['completedWorkIds'],self.ids);self.assertEqual(self.calls,6)
        report=self.report();self.assertEqual(report['completedWholeGames'],6);self.assertFalse(report['strengthEstablished'])
        self.assertEqual(report['inferenceCalls'],{'P1':6,'P2':6});self.assertEqual(report['allInCost']['status'],'pending-operator-cleanup-and-billing')
        self.assertEqual(len(report['scopeCells']),6)
    def test_truncation_is_unfinished_not_a_draw_or_completed_throughput(self):
        self.truncated=True;result=self.run_timing();self.assertEqual(result['completedWorkIds'],[])
        report=self.report();self.assertEqual(report['completedWholeGames'],0);self.assertFalse(report['scopeCoverageComplete']);self.assertEqual(report['completedWholeGameMs'],[])
        self.assertEqual(sum(c['unfinished'] for c in report['scopeCells']),6)
    def test_bounded_partial_schedule_keeps_missing_profile_and_seat_cells(self):
        self.plan['schedule']=self.plan['schedule'][:1];self.ids=self.ids[:1]
        result=self.run_timing();self.assertTrue(result['accountingComplete']);self.assertFalse(result['scopeCoverageComplete'])
        self.assertEqual(sum(c['planned']==0 for c in self.report()['scopeCells']),5)
    def test_expiry_during_claim_never_dispatches_a_game(self):
        self.barrier.after_claim=lambda:setattr(self,'now',111.)
        result=self.run_timing();self.assertEqual(self.calls,0);self.assertTrue(result['accountingComplete']);self.assertEqual(result['completedWorkIds'],[])
    def test_no_model_or_game_dispatch_after_original_bound(self):
        self.now=111.;model_calls=[]
        result=self.run_timing(model_factory=lambda x:model_calls.append(x));self.assertEqual(model_calls,[]);self.assertEqual(self.calls,0)
        self.assertEqual(self.report()['completedWholeGames'],0);self.assertTrue(result['accountingComplete'])
    def test_remote_settlement_uncertainty_stops_before_verification(self):
        self.barrier.fail=True
        with self.assertRaises(hosted_receipts.HostedInfrastructureError):self.run_timing()
        self.assertEqual(self.calls,1);self.assertTrue(list(self.root.glob('.ai-runs/run/raw/*/*.json')))
        self.assertFalse(list(self.root.glob('.ai-runs/run/verification/*/*.json')))
    def test_recovery_reuses_raw_and_verification_without_replaying_models(self):
        self.run_timing();original=(self.root/'.ai-runs/run/result-1.json').read_bytes();original_times=self.report()['completedWholeGameMs'];self.barrier.generation=2;self.execution['generation']=2;self.now=60.
        result=self.run_timing(player=lambda *_args,**_kwargs:self.fail('consumed game was replayed'))
        self.assertEqual(self.calls,6);self.assertEqual(result['completedWorkIds'],self.ids);self.assertEqual((self.root/'.ai-runs/run/result-1.json').read_bytes(),original);self.assertEqual(self.report()['completedWholeGameMs'],original_times)
    def test_unfinished_recovery_preserves_original_spent_time_and_inference(self):
        def unfinished(job,models,*args,**kwargs):
            for model in models.values():model.infer_export([0.])
            self.now+=7
            return {'status':'unfinished','reason':'inference-budget'}
        self.run_timing(player=unfinished);before=self.report()
        self.assertEqual(sum(before['unfinishedLowerBoundMs']),42000.)
        self.assertEqual(before['inferenceCalls'],{'P1':6,'P2':6})
        self.execution['generation']=2;self.barrier.generation=2;self.now=60.
        self.run_timing(player=lambda *_args,**_kwargs:self.fail('unfinished work replayed'))
        after=self.report()
        self.assertEqual(after['unfinishedLowerBoundMs'],before['unfinishedLowerBoundMs'])
        self.assertEqual(after['inferenceCalls'],before['inferenceCalls'])
        self.assertEqual(after['completedWholeGameMs'],[])
        self.assertEqual(after['unknownOriginalCostWorkIds'],[])

    def test_consumed_without_settlement_remains_unknown_cost_and_never_redispatches(self):
        namespace='public-timing:'+self.execution['manifestSha256']+':'+self.execution['phase']
        for identity in self.ids:self.barrier.evaluation_claim(namespace,identity,create=True)
        self.run_timing(player=lambda *_args,**_kwargs:self.fail('uncertain consumed job replayed'))
        report=self.report()
        self.assertEqual(report['unknownOriginalCostWorkIds'],self.ids)
        self.assertEqual(report['completedWholeGames'],0)
        self.assertFalse(report['timingCoverageComplete'])

    def test_expired_recovery_preserves_completed_work_without_model_or_game_dispatch(self):
        self.run_timing();before=self.report();self.execution['generation']=2;self.barrier.generation=2;self.now=111.
        result=self.run_timing(model_factory=lambda _:self.fail('expired recovery loaded model'),player=lambda *_a,**_k:self.fail('replayed'))
        self.assertEqual(result['completedWorkIds'],self.ids)
        self.assertEqual(self.report()['completedWholeGameMs'],before['completedWholeGameMs'])
        self.assertEqual(self.report()['inferenceCalls'],before['inferenceCalls'])

    def test_model_reload_failure_recovers_consumed_work_without_dispatch(self):
        self.plan['schedule']=self.plan['schedule'][:1];self.ids=self.ids[:1]
        self.run_timing();before=self.report();self.execution['generation']=2;self.barrier.generation=2;self.now=60.
        def unavailable(_):raise RuntimeError('synthetic reload failure')
        with self.assertRaises(timing.PublicTimingStopped):self.run_timing(model_factory=unavailable,player=lambda *_a,**_k:self.fail('replayed'))
        self.assertEqual(self.report()['completedWholeGames'],len(self.ids))
        self.assertEqual(self.report()['stopCategory'],'model-startup-failure')
        self.assertEqual(self.report()['completedWholeGameMs'],before['completedWholeGameMs'])
        self.assertEqual(self.report()['inferenceCalls'],before['inferenceCalls'])

    def test_local_timeout_advances_to_independent_successes_and_publishes_each_prefix(self):
        published=[];normal=self.player
        def player(job,*args,**kwargs):
            if job['id']==self.ids[0]:self.now+=3;raise TimeoutError('synthetic local bound')
            return normal(job,*args,**kwargs)
        result=self.run_timing(player=player,progress_publisher=lambda raw:published.append(json.loads(raw)))
        self.assertEqual(result['completedWorkIds'],self.ids[1:]);self.assertEqual(len(published),6)
        self.assertEqual(published[0]['receipts'][0]['status'],'unfinished')
        pointer=json.loads((self.root/'.ai-runs/run/latest.json').read_bytes())
        self.assertEqual(timing.digest(Path(pointer['checkpoint']).read_bytes()),pointer['sha256'])
        self.assertEqual(self.report()['unfinishedLowerBoundMs'],[3000.])

    def test_unclassified_correctness_errors_stop_new_jobs_and_retain_all_accounting(self):
        for error in (ValueError('synthetic identity'),RuntimeError('synthetic protocol')):
            with self.subTest(error=type(error).__name__):
                # Independent generation directory for the injected failure.
                self.execution['generation']+=1;self.barrier=Barrier();self.barrier.generation=self.execution['generation']
                calls=[]
                def broken(job,*args,**kwargs):calls.append(job['id']);raise error
                with self.assertRaises(timing.PublicTimingStopped):self.run_timing(player=broken)
                self.assertEqual(calls,[self.ids[0]])
                report=self.report();self.assertTrue(report['queueStopped']);self.assertEqual(report['stopCategory'],'shared-correctness')
                self.assertEqual(sum(c['unstarted'] for c in report['scopeCells']),5)

    def test_progress_transport_interruption_retains_prefix_and_never_starts_next_job(self):
        def lost(_):raise hosted_receipts.HostedInfrastructureError('synthetic persistent transport')
        with self.assertRaises(hosted_receipts.HostedInfrastructureError):self.run_timing(progress_publisher=lost)
        self.assertEqual(self.calls,1)
        pointer=json.loads((self.root/'.ai-runs/run/latest.json').read_bytes())
        prefix=json.loads(Path(pointer['checkpoint']).read_bytes())
        self.assertEqual(prefix['completedWorkIds'],self.ids[:1]);self.assertEqual(prefix['remainingWorkIds'],self.ids[1:])

    def test_insufficient_runway_skips_a_slow_cell_and_advances_to_bounded_independent_items(self):
        self.plan['schedule'][0]['gameSeconds']=111
        result=self.run_timing();self.assertEqual(result['completedWorkIds'],self.ids[1:]);self.assertEqual(self.calls,5)
        self.assertEqual(self.report()['scopeCells'][0]['unstarted'],1)
        namespace='public-timing:'+self.execution['manifestSha256']+':'+self.execution['phase']
        self.assertNotIn((namespace,self.ids[0]),self.barrier.records)

    def test_finite_artifact_envelope_rejects_an_oversized_queue_before_any_game(self):
        self.plan['schedule']=[{**self.plan['schedule'][0],'id':'bounded-'+str(i)} for i in range(110)]
        self.ids=[job['id'] for job in self.plan['schedule']]
        with self.assertRaisesRegex(ValueError,'finite public timing inventory'):self.run_timing()
        self.assertEqual(self.calls,0)

    def test_private_scientific_fields_and_changed_budgets_are_rejected(self):
        for mutate in [lambda p:p.update(familyInventory={}),lambda p:p['schedule'][0].update(partition='validation'),
            lambda p:p['schedule'][0].update(familyId='fake'),lambda p:p['schedule'][0].update(seed=2**32),
            lambda p:p['schedule'][0].update(startKind='developed'),lambda p:p.update(accountingReserveSeconds=0)]:
            other=copy.deepcopy(self.plan);mutate(other)
            with self.assertRaises(ValueError):timing.validate_plan(other,self.profiles,self.ids)
        other=copy.deepcopy(self.profiles);other['profiles']['babs']['simulations']=2
        with self.assertRaises(ValueError):timing.validate_plan(self.plan,other,self.ids)
    def test_bound_recipe_rejects_changed_source_model_plan_and_science_context(self):
        raw=timing.encoded(self.plan);image={'sourceRevision':__import__('os').environ.get('SYNTHETIC_TIMING_SOURCE_REVISION','a'*40),'dependencySha256':'2'*64,'sourceInventorySha256':'3'*64,'proofInventorySha256':'4'*64}
        recipe=timing.recipe_for(raw,image);recipe_raw=timing.encoded(recipe)
        execution={**self.execution,'dependencySha256':image['dependencySha256'],'executionRecipeSha256':timing.digest(recipe_raw),'recipeSha256':timing.digest(raw),
            'publicTiming':{'schema':1,**{k:recipe[k] for k in ('modelSha256','profilesSha256','planSha256','producerSha256','qualifiedRuntimeSha256')}}}
        context={**self.context,'execution':execution};self.assertEqual(timing.measured_context(raw,recipe_raw,context,image),execution)
        for key in ('modelSha256','producerSha256','qualifiedRuntimeSha256'):
            changed=copy.deepcopy(context);changed['execution']['publicTiming'][key]='9'*64
            with self.assertRaises(ValueError):timing.measured_context(raw,recipe_raw,changed,image)
        changed=copy.deepcopy(context);changed['execution']['scientific']={}
        with self.assertRaises(ValueError):timing.measured_context(raw,recipe_raw,changed,image)

    def test_source_only_package_preserves_operator_schedule_and_pins_original_public_bytes(self):
        source=Path(__file__).resolve().parents[3]/'apps/web/computer/models/trained-20261029-1086.onnx'
        target=self.root/'apps/web/computer/models/trained-20261029-1086.onnx';target.parent.mkdir(parents=True);target.write_bytes(source.read_bytes())
        template={'schema':1,'purpose':'public-performance-timing','campaignId':'synthetic-package','phaseSeconds':3600,'accountingReserveSeconds':10,
            'qualifiedRuntimeSha256':'f'*64,'schedule':[{k:j[k] for k in ('id','profile','referenceSeat','seed','gameSeconds')} for j in self.plan['schedule']]}
        image={'schema':2,'sourceRevision':'a'*40,'dependencySha256':'2'*64,'sourceInventorySha256':'3'*64,'proofInventorySha256':'4'*64,
            'sourceInventory':{'tools/ai-trainer/righelt_training/public_timing.py':timing.digest(Path(timing.__file__).read_bytes())}}
        output=self.root/'prepared'
        receipt=timing.prepare_package(template,image,output,profiles_loader=lambda:self.profiles,start_loader=lambda jobs:[self.start for _ in jobs],source_inspector=lambda _:None)
        self.assertFalse(receipt['launchAuthorized']);self.assertEqual(receipt['phase']['workIds'],self.ids);self.assertEqual(receipt['phase']['seconds'],3600)
        self.assertEqual(len(receipt['inputs']),3);self.assertEqual((output.stat().st_mode&0o777),0o700)
        for a in receipt['inputs']:
            self.assertEqual(timing.digest((output/a['path']).read_bytes()),a['sha256']);self.assertEqual((output/a['path']).stat().st_mode&0o777,0o600)
        plan=json.loads((output/receipt['inputs'][1]['path']).read_bytes())
        self.assertEqual([j['seed'] for j in plan['schedule']],[j['seed'] for j in self.plan['schedule']]);self.assertEqual(plan['model']['sha256'],self.plan['model']['sha256'])
        with self.assertRaises(FileExistsError):timing.prepare_package(template,image,output,profiles_loader=lambda:self.profiles,start_loader=lambda jobs:[self.start for _ in jobs],source_inspector=lambda _:None)

    def test_bad_package_source_or_seed_stops_before_primitive_dispatch(self):
        template={'schema':1,'purpose':'public-performance-timing','campaignId':'synthetic-package','phaseSeconds':120,'accountingReserveSeconds':10,
            'qualifiedRuntimeSha256':'f'*64,'schedule':[{'id':'j','profile':'babs','referenceSeat':'P1','seed':2**32,'gameSeconds':30}]}
        image={'schema':2,'sourceInventory':{'tools/ai-trainer/righelt_training/public_timing.py':timing.digest(Path(timing.__file__).read_bytes())}}
        def forbidden(*_args,**_kwargs):self.fail('invalid preparation dispatched a primitive')
        with self.assertRaises(ValueError):timing.prepare_package(template,image,self.root/'out',profiles_loader=forbidden,start_loader=forbidden,source_inspector=lambda _:None)
        image['sourceInventory']['tools/ai-trainer/righelt_training/public_timing.py']='0'*64
        with self.assertRaises(ValueError):timing.prepare_package(template,image,self.root/'out',profiles_loader=forbidden,start_loader=forbidden,source_inspector=forbidden)


class ChildSessionTest(unittest.TestCase):
    def test_actual_python_request_carries_only_the_bound_private_session(self):
        from io import BytesIO
        seen=[]
        def fetch(request,**_):seen.append(dict(request.header_items()));return BytesIO(b'{"ok":true}')
        environment={'COMPUTE_URL':'https://fixture.invalid','COMPUTE_ID':'timing','COMPUTE_GENERATION':'1',
            'COMPUTE_WORKER_TOKEN':'synthetic-worker-token','COMPUTE_STARTUP_SESSION':'a'*32}
        with patch.dict('os.environ',environment,clear=True),patch('urllib.request.urlopen',fetch):
            self.assertEqual(hosted_receipts.request('claim',{'key':'b'*64}),{'ok':True})
        self.assertEqual(seen[0]['X-compute-startup-session'],'a'*32)
        with patch.dict('os.environ',{**environment,'COMPUTE_STARTUP_SESSION':'invalid'},clear=True),patch('urllib.request.urlopen') as no_request:
            with self.assertRaisesRegex(ValueError,'invalid private worker session'):hosted_receipts.request('claim',{})
            no_request.assert_not_called()


def export_synthetic_fixture(root,context_path=None):
    """Cross-language contract fixture. Copies approved public bytes, never loads a model or engine."""
    case=PublicTimingTest('test_public_all_profile_seat_accounting_and_raw_before_verification');case.setUp()
    root=Path(root).resolve();root.mkdir(parents=True,exist_ok=True);case.root=root
    with patch.object(timing,'ROOT',root):
        directory=root/'.ai-runs/run';directory.mkdir(parents=True,exist_ok=True)
        inputs=root/'.ai-runs/inputs';inputs.mkdir(parents=True,exist_ok=True)
        model=(Path(__file__).resolve().parents[3]/'apps/web/computer/models/trained-20261029-1086.onnx').read_bytes();case.assertEqual(timing.digest(model),case.plan['model']['sha256']);case.assertEqual(len(model),322842)
        case.plan['model']['path']='.ai-runs/inputs/model.onnx';(inputs/'model.onnx').write_bytes(model)
        record={'schema':1,'kind':'cuda-runtime-probe','kernelPassed':True,'syntheticFixture':True}
        runtime_sha=timing.record_digest(record);case.plan['qualifiedRuntimeSha256']=runtime_sha
        runtime=timing.encoded({'runtimeSha256':runtime_sha,'record':record})
        (directory/'runtime-1.json').write_bytes(runtime)
        plan_raw=timing.encoded(case.plan);(inputs/'plan.json').write_bytes(plan_raw);(directory/'plan.json').write_bytes(plan_raw)
        image={'sourceRevision':__import__('os').environ.get('SYNTHETIC_TIMING_SOURCE_REVISION','a'*40),'dependencySha256':'2'*64,'sourceInventorySha256':'3'*64,'proofInventorySha256':'4'*64}
        recipe=timing.recipe_for(plan_raw,image);recipe_raw=timing.encoded(recipe)
        (inputs/'execution-recipe.json').write_bytes(recipe_raw);(directory/'execution-recipe.json').write_bytes(recipe_raw)
        descriptors=[timing.artifact(inputs/name,role) for name,role in [('model.onnx','public-incumbent-model'),('plan.json','public-timing-plan'),('execution-recipe.json','public-timing-execution')]]
        for descriptor,name in zip(descriptors,['model.onnx','plan.json','execution-recipe.json']):descriptor['name']=name
        binding={'schema':1,**{k:recipe[k] for k in ('modelSha256','profilesSha256','planSha256','producerSha256','qualifiedRuntimeSha256')}}
        if context_path:
            case.context=json.loads(Path(context_path).read_bytes());case.execution=case.context['execution']
            case.context['inputArtifacts']=[timing.artifact(directory/'plan.json','plan'),timing.artifact(directory/'execution-recipe.json','execution-recipe')]
            case.context['runtimeArtifact']=timing.artifact(directory/'runtime-1.json','runtime')
            class FixtureModel(Model):runtime={**Model.runtime,'artifactSha256':case.plan['model']['sha256']}
            def factory(_):
                if __import__('os').environ.get('SYNTHETIC_TIMING_UNAVAILABLE')=='expired':raise AssertionError('expired work must not load model')
                if __import__('os').environ.get('SYNTHETIC_TIMING_UNAVAILABLE')=='true':raise RuntimeError('synthetic model unavailable')
                return FixtureModel()
            if __import__('os').environ.get('SYNTHETIC_TIMING_UNAVAILABLE')=='expired':case.now=111.
            try:result=case.run_timing(model_factory=factory,wall=lambda:case.context['phaseDeadline']/1000-case.context['phaseSeconds']+case.now)
            except timing.PublicTimingStopped:result=json.loads((directory/'result.json').read_bytes())
            if __import__('os').environ.get('SYNTHETIC_TIMING_UNAVAILABLE')=='recovery-expired':
                case.execution['generation']=2;case.barrier.generation=2;case.now=111.
                result=case.run_timing(model_factory=lambda _:case.fail('expired recovery loaded model'),player=lambda *_a,**_k:case.fail('consumed game replayed'),wall=lambda:case.context['phaseDeadline']/1000-case.context['phaseSeconds']+case.now)
            output={'result':result}
        else:output={'inputs':descriptors,'publicTiming':binding,'image':image,'workIds':case.ids}
    case.doCleanups()
    return output


if __name__=='__main__':
    import sys
    if '--fixture-root' in sys.argv:
        index=sys.argv.index('--fixture-root');context=sys.argv[sys.argv.index('--context')+1] if '--context' in sys.argv else None
        print(json.dumps(export_synthetic_fixture(sys.argv[index+1],context)))
    else:unittest.main()

