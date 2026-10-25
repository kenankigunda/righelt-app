"""Model-free verification of immutable manifests and authorized source repairs."""
import hashlib
import json
from pathlib import Path
import re


def checked_envelope(path):
    record=json.loads(Path(path).read_text())
    value=hashlib.sha256(json.dumps(record['manifest'],sort_keys=True,allow_nan=False).encode()).hexdigest()
    if record.get('sha256')!=value:
        raise ValueError('Manifest file checksum mismatch')
    return record


def active_envelope(directory):
    directory=Path(directory)
    record=checked_envelope(directory/'manifest.json')
    changes=directory/'source-amendments.jsonl'
    if not changes.exists():
        pointer=directory/'active-manifest.json'
        if pointer.exists() and json.loads(pointer.read_text()).get('sha256')!=record['sha256']:
            raise ValueError('Orphan active manifest pointer')
        return record
    raw=changes.read_bytes()
    if len(raw)>4*1024**2:
        raise ValueError('Manifest amendment byte bound')
    rows=[json.loads(line)for line in raw.splitlines()if line.strip()]
    if len(rows)>1000:
        raise ValueError('Manifest amendment count bound')
    for row in rows:
        if row.get('oldManifest')!=record['sha256'] or not re.fullmatch('[a-f0-9]{64}',row.get('newManifest','')):
            raise ValueError('Broken source amendment chain')
        if any(not row.get(k)for k in ('cause','regressionEvidence','artifactDisposition','reviewEvidence')):
            raise ValueError('Unreviewed source amendment')
        record=checked_envelope(directory/'manifests'/(row['newManifest']+'.json'))
        if record['sha256']!=row['newManifest']:
            raise ValueError('Amended manifest identity mismatch')
    if rows or (directory/'active-manifest.json').exists():
        pointer=json.loads((directory/'active-manifest.json').read_text())
        if pointer.get('sha256')!=record['sha256']:
            raise ValueError('Active manifest pointer mismatch')
    return record
