"""Supervised, resumable validation workload preparation; never opens final tests."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import signal
import subprocess
import time
from .arena import freeze_plan, read_frozen_plan
from .checkpoint import atomic_json
from .config import CONFIG_SHA256
from .curriculum import family_for_root
from .replay import partition_for_family
from .runner import engine_command

PROFILE={'simulations':64,'temperature':0,'maxValueGap':0}
PROFILE_VERSION='learning-comparison-64-greedy-v1'


def checkpoint_identity(path):
    path=Path(path);metadata=json.loads(path.with_suffix('.json').read_text())
    digest=hashlib.sha256(path.read_bytes()).hexdigest()
    if metadata['sha256']!=digest or metadata['configSha256']!=CONFIG_SHA256:
        raise ValueError('preparation checkpoint identity mismatch')
    return {'checkpointSha256':digest,'profileVersion':PROFILE_VERSION,'profile':dict(PROFILE)}


def prepare(directory,candidate,opponent,*,clock=time.monotonic,command=engine_command,experiment_root=None):
    directory=Path(directory);runtime=json.loads((directory/'runtime.json').read_text())
    deadline=runtime['deadlineMonotonic']
    result_path=directory/'prepare-arena-result.json'
    result={'schema':1,'status':'inconclusive','reason':'preparation-unfinished','partition':'validation',
            'deadlineMonotonic':deadline,'productionPromotion':False}
    atomic_json(result_path,result)
    def heartbeat():
        atomic_json(directory/'device-memory.json',{'schema':1,'pid':os.getpid(),'observedAt':time.time(),'driverBytes':0})
    def ready():
        heartbeat()
        if deadline-clock()<15:return False
        allocation=json.loads((directory/'allocation.json').read_text())
        if allocation.get('stop'):return False
        while (allocation.get('paused',True) or allocation.get('workers',0)<1
               or allocation.get('reason')=='initial-conservative'
               or not 0<=time.time()-allocation.get('observedAt',0)<=30):
            if deadline-clock()<15 or allocation.get('stop'):return False
            heartbeat();time.sleep(.1)
            allocation=json.loads((directory/'allocation.json').read_text())
        return True
    heartbeat()
    if not ready():return result
    identity={'candidate':checkpoint_identity(candidate),'opponent':checkpoint_identity(opponent),
              'seed':runtime['seed'],'manifestSha256':runtime['manifestSha256'],'configSha256':CONFIG_SHA256,
              'deadlineMonotonic':deadline}
    key=hashlib.sha256(json.dumps(identity,sort_keys=True).encode()).hexdigest()
    output=directory/'validation-plans'/key;output.mkdir(parents=True,exist_ok=True)
    state_path=output/'preparation.json';plan_path=output/'plan.json'
    state=json.loads(state_path.read_text()) if state_path.exists() else {'identity':identity,'nextSeed':runtime['seed'],'pairs':[]}
    if state['identity']!=identity:raise ValueError('preparation identity changed')
    if plan_path.exists():
        plan,digest=read_frozen_plan(plan_path)
        if plan['candidate']!=identity['candidate'] or plan['opponent']!=identity['opponent']:raise ValueError('frozen model changed')
    else:
        fingerprints={p['openingFingerprint'] for p in state['pairs'] if p['kind']=='heldout'}
        attempts=0
        while len(state['pairs'])<100 and attempts<10000:
            if not ready():break
            seed=state['nextSeed']%(2**32);state['nextSeed']+=1;attempts+=1
            if len(state['pairs'])<50:
                if partition_for_family(f'normal:{seed}')=='validation':
                    state['pairs'].append({'id':str(len(state['pairs'])),'seed':seed,'kind':'normal'})
            else:
                timeout=min(5,deadline-clock()-10)
                try:opening=command({'command':'generate-opening','seed':seed,'budgetMs':timeout*1000},timeout=timeout)
                except (TimeoutError,subprocess.TimeoutExpired):opening=None
                if opening and opening.get('type')=='opening-generated' and not opening['initial'] and opening['state']['outcome']['status']=='ongoing':
                    family=family_for_root(opening['state']);fingerprint=opening['fingerprint']
                    if partition_for_family(family)=='validation' and fingerprint not in fingerprints:
                        state['pairs'].append({'id':str(len(state['pairs'])),'seed':seed,'kind':'heldout',
                            'initialState':opening['state'],'openingActions':opening['actions'],
                            'openingFingerprint':fingerprint,'familyId':family})
                        fingerprints.add(fingerprint)
            atomic_json(state_path,state)
        result.update(preparedPairs=len(state['pairs']),progress=str(state_path))
        if len(state['pairs'])<100:
            result['reason']='budget-or-resource-stop' if attempts<10000 else 'opening-attempt-limit'
            atomic_json(result_path,result);return result
        plan={'configSha256':CONFIG_SHA256,'partition':'validation','purpose':'incumbent',
              'candidate':identity['candidate'],'opponent':identity['opponent'],'pairs':state['pairs'],'bootstrapSeed':runtime['seed']}
        def verification_ready():
            if not ready():raise TimeoutError('preparation resource/budget stop')
        try:
            verification_ready()
            digest=freeze_plan(plan_path,plan,deadline=deadline,heartbeat=verification_ready,experiment_root=experiment_root)
        except (TimeoutError,subprocess.TimeoutExpired):
            result['reason']='verification-unfinished';atomic_json(result_path,result);return result
    result.update(status='completed',reason='complete',plan=str(plan_path),planSha256=digest,preparedPairs=100)
    atomic_json(result_path,result);return result


def main():
    parser=argparse.ArgumentParser();parser.add_argument('--run-dir',type=Path,required=True)
    parser.add_argument('--candidate-checkpoint',type=Path,required=True);parser.add_argument('--opponent-checkpoint',type=Path,required=True)
    args=parser.parse_args();runtime=json.loads((args.run_dir/'runtime.json').read_text())
    if runtime.get('command')!='prepare-arena' or runtime.get('supervisorPid')!=os.getppid() or os.getpgrp()!=os.getpid():
        raise ValueError('preparation requires the original external supervisor')
    signal.signal(signal.SIGUSR1,lambda *_:None)
    print(json.dumps(prepare(args.run_dir,args.candidate_checkpoint,args.opponent_checkpoint),indent=2))

if __name__=='__main__':main()
