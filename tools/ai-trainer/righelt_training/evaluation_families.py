"""Untouched final families and conservative geometry aliases, model-free."""
import hashlib
import json
import re
from .config import CONFIG
from .replay import partition_for_family
FINAL_FAMILIES=6


def commander_family(encoded):
    board=CONFIG['boardSize'];squares=board**2
    if len(encoded)!=CONFIG['inputPlanes']*squares:
        raise ValueError('Invalid family encoding length')
    anchors=[]
    for player in ('P1','P2'):
        start=CONFIG['planes'].index(player+'.commander')*squares
        plane=encoded[start:start+squares]
        if any(x not in (0,1)for x in plane)or sum(plane)>1:
            raise ValueError('Invalid commander family plane')
        anchors.extend((player,i//board,i%board)for i,x in enumerate(plane)if x)
    return family_from_anchors(anchors)


def family_from_anchors(anchors):
    raw=json.dumps(sorted(anchors),separators=(',',':')).encode()
    return 'simple:'+hashlib.sha256(raw).hexdigest()


def family_aliases(state):
    # Conservative exclusion only. These transforms never create examples or
    # assert that every board reflection is a symmetry of the actual rules.
    last=CONFIG['boardSize']-1
    anchors=[(p['owner'],p['position']['row'],p['position']['col'])
             for p in state['pieces']if p['kind']=='commander']
    result=set()
    for mirror in (False,True):
        for turns in range(4):
            for swap in (False,True):
                transformed=[]
                for owner,row,col in anchors:
                    if mirror:col=last-col
                    for _ in range(turns):row,col=col,last-row
                    if swap:owner='P2'if owner=='P1'else'P1'
                    transformed.append((owner,row,col))
                result.add(family_from_anchors(transformed))
    return result


def seal_final_families(entries, *, source_revision, forbidden_families=()):
    if not re.fullmatch('[a-f0-9]{40}',source_revision)or len(entries)!=FINAL_FAMILIES:
        raise ValueError('Exact source and bounded final family count required')
    seen=set();fingerprints=set();protected=set();forbidden=set(forbidden_families)
    for entry in entries:
        family=entry['familyId'];aliases=family_aliases(entry['initialState'])
        actual=family_from_anchors([(p['owner'],p['position']['row'],p['position']['col'])
            for p in entry['initialState']['pieces']if p['kind']=='commander'])
        if family!=actual:
            raise ValueError('Final family differs from actual commander arrangement')
        proof=entry['engineProof']
        if family not in aliases or partition_for_family(family)!='final'or family in seen or aliases&forbidden or aliases&protected:
            raise ValueError('Final family was exposed, duplicated or aliased')
        if (proof.get('sourceRevision')!=source_revision or proof.get('passed')is not True
                or proof.get('initial')is not False or proof.get('fingerprint')!=entry['openingFingerprint']
                or not entry.get('openingActions')):
            raise ValueError('Verified noninitial final trajectory required')
        if entry['openingFingerprint']in fingerprints:
            raise ValueError('Duplicate final trajectory fingerprint')
        for key in ('stateHash','encodingHash','openingFingerprint'):
            if not re.fullmatch('[a-f0-9]{64}',entry.get(key,'')):
                raise ValueError('Exact final position identities required')
        if proof.get('stateHash')!=entry['stateHash']or proof.get('encodingHash')!=entry['encodingHash']:
            raise ValueError('Final engine proof position mismatch')
        seen.add(family);fingerprints.add(entry['openingFingerprint']);protected.update(aliases)
    protocol={'schema':1,'kind':'overall-incremental-final-families-v1','sourceRevision':source_revision,
              'families':entries,'protectedFamilies':sorted(protected),'profiles':['babs','tau','horus'],
              'seatSwapped':True,'independentFamilies':len(seen),'outcomesObserved':False,
              'unfinishedIsDraw':False,'claimStrengthGainRequiresEvidence':True}
    raw=json.dumps(protocol,sort_keys=True,separators=(',',':'),allow_nan=False).encode()
    return {'protocol':protocol,'sha256':hashlib.sha256(raw).hexdigest()}


def read_final_families(binding):
    from pathlib import Path
    raw=Path(binding['path']).read_bytes()
    if hashlib.sha256(raw).hexdigest()!=binding['sha256']:
        raise ValueError('Final family file checksum changed')
    record=json.loads(raw);p=record['protocol']
    canonical=json.dumps(p,sort_keys=True,separators=(',',':'),allow_nan=False).encode()
    if hashlib.sha256(canonical).hexdigest()!=record['sha256']or p.get('outcomesObserved')is not False:
        raise ValueError('Final family protocol changed or already exposed')
    checked=seal_final_families(p['families'],source_revision=p['sourceRevision'])
    if checked!=record:raise ValueError('Final family contract mismatch')
    return p
