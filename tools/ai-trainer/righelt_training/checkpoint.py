import hashlib
import base64
import gzip
import json
import os
from pathlib import Path
import random
import uuid
import torch
from .config import CONFIG_SHA256
from .training_recipe import recipe_binding, validate_recipe, record_recipe
from .architecture import BASELINE, model_architecture, record_architecture
from .portable import resolve_reference,ChecksumMismatch


def weights_sha256(state):
    digest=hashlib.sha256()
    for name,tensor in sorted(state.items()):
        digest.update(name.encode())
        digest.update(tensor.detach().cpu().contiguous().numpy().tobytes())
    return digest.hexdigest()


def atomic_json(path, data):
    path=Path(path); path.parent.mkdir(parents=True,exist_ok=True)
    tmp=path.with_suffix(path.suffix+'.tmp')
    with tmp.open('w') as f:
        json.dump(data,f,sort_keys=True,allow_nan=False); f.write('\n');f.flush();os.fsync(f.fileno())
    os.replace(tmp,path)
    fd=os.open(path.parent,os.O_RDONLY)
    try:os.fsync(fd)
    finally:os.close(fd)


def read_recovery_sidecar(path):
    """Read legacy or losslessly compressed recovery state, checking its bytes."""
    record=json.loads(resolve_reference(path).read_text())
    if record.get('schema')==3:
        if 'state' in record:raise ValueError('ambiguous compressed recovery sidecar')
        raw=gzip.decompress(base64.b64decode(record.pop('stateGzipBase64'),validate=True))
        if hashlib.sha256(raw).hexdigest()!=record.pop('stateSha256'):
            raise ValueError('compressed recovery sidecar checksum mismatch')
        record['state']=json.loads(raw)
    elif 'stateGzipBase64' in record or 'stateSha256' in record:
        raise ValueError('compressed sidecar has invalid schema')
    return record


def save_checkpoint(path, model, optimizer, *, round_index, updates, replay_ids, manifest_sha256, recovery_state=None, training_recipe=None, exploration_adoption=None):
    path=Path(path);path.parent.mkdir(parents=True,exist_ok=True)
    recipe = recipe_binding() if training_recipe is None else validate_recipe(training_recipe)
    data={'schema':1,'configSha256':CONFIG_SHA256,'manifestSha256':manifest_sha256,'trainingRecipe':recipe,
          'model':{k:v.detach().cpu() for k,v in model.state_dict().items()},
          'optimizer':optimizer.state_dict(),'round':round_index,'updates':updates,
          'replayIds':replay_ids,'pythonRng':random.getstate(),'torchRng':torch.get_rng_state()}
    binding = {}
    architecture = model_architecture(model)
    if architecture['id'] != BASELINE:
        binding['modelArchitecture'] = architecture
        data['modelArchitecture'] = architecture
    if exploration_adoption is not None:
        from .exploration_adoption import read_binding
        if read_binding(exploration_adoption)['trainingRecipe'] != recipe:
            raise ValueError('checkpoint differs from selected recipe')
        binding['explorationAdoption'] = exploration_adoption
        data['explorationAdoption'] = exploration_adoption
    if recovery_state is not None:
        state=json.loads(json.dumps(recovery_state,sort_keys=True,allow_nan=False))
        archives={name:hashlib.sha256(resolve_reference(name, base=path.parent.parent).read_bytes()).hexdigest() for name in state['archives']}
        data['recovery']={'schema':1,'state':state,'archives':archives}
        data['recoverySha256']=hashlib.sha256(json.dumps(data['recovery'],sort_keys=True,allow_nan=False).encode()).hexdigest()
    if torch.backends.mps.is_available(): data['mpsRng']=torch.mps.get_rng_state()
    if torch.cuda.is_available(): data['cudaRng']=torch.cuda.get_rng_state_all()
    compact=os.environ.get('RIGHELT_COMPACT_RECOVERY')=='1' and recovery_state is not None
    recovery=data.get('recovery')
    if compact:
        raw=json.dumps(recovery,sort_keys=True,allow_nan=False).encode()
        data['recoveryGzip']=gzip.compress(raw,compresslevel=1,mtime=0)
        data['recoveryCodec']='json-gzip-v1'
        del data['recovery']
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
                                         'manifestSha256':manifest_sha256,'round':round_index,'updates':updates,'trainingRecipe':recipe,**binding})
    if recovery_state is not None:
        companion={'schema':2,'checkpointSha256':digest,'recoverySha256':data['recoverySha256'],'state':recovery['state']}
        if compact:
            raw=json.dumps(companion.pop('state'),sort_keys=True,allow_nan=False).encode()
            companion.update(schema=3,stateSha256=hashlib.sha256(raw).hexdigest(),
                stateGzipBase64=base64.b64encode(gzip.compress(raw,compresslevel=1,mtime=0)).decode())
        atomic_json(path.with_suffix('.runner.json'),companion)
    return digest


