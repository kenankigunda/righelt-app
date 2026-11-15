"""Pair-level statistics and gates; truncations never become engine draws."""
import math
import random
import json


def _start(job):
    return job.get('startKind', 'unclassified')


def _start_binding(job,required=False):
    claimed=required or any(k in job for k in ('kind','initialState','startKind','startIdentity'))
    if not claimed:return None
    start=_start(job);identity=job.get('startIdentity')
    if job.get('kind')=='normal' and job.get('initialState') is not None:
        raise ValueError('normal start cannot carry a custom construction')
    if identity is None and not required:
        return json.dumps({k:job.get(k) for k in ('kind','initialState','startKind','startIdentity')},sort_keys=True,allow_nan=False)
    if (start not in ('normal','developed') or not isinstance(identity,dict)
            or set(identity)!={'schema','startKind','kind','stateHash','constructionSha256'}
            or identity.get('schema')!=1 or identity.get('startKind')!=start or identity.get('kind')!=job.get('kind')
            or any(not isinstance(identity.get(k),str) or len(identity[k])!=64 or any(c not in '0123456789abcdef' for c in identity[k]) for k in ('stateHash','constructionSha256'))
            or start=='normal' and (job.get('kind')!='normal' or job.get('initialState') is not None)
            or start=='developed' and (job.get('kind')!='simple' or not isinstance(job.get('initialState'),dict))):
        raise ValueError('exact frozen start construction and authoritative identity required')
    # The shared Node authority constructs/validates this identity before execution.
    # Reporting compares both declared construction and that identity, not game rules.
    return json.dumps({k:job.get(k) for k in ('kind','initialState','startKind','startIdentity')},sort_keys=True,allow_nan=False)


def _primary_scope(scope, schedule):
    if scope is None: return None
    if (not isinstance(scope, dict) or set(scope) != {'metric','profiles','starts','seats'}
            or scope['metric'] not in ('score','actual-win-rate')):
        raise ValueError('explicit primary scope required')
    for key, allowed in (('profiles', {j['profile'] for j in schedule}),
                         ('starts', {'normal','developed'}), ('seats', {'P1','P2'})):
        values = scope[key]
        if not isinstance(values, list) or not values or any(not isinstance(v,str) for v in values) or len(set(values)) != len(values) or not set(values) <= allowed:
            raise ValueError('invalid primary scope '+key)
    candidate = [j for j in schedule if j['role']=='candidate']
    for job in candidate:_start_binding(job,required=True)
    if any(_start(j) not in ('normal','developed') or not isinstance(j.get('sourceFamily'),str)
           or not j['sourceFamily'] or type(j.get('seed')) is not int for j in candidate):
        raise ValueError('scoped work requires source family, seed and start kind')
    selected=[j for j in candidate if _in_scope(j,scope)]
    if not selected: raise ValueError('empty primary scope')
    for key,values in (('profiles',{j['profile'] for j in selected}),('starts',{_start(j) for j in selected}),('seats',{j['candidateSeat'] for j in selected})):
        if not set(scope[key])<=values: raise ValueError('unscheduled primary scope '+key)
    return {k: list(v) if isinstance(v,list) else v for k,v in scope.items()}


def _in_scope(job, scope):
    return scope is not None and job['profile'] in scope['profiles'] and _start(job) in scope['starts'] and job['candidateSeat'] in scope['seats']


def _summarize(jobs, records):
    wins=draws=losses=0; score=0.; missing={'unstarted':0,'unfinished':0,'failed':0}
    giveaways=unassessed=0
    for job in jobs:
        row=records.get(job['id'],{}); status=row.get('status','unstarted')
        if status=='complete':
            value=score_game(row['outcome'],job['candidateSeat']);score+=value
            wins+=value==1;draws+=value==.5;losses+=value==0
        else: missing[status]+=1
        if 'giveaways' in row: giveaways+=row['giveaways']
        else: unassessed+=1
    n=len(jobs); m=sum(missing.values())
    return {'scheduled':n,'completed':wins+draws+losses,'wins':wins,'draws':draws,'losses':losses,
        'missing':m,**missing,'scoreBounds':[score/n,(score+m)/n] if n else None,
        'actualWinRateBounds':[wins/n,(wins+m)/n] if n else None,
        'giveaways':giveaways,'giveawayUnassessed':unassessed,
        'sourceFamilies':sorted({j.get('sourceFamily',j['familyId']) for j in jobs})}


def _strata(jobs):
    strata={}
    for j in jobs: strata.setdefault((j['profile'],_start(j),j['candidateSeat']),[]).append(j)
    return strata


def _stratum(key, jobs, records):
    return dict(zip(('profile','startKind','candidateSeat'),key),**_summarize(jobs,records))


