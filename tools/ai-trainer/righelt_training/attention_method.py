"""Explicit compatibility with the retained attention incumbent's actual method.

Historical state is evidence, never authority to reopen an allocation. A new
experiment must separately bind the method, portable replay proof, minimized
observed-value rows and held-out exclusion guards. Missing proof fails closed.
"""
import copy
import gzip
import hashlib
import json
import math
import re
from .architecture import architecture_binding
from .pilot_recipe import checked_recipe
from .portable import read_bound, resolve_reference
from .replay import encoding_hash
from .config import CONFIG

KIND = 'attention-incumbent-method-v1'
STATE_KEY = 'supplementalObservedValuesV1'


def digest(value):
    return hashlib.sha256(json.dumps(value,sort_keys=True,separators=(',', ':'),allow_nan=False).encode()).hexdigest()


def observed_projection(rows):
    return [{key:row[key] for key in ('encoded','legal','policy','policyMask','terminalMask','terminalValue')} for row in rows]


def validate_method(value):
    required={'schema','kind','sourceRevision','architecture','pilotRecipe','replayProof','supplementalRows','supplementalReceipt','transferReceipt','guardsSha256'}
    if not isinstance(value,dict) or set(value)!=required or value['schema']!=1 or value['kind']!=KIND:
        raise ValueError('explicit attention incumbent method required')
    if value['sourceRevision']!='0d2891aeaab7ab2bec440bbdd44f8bf3ac7bdb18' or value['architecture']!=architecture_binding('board-attention-48x2-v1'):
        raise ValueError('unaudited attention source or architecture')
    checked_recipe(value['pilotRecipe'])
    for key in ('replayProof','supplementalRows','supplementalReceipt','transferReceipt'):
        binding=value[key]
        if not isinstance(binding,dict) or set(binding)!={'path','sha256'} or not isinstance(binding['path'],str) or not re.fullmatch('[a-f0-9]{64}',binding['sha256']):
            raise ValueError('complete attention input binding required')
    if not re.fullmatch('[a-f0-9]{64}',value['guardsSha256']):raise ValueError('held-out guards required')
    return copy.deepcopy(value)


def supplemental_rows(method, marker, buffer):
    rows=json.loads(read_bound(method['supplementalRows']))
    receipt=json.loads(read_bound(method['supplementalReceipt']))
    if (not isinstance(rows,list) or len(rows)!=28 or marker.get('kind')!='observed-values-at-original-buffer-boundary-v1'
            or marker.get('valuePositions')!=28 or receipt.get('schema')!=1
            or receipt.get('kind')!='portable-observed-values-qualification'
            or receipt.get('rowsSha256')!=method['supplementalRows']['sha256']
            or receipt.get('originalBinding')!=marker.get('binding')
            or receipt.get('archivePrefixSha256')!=digest(marker.get('archivePrefix'))
            or receipt.get('guardsSha256')!=method['guardsSha256']
            or receipt.get('sanitization')!={'schema':1,'originalIdsRemoved':True,'modelInputsUnchanged':True}
            or receipt.get('originalModelInputProjectionSha256')!=digest(observed_projection(rows))
            or receipt.get('sanitizedModelInputProjectionSha256')!=digest(observed_projection(rows))
            or receipt.get('policyTargets') is not False or receipt.get('qualified') is not True):
        raise ValueError('qualified unchanged supplemental rows required')
    protected=buffer.protected_encoding_hashes
    families=getattr(buffer,'protected_family_ids',())
    ids=set()
    for row in rows:
        encoded=row.get('encoded',[]);legal=row.get('legal',[])
        if (set(row)-{'id','gameId','encoded','legal','policy','policyMask','terminalValue','terminalMask'}
                or row.get('policyMask') is not False or row.get('policy')!=[] or row.get('terminalMask') is not True
                or not isinstance(row.get('terminalValue'),(int,float)) or not math.isfinite(row['terminalValue']) or not -1<=row['terminalValue']<=1
                or len(encoded)!=CONFIG['inputPlanes']*CONFIG['boardSize']**2 or any(not isinstance(x,(int,float)) or not math.isfinite(x) for x in encoded)
                or not legal or len(set(legal))!=len(legal) or any(type(i)is not int or not 0<=i<CONFIG['actionCount'] for i in legal)
                or not isinstance(row.get('id'),str) or row['id'] in ids):
            raise ValueError('invalid unchanged observed value row')
        ids.add(row['id'])
        if encoding_hash(encoded) in protected:raise ValueError('supplemental baseline conflicts with held-out guard')
        if families:
            from .evaluation_families import commander_family
            if commander_family(encoded) in families:raise ValueError('supplemental baseline conflicts with held-out family')
    return rows


