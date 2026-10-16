"""A resolved failure remains in history with review and recovery evidence."""
import hashlib
from pathlib import Path
from .allocation import rows,append


def validate_resolution(record,journal):
    starts={r['id']:r for r in journal if r['event']=='started'}
    ends={r['id']:r for r in journal if r['event']=='finished'}
    failed=starts.get(record['failedAttempt']);recovery=starts.get(record['recoveryAttempt'])
    end=ends.get(record['recoveryAttempt'])
    if not failed or not recovery or not end or end['reason']!='completed' or recovery['phase']!=failed['phase'] or recovery['observedAt']<=failed['observedAt']:
        raise ValueError('failure resolution lacks successful later recovery')
    if not all(record.get(k) for k in ('cause','fixRevision','artifactDisposition','reviewEvidence','regressionEvidence')):
        raise ValueError('failure resolution incomplete')
    for item in [*record['reviewEvidence'],*record['regressionEvidence']]:
        if hashlib.sha256(Path(item['path']).read_bytes()).hexdigest()!=item['sha256']:raise ValueError('repair evidence changed')


def resolved_failures(directory):
    directory=Path(directory);journal=rows(directory/'supervisor-attempts.jsonl');resolved=set()
    for record in rows(directory/'failure-resolutions.jsonl'):
        validate_resolution(record,journal)
        if record['failedAttempt'] in resolved:raise ValueError('duplicate failure resolution')
        resolved.add(record['failedAttempt'])
    return resolved


def record_resolution(directory,record):
    directory=Path(directory)
    if record['failedAttempt'] in resolved_failures(directory):raise ValueError('failure already resolved')
    validate_resolution(record,rows(directory/'supervisor-attempts.jsonl'))
    append(directory/'failure-resolutions.jsonl',record)
