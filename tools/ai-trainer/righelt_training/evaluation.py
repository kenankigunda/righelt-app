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
