"""Immutable raw consumption, followed by separately bound replay qualification.

A failed or uncertain PUT/settlement stops before verification. Recovery never
runs players for an existing consumption claim; it may replay the retained game
within the caller's original deadline. No service, clock reset or draw fallback.
"""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import tempfile
import time


def encoded(value):return json.dumps(value,sort_keys=True,allow_nan=False).encode()
def sha(value):return hashlib.sha256(encoded(value)).hexdigest()


def durable_json(path,value):
    """Publish immutable bytes only after file fsync, then fsync the directory."""
    path=Path(path)
    missing=[];parent=path.parent
    while not parent.exists():missing.append(parent);parent=parent.parent
    for directory in reversed(missing):
        directory.mkdir(exist_ok=True)
        ancestor=os.open(directory.parent,os.O_RDONLY)
        try:os.fsync(ancestor)
        finally:os.close(ancestor)
    payload=encoded(value)+b'\n'
    fd,name=tempfile.mkstemp(dir=path.parent,prefix='.raw-')
    try:
        with os.fdopen(fd,'wb') as stream:stream.write(payload);stream.flush();os.fsync(stream.fileno())
        try:os.link(name,path)
        except FileExistsError:
            if path.read_bytes()!=payload:raise ValueError('immutable prospective receipt differs')
        directory=os.open(path.parent,os.O_RDONLY)
        try:os.fsync(directory)
        finally:os.close(directory)
    finally:os.unlink(name)
    return path


def verifier_binding(source_revision,*,public_timing=False):
    root=Path(__file__).resolve().parents[3]
    files=['tools/ai-trainer/righelt_training/runner.py',
           'tools/ai-trainer/righelt_training/evaluation_start.py',
           'tools/ai-trainer/evaluation-start.mjs',
           'tools/ai-trainer/righelt_training/prospective_durability.py']
    if public_timing:files.extend(['tools/ai-trainer/righelt_training/public_timing.py','tools/ai-trainer/engine-worker.mjs'])
    return {'sourceRevision':source_revision,'files':{name:hashlib.sha256((root/name).read_bytes()).hexdigest() for name in files}}


