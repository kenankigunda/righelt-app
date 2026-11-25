"""Reproducible teaching schedules over an immutable ordinary replay population."""
import hashlib
import json
import random
from collections import defaultdict


BATCH_SIZE = 128
CYCLE = 2048
ACQUISITION_UPDATES = 512


def lesson_count(schedule, cursor):
    if type(cursor) is not int or cursor < 0:
        raise ValueError('invalid practice cursor')
    if schedule == 'acquire':
        return 25
    if schedule == 'ordinary':
        return 0
    if schedule == 'spaced':
        return 1
    if schedule == 'concentrated':
        offset = cursor % CYCLE
        return 32 if offset < 32 or offset >= CYCLE - 32 else 0
    raise ValueError('unknown tactical practice schedule')


def prior_lessons(schedule, cursor):
    if schedule != 'concentrated':
        return cursor * lesson_count(schedule, cursor)
    cycles, offset = divmod(cursor, CYCLE)
    return cycles * CYCLE + 32 * (min(offset, 32) + max(0, offset - (CYCLE - 32)))


def fair_lesson_order(rows, seed):
    """Cycle categories, then independent sources, then decisions within a source."""
    groups = defaultdict(lambda: defaultdict(list))
    for row in rows:
        groups[row['category']][row['sourceFamily']].append(row)
    rng = random.Random(seed)
    families = {category: sorted(sources) for category, sources in groups.items()}
    for category, sources in groups.items():
        rng.shuffle(families[category])
        for decisions in sources.values():
            rng.shuffle(decisions)
    categories = sorted(groups)
    rng.shuffle(categories)
    def sample(index):
        round_index, category_index = divmod(index, len(categories))
        category = categories[category_index]
        decision_index, family_index = divmod(round_index, len(families[category]))
        decisions = groups[category][families[category][family_index]]
        return decisions[decision_index % len(decisions)]
    return sample


class PracticeBatches:
    def __init__(self, ordinary, lessons, seed):
        if not ordinary:
            raise ValueError('empty ordinary replay population')
        self.ordinary = list(ordinary)
        random.Random(seed).shuffle(self.ordinary)
        if any(row.get('preference') is not None for row in self.ordinary):
            raise ValueError('certified lesson in ordinary pool')
        self.lesson = fair_lesson_order(lessons, seed) if lessons else None

    def batch(self, schedule, index):
        count = lesson_count(schedule, index)
        if count and self.lesson is None:
            raise ValueError('missing verified tactical lessons')
        n = prior_lessons(schedule, index)
        offset = index * BATCH_SIZE - n
        return ([self.ordinary[i % len(self.ordinary)] for i in range(offset, offset + BATCH_SIZE - count)]
                + [self.lesson(i) for i in range(n, n + count)])


def prepared_job(job, index, first_index, starts):
    """Select one launch in each eight while retaining the native opponent cycle."""
    from .replay import partition_for_family
    block, offset = divmod(index - first_index, 8)
    if block < 0 or not starts:
        raise ValueError('invalid prepared-start allocation')
    begin = index - offset
    role = block % 4
    eligible = [i for i in range(begin, begin+8) if (i//4+i)%4 == role]
    if index != eligible[(block//4) % len(eligible)]:
        return job
    if job['teaching']['cycle'] != role:
        raise ValueError('prepared start changed opponent role')
    source = starts[(block//4 + role) % len(starts)]
    earlier = source.get('earlier') is not None and (block//4 + role) % 2 == 1
    selected = source['earlier'] if earlier else source['state']
    source_family = source['sourceFamily']
    if partition_for_family(source_family) != 'train':
        raise ValueError('prepared-start family is outside training')
    lineage = {k:source.get(k) for k in ('id','sourceFamily','sourceGameId','archiveSha256')}
    lineage.update(earlier=earlier, stateHash=source['earlierHash'] if earlier else source['stateHash'])
    return {**job, 'kind':'simple', 'familyId':source_family, 'initialState':selected,
            'tacticalStart':lineage}


def preference_loss(logits, batch, ordinary_policy):
    """Unjudged legal logits receive zero direct gradient from a teaching row."""
    import torch
    selected = [(i, row) for i, row in enumerate(batch) if 'preference' in row]
    if not selected:
        return ordinary_policy
    indices = [i for i, _ in selected]
    subset = logits[indices]
    positive = torch.zeros(subset.shape, dtype=torch.bool)
    judged = torch.zeros_like(positive)
    for i, (_, row) in enumerate(selected):
        pref = row['preference']
        good, bad = pref['preferred'], pref['inferior']
        if (row.get('policyMask') is not False or row['policy'] or row['terminalMask']
                or any(row.get('futureFacts', {}).get('mask', [])) or not good or not bad
                or len(set(good + bad)) != len(good) + len(bad)
                or any(type(a) is not int or a not in row['legal'] for a in good + bad)):
            raise ValueError('invalid scoped tactical preference')
        positive[i, good] = True
        judged[i, good + bad] = True
    floor = torch.finfo(logits.dtype).min
    preferred = torch.logsumexp(subset.masked_fill(~positive.to(logits.device), floor), dim=1)
    compared = torch.logsumexp(subset.masked_fill(~judged.to(logits.device), floor), dim=1)
    return (ordinary_policy * (len(batch) - len(selected)) + (compared - preferred).sum()) / len(batch)


def sample_identity(batch):
    ids = [p['id'] for p in batch]
    return hashlib.sha256(json.dumps(ids, separators=(',', ':')).encode()).hexdigest()
