"""Operator-side closure inspection, and cloud-only recovery in an empty root.

Never rewrites hashed checkpoint/manifest bytes or revives an old allocation.
"""
import argparse
import hashlib
import json
from pathlib import Path
import random
import tempfile
import os
from contextlib import contextmanager
import torch
from .checkpoint import inspect_checkpoint, load_checkpoint, weights_sha256
from .model import model_from_record
from .trainer import make_optimizer
from .portable import PortableClosure


@contextmanager
def portable_context(root, files, manifest):
    """Bind immutable historical references exclusively to this fresh root."""
    names=('RIGHELT_PORTABLE_CLOSURE_PATH','RIGHELT_PORTABLE_CLOSURE_SHA256','RIGHELT_PORTABLE_ROOT','RIGHELT_HOSTED')
    root=Path(root).resolve();old_cwd=Path.cwd()
    old={key:os.environ.get(key) for key in names}
    try:
        for key in names:os.environ.pop(key,None)
        os.environ['RIGHELT_HOSTED']='1'
        os.chdir(root)
        digest=manifest.get('portableClosureSha256')
        closure=None
        if digest:
            matches=[a for a in files if a['sha256']==digest]
            if len(matches)!=1:raise ValueError('portable inventory is not uniquely bound')
            relative=matches[0]['path']
            os.environ.update(RIGHELT_PORTABLE_CLOSURE_PATH=str(Path(root)/relative),RIGHELT_PORTABLE_CLOSURE_SHA256=digest,RIGHELT_PORTABLE_ROOT=str(root))
            closure=PortableClosure(Path(root)/relative,digest,root)
            for entry in closure.entries.values():closure.resolve(entry['reference'],expected_sha256=entry['sha256'])
        yield closure
    finally:
        os.chdir(old_cwd)
        for key,value in old.items():
            if value is None:os.environ.pop(key,None)
            else:os.environ[key]=value


def materialize(root, files, objects):
    root=Path(root).resolve()
    for a in files:
        relative=Path(a['path'])
        if relative.is_absolute() or not relative.parts or relative.parts[0]!='.ai-runs' or '..' in relative.parts:
            raise ValueError('unsafe backup path')
        raw=(Path(objects)/a['sha256']).read_bytes()
        if len(raw)!=a['bytes'] or hashlib.sha256(raw).hexdigest()!=a['sha256']:raise ValueError('backup file checksum mismatch')
        target=root/relative;target.parent.mkdir(parents=True,exist_ok=True)
        if target.exists():raise ValueError('restore requires empty destinations')
        target.write_bytes(raw)


def checkpoint_path(files, pointer, objects):
    latest=json.loads((Path(objects)/pointer['sha256']).read_text())
    matches=[a for a in files if a['sha256']==latest['sha256'] and a['path'].endswith('.pt')]
    if len(matches)!=1:raise ValueError('checkpoint pointer is not uniquely bound')
    return matches[0]['path']


def inspect(root, relative):
    cp=Path(root).resolve()/relative
    meta=json.loads(cp.with_suffix('.json').read_text())
    data=inspect_checkpoint(cp,manifest_sha256=meta['manifestSha256'],require_recovery=True)
    model=model_from_record(data);optimizer=make_optimizer(model)
    recovered=load_checkpoint(cp,model,optimizer,manifest_sha256=meta['manifestSha256'],require_recovery=True)
    if not torch.equal(torch.get_rng_state(),data['torchRng']) or random.getstate()!=data['pythonRng']:raise ValueError('restored RNG differs')
    original=data['optimizer'];actual=optimizer.state_dict()
    if original['param_groups']!=actual['param_groups']:raise ValueError('restored optimizer groups differ')
    for key,values in original['state'].items():
        for name,value in values.items():
            other=actual['state'][key][name]
            if isinstance(value,torch.Tensor):
                if not torch.equal(value.cpu(),other.cpu()):raise ValueError('restored optimizer tensor differs')
            elif value!=other:raise ValueError('restored optimizer state differs')
    return {'rngRestored':True,'optimizerRestored':True,'cudaRngDeviceCount':len(data.get('cudaRng',[])), 'checkpointSha256':meta['sha256'],'weightsSha256':weights_sha256(model.state_dict()),
        'updates':recovered['updates'],'round':recovered['round'],'replayIds':recovered['replayIds'],
        'recoveryState':data['recovery']['state'],'optimizerStateEntries':len(optimizer.state),
        'sourceManifestSha256':meta['manifestSha256'],'allocationResumed':False}


