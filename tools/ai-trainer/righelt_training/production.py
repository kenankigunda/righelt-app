"""Frozen, independently replayed production starts. No historical move labels."""
import hashlib
import json
from pathlib import Path
from .replay import partition_for_family
from .portable import read_bound


def corpus_record(binding):
    if not isinstance(binding, dict) or set(binding) != {'path', 'sha256'}:
        raise ValueError('invalid production corpus binding')
    raw = read_bound(binding)
    if hashlib.sha256(raw).hexdigest() != binding['sha256']:
        raise ValueError('production corpus checksum mismatch')
    corpus = json.loads(raw)
    if corpus.get('schema') != 1 or corpus.get('kind') != 'production-starts-v1':
        raise ValueError('unsupported production corpus')
    held = set(corpus['heldOut'])
    positions = corpus['positions']
    withheld = {p['stateHash'] for p in positions if p['partition'] != 'train'}
    protected = {p['encodingHash'] for p in positions if p['partition'] != 'train' and not p.get('sharedOpening',False)}
    curation=corpus.get('curation',{})
    if 'sourceQualificationSchema' in curation and (type(curation['sourceQualificationSchema']) is not int or curation['sourceQualificationSchema'] != 1):
        raise ValueError('unsupported source qualification schema')
    protected_families={p.get('sourceFamily') for p in positions if p['partition']!='train'} if 'sourceQualificationSchema' in curation else set()
    for p in positions:
        if corpus.get('curation', {}).get('sourceQualificationSchema') == 1:
            if (p.get('sourcePurpose') not in ('competitive','exploratory','unclassified')
                or p.get('actorProvenance',{}).get('kind') not in ('human','computer','unknown')
                or not p.get('sourceFamily') or not p.get('label',{}).get('scope')
                or p.get('learnerEligibility') != {'historicalPolicy':False,'historicalOptimalNonterminalValue':False,'competitiveScore':False}
                or p['partition']=='train' and (p.get('historyStatus')!='active' or p.get('sourceFamily') in protected_families)):
                raise ValueError('invalid scoped source qualification')
        if p['partition'] not in ('train', 'validation'):
            raise ValueError('invalid production partition')
        if p['partition'] == 'train' and (p['gameId'] in held or p['stateHash'] in withheld or p['encodingHash'] in protected):
            raise ValueError('production evaluation leakage')
        if p['partition'] != 'train' and corpus.get('curation', {}).get('guardOnly'):
            if 'state' in p: raise ValueError('raw protected position in guard-only corpus')
            continue
        if p['state']['outcome']['status'] != 'ongoing':
            raise ValueError('terminal production start')
    return corpus


def load_corpus(binding):
    return [p for p in corpus_record(binding)['positions'] if p['partition'] == 'train']


def protected_encodings(binding):
    return {p['encodingHash'] for p in corpus_record(binding)['positions']
            if p['partition'] != 'train' and not p.get('sharedOpening',False)}


def production_job(position, *, seed, index, model_version, binding):
    # Explicit game grouping was frozen before this mapping. Salt only maps a
    # training family's name into the legacy buffer's hash-partition contract.
    for salt in range(10000):
        family = f"production:{position.get('sourceFamily',position['gameId'])}:{salt}"
        if partition_for_family(family) == 'train':
            return {'command': 'generate', 'id': f'game-{seed}-{index}', 'seed': seed,
                    'familyId': family, 'partition': 'train', 'kind': 'simple',
                    'initialState': position['state'], 'modelVersion': model_version,
                    'productionSource': {k: position[k] for k in ('gameId', 'decisionId', 'stateHash', 'category')}
                    | {'corpusSha256': binding['sha256']}
                    | ({'qualification':{k:position[k] for k in ('sourceFamily','sourcePurpose','actorProvenance','label','terminalBoundary','learnerEligibility')}} if 'sourcePurpose' in position else {})}
    raise ValueError('cannot map production family')
