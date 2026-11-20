"""Hash-bound relocation of immutable historical references, never path rewriting.

Only the operator prepares this inventory. Hosted readers cannot fall back to a
historical absolute path, even when that path happens to exist on the operator's
machine. The inventory and original checkpoint retain independent byte hashes.
"""
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re


class ChecksumMismatch(ValueError):
    pass


def file_sha256(path):
    digest = hashlib.sha256()
    with Path(path).open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(block)
    return digest.hexdigest()


def contained(root, relative):
    root = Path(root).resolve()
    relative = PurePosixPath(str(relative))
    if relative.is_absolute() or not relative.parts or relative.parts[0] != '.ai-runs' or any(p in ('.', '..') for p in relative.parts):
        raise ValueError('unsafe portable path')
    target = root
    for part in relative.parts:
        target = target / part
        if target.is_symlink():
            raise ValueError('portable path contains a symlink')
    if not target.resolve().is_relative_to(root):
        raise ValueError('portable path outside restore root')
    return target


class PortableClosure:
    def __init__(self, path, sha256, root):
        self.root_reference = Path(root).absolute()
        self.root = Path(root).resolve()
        path = Path(path)
        if not path.is_absolute():
            path = self.root / path
        try:
            relative = self.relative(path)
        except ValueError:
            raise ValueError('portable inventory outside restore root') from None
        path = contained(self.root, relative)
        if not re.fullmatch('[a-f0-9]{64}', sha256 or '') or file_sha256(path) != sha256:
            raise ChecksumMismatch('portable inventory checksum mismatch')
        value = json.loads(path.read_bytes())
        if value.get('schema') != 1 or not isinstance(value.get('entries'), list) or not 1 <= len(value['entries']) <= 4000:
            raise ValueError('invalid portable inventory')
        self.entries = {}
        self.paths = {}
        for entry in value['entries']:
            if set(entry) != {'reference', 'sha256', 'path'} or not isinstance(entry['reference'], str) or not entry['reference'] or not re.fullmatch('[a-f0-9]{64}', entry['sha256']):
                raise ValueError('invalid portable reference')
            target = contained(self.root, entry['path'])
            if entry['reference'] in self.entries or str(target) in self.paths and self.paths[str(target)]['sha256'] != entry['sha256']:
                raise ValueError('ambiguous portable reference')
            self.entries[entry['reference']] = entry
            self.paths[str(target)] = entry

    def relative(self, path):
        for root in (self.root_reference,self.root):
            try:return Path(path).relative_to(root)
            except ValueError:pass
        raise ValueError('path outside restore root')

    def resolve(self, reference, *, base=None, expected_sha256=None):
        original = str(reference)
        entry = self.entries.get(original)
        candidate = Path(reference)
        if entry is None:
            candidate = candidate if candidate.is_absolute() else Path(base or self.root) / candidate
            try:entry = self.paths.get(str(contained(self.root,self.relative(candidate))))
            except ValueError:entry = None
        if entry is not None:
            if expected_sha256 is not None and entry['sha256'] != expected_sha256:
                raise ChecksumMismatch('portable reference differs from committed checksum')
            target = contained(self.root, entry['path'])
            if file_sha256(target) != entry['sha256']:
                raise ChecksumMismatch('portable object checksum mismatch')
            return target
        # Newly produced recovery files need not occur in the initial inventory.
        # Historical absolute references outside the fresh root never get read.
        candidate = candidate if candidate.is_absolute() else Path(base or self.root) / candidate
        try:
            relative = self.relative(candidate)
        except ValueError:
            raise ValueError('unmapped historical reference') from None
        target = contained(self.root, relative)
        if expected_sha256 is not None and file_sha256(target) != expected_sha256:
            raise ChecksumMismatch('recovery object checksum mismatch')
        return target


_CLOSURES = {}


def closure_from_env():
    path = os.environ.get('RIGHELT_PORTABLE_CLOSURE_PATH')
    digest = os.environ.get('RIGHELT_PORTABLE_CLOSURE_SHA256')
    if not path and not digest:
        return None
    if not path or not digest:
        raise ValueError('incomplete portable inventory binding')
    root=os.environ.get('RIGHELT_PORTABLE_ROOT',os.getcwd())
    key=(str(Path(root).absolute()),str(Path(path).absolute()),digest)
    cached=_CLOSURES.get(key)
    if cached is not None:
        # Reuse parsed aliases only. Inventory bytes, ancestry and each resolved
        # object's bytes remain independently checked on every access.
        if Path(root).resolve()!=cached.root:raise ValueError('portable restore root changed')
        inventory=contained(cached.root,cached.relative(Path(path) if Path(path).is_absolute() else cached.root/Path(path)))
        if file_sha256(inventory)!=digest:raise ChecksumMismatch('portable inventory checksum mismatch')
        return cached
    closure=PortableClosure(path,digest,root)
    if len(_CLOSURES)>=4:_CLOSURES.pop(next(iter(_CLOSURES)))
    _CLOSURES[key]=closure
    return closure


def resolve_reference(reference, *, base=None, expected_sha256=None):
    closure = closure_from_env()
    if closure is not None:
        return closure.resolve(reference, base=base, expected_sha256=expected_sha256)
    target = Path(reference)
    target = target if target.is_absolute() else Path(base or os.getcwd()) / target
    if os.environ.get('RIGHELT_HOSTED') == '1':
        root = Path(os.getcwd()).resolve()
        try:
            target = contained(root, target.relative_to(root))
        except ValueError:
            raise ValueError('hosted reference outside run root') from None
    if expected_sha256 is not None and file_sha256(target) != expected_sha256:
        raise ChecksumMismatch('bound object checksum mismatch')
    return target.resolve()


def read_bound(binding, *, base=None):
    if not isinstance(binding, dict) or not re.fullmatch('[a-f0-9]{64}', binding.get('sha256', '')):
        raise ValueError('explicit file checksum required')
    return resolve_reference(binding['path'], base=base, expected_sha256=binding['sha256']).read_bytes()