def reconstruct_replay(buffer, data, method, *, base):
    method=validate_method(method)
    state=data['recovery']['state'];references=state['archives']
    proof=json.loads(read_bound(method['replayProof']))
    expected=data['recovery']['archives']
    entries=proof.get('entries',[])
    inherited=references[:len(entries)]
    if (not entries or proof.get('schema')!=1 or proof.get('kind')!='portable-inherited-replay-qualification'
            or proof.get('guardsSha256')!=method['guardsSha256'] or proof.get('qualified') is not True
            or entries!=[{'reference':name,'sha256':expected[name],'eligible':True} for name in inherited]
            or any(__import__('pathlib').Path(name).is_absolute() for name in references[len(entries):])):
        raise ValueError('complete ordered inherited replay qualification required')
    marker=state.get(STATE_KEY)
    if not isinstance(marker,dict) or not isinstance(marker.get('archivePrefix'),list) or references[:len(marker['archivePrefix'])]!=marker['archivePrefix']:
        raise ValueError('supplemental replay boundary changed')
    prefix=marker['archivePrefix']
    if len(prefix)!=len(set(prefix)):raise ValueError('duplicate supplemental boundary')
    rows=supplemental_rows(method,marker,buffer)
    # Native deque eviction remains authoritative. Never append these values at
    # the end: doing so changes their replay age and the unchanged control.
    for index,name in enumerate(references):
        if index==len(prefix):
            existing={p['id'] for p in buffer.positions}
            if any(p['id'] in existing for p in rows):raise ValueError('duplicate supplemental value identity')
            buffer.positions.extend(copy.deepcopy(rows))
        path=resolve_reference(name,base=base,expected_sha256=expected[name])
        with gzip.open(path,'rt') as stream:buffer.append(json.load(stream))
    if len(prefix)==len(references):buffer.positions.extend(copy.deepcopy(rows))
    return {'archives':len(references),'supplementalRows':len(rows),'archivePrefix':len(prefix),'qualified':True}


