"""Pair-level statistics and gates; truncations never become engine draws."""
import math
import random


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


def prospective_report(schedule, receipts):
    """Future development ledger only. Never reinterpret October's frozen score.

    Keep every scheduled attempt and genuine equal trajectory. Missing/timeout
    outcomes have [0,1] score bounds, never invented draws. Correlation groups
    remain visible, with no independence or confidence claim from one model.
    Baseline-baseline diagnostics do not erase complete candidate pairs.
    """
    jobs = {job['id']: job for job in schedule}
    if not jobs or len(jobs) != len(schedule): raise ValueError('unique scheduled jobs required')
    records = {}; receipt_ids = set()
    for row in receipts:
        job = jobs.get(row['jobId'])
        if not job or row['jobId'] in records or row['receiptId'] in receipt_ids:
            raise ValueError('unscheduled, duplicate or reused receipt')
        if any(row[key] != job[key] for key in ('pairId', 'candidateSeat', 'profile', 'familyId', 'role')):
            raise ValueError('receipt differs from scheduled work')
        if row['status'] == 'complete' and row.get('outcome') not in ('p1_win','p2_win','draw'):
            raise ValueError('cutoff is not a terminal outcome')
        if row['status'] not in ('complete','unfinished','failed'): raise ValueError('invalid attempt disposition')
        records[row['jobId']] = row; receipt_ids.add(row['receiptId'])
    candidate = [j for j in schedule if j['role'] == 'candidate']
    groups = {}
    for job in candidate:
        groups.setdefault((job['pairId'],job['profile']),[]).append(job)
    if any(len(group) != 2 or {j['candidateSeat'] for j in group} != {'P1','P2'} for group in groups.values()):
        raise ValueError('prospective paired seats required')
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
        'strengthEstablished': False}
