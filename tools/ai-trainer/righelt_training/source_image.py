"""Verify the audited source-only image without carrying Git history."""
import hashlib
import json
import os
import re
from functools import lru_cache
from pathlib import Path
from .config import ROOT


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=False).encode()).hexdigest()


def safe_source(root, name):
    path = Path(name)
    if path.is_absolute() or not path.parts or any(p in ('.', '..', '.git') for p in path.parts):
        raise ValueError('unsafe image source path')
    current = root
    for part in path.parts:
        current = current / part
        if current.is_symlink():
            raise ValueError('image source symlink forbidden')
    if not current.is_file():
        raise ValueError('image source missing')
    return current


@lru_cache(maxsize=1)
def source_image():
    path = ROOT / '.compute-source.json'
    if os.environ.get('RIGHELT_HOSTED') != '1' or not path.exists():
        return None
    record = json.loads(path.read_text())
    if record.get('schema') != 2:
        raise ValueError('audited source-only image identity required')
    for field in ('sourceInventory', 'proofInventory'):
        inventory = record.get(field)
        if not isinstance(inventory, dict) or not inventory or digest(inventory) != record.get(field + 'Sha256'):
            raise ValueError('image source inventory binding differs')
        if any(not isinstance(name,str) or not isinstance(expected,str) or not re.fullmatch('[a-f0-9]{64}',expected) for name,expected in inventory.items()):
            raise ValueError('image proof or source hash malformed')
    for name, expected in record['sourceInventory'].items():
        if record['proofInventory'].get(name) != expected:
            raise ValueError('image source and proof inventories differ')
        if hashlib.sha256(safe_source(ROOT, name).read_bytes()).hexdigest() != expected:
            raise ValueError('image source bytes differ')
    locks = {name: hashlib.sha256(safe_source(ROOT, name).read_bytes()).hexdigest()
             for name in ('pnpm-lock.yaml', 'tools/ai-trainer/requirements.lock')}
    if record.get('locks') != locks or record.get('dependencySha256') != digest(locks):
        raise ValueError('image dependencies differ')
    if not isinstance(record.get('sourceRevision'), str) or not re.fullmatch('[a-f0-9]{40}',record['sourceRevision']):
        raise ValueError('image source revision missing')
    if os.environ.get('SOURCE_REVISION', record['sourceRevision']) != record['sourceRevision']:
        raise ValueError('image source revision differs')
    return record


def proof_inventory(paths, revision=None):
    identity = source_image()
    if identity is None:
        return None
    if revision is not None and revision != identity['sourceRevision']:
        raise ValueError('historical source is not present in the source-only image')
    result = {}
    for name in paths:
        matched = {p: h for p, h in identity['proofInventory'].items()
                   if p == name or p.startswith(name + '/')}
        if not matched:
            raise ValueError('proof dependency missing from image identity')
        for filename, expected in matched.items():
            if not filename.startswith('tools/ai-trainer/tests/') and identity['sourceInventory'].get(filename) != expected:
                raise ValueError('runtime proof dependency is not exported')
        result.update(matched)
    return result