def selections(directory):
    directory=Path(directory);inventory=json.loads((directory/'inventory.json').read_text());result=[]
    for snapshot in inventory['recoveryPoints']:
        # Snapshot bytes supersede frozen inputs at an identical run path.
        files=list({a['path']:a for a in [*inventory['manifest']['inputs'],*snapshot['files']]}.values())
        pointer=next(a for a in snapshot['files'] if a['path'].endswith('/latest.json'))
        cp=checkpoint_path(files,pointer,directory/'objects')
        with tempfile.TemporaryDirectory(prefix='righelt-backup-audit-') as temporary:
            materialize(temporary,files,directory/'objects')
            with portable_context(temporary,files,inventory['manifest']) as closure:
                audit=inspect(temporary,cp)
                archive_paths=[str(closure.resolve(name,base=Path(temporary)/Path(cp).parent.parent).relative_to(temporary)) if closure else str(Path(pointer['path']).parent/name) for name in audit['replayIds']]
        run=str(Path(pointer['path']).parent)
        required={cp,str(Path(cp).with_suffix('.json')),str(Path(cp).with_suffix('.runner.json')),pointer['path']}
        required.update(archive_paths)
        if inventory['manifest'].get('portableClosureSha256'):
            required.update(a['path'] for a in inventory['manifest']['inputs'])
        for a in files:
            p=Path(a['path'])
            if p.suffix in ('.json','.jsonl') and '/checkpoints/' not in a['path']:
                required.add(a['path'])
        if not required.issubset({a['path'] for a in files}):raise ValueError('recovery closure missing companions')
        result.append({'snapshotId':snapshot['id'],'paths':sorted(required),'checkpointPath':cp,'checkpointSha256':audit['checkpointSha256']})
    if not result:result=[{'snapshotId':None,'paths':[]}]
    return result


def restore(directory, target):
    directory=Path(directory);target=Path(target)
    if target.exists():raise ValueError('cloud restore requires a new empty root')
    root=json.loads((directory/'backup-root.json').read_text())
    target.mkdir(parents=True)
    control_path=directory/'objects'/root['control']['sha256'];raw=control_path.read_bytes()
    if hashlib.sha256(raw).hexdigest()!=root['control']['sha256']:raise ValueError('control receipt checksum mismatch')
    control=json.loads(raw)
    if control['manifestSha256']!=root['manifestSha256']:raise ValueError('control manifest mismatch')
    (target/'control.json').write_bytes(raw)
    for claim in control['claims'].values():
        if claim.get('result'):
            a=claim['result'];data=(directory/'objects'/a['sha256']).read_bytes()
            if len(data)!=a['bytes'] or hashlib.sha256(data).hexdigest()!=a['sha256']:raise ValueError('settled receipt mismatch')
            receipts=target/'receipts';receipts.mkdir(exist_ok=True);(receipts/a['sha256']).write_bytes(data)
    materialize(target,root['files'],directory/'objects')
    if root['checkpointPath']:
        with portable_context(target,root['files'],control['manifest']):
            result=inspect(target,root['checkpointPath'])
        if result['checkpointSha256']!=root['checkpointSha256']:raise ValueError('restored checkpoint differs')
    else:result={'checkpointSha256':None,'allocationResumed':False}
    result.update(schema=1,backupId=root['id'],manifestSha256=root['manifestSha256'],controlSha256=root['control']['sha256'])
    (target/'restore-proof.json').write_text(json.dumps(result,sort_keys=True,allow_nan=False)+'\n')
    return result


def main():
    torch.set_num_threads(1)
    p=argparse.ArgumentParser();p.add_argument('--collection',type=Path);p.add_argument('--backup',type=Path);p.add_argument('--out',type=Path);args=p.parse_args()
    if args.collection:print(json.dumps(selections(args.collection)))
    elif args.backup and args.out:print(json.dumps(restore(args.backup,args.out)))
    else:p.error('collection or backup/out required')

if __name__=='__main__':main()