def paired_arm_report(control_schedule, control_receipts, treatment_schedule, treatment_receipts,
                      primary_scope=None, uncertainty=None):
    """Exploratory paired comparison with source-family, not game-level, resampling.

    Missing outcomes remain intervals. The uncertainty interval resamples the
    observed source families and their complete paired bundles. It is not an
    independent training replication or a population strength guarantee.
    """
    control=prospective_report(control_schedule,control_receipts,primary_scope)
    treatment=prospective_report(treatment_schedule,treatment_receipts,primary_scope)
    def key(j): return (j['role'],j['pairId'],j['profile'],_start(j),j['candidateSeat'])
    left={key(j):j for j in control_schedule};right={key(j):j for j in treatment_schedule}
    if len(left)!=len(control_schedule) or len(right)!=len(treatment_schedule) or set(left)!=set(right):
        raise ValueError('matched arm schedule required')
    for k,j in left.items():
        if any(j.get(field)!=right[k].get(field) for field in ('familyId','sourceFamily','seed','profile','startKind','candidateSeat')) or _start_binding(j,required=primary_scope is not None)!=_start_binding(right[k],required=primary_scope is not None):
            raise ValueError('arm family, seed, profile, start or seat mismatch')
    if {r['receiptId'] for r in control_receipts} & {r['receiptId'] for r in treatment_receipts}:
        raise ValueError('reused receipt across arms')
    result={'control':control,'treatment':treatment,'primaryScope':control['primaryScope'],
        'diagnosticOnly':primary_scope is None,'primaryPairedDeltaBounds':None,'familyUncertainty':None,
        'independentTrainingReplications':None,'strengthEstablished':False,
        'comparisonPurpose':'exploratory-promising-direction-screen'}
    if primary_scope is None: return result
    if (not isinstance(uncertainty,dict) or set(uncertainty)!={'confidence','seed','resamples'}
            or type(uncertainty['confidence']) not in (int,float) or not .5<uncertainty['confidence']<1
            or type(uncertainty['seed']) is not int or type(uncertainty['resamples']) is not int
            or not 100<=uncertainty['resamples']<=100000):
        raise ValueError('frozen family uncertainty settings required')
    cr={r['jobId']:r for r in control_receipts};tr={r['jobId']:r for r in treatment_receipts}
    def bounds(job, records):
        row=records.get(job['id'],{})
        if row.get('status')!='complete': return (0.,1.)
        value=score_game(row['outcome'],job['candidateSeat'])
        if primary_scope['metric']=='actual-win-rate': value=float(value==1)
        return (value,value)
    families={};deltas=[]
    for k,j in left.items():
        if j['role']!='candidate' or not _in_scope(j,primary_scope): continue
        a,b=bounds(j,cr),bounds(right[k],tr);delta=(b[0]-a[1],b[1]-a[0])
        deltas.append(delta);families.setdefault(j['sourceFamily'],[]).append(delta)
    def mean(rows,index): return sum(r[index] for r in rows)/len(rows)
    result['primaryPairedDeltaBounds']=[mean(deltas,0),mean(deltas,1)]
    result['primaryPairedDelta']=result['primaryPairedDeltaBounds'][0] if result['primaryPairedDeltaBounds'][0]==result['primaryPairedDeltaBounds'][1] else None
    ids=sorted(families);interval=None
    if len(ids)>=2:
        rng=random.Random(uncertainty['seed']);low=[];high=[]
        for _ in range(uncertainty['resamples']):
            sample=[d for family in rng.choices(ids,k=len(ids)) for d in families[family]]
            low.append(mean(sample,0));high.append(mean(sample,1))
        low.sort();high.sort();alpha=(1-uncertainty['confidence'])/2;n=uncertainty['resamples']-1
        interval=[low[math.floor(alpha*n)],high[math.ceil((1-alpha)*n)]]
    result['familyUncertainty']={**uncertainty,'sourceFamilies':ids,'interval':interval,
        'status':'observed-source-family-resampling' if interval else 'insufficient-source-families',
        'missingOutcomesImputed':False,'scope':'Conditional exploratory uncertainty over retained source families, not independent training replications.'}
    return result


def score_game(outcome, candidate_seat):
    if candidate_seat not in ('P1', 'P2'):
        raise ValueError('invalid seat')
    if outcome == 'truncated': return 0.0
    if outcome == 'draw': return 0.5
    if outcome not in ('p1_win', 'p2_win'): raise ValueError('unfinished or invalid outcome')
    return float(outcome == ('p1_win' if candidate_seat == 'P1' else 'p2_win'))


