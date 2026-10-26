"""Frozen overall evaluation: all live profiles, paired seats, independent controls."""
import gzip
import hashlib
import json
from pathlib import Path
import time
import subprocess
from .config import ROOT
from .evaluation_families import read_final_families



_PROFILE_CACHE={}
_PROFILE_SOURCE=ROOT/'packages/shared-types/src/computer-play.ts'
def _export_public_profiles():
    script="import {COMPUTER_PROFILES}from './packages/shared-types/src/computer-play.ts'; console.log(JSON.stringify(COMPUTER_PROFILES));"
    return json.loads(subprocess.check_output(['node','--import','tsx','--input-type=module','-e',script],cwd=ROOT,text=True,timeout=10))


def capture_public_profiles(path):
    path=Path(path)
    if path.exists():raise ValueError('Preserve existing public profile artifact')
    record={'schema':1,'kind':'authoritative-public-profiles-v1','sourceSha256':hashlib.sha256(_PROFILE_SOURCE.read_bytes()).hexdigest(),'profiles':_export_public_profiles()}
    path.write_text(json.dumps(record,sort_keys=True,indent=2)+'\n')
    return {'path':str(path.resolve()),'sha256':hashlib.sha256(path.read_bytes()).hexdigest()}


def read_public_profiles(binding):
    raw=Path(binding['path']).read_bytes();digest=hashlib.sha256(raw).hexdigest()
    if digest!=binding['sha256']:raise ValueError('Public profile artifact changed')
    record=json.loads(raw);source_sha=hashlib.sha256(_PROFILE_SOURCE.read_bytes()).hexdigest()
    if record.get('schema')!=1 or record.get('kind')!='authoritative-public-profiles-v1'or record.get('sourceSha256')!=source_sha:raise ValueError('Public profile source changed')
    key=(digest,source_sha)
    if key not in _PROFILE_CACHE:
        if record['profiles']!=_export_public_profiles():raise ValueError('Public profiles differ from authoritative source export')
        _PROFILE_CACHE[key]=record['profiles']
    return json.loads(json.dumps(_PROFILE_CACHE[key]))

def definition(family_binding,profile_binding):
    profiles=read_public_profiles(profile_binding)
    families=read_final_families(family_binding)['families']
    if set(profiles)!={'babs','tau','horus'}:raise ValueError('All live profiles required')
    names=('babs','tau','horus');groups=[]
    # Spread early coverage across families/profiles, then complete the matrix.
    for diagonal in range(3):
        for index,family in enumerate(families):
            profile=names[(index+diagonal)%3]
            groups.append({'id':f"family-{index}-{profile}",'familyId':family['familyId'],
                'initialState':family['initialState'],'openingFingerprint':family['openingFingerprint'],
                'seed':(family['seed']+names.index(profile)*1000003)%2**32,'profile':profile})
    return {'schema':1,'kind':'overall-followup-final-v1','familySeal':family_binding,
            'profiles':profiles,'profileDefinition':profile_binding,'profileSourceSha256':hashlib.sha256(_PROFILE_SOURCE.read_bytes()).hexdigest(),'groups':groups,'gameSeconds':180,'unfinishedIsDraw':False,
            'independentFamilies':6,'candidateMatches':36,'baselineControls':18,
            'releaseRule':'Healthy and no clear regression; strength gain may remain uncertain. Evidence review required.',
            'automaticPromotion':False,'evaluationUsedForTraining':False}


def validate_plan(plan):
    expected=definition(plan['familySeal'],plan['profileDefinition'])
    if plan!=expected:raise ValueError('Frozen final evaluation definition changed')
    return plan


def jobs(plan,candidate_sha,baseline_sha):
    validate_plan(plan)
    for group in plan['groups']:
        profile=plan['profiles'][group['profile']]
        for seat in (None,'P1','P2'):
            versions={side:candidate_sha if side==seat else baseline_sha for side in ('P1','P2')}
            yield {**group,'id':group['id']+('-control'if seat is None else'-candidate-'+seat),
                'groupId':group['id'],'command':'arena','partition':'final','kind':'simple','openingKind':'heldout',
                'candidateSeat':seat,'modelVersions':versions,
                'evaluationProfile':{'name':group['profile'],'definition':profile,'artifactSha256':plan['profileDefinition']['sha256'],'sourceSha256':plan['profileSourceSha256']},
                'profiles':{side:profile for side in ('P1','P2')},
                'profileVersions':{side:profile['version']for side in ('P1','P2')}}


