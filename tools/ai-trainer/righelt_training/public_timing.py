"""Public original-incumbent evaluation cost, with no scientific partitions.

The command consumes a reviewed finite plan. It never chooses counts, seeds,
models, search budgets, training data or another experiment.
"""
import argparse
import hashlib
import json
import math
import os
from pathlib import Path
import re
import time
import tempfile
import subprocess

ROOT=Path(__file__).resolve().parents[3]
POLICY=json.loads((ROOT/'tools/hosted-compute/policy.json').read_bytes())
TIMING=POLICY['publicTiming']


def encoded(value):return json.dumps(value,sort_keys=True,separators=(',',':'),ensure_ascii=False,allow_nan=False).encode()
def digest(raw):return hashlib.sha256(raw).hexdigest()
def record_digest(value):return digest(encoded(value))
def require(condition,message):
    if not condition:raise ValueError(message)


def recipe_for(plan_raw,image):
    """Source-only preparation. Does not open a model or execute a game."""
    plan=json.loads(plan_raw)
    return {'schema':1,'kind':TIMING['recipeKind'],'sourceRevision':image['sourceRevision'],
        'dependencySha256':image['dependencySha256'],'sourceInventorySha256':image['sourceInventorySha256'],
        'proofInventorySha256':image['proofInventorySha256'],'producerSha256':digest(Path(__file__).read_bytes()),
        'planSha256':digest(plan_raw),'modelSha256':plan['model']['sha256'],
        'profilesSha256':record_digest(plan['profiles']),'qualifiedRuntimeSha256':plan['qualifiedRuntimeSha256']}


def validate_plan(plan,profiles,work_ids):
    require(set(plan)=={'schema','kind','purpose','model','profiles','schedule','qualifiedRuntimeSha256','accountingReserveSeconds'}
        and plan['schema']==1 and plan['kind']==TIMING['planKind'] and plan['purpose']==TIMING['purpose'],'invalid public timing plan')
    model=plan['model']
    require(set(model)=={'kind','id','path','sha256','bytes'} and model['kind']=='original-public-incumbent-onnx'
        and model['id']==TIMING['incumbent']['id'] and model['sha256']==TIMING['incumbent']['sha256'] and model['bytes']==TIMING['incumbent']['bytes'] and isinstance(model['path'],str),'original public incumbent required')
    require(plan['profiles']==profiles and re.fullmatch('[a-f0-9]{64}',plan['qualifiedRuntimeSha256'] or ''),'public timing profile or cohort differs')
    require(type(plan['accountingReserveSeconds']) in (int,float) and math.isfinite(plan['accountingReserveSeconds']) and plan['accountingReserveSeconds']>0,'explicit accounting publication reserve required')
    schedule=plan['schedule']
    require(isinstance(schedule,list) and schedule and len(schedule)*5+12<=POLICY['maxArtifacts']
        and [j.get('id') for j in schedule]==work_ids and len(set(work_ids))==len(work_ids),'finite public timing inventory differs')
    for job in schedule:
        require(set(job)=={'id','profile','referenceSeat','seed','gameSeconds','startKind','kind','startIdentity'}
            and isinstance(job['id'],str) and re.fullmatch('[A-Za-z0-9][A-Za-z0-9._-]{0,119}',job['id'])
            and job['profile'] in profiles['profiles'] and job['referenceSeat'] in ('P1','P2')
            and type(job['seed']) is int and 0<=job['seed']<2**32
            and type(job['gameSeconds']) in (int,float) and math.isfinite(job['gameSeconds']) and 0<job['gameSeconds']<=TIMING['maxGameSeconds']
            and job['kind']=='normal' and job['startKind']=='normal','invalid bounded normal public timing job')
    return schedule


def artifact(path,role):
    path=Path(path).resolve();raw=path.read_bytes()
    return {'name':digest(raw),'sha256':digest(raw),'bytes':len(raw),'path':str(path.relative_to(ROOT.resolve())),'role':role}


