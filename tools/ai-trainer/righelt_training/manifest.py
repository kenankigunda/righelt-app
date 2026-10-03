import hashlib
import json
from pathlib import Path
import platform
import subprocess
import sys
from .config import CONFIG,CONFIG_SHA256,ROOT
from .checkpoint import atomic_json


def build_manifest(seed,stage):
    if stage not in ('initial','overnight') or not isinstance(seed,int) or not 0<=seed<2**32:
        raise ValueError('invalid stage or seed')
    dirty=subprocess.check_output(['git','status','--porcelain'],cwd=ROOT,text=True)
    if dirty.strip():raise ValueError('commit experiment source before launch')
    revision=subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip()
    return {'schema':1,'sourceRevision':revision,'configSha256':CONFIG_SHA256,'config':CONFIG,
            'python':platform.python_version(),'platform':platform.platform(),'seed':seed,'stage':stage,
            'resourcePolicy':'adaptive-v1','seconds':CONFIG['resources']['initialSeconds' if stage=='initial' else 'overnightSeconds'],
            'dependencies':subprocess.check_output([sys.executable,'-m','pip','freeze'],text=True).splitlines(),
            'lockHashes':{p:hashlib.sha256((ROOT/p).read_bytes()).hexdigest() for p in ['pnpm-lock.yaml','tools/ai-trainer/requirements.lock']}}


def write_manifest(path,data):
    digest=hashlib.sha256(json.dumps(data,sort_keys=True,allow_nan=False).encode()).hexdigest()
    atomic_json(path,{'manifest':data,'sha256':digest})
    return digest