def consume_and_qualify(*,job,base,execution,namespace,directory,deadline,barrier,play,verify,start_verify,model_versions,profile_versions,capture_metadata=None):
    """Return a scored disposition and all immutable raw/qualification files."""
    public_timing=execution.get('publicTiming') is not None
    if public_timing:
        from .public_timing import TIMING
        if execution.get('scientific') is not None or job.get('purpose')!=TIMING['purpose'] or any(k in job for k in ('partition','familyId','sourceFamily')):
            raise ValueError('public timing cannot invent scientific lineage')
    current=execution.get('generation')
    if type(current)is not int or current<1:raise ValueError('prospective verification generation bounds')
    def checked_origin(value):
        if type(value)is not int or value<1 or not value<=current<=value+2:
            raise ValueError('prospective verification generation bounds')
        return value
    key=hashlib.sha256(job['id'].encode()).hexdigest();paths=[]
    claim=barrier.evaluation_claim(namespace,job['id'],create=time.monotonic()<deadline-20)
    if claim.get('unclaimed'):return {**base,'status':'unstarted','reason':'original-budget'},paths
    retained=claim.get('result')
    if not claim['created'] and retained is None:
        origin=claim.get('record',{}).get('generation')
        if origin is not None:
            origin=checked_origin(origin)
            local=Path(directory)/'raw'/str(origin)/(key+'.json')
            if local.is_file():paths.append(local)
        return {**base,'status':'unfinished','reason':'consumed-without-settlement'},paths
    raw=retained
    def save(game):
        nonlocal raw
        candidate={**base,'schema':1,'status':'raw-complete','originalGeneration':execution['generation'],
                   'sourceRevision':execution['sourceRevision'],'game':game,'gameSha256':sha(game),
                   'rawOutcome':game.get('outcome',{}).get('status')}
        if public_timing and capture_metadata is not None:candidate['publicTimingMeasurements']=capture_metadata()
        if raw is not None and raw!=candidate:raise ValueError('raw completion changed')
        raw=candidate
        path=durable_json(Path(directory)/'raw'/str(execution['generation'])/(key+'.json'),raw)
        if path not in paths:paths.append(path)
        # An uncertain settlement raises, before any verifier is invoked.
        barrier.settle(namespace,job['id'],raw)
    if claim['created']:
        result=play(save)
        if result.get('status')=='completed':
            if raw is None:save(result['game'])
            elif raw.get('game')!=result['game']:raise ValueError('player changed completed game')
        elif result.get('status')=='unfinished':
            if raw is not None:raise ValueError('player discarded durable completed game')
            raw={**base,'status':'unfinished','reason':result.get('reason','unknown')}
            if public_timing:
                raw['originalGeneration']=execution['generation']
                if capture_metadata is not None:raw['publicTimingMeasurements']=capture_metadata()
            paths.append(durable_json(Path(directory)/'raw'/str(execution['generation'])/(key+'.json'),raw))
            barrier.settle(namespace,job['id'],raw)
            return ({**raw,'rawEvidenceSha256':hashlib.sha256(encoded(raw)+b'\n').hexdigest()} if public_timing else raw),paths
        else:raise ValueError('evaluation correctness failure')
    else:
        if any(raw.get(k)!=v for k,v in base.items()):raise ValueError('recovered prospective receipt identity mismatch')
        origin=checked_origin(raw.get('originalGeneration',current))
        paths.append(durable_json(Path(directory)/'raw'/str(origin)/(key+'.json'),raw))
    if raw['status'] not in ('raw-complete','complete'):
        return ({**raw,'rawEvidenceSha256':hashlib.sha256(encoded(raw)+b'\n').hexdigest()} if public_timing else raw),paths
    game=raw['game']
    if raw.get('gameSha256')!=sha(game):raise ValueError('retained raw game hash differs')
    # Even cached proofs must match this frozen job/model/profile identity.
    if (game.get('id')!=job['id'] or game.get('seed')!=job['seed'] or (not public_timing and (game.get('familyId')!=job['familyId']
            or game.get('partition')!=job['partition'])) or game.get('modelVersions')!=model_versions
            or game.get('profileVersions')!=profile_versions):raise ValueError('executed evaluation identity mismatch')
    if public_timing and (game.get('purpose')!=TIMING['purpose'] or any(k in game for k in ('partition','familyId','sourceFamily'))):raise ValueError('executed public timing scope differs')
    if job.get('startIdentity') is not None and game.get('kind')!=job.get('kind'):
        raise ValueError('executed actual start kind differs')
    qualified={**raw,'status':'unfinished','reason':'verification-budget','engineReplayVerified':False}
    # The authenticated raw object alone is not evidence of correct starts/rules.
    binding={'schema':1,'kind':'public-timing-verification' if public_timing else 'prospective-replay-verification','rawSha256':sha(raw),
             'startIdentity':job.get('startIdentity'),'verifier':verifier_binding(execution['sourceRevision'],public_timing=public_timing)}
    if public_timing:binding['rawEvidenceSha256']=hashlib.sha256(encoded(raw)+b'\n').hexdigest()
    origin=checked_origin(raw.get('originalGeneration',current))
    proof=None
    for generation in range(origin,execution['generation']+1):
        cached=barrier.evaluation_claim(namespace+':verification:'+str(generation),job['id'],create=False)
        candidate=cached.get('result')
        if candidate is not None:
            if any(candidate.get(k)!=v for k,v in binding.items()):raise ValueError('recovered replay verification binding differs')
            proof=candidate;break
    if proof is None:
        if time.monotonic()>=deadline:return qualified,paths
        try:
            # Metadata/start checks happen AFTER raw persistence, including wrong starts.
            if job.get('startIdentity') is not None:
                start_verify(job,game,seconds=min(10,max(.001,deadline-time.monotonic())))
            if time.monotonic()>=deadline:return qualified,paths
            verify(game,deadline)
        except (TimeoutError,subprocess.TimeoutExpired):return qualified,paths
        except ValueError as error:
            if isinstance(error.__cause__,subprocess.TimeoutExpired):return qualified,paths
            raise
        proof={**binding,'engineReplayVerified':True,'outcome':game['outcome']['status']}
        path=durable_json(Path(directory)/'verification'/str(execution['generation'])/(key+'.json'),proof);paths.append(path)
        proof_namespace=namespace+':verification:'+str(execution['generation'])
        proof_claim=barrier.evaluation_claim(proof_namespace,job['id'],create=True)
        if not proof_claim.get('created') and proof_claim.get('result')!=proof:
            raise ValueError('verification settlement is uncertain')
        barrier.settle(proof_namespace,job['id'],proof)
    else:paths.append(durable_json(Path(directory)/'verification'/str(execution['generation'])/(key+'.json'),proof))
    if proof.get('engineReplayVerified') is not True or proof.get('outcome')!=game.get('outcome',{}).get('status'):
        raise ValueError('invalid retained replay verification')
    terminal=proof['outcome'] in ('p1_win','p2_win','draw') and (not public_timing or game.get('termination')=='terminal')
    return {**raw,'status':'complete' if terminal else 'unfinished','engineReplayVerified':True,
            'rawEvidenceSha256':hashlib.sha256(encoded(raw)+b'\n').hexdigest(),
            'verificationEvidenceSha256':hashlib.sha256(encoded(proof)+b'\n').hexdigest(),
            'outcome':proof['outcome'],**({} if terminal else {'reason':'truncated:'+str(game.get('truncationReason','unknown'))})},paths