def measured_context(plan_raw,recipe_raw,context,image):
    execution=context['execution'];binding=execution.get('publicTiming')
    require(binding and 'scientific' not in execution and 'inputCheckpointSha256' not in execution
        and 'dataSha256' not in execution,'explicit public timing execution required')
    recipe=json.loads(recipe_raw)
    require(recipe==recipe_for(plan_raw,image) and digest(recipe_raw)==execution['executionRecipeSha256']
        and recipe['planSha256']==execution['recipeSha256'],'public timing recipe or source differs')
    require(recipe['sourceRevision']==execution['sourceRevision'] and recipe['dependencySha256']==execution['dependencySha256']
        and all(binding.get(k)==recipe[k] for k in ('modelSha256','profilesSha256','planSha256','producerSha256','qualifiedRuntimeSha256')),'public timing input binding differs')
    require(type(context.get('phaseDeadline')) in (int,float) and math.isfinite(context['phaseDeadline'])
        and type(context.get('phaseSeconds')) in (int,float) and 0<context['phaseSeconds']<=86400,'original phase deadline required')
    return execution


def prepare_package(template,image,output,*,profiles_loader=None,start_loader=None,source_inspector=None):
    """Create public input files from operator-chosen bounds, never a launch."""
    from .prospective_durability import durable_json
    if profiles_loader is None:
        from .hosted_science import authoritative_profiles
        profiles_loader=authoritative_profiles
    if start_loader is None:
        from .evaluation_start import expected_evaluation_starts
        start_loader=expected_evaluation_starts
    require(set(template)=={'schema','purpose','campaignId','phaseSeconds','accountingReserveSeconds','qualifiedRuntimeSha256','schedule'}
        and template['schema']==1 and template['purpose']==TIMING['purpose']
        and isinstance(template['campaignId'],str) and re.fullmatch('[A-Za-z0-9][A-Za-z0-9._-]{0,39}',template['campaignId'])
        and type(template['phaseSeconds']) is int and 0<template['phaseSeconds']<=POLICY['startupMs']/1000,'bounded operator public timing template required')
    producer=digest(Path(__file__).read_bytes())
    require(image.get('schema')==2 and image.get('sourceInventory',{}).get('tools/ai-trainer/righelt_training/public_timing.py')==producer,'preparation source differs from built image')
    if source_inspector is None:
        revision=subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,stderr=subprocess.DEVNULL,timeout=10,text=True).strip()
        dirty=subprocess.check_output(['git','status','--porcelain','--untracked-files=all'],cwd=ROOT,stderr=subprocess.DEVNULL,timeout=10,text=True).strip()
        require(revision==image['sourceRevision'] and not dirty,'preparation needs the clean exact built-image checkout')
    else:source_inspector(image)
    jobs=[]
    require(isinstance(template['schedule'],list) and template['schedule'],'operator-selected work inventory required')
    for item in template['schedule']:
        require(set(item)=={'id','profile','referenceSeat','seed','gameSeconds'},'public preparation cannot add scientific lineage or custom roots')
        require(isinstance(item['id'],str) and re.fullmatch('[A-Za-z0-9][A-Za-z0-9._-]{0,119}',item['id'])
            and isinstance(item['profile'],str) and item['referenceSeat'] in ('P1','P2') and type(item['seed']) is int and 0<=item['seed']<2**32
            and type(item['gameSeconds']) in (int,float) and math.isfinite(item['gameSeconds']) and 0<item['gameSeconds']<=TIMING['maxGameSeconds'],'invalid operator work item')
        jobs.append({**item,'kind':'normal','startKind':'normal'})
    profiles=profiles_loader();starts=start_loader(jobs)
    require(len(starts)==len(jobs),'canonical public start inventory differs')
    for job,start in zip(jobs,starts):job['startIdentity']=start
    prefix=f".ai-runs/{template['campaignId']}"
    plan={'schema':1,'kind':TIMING['planKind'],'purpose':TIMING['purpose'],
        'model':{'kind':'original-public-incumbent-onnx','id':TIMING['incumbent']['id'],'sha256':TIMING['incumbent']['sha256'],
            'bytes':TIMING['incumbent']['bytes'],'path':prefix+'/inputs/model.onnx'},
        'profiles':profiles,'schedule':jobs,'qualifiedRuntimeSha256':template['qualifiedRuntimeSha256'],
        'accountingReserveSeconds':template['accountingReserveSeconds']}
    validate_plan(plan,profiles,[j['id'] for j in jobs])
    require(0<plan['accountingReserveSeconds']<template['phaseSeconds'],'accounting reserve exceeds original phase')
    # Only the already approved public artifact is read. No model is loaded.
    model=(ROOT/'apps/web/computer/models'/f"{TIMING['incumbent']['id']}.onnx").read_bytes()
    require(len(model)==TIMING['incumbent']['bytes'] and digest(model)==TIMING['incumbent']['sha256'],'original public model bytes differ')
    plan_raw=encoded(plan);recipe=recipe_for(plan_raw,image);recipe_raw=encoded(recipe)
    output=Path(output).resolve();output.mkdir(mode=0o700)
    directory=output/prefix/'inputs';directory.mkdir(parents=True,mode=0o700)
    descriptors=[]
    for name,role,raw in [('model.onnx','public-incumbent-model',model),('plan.json','public-timing-plan',plan_raw),('execution-recipe.json','public-timing-execution',recipe_raw)]:
        target=directory/name;fd=os.open(target,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
        with os.fdopen(fd,'wb') as stream:stream.write(raw);stream.flush();os.fsync(stream.fileno())
        descriptors.append({'name':name,'role':role,'path':str(target.relative_to(output)),'sha256':digest(raw),'bytes':len(raw)})
    run_dir=prefix+'/run';argv=['tools/ai-trainer/.venv/bin/python','-m','righelt_training.public_timing','--plan',prefix+'/inputs/plan.json','--run-dir',run_dir,'--seconds',str(template['phaseSeconds'])]
    receipt={'schema':1,'kind':'public-timing-preparation','templateCommitment':{'domain':'canonical-json-utf8-sha256','sha256':record_digest(template)},'imageIdentityCommitment':{'domain':'canonical-json-utf8-sha256','sha256':record_digest(image)},
        'sourceRevision':image['sourceRevision'],'dependencySha256':image['dependencySha256'],'recipeSha256':digest(plan_raw),'executionRecipeSha256':digest(recipe_raw),
        'publicTiming':{'schema':1,**{k:recipe[k] for k in ('modelSha256','profilesSha256','planSha256','producerSha256','qualifiedRuntimeSha256')}},
        'inputs':descriptors,'phase':{'id':'public-timing','kind':'benchmark','device':'cuda','seconds':template['phaseSeconds'],'workIds':[j['id'] for j in jobs],
            'planSha256':digest(plan_raw),'argv':argv,'resumeArgv':argv+['--resume'],'runDir':run_dir,'outputs':['timing'],'outputPaths':{'timing':run_dir+'/result.json'},
            'expect':{'timing':{'accountingComplete':True,'strengthEstablished':False,'scientificAdmission':False}}},
        'launchAuthorized':False,'scientificAdmission':False,'strengthEstablished':False}
    durable_json(output/'preparation.json',receipt)
    handle=os.open(directory,os.O_RDONLY)
    try:os.fsync(handle)
    finally:os.close(handle)
    return receipt


class MeasuredModel:
    def __init__(self,model,seat,clock):self.model=model;self.seat=seat;self.clock=clock;self.calls=0;self.seconds=0.
    def infer_export(self,encoded_state):
        started=self.clock()
        try:return self.model.infer_export(encoded_state)
        finally:self.calls+=1;self.seconds+=max(0.,self.clock()-started)


def execute(plan,directory,execution,work_ids,*,context,seconds,barrier,profiles,start_expected,start_verify,verify,
            model_factory,player,clock=time.monotonic,wall=time.time,writer=None):
    from .prospective_durability import durable_json
    write=writer or durable_json
    started=clock();original_deadline=context['phaseDeadline'];work_deadline=original_deadline-plan['accountingReserveSeconds']*1000
    require(0<plan['accountingReserveSeconds']<seconds,'accounting reserve exceeds phase')
    deadline=min(started+seconds-plan['accountingReserveSeconds'],started+work_deadline/1000-wall())
    schedule=validate_plan(plan,profiles,work_ids)
    directory=Path(directory);directory.mkdir(parents=True,exist_ok=True)
    preparation_started=clock()
    expected=start_expected(schedule,seconds=max(.001,min(10,deadline-clock()))) if clock()<deadline else None
    if expected is not None:require(len(expected)==len(schedule) and all(job['startIdentity']==root for job,root in zip(schedule,expected)),'canonical zero-warmup start differs')
    preparation_ms=max(0.,clock()-preparation_started)*1000
    model_started=clock();model=None;model_failure=False
    if expected is None or clock()>=deadline:model_failure=True
    else:
        try:model=model_factory(plan['model'])
        except Exception:model_failure=True
    model_load_ms=max(0.,clock()-model_started)*1000
    models={seat:MeasuredModel(model,seat,clock) for seat in ('P1','P2')} if model else {}
    runtime=model.runtime if model else {'kind':'unavailable','reason':'model-load-failed'}
    receipts=[];attempts=[];paths=[]
    namespace='public-timing:'+execution['manifestSha256']+':'+execution['phase']
    def save(path,value,role):
        write(path,value);a=artifact(path,role)
        if not any(prior['path']==a['path'] for prior in paths):paths.append(a)
        return a
    from .prospective_durability import consume_and_qualify
    for job in schedule:
        key=digest(job['id'].encode());base={'schema':1,'purpose':TIMING['purpose'],'workId':job['id'],
            'profile':job['profile'],'referenceSeat':job['referenceSeat'],'seed':job['seed'],'originalDeadline':original_deadline,'originalWorkDeadline':work_deadline}
        attempt_start=clock();before={seat:(m.calls,m.seconds) for seat,m in models.items()}
        decision_path=directory/'decisions'/str(execution['generation'])/(key+'.jsonl')
        current={**base,'status':'unstarted','reason':'model-load-failed' if model_failure else 'original-budget','elapsedMs':0.,'inferenceMs':0.,'completedWholeGame':False}
        profile=profiles['profiles'][job['profile']]
        versions={seat:plan['model']['sha256'] for seat in ('P1','P2')}
        profile_versions={seat:profile['version'] for seat in ('P1','P2')}
        engine_job={**job,'purpose':TIMING['purpose'],'profiles':{seat:profile for seat in ('P1','P2')},
            'modelVersions':versions,'profileVersions':profile_versions,
            'evaluationProfile':{'name':job['profile'],'sourceSha256':profiles['sourceSha256'],
                'definition':profile,'artifactSha256':record_digest(profiles)},'decisionLogPath':str(decision_path)}
        played=False
        def play(raw_complete):
            nonlocal played
            if model_failure or clock()>=deadline:return {'status':'unfinished','reason':'original-budget-before-dispatch'}
            played=True
            return player(engine_job,models,min(deadline,clock()+job['gameSeconds']+10),'cpu-onnxruntime',raw_complete=raw_complete)
        def capture_measurements():return {'elapsedUntilRawMs':max(0.,clock()-attempt_start)*1000,'inferenceMs':sum(max(0.,m.seconds-before[seat][1]) for seat,m in models.items())*1000,'inferenceCalls':{seat:m.calls-before[seat][0] for seat,m in models.items()},'inferenceRuntime':runtime}
        verification_seconds=0.
        def replay(game,bound):
            nonlocal verification_seconds
            began=clock()
            try:return verify(game,bound)
            finally:verification_seconds+=max(0.,clock()-began)
        try:
            record,durable_paths=consume_and_qualify(job=engine_job,base=base,execution=execution,namespace=namespace,
                directory=directory,deadline=deadline,barrier=barrier,play=play,verify=replay,
                start_verify=start_verify,model_versions=versions,profile_versions=profile_versions,capture_metadata=capture_measurements,allow_new_work=not model_failure)
            for retained in durable_paths:
                a=artifact(retained,'verification' if 'verification' in Path(retained).parts else 'raw')
                if not any(prior['path']==a['path'] for prior in paths):paths.append(a)
            current.update(record)
            current.update(completedWholeGame=record['status']=='complete',startVerified=record.get('engineReplayVerified') is True,
                termination=record.get('game',{}).get('termination'),verificationMs=verification_seconds*1000)
            # The exact raw game remains in its own immutable artifact.
            current.pop('game',None)
            measured=record.get('publicTimingMeasurements')
            if measured is not None:
                if model is None:runtime=measured['inferenceRuntime']
                origin=record['originalGeneration'];measurement_namespace=namespace+':measurements:'+str(origin)
                prior=barrier.evaluation_claim(measurement_namespace,job['id'],create=played and clock()<deadline)
                saved=prior.get('result')
                binding={**base,'kind':'public-timing-measurement','originalGeneration':origin,'rawEvidenceSha256':record.get('rawEvidenceSha256'),'verificationEvidenceSha256':record.get('verificationEvidenceSha256'),'status':record['status']}
                if prior.get('created'):
                    saved={**binding,'elapsedMs':max(0.,clock()-attempt_start)*1000,'verificationMs':verification_seconds*1000,**measured}
                    write(directory/'measurements'/str(origin)/(key+'.json'),saved);barrier.settle(measurement_namespace,job['id'],saved)
                complete=saved is not None and all(saved.get(k)==v for k,v in binding.items())
                current.update(timingComplete=complete,elapsedMs=saved['elapsedMs'] if complete else measured['elapsedUntilRawMs'],
                    inferenceMs=measured['inferenceMs'],inferenceCalls=measured['inferenceCalls'],verificationMs=saved['verificationMs'] if complete else verification_seconds*1000)
                if complete:
                    retained=write(directory/'measurements'/str(origin)/(key+'.json'),saved);measurement_artifact=artifact(retained,'measurements');paths.append(measurement_artifact);current['measurementEvidenceSha256']=measurement_artifact['sha256']
        except Exception as error:
            from .hosted_receipts import HostedInfrastructureError
            if isinstance(error,HostedInfrastructureError):raise
            current.update(status='failed',reason='public-game-or-verification-failed')
            for folder,role in [('raw','raw'),('verification','verification')]:
                for retained in (directory/folder).glob('*/'+key+'.json'):
                    a=artifact(retained,role)
                    if not any(prior['path']==a['path'] for prior in paths):paths.append(a)
        if not current.get('publicTimingMeasurements'):
            current.update(elapsedMs=0. if current['status']=='unstarted' else max(0.,clock()-attempt_start)*1000,inferenceMs=sum(max(0.,m.seconds-before[seat][1]) for seat,m in models.items())*1000,inferenceCalls={seat:m.calls-before[seat][0] for seat,m in models.items()},timingComplete=False)
        if decision_path.exists():paths.append(artifact(decision_path,'decisions'))
        current['kind']='public-timing-attempt'
        a=save(directory/'attempts'/str(execution['generation'])/(key+'.json'),current,'attempt')
        receipts.append({'workId':job['id'],'status':current['status'],'evidenceSha256':a['sha256']});attempts.append(current)
    cells=[]
    for name in sorted(profiles['profiles']):
        for seat in ('P1','P2'):
            rows=[a for a in attempts if a['profile']==name and a['referenceSeat']==seat]
            cells.append({'profile':name,'referenceSeat':seat,'planned':len(rows),
                **{status:sum(a['status']==status for a in rows) for status in ('complete','unfinished','failed','unstarted')}})
    completed=[a for a in attempts if a['status']=='complete']
    report={'schema':1,'kind':TIMING['reportKind'],'accountingComplete':True,'scopeCoverageComplete':all(c['complete']>0 for c in cells) and all(sum(a.get('inferenceCalls',{}).get(seat,0) for a in attempts)>0 for seat in ('P1','P2')),
        'strengthEstablished':False,'scientificAdmission':False,'completedWholeGames':len(completed),'scopeCells':cells,
        'timingCoverageComplete':all(a.get('timingComplete') is True for a in completed) and bool(completed),
        'completedWholeGameMs':[a['elapsedMs'] for a in completed if a.get('timingComplete') is True],
        'completedTimeLowerBoundMs':[a['elapsedMs'] for a in completed if a.get('timingComplete') is not True],
        'unfinishedLowerBoundMs':[a['elapsedMs'] for a in attempts if a['status'] in ('unfinished','failed')],
        'unknownOriginalCostWorkIds':[a['workId'] for a in attempts if a['status'] in ('unfinished','failed') and not a.get('publicTimingMeasurements')],
        'elapsedMs':max(0.,clock()-started)*1000,'normalStartPreparationMs':preparation_ms,'modelLoadMs':model_load_ms,
        'inferenceMs':sum(a['inferenceMs'] for a in attempts),'inferenceCalls':{seat:sum(a.get('inferenceCalls',{}).get(seat,0) for a in attempts) for seat in ('P1','P2')},
        'recoveryBookkeepingMs':max(0.,clock()-started)*1000,
        'lifecycle':context.get('lifecycle',{}),'resource':context.get('resource',{}),
        'allInCost':{'status':'pending-operator-cleanup-and-billing'},'exportPerformed':False,
        'seatLabels':'diagnostic coverage, not independent strength games',
        'remainingReadiness':['developed-full-board','long-repetition','legal-continuations','attention-training','browser-wasm']}
    report_path=save(directory/f"timing-report-{execution['generation']}.json",report,'report')
    proof={'schema':1,'kind':TIMING['proofKind'],'execution':execution,'publicTiming':execution['publicTiming'],
        'originalIncumbent':TIMING['incumbent'],'originalDeadline':original_deadline,'originalWorkDeadline':work_deadline,'workReceipts':receipts,'inferenceRuntime':runtime,
        'runtimeArtifactSha256':context['runtimeArtifact']['sha256'],'reportSha256':report_path['sha256']}
    save(directory/f"timing-proof-{execution['generation']}.json",proof,'proof')
    result={'schema':1,'kind':TIMING['resultKind'],'disposition':'complete','execution':execution,
        'accountedWorkIds':work_ids,'completedWorkIds':[a['workId'] for a in completed],
        'accountingComplete':True,'scopeCoverageComplete':report['scopeCoverageComplete'],
        'strengthEstablished':False,'scientificAdmission':False,'artifacts':paths+context['inputArtifacts']+[context['runtimeArtifact']]}
    retained=write(directory/f"result-{execution['generation']}.json",result)
    fd,temporary=tempfile.mkstemp(dir=directory,prefix='.result-',suffix='.tmp')
    try:
        with os.fdopen(fd,'wb') as stream:stream.write(Path(retained).read_bytes());stream.flush();os.fsync(stream.fileno())
        os.replace(temporary,directory/'result.json')
        handle=os.open(directory,os.O_RDONLY)
        try:os.fsync(handle)
        finally:os.close(handle)
    finally:
        if os.path.exists(temporary):os.unlink(temporary)
    return result


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--plan');parser.add_argument('--run-dir');parser.add_argument('--seconds',type=int)
    parser.add_argument('--resume',action='store_true');parser.add_argument('--describe',action='store_true')
    parser.add_argument('--verify-import',action='store_true')
    parser.add_argument('--prepare-template');parser.add_argument('--image-identity');parser.add_argument('--output')
    args=parser.parse_args()
    if args.verify_import:
        from .source_image import source_image
        from .arena import play_game
        from .export_runtime import ExportedModel
        from .evaluation_start import expected_evaluation_starts,verify_evaluation_game_start
        from . import hosted_receipts
        image=source_image();require(image is not None,'audited image import check required')
        print(json.dumps({'kind':'public-timing-import-check','sourceRevision':image['sourceRevision'],
            'dependencySha256':image['dependencySha256'],'producerSha256':digest(Path(__file__).read_bytes()),
            'modelLoaded':False,'kernelRun':False,'launchAuthorized':False}));return
    if args.describe:
        print(json.dumps({'schema':1,'purpose':TIMING['purpose'],'producerSha256':digest(Path(__file__).read_bytes()),
            'planKind':TIMING['planKind'],'recipeKind':TIMING['recipeKind'],'resultKind':TIMING['resultKind'],
            'operatorLaunchAuthorized':False}));return
    if args.prepare_template:
        require(args.image_identity and args.output and not args.plan and not args.run_dir and args.seconds is None,'separate source-only preparation required')
        receipt=prepare_package(json.loads(Path(args.prepare_template).read_bytes()),json.loads(Path(args.image_identity).read_bytes()),args.output)
        print(json.dumps({'kind':'public-timing-preparation','directory':str(Path(args.output).resolve()),'receiptCanonicalSha256':record_digest(receipt),'receiptFileSha256':digest((Path(args.output)/'preparation.json').read_bytes()),'launchAuthorized':False}));return
    require(os.environ.get('RIGHELT_HOSTED')=='1' and args.plan and args.run_dir and args.seconds and args.seconds>0,'reviewed hosted public timing launch required')
    from .portable import resolve_reference
    from .source_image import source_image
    from .prospective_durability import durable_json
    from .hosted_science import authoritative_profiles
    from .evaluation_start import expected_evaluation_starts,verify_evaluation_game_start
    from .runner import verify_game
    from .arena import play_game
    from .export_runtime import ExportedModel
    from . import hosted_receipts
    image=source_image();require(image is not None,'audited source image required')
    plan_raw=resolve_reference(args.plan,expected_sha256=os.environ['RIGHELT_EXPECTED_RECIPE_SHA256']).read_bytes()
    recipe_raw=resolve_reference(os.environ['RIGHELT_EXECUTION_RECIPE_PATH'],expected_sha256=os.environ['RIGHELT_EXECUTION_RECIPE_SHA256']).read_bytes()
    context=json.loads(resolve_reference(os.environ['RIGHELT_EXECUTION_CONTEXT']).read_bytes())
    execution=measured_context(plan_raw,recipe_raw,context,image)
    require(args.seconds==context['phaseSeconds'],'public timing phase duration differs')
    directory=resolve_reference(args.run_dir);directory.mkdir(parents=True,exist_ok=True)
    for name,raw_data in [('plan.json',plan_raw),('execution-recipe.json',recipe_raw)]:
        target=directory/name
        if target.exists():require(target.read_bytes()==raw_data,'public timing input copy differs')
        else:
            with target.open('xb') as stream:stream.write(raw_data);stream.flush();os.fsync(stream.fileno())
    context['inputArtifacts']=[artifact(directory/'plan.json','plan'),artifact(directory/'execution-recipe.json','execution-recipe')]
    context['runtimeArtifact']=artifact(directory/f"runtime-{execution['generation']}.json",'runtime')
    result=execute(json.loads(plan_raw),directory,execution,context['completedWorkIds'],context=context,seconds=args.seconds,
        barrier=hosted_receipts,profiles=authoritative_profiles(seconds=max(.001,min(10,context['phaseDeadline']/1000-time.time()))),start_expected=expected_evaluation_starts,
        start_verify=verify_evaluation_game_start,verify=verify_game,model_factory=ExportedModel,player=play_game,writer=durable_json)
    print(json.dumps({'kind':TIMING['resultKind'],'accountingComplete':result['accountingComplete'],
        'scopeCoverageComplete':result['scopeCoverageComplete'],'strengthEstablished':False}))


if __name__=='__main__':
    try:main()
    except Exception:
        print('Public timing stopped; inspect retained accounting evidence.',file=__import__('sys').stderr)
        raise SystemExit(1)