def report(plan,records):
    terminal={'p1_win','p2_win','draw'};scores=[];comparisons=[]
    for group in plan['groups']:
        control=records.get(group['id']+'-control')
        for seat in ('P1','P2'):
            candidate=records.get(group['id']+'-candidate-'+seat)
            if not candidate or candidate.get('outcome')not in terminal:continue
            score=.5 if candidate['outcome']=='draw'else float(candidate['outcome']==seat.lower()+'_win')
            scores.append({'familyId':group['familyId'],'profile':group['profile'],'seat':seat,'score':score})
            if control and control.get('outcome')in terminal:
                baseline=.5 if control['outcome']=='draw'else float(control['outcome']==seat.lower()+'_win')
                comparisons.append({'familyId':group['familyId'],'profile':group['profile'],'seat':seat,
                    'candidate':score,'baseline':baseline,'delta':score-baseline})
    return {'kind':plan['kind'],'expectedCandidateGames':36,'expectedControlGames':18,
            'completedTerminalCandidateGames':len(scores),'terminalScores':scores,'matchedComparisons':comparisons,
            'matchedLossesBaselineWon':[row for row in comparisons if row['candidate']==0 and row['baseline']==1],
            'observedIndependentFamilies':len({row['familyId']for row in comparisons}),
            'uniqueCompletedTrajectories':len({r['trajectorySha256']for r in records.values()if r.get('trajectorySha256')}),
            'unfinishedGames':sum(r.get('outcome')not in terminal for r in records.values()),
            'unattemptedGames':54-len(records),'uncertainStrengthAllowed':True,
            'clearRegressionDecision':'Requires correctness/target/runtime and matched game evidence review',
            'automaticPromotion':False,'evaluationUsedForTraining':False}


def run(plan,directory,models,candidate_sha,baseline_sha,deadline,*,allocation,heartbeat,
        player=None,clock=time.monotonic):
    """Use the existing exact-replayed arena player, without legacy workload claims."""
    validate_plan(plan)
    if player is None:
        from .arena import play_game
        player=lambda job,selected,end:play_game(job,selected,end,'mps',allocation=allocation,checkpoint=heartbeat)
    directory=Path(directory);directory.mkdir(parents=True,exist_ok=True)
    identity=hashlib.sha256(json.dumps({'plan':plan,'candidate':candidate_sha,'baseline':baseline_sha},sort_keys=True).encode()).hexdigest()
    state_path=directory/'state.json'
    state=json.loads(state_path.read_text())if state_path.exists()else{'identity':identity,'records':{}}
    if state['identity']!=identity:raise ValueError('Final candidate, baseline or plan changed')
    expected_jobs={job['id']:job for job in jobs(plan,candidate_sha,baseline_sha)}
    def checked_game(game,job):
        if (game.get('id')!=job['id']or game.get('modelVersions')!=job['modelVersions']
                or game.get('profileVersions')!=job['profileVersions']or game.get('initialState')!=job['initialState']
                or game.get('evaluationProfile')!=job['evaluationProfile']or game.get('partition')!='final'or any(game.get(k)!=job[k]for k in ('seed','familyId','kind'))):
            raise ValueError('Final game changed model/profile/opening provenance')
        if game['termination']=='terminal'and game['outcome']['status']in ('p1_win','p2_win','draw'):return game['outcome']['status']
        if game['termination']=='truncated'and game['outcome']['status']=='ongoing':return'truncated'
        raise ValueError('Dishonest final game outcome')
    def trajectory_hash(game,job):
        trajectory=[(d['controller'],d['beforeHash'],d['action'],d['afterHash'])for d in game['decisions']]
        return hashlib.sha256(json.dumps([job['initialState'],trajectory,game['finalHash']],sort_keys=True).encode()).hexdigest()
    for identity_key,entry in state['records'].items():
        if identity_key not in expected_jobs:raise ValueError('Unknown resumed final job')
        if 'archive'in entry:
            archive=(directory/entry['archive']).resolve()
            if not archive.is_relative_to(directory.resolve()):raise ValueError('Final archive outside allocation')
            raw=archive.read_bytes()
            if hashlib.sha256(raw).hexdigest()!=entry['sha256']:raise ValueError('Final archive checksum changed')
            game=json.loads(gzip.decompress(raw));job=expected_jobs[identity_key]
            if checked_game(game,job)!=entry['outcome']:raise ValueError('Final outcome receipt changed')
            if entry.get('trajectorySha256')!=trajectory_hash(game,job):raise ValueError('Final trajectory receipt changed')
        elif entry.get('outcome')!='unfinished'or not isinstance(entry.get('reason'),str):
            raise ValueError('Terminal/truncated final result requires verified archive')
    def persist():
        for path,data in ((state_path,state),(directory/'report.json',report(plan,state['records']))):
            temp=path.with_suffix('.tmp');temp.write_text(json.dumps(data,indent=2)+'\n');temp.replace(path)
    for job in jobs(plan,candidate_sha,baseline_sha):
        if job['id']in state['records']:continue
        heartbeat();assigned=allocation()
        if assigned.get('paused')or assigned.get('stop')or clock()>=deadline-30:break
        selected={seat:models['candidate']if job['candidateSeat']==seat else models['baseline']for seat in ('P1','P2')}
        result=player({**job,'decisionLogPath':str(directory/(job['id']+'.decisions.jsonl'))},selected,min(deadline,clock()+plan['gameSeconds']))
        if result['status']=='completed':
            game=result['game']
            outcome=checked_game(game,job)
            raw=gzip.compress(json.dumps(game,sort_keys=True).encode(),mtime=0)
            archive=directory/(job['id']+'.json.gz');archive.write_bytes(raw);archive.chmod(0o600)
            entry={'outcome':outcome,'archive':archive.name,'sha256':hashlib.sha256(raw).hexdigest(),
                'trajectorySha256':trajectory_hash(game,job)}
        elif result['status']=='unfinished':entry={'outcome':'unfinished','reason':result.get('reason')}
        else:raise ValueError('Final correctness failure requires repair')
        state['records'][job['id']]=entry;persist()
    persist();return report(plan,state['records'])
