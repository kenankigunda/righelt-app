"""Durable round-wide corpus admission, published before model construction."""
import json
import os
from pathlib import Path
import tempfile
import time


def record_path(contract):
    return Path(contract['statePath']).resolve().parent/'private/followup-production-data-start-v1.json'


def read_start(contract,binding):
    path=record_path(contract)
    if not path.exists():return None
    record=json.loads(path.read_text())
    if (record.get('schema')!=1 or record.get('kind')!='round-data-admission-v1'
            or record.get('executionStartedAt')!=contract['executionStartedAt']
            or record.get('deadline')!=contract['deadline']or record.get('dataBinding')!=binding):
        raise ValueError('Round-wide admitted data identity changed')
    return record


def admit(contract,binding,manifest_sha,source_revision,*,clock=time.time,state_confirmed_at=None):
    existing=read_start(contract,binding)
    if existing:return existing
    path=record_path(contract);path.parent.mkdir(parents=True,exist_ok=True)
    record={'schema':1,'kind':'round-data-admission-v1','executionStartedAt':contract['executionStartedAt'],
            'deadline':contract['deadline'],'dataBinding':binding,'candidateAdmissionAt':clock(),
            'stateConfirmedAt':state_confirmed_at,'firstManifestSha256':manifest_sha,'firstSourceRevision':source_revision,
            'boundary':'Immediately before first candidate model construction; not a successful-gradient claim'}
    # Hard-link publishes a fully written, synced inode atomically and refuses
    # replacement. A controller crash can never unlock or replace this record.
    descriptor,name=tempfile.mkstemp(prefix='.round-data-',dir=path.parent)
    try:
        with os.fdopen(descriptor,'w')as stream:
            json.dump(record,stream,sort_keys=True,allow_nan=False);stream.flush();os.fsync(stream.fileno())
        try:os.link(name,path)
        except FileExistsError:return read_start(contract,binding)
        parent=os.open(path.parent,os.O_RDONLY)
        try:os.fsync(parent)
        finally:os.close(parent)
    finally:Path(name).unlink(missing_ok=True)
    return record
