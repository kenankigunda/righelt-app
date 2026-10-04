"""Durable conditional progression and mail outbox; no implicit compute launch.

The coordinator claims a single next action, invokes the existing supervised
phase runner, then records its evidence. Connector mail delivery stays outside
this process; an uncertain acceptance must be reconciled before another send.
All mutations hold the archive coordinator lock (CLI owns it).
"""
import argparse
import hashlib
import json
from pathlib import Path
import time
from .allocation import Allocation,append,rows,CONTINUATION_LIMITS
from .checkpoint import atomic_json
from .activity import observation

PREREQUISITE='01a10362-d1f0-7790-8163-088cad20761e'
PHASES=('diagnostic','six-hour','twelve-hour')


def digest(path):return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def read(path):return json.loads(Path(path).read_text())


def immutable(path,data):
    path=Path(path);path.parent.mkdir(parents=True,exist_ok=True)
    if path.exists():
        if read(path)!=data:raise ValueError('immutable sequence evidence changed')
        return
    # Publish atomically without replacing a concurrently published identity.
    import os,tempfile
    fd,temp=tempfile.mkstemp(dir=path.parent)
    try:
        with os.fdopen(fd,'w') as stream:
            json.dump(data,stream,sort_keys=True,allow_nan=False);stream.flush();os.fsync(stream.fileno())
        try:os.link(temp,path)
        except FileExistsError:
            if read(path)!=data:raise ValueError('immutable sequence evidence changed')
    finally:Path(temp).unlink()


def launch_ready(receipt,envelope,*,now=None):
    now=time.time() if now is None else now
    if (receipt.get('threadId')!=PREREQUISITE or receipt.get('completed') is not True
        or not receipt.get('evidence') or not receipt.get('alertId')):
        raise ValueError('required task completion receipt missing')
    live=observation(envelope,now)
    if live['developmentActive']:raise ValueError('project work active or observations unavailable')
    return live


