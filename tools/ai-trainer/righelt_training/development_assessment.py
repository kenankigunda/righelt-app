"""Actual model-driven development probes, within the existing teacher allocation.

Historical states are diagnostics only. Every chosen action comes from native
search. Opponent-controlled continuations are unsupported, never cooperative.
Consumed probes are not rerun; settled source-bound receipts restore their bytes.
"""
import hashlib
import json
import math
import re
from pathlib import Path
import subprocess
import time
from .config import ROOT


def digest(raw):return hashlib.sha256(raw).hexdigest()
def work_ids(index):
    return ['development-'+digest(json.dumps([c['key'],p],separators=(',',':'),ensure_ascii=False).encode())[:32]
            for c in index['cases'] for p in index['profiles']]


def bridge(job,seconds):
    if seconds<=0:raise TimeoutError('original development assessment budget exhausted')
    try:
        process=subprocess.run(['node','--import','tsx','tools/hosted-compute/development-suite-assessment.mjs','--bridge'],
            cwd=ROOT,input=json.dumps(job,allow_nan=False),text=True,capture_output=True,check=True,timeout=seconds)
        return json.loads(process.stdout)
    except subprocess.TimeoutExpired as error:raise TimeoutError('development verification budget exhausted') from error
    except subprocess.CalledProcessError:raise ValueError('development verification rejected actual search') from None


