import gzip
import hashlib
import json
import os
from pathlib import Path
from collections import deque
from array import array
from .config import CONFIG
from .training_recipe import validate_decision_recipe


def partition_for_family(family_id):
    bucket=int(hashlib.sha256(family_id.encode()).hexdigest()[:8],16)%100
    return 'train' if bucket<80 else 'validation' if bucket<90 else 'final'


def save_game(directory,game):
    if game['partition']!='train' or partition_for_family(game['familyId'])!='train':raise ValueError('training partition violation')
    if game['termination'] not in ('terminal','truncated'):raise ValueError('unfinished game')
    if (game['termination']=='terminal') != (game['outcome']['status']!='ongoing'):raise ValueError('dishonest termination')
    path=Path(directory)/f"{hashlib.sha256(game['id'].encode()).hexdigest()}.json.gz"
    if path.exists():raise ValueError('duplicate game ID')
    tmp=path.with_suffix('.tmp');path.parent.mkdir(parents=True,exist_ok=True)
    with tmp.open('wb') as raw:
        with gzip.GzipFile(fileobj=raw,mode='wb',mtime=0) as f:
            f.write(json.dumps(game,sort_keys=True,allow_nan=False).encode())
        raw.flush();os.fsync(raw.fileno())
    os.replace(tmp,path)
    return path

class ReplayBuffer:
    def __init__(self,capacity=None):
        self.positions=deque(maxlen=capacity or CONFIG['training']['replayCapacity'])
        self.ids=set()
        self.game_ids=[]

    def append(self,game):
        if game['id'] in self.ids:raise ValueError('duplicate replay game')
        if game['partition']!='train' or partition_for_family(game['familyId'])!='train':raise ValueError('sealed data cannot enter replay')
        terminal=game['termination']=='terminal';outcome=game['outcome']['status']
        if terminal==(outcome=='ongoing'):raise ValueError('inconsistent value target')
        value={'p1_win':1.,'p2_win':-1.,'draw':0.,'ongoing':0.}[outcome]
        # Validate all recipe bindings before mutating the replay buffer.
        for decision in game['decisions']:
            validate_decision_recipe(decision)
        for decision in game['decisions']:
            position={k:decision[k] for k in ('id','legal','policy','policyMask','fallback','legality','trainingRecipe') if k in decision}
            mask=decision.get('policyMask',True)
            fallback=decision.get('fallback')
            if type(mask) is not bool or (fallback is not None) != (not mask):
                raise ValueError('fallback policy mask mismatch')
            if not mask and (decision.get('policy') or fallback.get('schemaVersion') not in (1,2)
                or fallback.get('reason') not in ('search-incomplete','safety-incomplete','legality-incomplete')):
                raise ValueError('invalid fallback training target')
            legality=decision.get('legality')
            if fallback and fallback.get('reason')=='legality-incomplete':
                if fallback.get('schemaVersion')!=2 or not legality or legality.get('complete') is not False:
                    raise ValueError('missing partial legality evidence')
            if legality is not None:
                indices=legality.get('indices')
                if (type(legality.get('complete')) is not bool or not isinstance(indices,list) or
                    any(type(i) is not int or i<0 or i>=CONFIG['actionCount'] for i in indices) or
                    len(set(indices))!=len(indices) or indices!=decision.get('legal') or
                    any(type(legality.get(k)) is not int or legality[k]<0 for k in ('checked','unknown')) or
                    legality['checked']<len(indices) or (legality['complete'] and legality['unknown']!=0) or
                    (not legality['complete'] and (mask or not fallback or fallback.get('reason')!='legality-incomplete'))):
                    raise ValueError('invalid legality evidence')
            if 'encoded' in decision:position['encoded']=array('f',decision['encoded'])
            self.positions.append({**position,'terminalMask':terminal,'terminalValue':value,'gameId':game['id']})
        self.ids.add(game['id'])
        self.game_ids.append(game['id'])
