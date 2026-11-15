"""Operator-only immutable checkpoint and empty-root relocation audit.

Reads original historical files, copies a content-bound closure, then loads only
the copies. This never runs training or resumes an old allocation.
"""
import argparse
from contextlib import contextmanager
import hashlib
import json
import os
from pathlib import Path
import random
import shutil

from .portable import file_sha256


@contextmanager
def portable_environment(root,inventory):
    keys=('RIGHELT_PORTABLE_CLOSURE_PATH','RIGHELT_PORTABLE_CLOSURE_SHA256','RIGHELT_PORTABLE_ROOT')
    prior={key:os.environ.get(key) for key in keys};cwd=Path.cwd()
    os.environ.update(dict(zip(keys,(str(inventory),file_sha256(inventory),str(root)))))
    os.chdir(root)
    try:yield
    finally:
        os.chdir(cwd)
        for key,value in prior.items():
            if value is None:os.environ.pop(key,None)
            else:os.environ[key]=value


def audit(checkpoint,destination):
    import torch
    from .checkpoint import inspect_checkpoint,load_checkpoint,weights_sha256
    from .model import model_from_record
    checkpoint=Path(checkpoint).resolve();destination=Path(destination).resolve()
    if destination.exists():raise FileExistsError('new empty audit destination required')
    meta=json.loads(checkpoint.with_suffix('.json').read_bytes())
    data=inspect_checkpoint(checkpoint,manifest_sha256=meta['manifestSha256'],require_recovery=True)
    root=destination;run=root/'.ai-runs'/'portable';(run/'checkpoints').mkdir(parents=True)
    copied=run/'checkpoints'/checkpoint.name;entries=[]
    for source in (checkpoint,checkpoint.with_suffix('.json'),checkpoint.with_suffix('.runner.json')):
        target=run/'checkpoints'/source.name;shutil.copyfile(source,target)
        entries.append({'reference':str(source),'sha256':file_sha256(source),'path':str(target.relative_to(root))})
    total=0
    for reference,expected in data['recovery']['archives'].items():
        source=(checkpoint.parent.parent/reference).resolve()
        if file_sha256(source)!=expected:raise ValueError('historical replay object checksum mismatch')
        target=run/'objects'/expected
        target.parent.mkdir(exist_ok=True)
        if not target.exists():shutil.copyfile(source,target)
        if file_sha256(target)!=expected:raise ValueError('copied replay object checksum mismatch')
        total+=target.stat().st_size
        entries.append({'reference':reference,'sha256':expected,'path':str(target.relative_to(root))})
    inventory=run/'portable.json';inventory.write_text(json.dumps({'schema':1,'entries':entries},sort_keys=True)+'\n')
    with portable_environment(root,inventory):
        restored=model_from_record(meta);optimizer=torch.optim.AdamW(restored.parameters())
        loaded=load_checkpoint(copied,restored,optimizer,manifest_sha256=meta['manifestSha256'],require_recovery=True)
        if weights_sha256(restored.state_dict())!=weights_sha256(data['model']):raise ValueError('portable model differs')
        if not torch.equal(torch.get_rng_state(),data['torchRng']) or random.getstate()!=data['pythonRng']:
            raise ValueError('portable CPU RNG differs')
        for parameter,state in optimizer.state.items():
            for key,value in state.items():
                if isinstance(value,torch.Tensor):
                    if not torch.isfinite(value).all():raise ValueError('nonfinite optimizer state')
                    if key in ('exp_avg','exp_avg_sq') and value.shape!=parameter.shape:raise ValueError('optimizer tensor shape differs')
        if any(group['lr']!=.0001 for group in optimizer.param_groups):raise ValueError('incumbent optimizer learning rate differs')
        if loaded['replayIds']!=data['replayIds'] or loaded['recovery']['state']!=data['recovery']['state']:
            raise ValueError('portable cursor or observed-value marker differs')
        # The original Mac archive remains present. Its presence must not make a
        # missing cloud copy recoverable, or turn this into a false empty restore.
        first=next(entry for entry in entries if entry['reference'] in data['recovery']['archives'])
        target=root/first['path'];hidden=target.with_name(target.name+'.missing');target.rename(hidden)
        rejected=False
        try:
            try:inspect_checkpoint(copied,manifest_sha256=meta['manifestSha256'],require_recovery=True)
            except FileNotFoundError:rejected=True
        finally:hidden.rename(target)
        if not rejected:raise ValueError('missing cloud object fell back to original Mac')
    result={'schema':1,'kind':'attention-portable-checkpoint-audit','checkpointSha256':meta['sha256'],
        'architecture':meta['modelArchitecture'],'round':data['round'],'updates':data['updates'],
        'archives':len(data['replayIds']),'archiveBytes':total,'inventorySha256':file_sha256(inventory),
        'tensorOptimizerCpuRngCursorPassed':True,'emptyRootObjectRestorePassed':True,'missingCopyNegativePassed':True,
        'cudaQualified':False,'archiveEngineReplayQualified':False,'scientificMethodFrozen':False}
    (destination/'audit.json').write_text(json.dumps(result,sort_keys=True,indent=2)+'\n')
    return result


def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--checkpoint',required=True);parser.add_argument('--out',required=True)
    args=parser.parse_args();print(json.dumps(audit(args.checkpoint,args.out),sort_keys=True))


if __name__=='__main__':main()