def produce_assessment(component,execution,*,model,model_sha256,device,deadline,read_object,output,search=None,barrier=None,clock=time.monotonic):
    if search is None:
        from .search_parity import search_reference
        search=search_reference
    if barrier is None:
        from . import hosted_receipts as barrier
    if (component.get('schema')!=1 or component.get('seed')!=execution['seed'] or not isinstance(model_sha256,str) or not re.fullmatch('[a-f0-9]{64}',model_sha256)
            or any(type(component.get(k)) is not int or component[k]<=0 for k in ('maxActions','maxOperations'))
            or any(type(component.get(k)) not in (int,float) or not math.isfinite(component[k]) or component[k]<=0 for k in ('stepSeconds','milliseconds'))):raise ValueError('frozen bounded development assessment required')
    if getattr(model,'training',False):raise ValueError('frozen evaluation-mode teacher required')
    output=Path(output);objects={};paths=[]
    def store(strings):
        for sha,text in strings.items():
            raw=text.encode()
            if digest(raw)!=sha:raise ValueError('retained development object checksum differs')
            path=output/'.objects'/sha;path.parent.mkdir(parents=True,exist_ok=True)
            if path.exists():
                if path.is_symlink() or path.read_bytes()!=raw:raise ValueError('immutable development object differs')
            else:
                # Native bridge supplies canonical bytes; retain those exact bytes.
                import os
                with path.open('xb') as stream:stream.write(raw);stream.flush();os.fsync(stream.fileno())
                fd=os.open(path.parent,os.O_RDONLY)
                try:os.fsync(fd)
                finally:os.close(fd)
            objects[sha]=text
            if path not in paths:paths.append(path)
    def load(sha):
        if sha not in objects:
            raw=read_object(sha)
            if digest(raw)!=sha:raise ValueError('frozen development input checksum differs')
            objects[sha]=raw.decode()
        return json.loads(objects[sha])
    index=load(component['indexSha256'])
    metadata=bridge({'mode':'metadata','index':index},deadline-clock()) if clock()<deadline else {'indexSha256':component['indexSha256'],'workIds':work_ids(index)}
    if metadata['workIds']!=work_ids(index):raise ValueError('native development work inventory differs')
    identity={k:execution[k] for k in ('sourceRevision','dependencySha256')};identity['modelSha256']=model_sha256
    namespace='development:'+execution['manifestSha256']+':'+execution['phase']
    rows=[];receipts=[]
    def probe(c,prepared,profile_sha):
        profile=load(profile_sha);actual_identity={**identity,'profileSha256':profile_sha}
        base={'schema':1,'kind':'executed-development-assessment','caseKey':c['key'],'rootSha256':c['rootSha256'],'scopeSha256':c['scopeSha256'],'family':c['family'],**actual_identity,'observedValuesUnchanged':True,'historicalTrainingPositions':0,'acceptableActionSetComplete':False}
        if c['disposition']!='admitted':return {**base,'disposition':'reference-only','reason':c['reason']},{}
        until=min(deadline,clock()+component['milliseconds']/1000);remaining=component['maxOperations'];state=prepared['state'];actions=[];steps=[];produced={};root=state['sideToMove'];turn=state['turnIndex']
        stage='model-search'
        try:
            for step in range(component['maxActions']):
                if remaining<=0:raise TimeoutError('aggregate engine verification budget exhausted')
                if state['sideToMove']!=root:return {**base,'disposition':'incomplete','reason':'unsupported-non-root-controller-continuation'},produced
                seconds=min(component['stepSeconds'],until-clock())
                if seconds<=1:raise TimeoutError('insufficient bounded model-search runway')
                stage='model-search'
                answer=search(state,model,device,component['seed'],profile,bound_seconds=seconds)
                stage='search-step-verification'
                result=bridge({'mode':'step','state':state,'answer':answer,'identity':actual_identity,'profile':profile,'seed':component['seed'],'bounds':{'milliseconds':max(.001,(until-clock())*1000),'maxOperations':remaining}},until-clock())
                remaining-=result['operations'];produced.update(result['objectStrings']);steps.append(result['search']);actions.append(answer['action']);state=result['nextState']
                if state['outcome']['status']!='ongoing' or state['turnIndex']!=turn:break
            stage='complete-turn-verification'
            result=bridge({'mode':'assess','caseIndex':c,'prepared':prepared,'identity':actual_identity,'search':steps[0] if steps else None,'stepSearches':steps,'actions':actions,'bounds':{'maxActions':component['maxActions'],'milliseconds':max(.001,(until-clock())*1000),'maxOperations':remaining}},until-clock())
            produced.update(result['objectStrings']);return result['assessment'],produced
        except (TimeoutError,ValueError):return {**base,'disposition':'incomplete','reason':'original-budget-or-unverified-'+stage},produced
    for c in index['cases']:
        packet=next(p for p in index['packets'] if p['id']==c['packetId']);prepared=next(x for x in load(packet['preparedSha256'])['cases'] if x['id']==c['caseId'])
        for profile in index['profiles']:
            wid='development-'+digest(json.dumps([c['key'],profile],separators=(',',':'),ensure_ascii=False).encode())[:32]
            binding={'indexSha256':component['indexSha256'],'component':component,'caseKey':c['key'],'profileSha256':profile,**identity}
            claim=barrier.evaluation_claim(namespace,wid,create=clock()<deadline);settled=claim.get('result')
            if settled is not None:
                if settled.get('binding')!=binding:raise ValueError('recovered development probe binding differs')
                store(settled['objectStrings']);before=settled['before'];after=settled['after']
            elif claim.get('created'):
                before,bobjects=probe(c,prepared,index.get('beforeProfiles',{}).get(profile,profile));after,aobjects=probe(c,prepared,profile)
                # Canonical object identities and assessment bytes come from the shared Node producer.
                complete_objects={**bobjects,**aobjects}
                settled={'binding':binding,'before':before,'after':after,'objectStrings':complete_objects}
                barrier.settle(namespace,wid,settled);store(complete_objects)
            else:
                def missing(p):return {'schema':1,'kind':'executed-development-assessment','caseKey':c['key'],'rootSha256':c['rootSha256'],'scopeSha256':c['scopeSha256'],'family':c['family'],**identity,'profileSha256':p,'observedValuesUnchanged':True,'historicalTrainingPositions':0,'acceptableActionSetComplete':False,'disposition':'missing','reason':'consumed-unsettled' if not claim.get('unclaimed') else 'original-budget'}
                before=missing(index.get('beforeProfiles',{}).get(profile,profile));after=missing(profile)
            # Incomplete/reference-only metadata also receives immutable SHA objects.
            def retain(record):
                text=json.dumps(record,sort_keys=True,separators=(',',':'),ensure_ascii=False,allow_nan=False);sha=digest(text.encode());store({sha:text});return sha
            before_sha=retain(before);after_sha=retain(after);rows.append({'caseKey':c['key'],'profileSha256':profile,'beforeSha256':before_sha,'afterSha256':after_sha})
            status='complete' if all(r['disposition'] in ('complete','reference-only') for r in (before,after)) else 'unstarted' if claim.get('unclaimed') else 'unfinished'
            receipts.append({'workId':wid,'status':status,'evidenceSha256':after_sha})
    report={'schema':1,'kind':'development-suite-report','indexSha256':metadata['indexSha256'],'purpose':'teacher-qualification','before':identity,'after':identity,'rows':rows,'dose':{'historicalAssessmentPositions':0,'trainingProofs':[]}}
    # Load all bound preparation/coverage inputs for the portable final gate.
    load(index['coverageSha256'])
    for p in index['packets']:load(p['preparationSha256'])
    for s in index.get('supplements',[]):load(s['sha256'])
    if clock()<deadline:
        checked=bridge({'mode':'report','index':index,'report':report,'objects':objects},deadline-clock());store(checked['objectStrings']);report=checked['report'];qualified=checked['checked']['qualified']
    else:qualified=False
    text=json.dumps(report,sort_keys=True,separators=(',',':'),ensure_ascii=False,allow_nan=False);report_sha=digest(text.encode());store({report_sha:text})
    return {'report':report,'reportSha256':report_sha,'reportPath':output/'.objects'/report_sha,'workReceipts':receipts,'artifactPaths':paths,'qualified':qualified}