def paired_report(pairs, seed, threshold=0.60, resamples=10000):
    if not pairs or resamples != 10000: raise ValueError('requires pairs and 10000 resamples')
    seen=set(); scores=[]; truncations=0; starts={'normal':0,'heldout':0}
    for pair in pairs:
        if pair['id'] in seen: raise ValueError('duplicate pair')
        seen.add(pair['id'])
        games=pair['games']
        if len(games)!=2 or {g['candidateSeat'] for g in games}!={'P1','P2'}:
            raise ValueError('seat-swapped pair required')
        if pair['kind'] not in starts: raise ValueError('invalid start kind')
        starts[pair['kind']]+=1
        scores.append(sum(score_game(g['outcome'],g['candidateSeat']) for g in games)/2)
        truncations+=sum(g['outcome']=='truncated' for g in games)
    rng=random.Random(seed)
    draws=sorted(sum(rng.choices(scores,k=len(scores)))/len(scores) for _ in range(resamples))
    lower=draws[math.floor(0.025*(resamples-1))]
    upper=draws[math.ceil(0.975*(resamples-1))]
    score=sum(scores)/len(scores); truncation=truncations/(2*len(pairs))
    complete=len(pairs)==100 and starts=={'normal':50,'heldout':50}
    return {'score':score,'lower95':lower,'upper95':upper,'games':len(pairs)*2,
            'truncations':truncations,'truncationRate':truncation,'seed':seed,
            'resamples':resamples,'complete':complete,
            'passed':complete and score>=threshold and lower>0.5 and truncation<=0.05}


def prospective_report(schedule, receipts, primary_scope=None):
    """Future development ledger only. Never reinterpret October's frozen score.

    Keep every scheduled attempt and genuine equal trajectory. Missing/timeout
    outcomes have [0,1] score bounds, never invented draws. Correlation groups
    remain visible, with no independence or confidence claim from one model.
    Baseline-baseline diagnostics do not erase complete candidate pairs.
    """
    scope = _primary_scope(primary_scope, schedule)
    jobs = {job['id']: job for job in schedule}
    if not jobs or len(jobs) != len(schedule): raise ValueError('unique scheduled jobs required')
    records = {}; receipt_ids = set()
    for row in receipts:
        job = jobs.get(row['jobId'])
        if not job or row['jobId'] in records or row['receiptId'] in receipt_ids:
            raise ValueError('unscheduled, duplicate or reused receipt')
        identity = ('pairId', 'candidateSeat', 'profile', 'familyId', 'role') + (('sourceFamily','seed','startKind','startIdentity') if scope else ())
        if any(row.get(key) != job.get(key) for key in identity):
            raise ValueError('receipt differs from scheduled work')
        if row['status'] == 'complete' and row.get('outcome') not in ('p1_win','p2_win','draw'):
            raise ValueError('cutoff is not a terminal outcome')
        if row['status'] not in ('complete','unfinished','failed'): raise ValueError('invalid attempt disposition')
        if 'giveaways' in row and (type(row['giveaways']) is not int or row['giveaways'] < 0): raise ValueError('invalid giveaway count')
        records[row['jobId']] = row; receipt_ids.add(row['receiptId'])
    candidate = [j for j in schedule if j['role'] == 'candidate']
    groups = {}
    for job in candidate:
        groups.setdefault((job['pairId'],job['profile']),[]).append(job)
    if any(len(group) != 2 or {j['candidateSeat'] for j in group} != {'P1','P2'} for group in groups.values()):
        raise ValueError('prospective paired seats required')
    if scope and any(any(group[0].get(k)!=group[1].get(k) for k in ('familyId','sourceFamily','seed','startKind')) for group in groups.values()):
        raise ValueError('paired source family, seed and start identity required')
    if any(_start_binding(group[0],required=scope is not None)!=_start_binding(group[1],required=scope is not None) for group in groups.values()):
        raise ValueError('paired seats require the exact same frozen start')
    low = high = 0.; complete_pairs = 0
    for group in groups.values():
        complete_pairs += all(records.get(j['id'],{}).get('status') == 'complete' for j in group)
        for job in group:
            row = records.get(job['id'])
            if row and row['status'] == 'complete':
                value = score_game(row['outcome'], job['candidateSeat']); low += value; high += value
            else: high += 1
    n = len(candidate)
    return {'scheduledAttempts': len(schedule), 'candidateGames': n, 'attempted': len(records),
        'completed': sum(r['status']=='complete' for r in records.values()),
        'unfinished': sum(r['status']=='unfinished' for r in records.values()),
        'failed': sum(r['status']=='failed' for r in records.values()), 'unstarted':len(jobs)-len(records),
        'completeCandidatePairs': complete_pairs, 'candidateScoreBounds': [low/n,high/n] if n else None,
        'families': sorted({j['familyId'] for j in candidate}),
        'equalTrajectoriesRetained': True, 'independentTrainingReplications': None,
        'strengthEstablished': False,
        'primaryScope': scope, 'diagnosticOnly': scope is None,
        'primary': _summarize([j for j in candidate if _in_scope(j, scope)], records) if scope else None,
        'strata': [_stratum(key, values, records) for key, values in sorted(_strata(candidate).items())],
        'horusNormal': _summarize([j for j in candidate if j['profile']=='horus' and _start(j)=='normal'], records),
        'sourceFamilies': sorted({j.get('sourceFamily', j['familyId']) for j in candidate}),
        'scheduledWork': [{**j, 'status': records.get(j['id'],{}).get('status','unstarted'),
            'receiptId': records.get(j['id'],{}).get('receiptId'), 'outcome': records.get(j['id'],{}).get('outcome')} for j in schedule]}
