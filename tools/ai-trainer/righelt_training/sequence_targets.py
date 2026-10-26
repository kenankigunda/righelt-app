"""Observed future board facts for training, never invented terminal labels."""
import math
from .config import CONFIG
from .replay import encoding_hash

HORIZONS=(1,2,4)
FACTS=('P1.commanderSupplied','P2.commanderSupplied','P1.unitsSupplied',
       'P2.unitsSupplied','P1.commandedFraction','P2.commandedFraction',
       'P1.materialShare','P2.materialShare')
TARGET_COUNT=len(HORIZONS)*len(FACTS)
FUTURE_LOSS_WEIGHT=0.1
TERMINAL_CONVENTION='exact-replayed-absorbing-terminal-v1'


def future_batch(positions):
    values=[];masks=[]
    for p in positions:
        target=p.get('futureFacts',{'values':[0.]*TARGET_COUNT,'mask':[False]*TARGET_COUNT})
        v,m=target['values'],target['mask']
        if (len(v)!=TARGET_COUNT or len(m)!=TARGET_COUNT or any(type(x)is not bool for x in m)
                or any(not math.isfinite(x)or not 0<=x<=1 for x in v)):
            raise ValueError('Invalid future-fact target/mask')
        values.append(v);masks.append(m)
    return values,masks


def board_facts(encoded,*,allow_empty=False):
    squares=CONFIG['boardSize']**2
    if len(encoded)!=CONFIG['inputPlanes']*squares or any(not math.isfinite(v)for v in encoded):
        raise ValueError('Invalid future-fact encoding')
    def plane(name):
        index=CONFIG['planes'].index(name)
        values=encoded[index*squares:(index+1)*squares]
        if any(v not in (0,1)for v in values):
            raise ValueError('Nonbinary board fact plane')
        return values
    commander=[];units=[];commanded=[];material=[]
    for player in ('P1','P2'):
        c,u,s,k=(plane(player+'.'+name)for name in ('commander','unit','supplied','commanded'))
        if sum(c)>1 or any(a+b>1 for a,b in zip(c,u)):
            raise ValueError('Invalid commander/material occupancy')
        total=sum(c)+sum(u)
        commander.append(sum(a*b for a,b in zip(c,s)))
        units.append(sum(a*b for a,b in zip(u,s))/sum(u)if sum(u)else 0.)
        commanded.append(sum((a+b)*v for a,b,v in zip(c,u,k))/total if total else 0.)
        material.append(total)
    total=sum(material)
    if not total and not allow_empty:
        raise ValueError('Empty future board')
    return commander+units+commanded+[x/total if total else 0. for x in material]


def observed_future_targets(decisions, *, protected_encodings=(),protected_families=(),endpoint=None):
    """Caller must exact-replay the archive first. Missing legacy clocks mask all.

    A horizon is the first observed prestate after that many completed turns.
    Forced controller changes are not used as a proxy for completed turns.
    """
    result=[{'values':[0.]*TARGET_COUNT,'mask':[False]*TARGET_COUNT}for _ in decisions]
    if not decisions or any('turnIndex'not in d for d in decisions):
        return result
    previous=None
    for d in decisions:
        turn=d['turnIndex']
        if type(turn)is not int or turn<0 or previous is not None and turn<previous['turnIndex']:
            raise ValueError('Invalid completed-turn sequence')
        if previous is not None and previous['afterHash']!=d['beforeHash']:
            raise ValueError('Mixed or discontinuous future trajectory')
        previous=d
    protected=frozenset(protected_encodings)
    if endpoint is not None:
        if (type(endpoint.get('turnIndex'))is not int or endpoint['turnIndex']<decisions[-1]['turnIndex']
                or type(endpoint.get('terminal'))is not bool or endpoint.get('stateHash')!=decisions[-1]['afterHash']):
            raise ValueError('Invalid verified future endpoint')
        endpoint_facts=board_facts(endpoint['encoded'],allow_empty=endpoint['terminal'])
    facts={'endpoint':endpoint_facts}if endpoint is not None else{}
    for i,start in enumerate(decisions):
        for offset,horizon in enumerate(HORIZONS):
            target=start['turnIndex']+horizon
            future=next((j for j in range(i+1,len(decisions))if decisions[j]['turnIndex']>=target),None)
            if future is not None and decisions[future]['turnIndex']==target:
                encoded=decisions[future].get('encoded');key=future
            elif endpoint is not None and (endpoint['turnIndex']==target or endpoint['terminal']and endpoint['turnIndex']<=target):
                encoded=endpoint['encoded'];key='endpoint'
            else:continue
            if encoded is None or protected and encoding_hash(encoded)in protected:
                continue
            if protected_families:
                from .evaluation_families import commander_family
                if commander_family(encoded)in protected_families:continue
            if key not in facts:facts[key]=board_facts(encoded)
            begin=offset*len(FACTS)
            result[i]['values'][begin:begin+len(FACTS)]=facts[key]
            known=[True]*len(FACTS)
            if key=='endpoint'and sum(facts[key][-2:])==0:known[-2:]=[False,False]
            result[i]['mask'][begin:begin+len(FACTS)]=known
    return result
