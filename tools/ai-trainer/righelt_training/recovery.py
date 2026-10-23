"""Durable allocation-wide consumption; rollback cannot reissue work identities."""
import fcntl
import json
import re
from pathlib import Path
from .checkpoint import atomic_json
from .allocation import append,rows
import time

class RecoveryLedger:
    def __init__(self,root):self.root=Path(root);self.root.mkdir(parents=True,exist_ok=True)
    def claim(self,kind,key,minimum=0):
        with (self.root/'recovery-ledger.lock').open('a') as lock:
            fcntl.flock(lock,fcntl.LOCK_EX)
            path=self.root/'recovery-ledger.json'
            data=json.loads(path.read_text()) if path.exists() else {'schema':1,'checkpoints':0,'jobs':{}}
            if kind=='checkpoint':
                if not data['checkpoints']:
                    for checkpoint in self.root.rglob('checkpoint-*.pt'):
                        match=re.fullmatch(r'checkpoint-(\d+)\.pt',checkpoint.name)
                        if match:data['checkpoints']=max(data['checkpoints'],int(match[1]))
                value=max(data['checkpoints'],minimum);data['checkpoints']=value+1
            else:
                if key not in data['jobs']:
                    # Bootstrap conservatively from immutable legacy checkpoint cursors.
                    floor=0
                    for companion in self.root.rglob('*.runner.json'):
                        manifest_path=companion.parent.parent/'manifest.json'
                        if not manifest_path.exists():continue
                        manifest=json.loads(manifest_path.read_text())['manifest']
                        if f"{manifest['stage']}:{manifest['seed']}"==key:
                            floor=max(floor,json.loads(companion.read_text())['state']['nextJob'])
                    data['jobs'][key]=floor
                value=max(data['jobs'][key],minimum);data['jobs'][key]=value+1
            atomic_json(path,data)
            return value
    def checkpoint(self,minimum=0):return self.claim('checkpoint','',minimum)
    def job(self,stage,seed,minimum=0):return self.claim('job',f'{stage}:{seed}',minimum)

    def launches(self):return rows(self.root/'generation-launches.jsonl')

    def launched(self,job_id):return any(row['jobId']==job_id for row in self.launches())

    def launch(self,job_id,directory):
        """Consume a pending ID durably before spawn, independently of rollback."""
        with (self.root/'recovery-ledger.lock').open('a') as lock:
            fcntl.flock(lock,fcntl.LOCK_EX)
            if self.launched(job_id):return False
            append(self.root/'generation-launches.jsonl',{'jobId':job_id,
                   'directory':str(Path(directory).resolve()),'claimedAt':time.time()})
            return True
