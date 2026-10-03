import hashlib
import json
import os
from pathlib import Path
import random
import torch
from .config import CONFIG_SHA256


def atomic_json(path, data):
    path=Path(path); path.parent.mkdir(parents=True,exist_ok=True)
    tmp=path.with_suffix(path.suffix+'.tmp')
    with tmp.open('w') as f:
        json.dump(data,f,sort_keys=True,allow_nan=False); f.write('\n');f.flush();os.fsync(f.fileno())
    os.replace(tmp,path)


def save_checkpoint(path, model, optimizer, *, round_index, updates, replay_ids, manifest_sha256):
    path=Path(path);path.parent.mkdir(parents=True,exist_ok=True)
    data={'schema':1,'configSha256':CONFIG_SHA256,'manifestSha256':manifest_sha256,
          'model':{k:v.detach().cpu() for k,v in model.state_dict().items()},
          'optimizer':optimizer.state_dict(),'round':round_index,'updates':updates,
          'replayIds':replay_ids,'pythonRng':random.getstate(),'torchRng':torch.get_rng_state()}
    if torch.backends.mps.is_available(): data['mpsRng']=torch.mps.get_rng_state()
    tmp=path.with_suffix('.tmp')
    with tmp.open('wb') as f: torch.save(data,f);f.flush();os.fsync(f.fileno())
    os.replace(tmp,path)
    digest=hashlib.sha256(path.read_bytes()).hexdigest()
    atomic_json(path.with_suffix('.json'),{'sha256':digest,'configSha256':CONFIG_SHA256,
                                         'manifestSha256':manifest_sha256,'round':round_index,'updates':updates})
    return digest


def load_checkpoint(path, model, optimizer=None, *, manifest_sha256):
    path=Path(path);meta=json.loads(path.with_suffix('.json').read_text())
    if hashlib.sha256(path.read_bytes()).hexdigest()!=meta['sha256']: raise ValueError('checkpoint checksum mismatch')
    data=torch.load(path,map_location='cpu',weights_only=True)
    if data['configSha256']!=CONFIG_SHA256 or data['manifestSha256']!=manifest_sha256:
        raise ValueError('checkpoint incompatible with run manifest')
    model.load_state_dict(data['model'])
    if optimizer is not None: optimizer.load_state_dict(data['optimizer'])
    random.setstate(data['pythonRng']);torch.set_rng_state(data['torchRng'])
    if 'mpsRng' in data and torch.backends.mps.is_available(): torch.mps.set_rng_state(data['mpsRng'])
    return data
