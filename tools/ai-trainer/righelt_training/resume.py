"""An explicitly reset allocation can inherit only its audited predecessor."""
import hashlib
import json
from pathlib import Path
from .checkpoint import inspect_checkpoint
from .manifest import manifest_hashes


def validate_reset_checkpoint(checkpoint, gate, creation):
    proof=gate.get('resumeCheckpoint',{})
    if not checkpoint or not creation.get('authorization') or not creation.get('resetFrom'):
        raise ValueError('reset requires explicit authorization and checkpoint')
    checkpoint=Path(checkpoint).resolve();source=checkpoint.parent.parent
    if source!=Path(creation['resetFrom']).resolve() or str(checkpoint)!=proof.get('checkpoint'):
        raise ValueError('reset checkpoint must belong to authorized predecessor')
    if hashlib.sha256(checkpoint.read_bytes()).hexdigest()!=proof.get('sha256'):
        raise ValueError('reset checkpoint identity mismatch')
    audit=Path(proof.get('auditPath',''))
    if not audit.is_file() or hashlib.sha256(audit.read_bytes()).hexdigest()!=proof.get('auditSha256'):
        raise ValueError('reset recovery audit missing or changed')
    verified=json.loads(audit.read_text())
    if verified.get('passed') is not True or verified.get('sha256')!=proof['sha256']:
        raise ValueError('reset recovery audit failed')
    meta=json.loads(checkpoint.with_suffix('.json').read_text())
    if meta['manifestSha256'] not in manifest_hashes(source):raise ValueError('reset checkpoint lineage invalid')
    data=inspect_checkpoint(checkpoint,manifest_sha256=meta['manifestSha256'],require_recovery=True)
    if data['updates']<=0 or not data.get('optimizer') or data['updates']!=verified.get('updates'):
        raise ValueError('reset requires matching trained optimizer and cursor')
    return {'checkpoint':str(checkpoint),'sha256':proof['sha256'],'updates':data['updates']}