class Sequence:
    def __init__(self,directory):
        self.directory=Path(directory).resolve();self.path=self.directory/'sequence.json'
        self.config=read(self.path)
        self.root=self.directory.parent
        if not self.config.get('sequenceId'):raise ValueError('sequence identity required')
        for name in ('diagnosticDirectory','sixHourDirectory','twelveHourDirectory','recoveryCheckpoint','opponentCheckpoint'):
            if not Path(self.config[name]).resolve().is_relative_to(self.root):raise ValueError('sequence path outside archive')
        if digest(self.config['recoveryCheckpoint'])!=self.config['recoverySha256']:raise ValueError('starting checkpoint changed')
        if digest(self.config['opponentCheckpoint'])!=self.config['opponentSha256']:raise ValueError('diagnostic opponent changed')

    def report_path(self,phase):return self.directory/'reports'/f'{phase}.json'

    def next_phase(self):
        for phase in PHASES:
            path=self.report_path(phase)
            if not path.exists():return phase
            self.ensure_mail_intent(phase)
            report=read(path)
            if not report.get('advancementEligible'):return None
        return None

    def claim(self,receipt,envelope):
        phase=self.next_phase()
        if phase is None:return {'action':'finished-or-gate-unmet'}
        completion=self.directory/'completion-receipt.json'
        if not (self.directory/'claims'/'diagnostic.json').exists():launch_ready(receipt,envelope)
        else:
            # Newly active work is protected by the live adaptive resource policy;
            # it does not revoke an already-started conditional sequence.
            observation(envelope)
            if not completion.exists():raise ValueError('sequence launch receipt missing')
        if not completion.exists():immutable(completion,receipt)
        directory=Path(self.config[{'diagnostic':'diagnosticDirectory','six-hour':'sixHourDirectory','twelve-hour':'twelveHourDirectory'}[phase]])
        allocation=Allocation(self.root,directory)
        if phase=='diagnostic':
            creation,charged,pending=allocation.accounting()
            if creation['id']!=self.config['diagnosticAllocationId'] or creation['seconds']!=7200:
                raise ValueError('diagnostic must reuse original evaluation allowance')
            if pending:raise ValueError('recover unsettled accounting before claim')
            if charged>=creation['seconds']:raise ValueError('diagnostic budget exhausted')
            contract=None
        else:
            prior=self.report_path('diagnostic' if phase=='six-hour' else 'six-hour')
            report=read(prior)
            checkpoint=self.config['recoveryCheckpoint'] if phase=='six-hour' else report['recoveryCheckpoint']
            sha=self.config['recoverySha256'] if phase=='six-hour' else report['recoverySha256']
            evidence=Path(report['evidence']) if phase=='six-hour' else prior
            if phase=='six-hour' and digest(evidence)!=report['evidenceSha256']:raise ValueError('diagnostic proof changed')
            seconds,reserve=CONTINUATION_LIMITS[phase]
            contract={'sequenceId':self.config['sequenceId'],'phase':phase,'budgetSeconds':seconds,'reserveSeconds':reserve,
                'preserveState':True,'freshHealth':True,'recoveryCheckpoint':checkpoint,'recoverySha256':sha,
                'predecessorEvidence':str(evidence),'predecessorEvidenceSha256':digest(evidence)}
            # Coordinator serializes progression; acquire the same allocation lock
            # used by supervisors to prevent claims racing live compute.
            import fcntl
            with (self.root/'supervisor.lock').open('a+') as lock:
                fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
                allocation.create_continuation(contract)
            immutable(self.directory/'contracts'/f'{phase}.json',contract)
        action={'action':'run','phase':phase,'runDirectory':str(directory),'contract':str(self.directory/'contracts'/f'{phase}.json') if contract else None}
        immutable(self.directory/'claims'/f'{phase}.json',action)
        return action

    def complete(self,phase,evidence):
        if phase not in PHASES or not (self.directory/'claims'/f'{phase}.json').exists():raise ValueError('stage was not claimed')
        if self.next_phase()!=phase and not self.report_path(phase).exists():raise ValueError('stage out of order')
        claim=read(self.directory/'claims'/f'{phase}.json')
        if not Path(evidence).resolve().is_relative_to(Path(claim['runDirectory']).resolve()):
            raise ValueError('stage evidence belongs to another allocation')
        creation,charged,pending=Allocation(self.root,claim['runDirectory']).accounting()
        if pending:raise ValueError('stage compute is not confirmed stopped/accounted')
        proof=read(evidence)
        if phase=='diagnostic':
            passed=(proof.get('diagnosticGatePassed') is True and proof.get('allAttemptsAccounted') is True
                and proof.get('scheduledGames')==20 and proof.get('terminalGames',0)>=16
                and proof.get('workload')=='restart-diagnostic-20-v1')
        else:
            passed=(proof.get('advancementEligible') is True and proof.get('health',{}).get('healthy') is True
                and proof.get('health',{}).get('freshHealthRequired') is True
                and proof.get('sequenceId')==self.config['sequenceId'] and proof.get('phase')==phase)
        report={**proof,'sequenceId':self.config['sequenceId'],'phase':phase,
                'evidence':str(Path(evidence).resolve()),'evidenceSha256':digest(evidence),'advancementEligible':passed,
                'allocationId':creation['id'],'budgetSeconds':creation['seconds'],'chargedSeconds':charged}
        immutable(self.report_path(phase),report)
        self.ensure_mail_intent(phase)
        return report

    def ensure_mail_intent(self,phase):
        # Recovery closes the crash window between immutable report publication
        # and outbox publication before progression exposes the next stage.
        notification_id=hashlib.sha256(f"{self.config['sequenceId']}:{phase}".encode()).hexdigest()
        intent={'id':notification_id,'phase':phase,'report':str(self.report_path(phase)),
                'reportSha256':digest(self.report_path(phase)),
                'subject':f'Righelt T-107: {phase} results [{notification_id[:16]}]'}
        immutable(self.directory/'mail'/f'{phase}.json',intent)

    def mail(self,phase,action,receipt=None):
        intent=read(self.directory/'mail'/f'{phase}.json')
        if digest(intent['report'])!=intent['reportSha256']:raise ValueError('stage report changed')
        journal=self.directory/'mail'/f'{phase}-delivery.jsonl';events=rows(journal)
        last=events[-1]['event'] if events else 'pending'
        if action=='status':return {**intent,'status':last}
        if action=='claim':
            if last not in ('pending','confirmed-not-sent'):raise ValueError('reconcile uncertain send before retry')
            append(journal,{'event':'sending','id':intent['id'],'observedAt':time.time()})
        elif action=='sent':
            if last not in ('sending','uncertain'):raise ValueError('no pending send')
            if not receipt or not receipt.get('messageId') or receipt.get('notificationId')!=intent['id']:
                raise ValueError('connector confirmation required')
            append(journal,{'event':'sent','receipt':receipt,'observedAt':time.time()})
        elif action=='uncertain':
            if last!='sending':raise ValueError('no sending attempt')
            append(journal,{'event':'uncertain','observedAt':time.time()})
        elif action=='confirmed-not-sent':
            if last not in ('sending','uncertain') or not receipt or receipt.get('notificationId')!=intent['id'] or receipt.get('searchedSentMail') is not True or receipt.get('matches')!=0:
                raise ValueError('sent-mail reconciliation required')
            append(journal,{'event':'confirmed-not-sent','receipt':receipt,'observedAt':time.time()})
        else:raise ValueError('unknown mail action')
        return {**intent,'status':rows(journal)[-1]['event']}


def main():
    import fcntl
    parser=argparse.ArgumentParser();parser.add_argument('--directory',type=Path,required=True)
    sub=parser.add_subparsers(dest='command',required=True)
    claim=sub.add_parser('claim');claim.add_argument('--completion',type=Path,required=True);claim.add_argument('--snapshot',type=Path,required=True)
    done=sub.add_parser('complete');done.add_argument('--phase',choices=PHASES,required=True);done.add_argument('--evidence',type=Path,required=True)
    mail=sub.add_parser('mail');mail.add_argument('--phase',choices=PHASES,required=True);mail.add_argument('--action',choices=('status','claim','sent','uncertain','confirmed-not-sent'),default='status');mail.add_argument('--receipt',type=Path)
    sub.add_parser('status');args=parser.parse_args()
    lock_path=args.directory/'mail.lock' if args.command=='mail' else args.directory.parent/'coordinator.lock'
    with lock_path.open('a+') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        sequence=Sequence(args.directory)
        if args.command=='claim':result=sequence.claim(read(args.completion),read(args.snapshot))
        elif args.command=='complete':result=sequence.complete(args.phase,args.evidence)
        elif args.command=='mail':result=sequence.mail(args.phase,args.action,read(args.receipt) if args.receipt else None)
        else:result={'nextPhase':sequence.next_phase()}
        print(json.dumps(result,indent=2))

if __name__=='__main__':main()