def inspect_checkpoint(path, *, manifest_sha256, require_recovery=False, training_recipe=None):
    path=resolve_reference(path);meta=json.loads(resolve_reference(path.with_suffix('.json')).read_text())
    if hashlib.sha256(path.read_bytes()).hexdigest()!=meta['sha256']: raise ValueError('checkpoint checksum mismatch')
    data=torch.load(path,map_location='cpu',weights_only=True)
    if 'recoveryGzip' in data:
        if 'recovery' in data or data.get('recoveryCodec')!='json-gzip-v1':raise ValueError('ambiguous compressed checkpoint recovery')
        data['recovery']=json.loads(gzip.decompress(data.pop('recoveryGzip')))
        data.pop('recoveryCodec')
    elif 'recoveryCodec' in data:raise ValueError('compressed checkpoint payload missing')
    if (record_architecture(data) != record_architecture(meta)
            or ('modelArchitecture' in data) != ('modelArchitecture' in meta)):
        raise ValueError('Checkpoint architecture metadata mismatch')
    if data['configSha256']!=CONFIG_SHA256 or data['manifestSha256']!=manifest_sha256:
        raise ValueError('checkpoint incompatible with run manifest')
    recipe = record_recipe(data)
    if record_recipe(meta) != recipe or ('trainingRecipe' in data) != ('trainingRecipe' in meta):
        raise ValueError('checkpoint recipe metadata mismatch')
    if training_recipe is not None and validate_recipe(training_recipe) != recipe:
        raise ValueError('checkpoint training recipe mismatch')
    if ('explorationAdoption' in data) != ('explorationAdoption' in meta) or data.get('explorationAdoption') != meta.get('explorationAdoption'):
        raise ValueError('checkpoint adoption metadata mismatch')
    if 'explorationAdoption' in data:
        from .exploration_adoption import read_binding
        if read_binding(data['explorationAdoption'])['trainingRecipe'] != recipe:
            raise ValueError('checkpoint selected recipe mismatch')
    if any(meta.get(key)!=data[key] for key in ('configSha256','manifestSha256','round','updates')):
        raise ValueError('checkpoint metadata mismatch')
    recovery=data.get('recovery')
    if require_recovery and recovery is None:raise ValueError('checkpoint lacks bound recovery bundle')
    if recovery is not None:
        companion=read_recovery_sidecar(path.with_suffix('.runner.json'))
        digest=hashlib.sha256(json.dumps(recovery,sort_keys=True,allow_nan=False).encode()).hexdigest()
        if (digest!=data['recoverySha256'] or digest!=companion.get('recoverySha256')
            or companion.get('checkpointSha256')!=meta['sha256'] or companion.get('state')!=recovery['state']):
            raise ValueError('recovery sidecar binding mismatch')
        if set(recovery['archives'])!=set(recovery['state']['archives']):raise ValueError('recovery archive list mismatch')
        if (recovery['state']['updates']!=data['updates'] or recovery['state']['round']!=data['round']
            or recovery['state']['archives']!=data['replayIds']):raise ValueError('recovery cursor/payload mismatch')
        for name,expected in recovery['archives'].items():
            try:resolve_reference(name, base=path.parent.parent, expected_sha256=expected)
            except ChecksumMismatch as error:raise ValueError('recovery archive checksum mismatch') from error
    return data


def load_checkpoint(path, model, optimizer=None, *, manifest_sha256, require_recovery=False, training_recipe=None, validate_state=None):
    data=inspect_checkpoint(path,manifest_sha256=manifest_sha256,require_recovery=require_recovery,training_recipe=training_recipe)
    if model_architecture(model) != record_architecture(data):
        raise ValueError('Checkpoint differs from requested model architecture')
    if validate_state is not None: validate_state(data)
    if 'cudaRng' in data and torch.cuda.is_available() and len(data['cudaRng']) != torch.cuda.device_count():
        raise ValueError('CUDA recovery device count mismatch')
    model.load_state_dict(data['model'])
    if optimizer is not None: optimizer.load_state_dict(data['optimizer'])
    random.setstate(data['pythonRng']);torch.set_rng_state(data['torchRng'])
    if 'mpsRng' in data and torch.backends.mps.is_available(): torch.mps.set_rng_state(data['mpsRng'])
    if 'cudaRng' in data and torch.cuda.is_available():
        torch.cuda.set_rng_state_all(data['cudaRng'])
    return data