def transfer_state(data, method, checkpoint_sha256, target_seed=None):
    """A new allocation consumes old uncertain work, never resumes its clock."""
    from .runner import default_state
    receipt=json.loads(read_bound(method['transferReceipt']))
    old=data['recovery']['state'];pending=old.get('pendingGenerationJob')
    cursor={key:old.get(key) for key in ('round','phase','trainingBatch','nextJob','generationLaunched','generationElapsedSeconds','pendingGenerationJob')}
    if (receipt.get('schema')!=1 or receipt.get('kind')!='attention-closed-allocation-transfer'
            or receipt.get('checkpointSha256')!=checkpoint_sha256
            or receipt.get('checkpointRecoverySha256')!=data['recoverySha256']
            or receipt.get('sourceAllocationClosed') is not True or receipt.get('cursorSha256')!=digest(cursor)
            or receipt.get('initialization') not in ('new-generation-boundary','resume-training-cursor',
                                                      'new-local-campaign-after-zero-batch')):
        raise ValueError('qualified closed-allocation transfer required')
    if pending:
        disposition=receipt.get('pendingDisposition')
        if receipt.get('pendingJobId')!=pending['id'] or disposition not in ('consumed-unfinished','consumed-unissued'):
            raise ValueError('old pending work cannot be retried')
        launches=[json.loads(line) for line in read_bound(receipt['sourceLaunchLedger']).decode().splitlines() if line.strip()]
        launched=any(row.get('jobId')==pending['id'] for row in launches)
        if disposition=='consumed-unfinished' and not launched:raise ValueError('missing original pending-work consumption proof')
        if disposition=='consumed-unissued':
            match=re.fullmatch(r'(initial|overnight)-game-(\d+)-(\d+)',pending['id'])
            counter=json.loads(read_bound(receipt['sourceRecoveryLedger']))
            if (launched or not match or receipt.get('sourceJobCounterKey')!=f'{match[1]}:{match[2]}'
                    or old['nextJob']!=int(match[3])+1 or counter.get('jobs',{}).get(receipt['sourceJobCounterKey'],0)<old['nextJob']):
                raise ValueError('unissued work requires original consumed counter and complete launch absence')
    elif receipt.get('pendingJobId') is not None:
        raise ValueError('transfer invents pending work')
    # A shared calibration descendant can preserve an exact training cursor.
    # Its original shuffle seed and typed source receipt remain mandatory.
    local_boundary = receipt['initialization'] == 'new-local-campaign-after-zero-batch'
    if local_boundary:
        authority = json.loads(read_bound(receipt['newProgram']))
        closed = json.loads(read_bound(receipt['closureEvidence']))
        if (old.get('phase') != 'training' or type(old.get('trainingBatch')) is not int
                or old['trainingBatch'] != 0 or not pending or receipt['pendingDisposition'] != 'consumed-unissued'
                or checkpoint_sha256 not in authority.get('parent', {}).values()
                or data['updates'] != authority.get('parentUpdates') or authority.get('cloud') is not False
                or closed.get('noFurtherTrainingOrResume') is not True
                or closed.get('allCheckpointsArchivesFailuresRetained') is not True):
            raise ValueError('closed local training boundary and unissued job required')
    elif old.get('phase')=='training':
        source=json.loads(read_bound(receipt.get('sourceResult')))
        if (receipt['initialization']!='resume-training-cursor' or source.get('kind')!='compute-result'
                or source.get('execution',{}).get('seed')!=target_seed
                or source.get('execution',{}).get('scientific',{}).get('stage')!='calibration'
                or source.get('execution',{}).get('scientific',{}).get('arm')!='shared'
                or source.get('disposition')!='complete' or source.get('allWorkComplete') is not True
                or not any(a.get('role')=='checkpoint' and a.get('sha256')==checkpoint_sha256 for a in source.get('artifacts',[]))
                or type(old.get('trainingBatch'))is not int or old['trainingBatch']<0):
            raise ValueError('exact shared training cursor and seed required')
    elif old.get('phase')!='generation' or receipt['initialization']!='new-generation-boundary':
        raise ValueError('unsupported incumbent transfer cursor')
    state=default_state()
    state.update(round=data['round'],updates=data['updates'],inheritedUpdates=data['updates'],
                 nextJob=old['nextJob'],archives=copy.deepcopy(old['archives']),
                 pilotLearningRate=old.get('pilotLearningRate'),curriculumSwitched=old['curriculumSwitched'])
    state[STATE_KEY]=copy.deepcopy(old[STATE_KEY])
    if old['phase']=='training' and not local_boundary:state.update(phase='training',trainingBatch=old['trainingBatch'])
    state['inheritedBoundary']={'cursor':cursor,'checkpointRecoverySha256':data['recoverySha256'],
        'inheritedReplayCount':len(old['archives']),
        'pendingDisposition':receipt.get('pendingDisposition'),'counters':{key:old.get(key) for key in
        ('completedGames','terminalGames','truncatedGames','unfinishedGames','nonzeroUpdates')}}
    return state


def restore_attention(runner, checkpoint):
    from .checkpoint import load_checkpoint
    from .execution_recipe import verify_runtime
    recipe=verify_runtime()
    meta=json.loads(resolve_reference(checkpoint.with_suffix('.json')).read_bytes())
    data=load_checkpoint(checkpoint,runner.model,runner.optimizer,
        manifest_sha256=meta['manifestSha256'],require_recovery=True,training_recipe=runner.training_recipe)
    original=recipe['incumbent']['checkpointSha256']
    if meta['sha256']==original:
        state=transfer_state(data,runner.attention_method,meta['sha256'],target_seed=runner.seed)
    else:
        if meta['manifestSha256']!=runner.manifest_hash:raise ValueError('attention recovery escaped new experiment')
        state=copy.deepcopy(data['recovery']['state'])
    runner.buffer.positions.clear();runner.buffer.ids.clear();runner.buffer.game_ids.clear()
    reconstruct_replay(runner.buffer,data,runner.attention_method,base=checkpoint.parent.parent)
    runner.state=state
    if meta['sha256']==original:
        from .consumption_transfer import apply
        apply(runner,data,meta['sha256'])
    if state.get('generationStartedMonotonic') is not None:
        import time
        elapsed=state.get('generationElapsedSeconds')
        if not isinstance(elapsed,(int,float)) or not math.isfinite(elapsed) or elapsed<0:raise ValueError('invalid restored generation clock')
        state['generationStartedMonotonic']=time.monotonic()-elapsed
    runner.model_version=meta['sha256']
    return data
