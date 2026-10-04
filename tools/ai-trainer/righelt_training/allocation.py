"""Append-only supervised-time accounting; stopped repair time is not charged."""
import json
import os
from pathlib import Path
import time
import uuid
import hashlib
import psutil
from .config import CONFIG


def append(path,row):
    path=Path(path);path.parent.mkdir(parents=True,exist_ok=True)
    with path.open('a') as stream:
        stream.write(json.dumps(row,sort_keys=True,allow_nan=False)+'\n');stream.flush();os.fsync(stream.fileno())


def rows(path):
    return [json.loads(line) for line in Path(path).read_text().splitlines()] if Path(path).exists() else []


def identity(pid):
    process=psutil.Process(pid)
    return {'pid':pid,'created':process.create_time()}


def alive(record):
    try:return psutil.Process(record['pid']).create_time()==record['created']
    except psutil.NoSuchProcess:return False


CONTINUATION_LIMITS={'six-hour':(21600,3600),'twelve-hour':(43200,7200)}


def contract_hash(contract):
    return hashlib.sha256(json.dumps(contract,sort_keys=True,allow_nan=False).encode()).hexdigest()


def validate_contract(contract,root):
    """Fixed conditional authorization, distinct from the recovery lineage."""
    if (not isinstance(contract,dict) or contract.get('phase') not in CONTINUATION_LIMITS
        or not isinstance(contract.get('sequenceId'),str) or not contract['sequenceId']
        or contract.get('preserveState') is not True or contract.get('freshHealth') is not True):
        raise ValueError('invalid continuation contract')
    if (contract.get('budgetSeconds'),contract.get('reserveSeconds'))!=CONTINUATION_LIMITS[contract['phase']]:
        raise ValueError('continuation exceeds approved budget or changes reserve')
    for name in ('recoveryCheckpoint','predecessorEvidence'):
        path=Path(contract[name]).resolve()
        if not path.is_relative_to(Path(root).resolve()):raise ValueError('continuation evidence outside archive')
        digest=hashlib.sha256(path.read_bytes()).hexdigest()
        key='recoverySha256' if name=='recoveryCheckpoint' else 'predecessorEvidenceSha256'
        if digest!=contract.get(key):raise ValueError('continuation evidence changed')
    evidence=json.loads(Path(contract['predecessorEvidence']).read_text())
    if contract['phase']=='six-hour':
        if (evidence.get('diagnosticGatePassed') is not True or evidence.get('allAttemptsAccounted') is not True
            or evidence.get('terminalGames',0)<16 or evidence.get('scheduledGames')!=20
            or evidence.get('workload')!='restart-diagnostic-20-v1'):
            raise ValueError('diagnostic predecessor gate unmet')
    elif (evidence.get('advancementEligible') is not True or evidence.get('phase')!='six-hour'
          or evidence.get('sequenceId')!=contract['sequenceId'] or evidence.get('health',{}).get('healthy') is not True
          or evidence.get('recoveryCheckpoint')!=contract['recoveryCheckpoint']
          or evidence.get('recoverySha256')!=contract['recoverySha256']):
        raise ValueError('fresh six-hour health predecessor gate unmet')
    return contract


def validate_continuation(directory,manifest):
    directory=Path(directory).resolve()
    creation=Allocation(directory.parent,directory).accounting()[0]
    contract=manifest.get('continuation')
    if contract is None:
        if creation.get('continuation'):raise ValueError('continuation manifest missing')
        return None
    validate_contract(contract,directory.parent)
    if (creation.get('continuation')!=contract or creation.get('contractSha256')!=contract_hash(contract)
        or creation['seconds']!=contract['budgetSeconds'] or manifest.get('seconds')!=contract['budgetSeconds']):
        raise ValueError('manifest continuation differs from authorized allocation')
    return contract


