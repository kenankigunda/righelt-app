import hashlib
import json
import os
from pathlib import Path
import random
import uuid
import torch
from .config import CONFIG_SHA256


def atomic_json(path, data):
    path=Path(path); path.parent.mkdir(parents=True,exist_ok=True)
    tmp=path.with_suffix(path.suffix+'.tmp')
    with tmp.open('w') as f:
        json.dump(data,f,sort_keys=True,allow_nan=False); f.write('\n');f.flush();os.fsync(f.fileno())
    os.replace(tmp,path)
    fd=os.open(path.parent,os.O_RDONLY)
    try:os.fsync(fd)
    finally:os.close(fd)


def save_checkpoint(path, model, optimizer, *, round_index, updates, replay_ids, manifest_sha256, recovery_state=None):
    path=Path(path);path.parent.mkdir(parents=True,exist_ok=True)
    data={'schema':1,'configSha256':CONFIG_SHA256,'manifestSha256':manifest_sha256,
          'model':{k:v.detach().cpu() for k,v in model.state_dict().items()},
          'optimizer':optimizer.state_dict(),'round':round_index,'updates':updates,
          'replayIds':replay_ids,'pythonRng':random.getstate(),'torchRng':torch.get_rng_state()}
    if recovery_state is not None:
        state=json.loads(json.dumps(recovery_state,sort_keys=True,allow_nan=False))
        archives={name:hashlib.sha256((path.parent.parent/name).read_bytes()).hexdigest() for name in state['archives']}
        data['recovery']={'schema':1,'state':state,'archives':archives}
        data['recoverySha256']=hashlib.sha256(json.dumps(data['recovery'],sort_keys=True,allow_nan=False).encode()).hexdigest()
    if torch.backends.mps.is_available(): data['mpsRng']=torch.mps.get_rng_state()
    tmp=path.with_name(path.name+'.'+uuid.uuid4().hex+'.tmp')
    try:
        with tmp.open('xb') as f:torch.save(data,f);f.flush();os.fsync(f.fileno())
        os.link(tmp,path)  # Atomic no-overwrite publication, including legacy paths.
    finally:tmp.unlink(missing_ok=True)
    fd=os.open(path.parent,os.O_RDONLY)
    try:os.fsync(fd)
    finally:os.close(fd)
    digest=hashlib.sha256(path.read_bytes()).hexdigest()
    atomic_json(path.with_suffix('.json'),{'sha256':digest,'configSha256':CONFIG_SHA256,
                                         'manifestSha256':manifest_sha256,'round':round_index,'updates':updates})
    if recovery_state is not None:
        atomic_json(path.with_suffix('.runner.json'),{'schema':2,'checkpointSha256':digest,
                    'recoverySha256':data['recoverySha256'],'state':data['recovery']['state']})
    return digest


def inspect_checkpoint(path, *, manifest_sha256, require_recovery=False):
    path=Path(path);meta=json.loads(path.with_suffix('.json').read_text())
    if hashlib.sha256(path.read_bytes()).hexdigest()!=meta['sha256']: raise ValueError('checkpoint checksum mismatch')
    data=torch.load(path,map_location='cpu',weights_only=True)
    if data['configSha256']!=CONFIG_SHA256 or data['manifestSha256']!=manifest_sha256:
        raise ValueError('checkpoint incompatible with run manifest')
    if any(meta.get(key)!=data[key] for key in ('configSha256','manifestSha256','round','updates')):
        raise ValueError('checkpoint metadata mismatch')
    recovery=data.get('recovery')
    if require_recovery and recovery is None:raise ValueError('checkpoint lacks bound recovery bundle')
    if recovery is not None:
        companion=json.loads(path.with_suffix('.runner.json').read_text())
        digest=hashlib.sha256(json.dumps(recovery,sort_keys=True,allow_nan=False).encode()).hexdigest()
        if (digest!=data['recoverySha256'] or digest!=companion.get('recoverySha256')
            or companion.get('checkpointSha256')!=meta['sha256'] or companion.get('state')!=recovery['state']):
            raise ValueError('recovery sidecar binding mismatch')
        if set(recovery['archives'])!=set(recovery['state']['archives']):raise ValueError('recovery archive list mismatch')
        if (recovery['state']['updates']!=data['updates'] or recovery['state']['round']!=data['round']
            or recovery['state']['archives']!=data['replayIds']):raise ValueError('recovery cursor/payload mismatch')
        for name,expected in recovery['archives'].items():
            if hashlib.sha256((path.parent.parent/name).read_bytes()).hexdigest()!=expected:raise ValueError('recovery archive checksum mismatch')
    return data


def load_checkpoint(path, model, optimizer=None, *, manifest_sha256, require_recovery=False):
    data=inspect_checkpoint(path,manifest_sha256=manifest_sha256,require_recovery=require_recovery)
    model.load_state_dict(data['model'])
    if optimizer is not None: optimizer.load_state_dict(data['optimizer'])
    random.setstate(data['pythonRng']);torch.set_rng_state(data['torchRng'])
    if 'mpsRng' in data and torch.backends.mps.is_available(): torch.mps.set_rng_state(data['mpsRng'])
    return data
