import hashlib
import json
from pathlib import Path
import platform
import subprocess
import sys
from .config import CONFIG,CONFIG_SHA256,ROOT
from .checkpoint import atomic_json
from .resource_policy import manifest_fields
from .training_recipe import recipe_binding, validate_recipe, record_recipe


def build_manifest(seed,stage,*,training_recipe=None):
    if stage not in ('initial','overnight') or not isinstance(seed,int) or not 0<=seed<2**32:
        raise ValueError('invalid stage or seed')
    dirty=subprocess.check_output(['git','status','--porcelain'],cwd=ROOT,text=True)
    if dirty.strip():raise ValueError('commit experiment source before launch')
    revision=subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip()
    recipe=recipe_binding() if training_recipe is None else validate_recipe(training_recipe)
    return {'schema':1,'sourceRevision':revision,'configSha256':CONFIG_SHA256,'config':CONFIG,'trainingRecipe':recipe,
            'python':platform.python_version(),'platform':platform.platform(),'seed':seed,'stage':stage,
            **manifest_fields(),'seconds':CONFIG['resources']['initialSeconds' if stage=='initial' else 'overnightSeconds'],
            'dependencies':subprocess.check_output([sys.executable,'-m','pip','freeze'],text=True).splitlines(),
            'lockHashes':{p:hashlib.sha256((ROOT/p).read_bytes()).hexdigest() for p in ['pnpm-lock.yaml','tools/ai-trainer/requirements.lock']}}


def write_manifest(path,data):
    record_recipe(data)
    digest=hashlib.sha256(json.dumps(data,sort_keys=True,allow_nan=False).encode()).hexdigest()
    atomic_json(path,{'manifest':data,'sha256':digest})
    return digest


def active_manifest(directory):
    directory=Path(directory)
    pointer=directory/'active-manifest.json'
    from .allocation import rows
    amendments=rows(directory/'source-amendments.jsonl')
    if not amendments:
        record=json.loads((directory/'manifest.json').read_text())
        record_recipe(record['manifest'])
        return record
    digest=amendments[-1]['newManifest']
    record=json.loads((directory/'manifests'/f'{digest}.json').read_text())
    if record['sha256']!=digest or hashlib.sha256(json.dumps(record['manifest'],sort_keys=True,allow_nan=False).encode()).hexdigest()!=digest:
        raise ValueError('active manifest checksum mismatch')
    record_recipe(record['manifest'])
    return record


def manifest_hashes(directory):
    directory=Path(directory)
    from .allocation import rows
    initial=json.loads((directory/'manifest.json').read_text())['sha256']
    result={initial};previous=initial
    for change in rows(directory/'source-amendments.jsonl'):
        if change['oldManifest']!=previous:raise ValueError('broken source amendment chain')
        result.add(change['newManifest']);previous=change['newManifest']
    if active_manifest(directory)['sha256']!=previous:raise ValueError('active manifest not in source amendment chain')
    return result


def amend_manifest(directory,manifest,repair):
    from .allocation import append
    directory=Path(directory);prior=active_manifest(directory)
    if record_recipe(prior['manifest']) != record_recipe(manifest):
        raise ValueError('repair changes training recipe')
    if prior['manifest']==manifest:return prior
    if prior['manifest'].get('continuation')!=manifest.get('continuation'):
        raise ValueError('repair changes continuation authorization')
    for key in ('configSha256','seed','stage','seconds'):
        if prior['manifest'][key]!=manifest[key]:raise ValueError('repair changes approved experiment contract')
    for key in ('cause','regressionEvidence','artifactDisposition','reviewEvidence'):
        if not repair.get(key):raise ValueError(f'source amendment missing {key}')
    digest=hashlib.sha256(json.dumps(manifest,sort_keys=True,allow_nan=False).encode()).hexdigest()
    path=directory/'manifests'/f'{digest}.json'
    if path.exists():raise ValueError('source amendment already exists; investigate interrupted amendment')
    write_manifest(path,manifest)
    append(directory/'source-amendments.jsonl',{'oldManifest':prior['sha256'],'newManifest':digest,**repair})
    atomic_json(directory/'active-manifest.json',{'sha256':digest})
    return active_manifest(directory)


SCREEN_PROOF_PATHS=('tools/ai-trainer/exploration-record.mjs','tools/ai-trainer/engine-worker.mjs',
    'tools/ai-trainer/righelt_training/exploration_plan.py','tools/ai-trainer/righelt_training/exploration_metrics.py',
    'tools/ai-trainer/righelt_training/exploration_journal.py','tools/ai-trainer/righelt_training/exploration_receipt.py',
    'tools/ai-trainer/righelt_training/exploration_screen.py','tools/ai-trainer/righelt_training/exploration_worker.py',
    'tools/ai-trainer/righelt_training/allocation.py','tools/ai-trainer/righelt_training/processes.py',
    'tools/ai-trainer/tests/exploration-worker.test.mjs','tools/ai-trainer/tests/test_exploration_plan_metrics.py',
    'tools/ai-trainer/tests/test_exploration_journal_receipt.py','tools/ai-trainer/tests/test_exploration_screen.py',
    'tools/ai-trainer/tests/test_exploration_process.py')

PROOF_PATHS=('packages/game-engine/src','packages/computer-player/src','packages/shared-types/src',
    'packages/computer-player/config/training-recipes-v1.json',
    'tools/ai-trainer/righelt_training/model.py','tools/ai-trainer/righelt_training/export.py',
    'tools/ai-trainer/righelt_training/parity.py','tools/ai-trainer/requirements.lock','pnpm-lock.yaml',*SCREEN_PROOF_PATHS)

def dependency_inventory(revision=None):
    """Exact tracked source inventory; missing paths can never imply no changes."""
    inventory={}
    for name in PROOF_PATHS:
        if not (ROOT/name).exists():raise ValueError(f'proof dependency missing: {name}')
        files=subprocess.check_output(['git','ls-tree','-r','--name-only',revision or 'HEAD','--',name],cwd=ROOT,text=True).splitlines()
        if not files:raise ValueError(f'empty proof dependency: {name}')
        for filename in files:
            data=subprocess.check_output(['git','show',f'{revision}:{filename}'],cwd=ROOT) if revision else (ROOT/filename).read_bytes()
            inventory[filename]=hashlib.sha256(data).hexdigest()
    return inventory