class Allocation:
    # Caller holds the archive's supervisor.lock throughout mutations and compute.
    def __init__(self,root,directory):
        self.root=Path(root).resolve();self.directory=Path(directory).resolve()
        if not self.directory.is_relative_to(self.root):raise ValueError('allocation outside archive')
        self.path=self.root/'allocation-events.jsonl'
        self.key=str(self.directory)

    def events(self):return [r for r in rows(self.path) if r['allocation']==self.key]

    def create_continuation(self,contract):
        validate_contract(contract,self.root)
        existing=self.events()
        if existing:
            if existing[0].get('continuation')!=contract:raise ValueError('allocation contract already frozen')
            return existing[0]
        for row in rows(self.path):
            prior=row.get('continuation',{})
            if (row['event']=='created' and prior.get('sequenceId')==contract['sequenceId']
                and prior.get('phase')==contract['phase']):
                raise ValueError('sequence phase allocation already claimed')
        record={'event':'created','allocation':self.key,'stage':'initial' if contract['phase']=='six-hour' else 'overnight',
                'seconds':contract['budgetSeconds'],'id':uuid.uuid4().hex,'observedAt':time.time(),
                'continuation':contract,'contractSha256':contract_hash(contract),
                'authorization':'T-107 approved conditional sequence 2026-10-04'}
        append(self.path,record)
        return record

    def create(self,stage,*,reset_from=None,reason=None):
        existing=self.events()
        if existing:return existing[0]
        others=[r for r in rows(self.path) if r['event']=='created' and r['stage']==stage]
        legacy=self.root/'budget-ledger.json'
        old=json.loads(legacy.read_text()).get('stages',{}).get(stage) if legacy.exists() else None
        old=str(Path(old).resolve()) if old else None
        if (others or old) and reset_from is None:raise ValueError('stage allocation exists; explicit authorized reset required')
        if reset_from is not None:
            prior=Path(reset_from).resolve()
            if not reason or (str(prior)!=old and str(prior) not in [r['allocation'] for r in others]):
                raise ValueError('reset must identify previous allocation and authorization')
            runtime=prior/'runtime.json'
            if runtime.exists():
                record=json.loads(runtime.read_text())
                pid=record.get('supervisorPid')
                if pid and psutil.pid_exists(pid):raise ValueError('prior supervisor must be stopped before reset')
        record={'event':'created','allocation':self.key,'stage':stage,'seconds':CONFIG['resources']['initialSeconds' if stage=='initial' else 'overnightSeconds'],
                'id':uuid.uuid4().hex,'observedAt':time.time(),'resetFrom':str(Path(reset_from).resolve()) if reset_from else None,'authorization':reason}
        append(self.path,record);return record

    def accounting(self):
        events=self.events()
        if not events or events[0]['event']!='created':raise ValueError('allocation not authorized')
        starts={};ends={}
        for row in events[1:]:
            if row['event']=='started':
                if row['id'] in starts:raise ValueError('duplicate accounting interval')
                starts[row['id']]=row
            elif row['event']=='finished':
                if row['id'] in ends or row['id'] not in starts:raise ValueError('invalid accounting completion')
                ends[row['id']]=row
        charged=sum(r['chargedSeconds'] for r in ends.values())
        return events[0],charged,[r for key,r in starts.items() if key not in ends]

    def recover_abandoned(self,cleanup):
        _,_,pending=self.accounting()
        for row in pending:
            if alive(row['owner']):raise ValueError('allocation supervisor is still alive')
            cleanup(self.directory)  # verify all registered compute is gone first
            self.finish(row['id'],reason='interrupted-recovered')

    def begin(self,phase):
        creation,charged,pending=self.accounting()
        if pending:raise ValueError('unsettled accounting interval')
        remaining=max(0,creation['seconds']-charged)
        if remaining<=0:raise ValueError('approved supervised budget exhausted')
        row={'event':'started','allocation':self.key,'id':uuid.uuid4().hex,'phase':phase,
             'wall':time.time(),'monotonic':time.monotonic(),'boot':psutil.boot_time(),'owner':identity(os.getpid())}
        append(self.path,row)
        return row,remaining,charged

    def finish(self,attempt,*,reason):
        _,_,pending=self.accounting()
        row=next((r for r in pending if r['id']==attempt),None)
        if row is None:return
        elapsed=max(0,time.time()-row['wall'])
        if row['boot']==psutil.boot_time():elapsed=max(elapsed,time.monotonic()-row['monotonic'])
        append(self.path,{'event':'finished','allocation':self.key,'id':attempt,'chargedSeconds':elapsed,'reason':reason,'observedAt':time.time()})


def main():
    import argparse,fcntl
    parser=argparse.ArgumentParser()
    parser.add_argument('command',choices=('reset','status'))
    parser.add_argument('--archive',type=Path,required=True)
    parser.add_argument('--target',type=Path,required=True)
    parser.add_argument('--previous',type=Path)
    parser.add_argument('--authorization')
    parser.add_argument('--stage',choices=('initial','overnight'),default='initial')
    args=parser.parse_args();args.archive.mkdir(parents=True,exist_ok=True)
    with (args.archive/'supervisor.lock').open('a+') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        allocation=Allocation(args.archive,args.target)
        if args.command=='reset':
            if not args.previous or not args.authorization:parser.error('reset needs previous allocation and explicit authorization')
            print(json.dumps(allocation.create(args.stage,reset_from=args.previous,reason=args.authorization)))
        else:
            created,charged,pending=allocation.accounting()
            print(json.dumps({'limitSeconds':created['seconds'],'chargedSeconds':charged,'openIntervals':pending}))

if __name__=='__main__':main()
