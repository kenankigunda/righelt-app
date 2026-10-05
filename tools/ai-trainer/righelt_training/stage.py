"""Sequence one approved allocation; every compute phase remains supervised."""
import argparse
import hashlib
import fcntl
import json
from pathlib import Path
import subprocess
import sys
from .checkpoint import atomic_json
from .config import ROOT
from .processes import install_stop_handlers,cleanup_owned
from .allocation import Allocation,contract_hash


class PhaseIncomplete(ValueError):
    def __init__(self,phase,reason):
        super().__init__(f'{phase}: {reason}')
        self.phase=phase;self.reason=reason


def remaining_budget(directory):
    creation,charged,pending=Allocation(Path(directory).parent,directory).accounting()
    if pending:raise ValueError('stage has unsettled supervised computation')
    return max(0,creation['seconds']-charged)


def health_bindings(directory):
    return {name:hashlib.sha256((Path(directory)/name).read_bytes()).hexdigest()
            for name in ('health-report.json','trained-export-parity.json','latest.json')}


def read(path):
    return json.loads(Path(path).read_text())


def development_flags(args):
    path=getattr(args,'development_cases',None)
    return ['--development-cases',str(path.resolve())] if path else []


def development_record(directory,args):
    cases=getattr(args,'development_cases',None)
    if not cases:return None
    path=directory/'development-latest.json'
    if not path.exists():return {'status':'missing','acceptanceDecision':None}
    record=read(path)
    if record.get('casesSha256')!=hashlib.sha256(cases.read_bytes()).hexdigest():
        raise ValueError('development observation uses different frozen cases')
    parity=read(directory/'trained-export-parity.json')
    if any(record.get(k)!=parity.get(k) for k in ('checkpointSha256','sourceRevision')):
        raise ValueError('development observation checkpoint/source mismatch')
    for key in ('proof','report'):
        if hashlib.sha256(Path(record[key]).read_bytes()).hexdigest()!=record[key+'Sha256']:
            raise ValueError('development observation artifact changed')
    proof,report=read(record['proof']),read(record['report'])
    if (type(record.get('complete')) is not bool or proof.get('complete') is not record['complete']
            or report.get('status')!=('complete' if record['complete'] else 'incomplete')):
        raise ValueError('development observation completion mismatch')
    return {**record,'status':'complete' if record['complete'] else 'incomplete','acceptanceDecision':None}


def export_complete(data,directory,args):
    # Missing optional observations never rerun an already proven numeric phase.
    # The separate record still validates retained evidence before reporting it.
    return data.get('complete') is True and data.get('numericPassed') is True


def invoke_supervisor(argv):
    directory=Path(argv[argv.index("--run-dir")+1]) if "--run-dir" in argv else None
    process=subprocess.Popen(argv,cwd=ROOT)
    try:
        code=process.wait()
        if code:raise subprocess.CalledProcessError(code,argv)
    except BaseException:
        if directory is not None:cleanup_owned(directory,owner=process.pid)
        if process.poll() is None:
            process.terminate()
            try:process.wait(timeout=5)
            except subprocess.TimeoutExpired:process.kill();process.wait(timeout=2)
        if directory is not None:cleanup_owned(directory,owner=process.pid)
        raise


def execute_diagnostic(args,invoke=None):
    """Use the existing evaluation allocation; never create a training budget."""
    from .arena import RESTART_WORKLOAD
    directory=args.run_dir.resolve();invoke=invoke or invoke_supervisor
    common=[sys.executable,'-m','righelt_training.supervisor','--run-dir',str(directory),
            '--activity-file',str(args.activity_file.resolve()),'--gate-report',str(args.gate_report.resolve()),
            '--stage','overnight','--seed',str(args.seed),'--resume',str(args.resume.resolve())]
    pair=['--candidate-checkpoint',str(args.resume.resolve()),'--opponent-checkpoint',str(args.opponent_checkpoint.resolve())]
    result={'schema':1,'phase':'diagnostic','status':'inconclusive','diagnosticGatePassed':False,
            'sourceRevision':read(args.gate_report)['sourceRevision'],'productionPromotion':False}
    def phase(name,flags,proof,valid):
        receipt=directory/'phase-receipts'/f'diagnostic-{name}.json'
        if receipt.exists() and proof.exists():
            prior=read(receipt)
            if (prior['sourceRevision']==result['sourceRevision'] and
                prior['proofSha256']==hashlib.sha256(proof.read_bytes()).hexdigest() and valid(read(proof))):return
        invoke(common+flags)
        if read(directory/'supervisor-result.json')['reason']!='completed':raise ValueError(f'diagnostic {name} unfinished')
        if not proof.exists() or not valid(read(proof)):raise ValueError(f'diagnostic {name} incomplete')
        atomic_json(receipt,{'sourceRevision':result['sourceRevision'],'proofSha256':hashlib.sha256(proof.read_bytes()).hexdigest()})
    try:
        phase('export',['--export-parity','--parity-corpus',str(args.parity_corpus.resolve()),*development_flags(args)],directory/'trained-export-parity.json',lambda p:export_complete(p,directory,args))
        result['developmentObservation']=development_record(directory,args)
        parity=read(directory/'trained-export-parity.json')
        if not parity.get('complete') or not parity.get('numericPassed'):raise ValueError('diagnostic export failed')
        phase('prepare',['--prepare-arena','--diagnostic',*pair],directory/'prepare-arena-result.json',lambda p:p.get('status')=='completed' and p.get('preparedPairs')==10)
        preparation=read(directory/'prepare-arena-result.json')
        if preparation.get('status')!='completed' or preparation.get('preparedPairs')!=10:raise ValueError('diagnostic preparation incomplete')
        from .arena import read_frozen_plan
        plan,digest=read_frozen_plan(preparation['plan'])
        if plan.get('workload')!=RESTART_WORKLOAD:raise ValueError('diagnostic workload mismatch')
        report=directory/'evaluations'/digest/'report.json'
        phase('arena',['--arena-plan',preparation['plan'],*pair],report,lambda p:p.get('allAttemptsAccounted') is True and p.get('identity',{}).get('planSha256')==digest)
        result.update(read(report),phase='diagnostic',report=str(report),plan=preparation['plan'])
    except (ValueError,OSError,KeyError,subprocess.SubprocessError) as error:
        result['reason']=str(error)
        if 'report' in locals() and report.exists():
            partial=read(report)
            if partial.get('identity',{}).get('planSha256')==digest:
                result.update(partial,phase='diagnostic',report=str(report),plan=preparation['plan'],
                              diagnosticGatePassed=False,status='inconclusive',reason=str(error))
    atomic_json(directory/'diagnostic-result.json',result)
    return result


def execute(args, invoke=None):
    directory=args.run_dir.resolve()
    result={'schema':1,'stage':args.stage,'status':'inconclusive','phase':'training','productionPromotion':False}
    common=[sys.executable,'-m','righelt_training.supervisor','--run-dir',str(directory),
            '--activity-file',str(args.activity_file.resolve()),'--gate-report',str(args.gate_report.resolve()),
            '--stage',args.stage,'--seed',str(args.seed)]
    continuation=read(args.continuation) if getattr(args,'continuation',None) else None
    if continuation:common+=['--continuation',str(args.continuation.resolve())]
    if invoke is None:
        invoke=invoke_supervisor
    revision=read(args.gate_report)['sourceRevision']
    result['sourceRevision']=revision
    completed=directory/'stage-result.json'
    if continuation and completed.exists():
        prior=read(completed)
        if (prior.get('advancementEligible') is True and prior.get('sourceRevision')==revision
            and prior.get('sequenceId')==continuation['sequenceId'] and prior.get('phase')==continuation['phase']
            and prior.get('continuationSha256')==contract_hash(continuation)
            and prior.get('healthBindings')==health_bindings(directory)):
            # An ended stage is not another request to run its unfinished strength
            # matches. Recovery reuses the proven outcome without spending again.
            remaining_budget(directory)
            if hashlib.sha256(Path(prior['recoveryCheckpoint']).read_bytes()).hexdigest()!=prior['recoverySha256']:
                raise ValueError('completed stage recovery checkpoint changed')
            return prior
    def phase(name,flags,proof_name=None,valid=lambda data:True):
        receipt_path=directory/'phase-receipts'/f'{name}.json'
        proof=directory/proof_name if proof_name else None
        if receipt_path.exists():
            receipt=read(receipt_path)
            compatible=(receipt['sourceRevision']==revision or (name=='training' and read(args.gate_report).get('repair',{}).get('preserveTraining') is True))
            if compatible and proof and proof.exists() and hashlib.sha256(proof.read_bytes()).hexdigest()==receipt['proofSha256'] and valid(read(proof)):
                return

        result['phase']=name
        if directory.exists():atomic_json(directory/'stage-result.json',result)
        optional_strength=bool(continuation and result.get('healthPassed') and name in ('prepare-validation','validation'))
        if optional_strength and remaining_budget(directory)<=0:raise PhaseIncomplete(name,'budget-expired')
        invoke(common+flags)
        report=read(directory/'supervisor-result.json')
        if report['reason']!='completed':raise PhaseIncomplete(name,report['reason'])
        if proof is None or not proof.exists() or not valid(read(proof)):
            raise PhaseIncomplete(name,read(proof).get('reason','completion evidence incomplete') if proof and proof.exists() else 'completion evidence incomplete')
        atomic_json(receipt_path,{'schema':1,'sourceRevision':revision,'proofSha256':hashlib.sha256(proof.read_bytes()).hexdigest()})
    try:
        # Existing allocation requires an explicit checkpoint; supervisor preserves
        # source, stage claim and original deadline, including all stopped time.
        if args.stage=='initial' and not continuation:phase('canary',['--canary','--parity-corpus',str(args.parity_corpus.resolve())],'canary-report.json',lambda p:p.get('passed') is True)
        checkpoint=args.resume
        if (directory/'latest.json').exists():checkpoint=Path(read(directory/'latest.json')['checkpoint'])
        phase('training',['--resume',str(checkpoint.resolve())] if checkpoint else [],'runner-result.json',lambda p:p.get('reason')=='validation-handoff')
        latest=Path(read(directory/'latest.json')['checkpoint']).resolve()
        phase('export-parity',['--resume',str(latest),'--export-parity','--parity-corpus',str(args.parity_corpus.resolve()),*development_flags(args)],'trained-export-parity.json',lambda p:export_complete(p,directory,args))
        result['developmentObservation']=development_record(directory,args)
        parity=read(directory/'trained-export-parity.json')
        if not parity.get('complete') or not parity.get('numericPassed'):raise ValueError('trained export parity incomplete or failed')
        phase('health',['--resume',str(latest),'--health'],'health-report.json',lambda p:p.get('complete') is True)
        health=read(directory/'health-report.json')
        result['health']=health
        if not health.get('healthy'):raise ValueError('pipeline health gate unmet')
        result['healthPassed']=True
        if continuation:result['healthBindings']=health_bindings(directory)
        checkpoints=health['checkpoints'];candidate=checkpoints[0]
        opponent={'path':continuation['recoveryCheckpoint']} if continuation else next((p for p in checkpoints[1:] if p['weightsSha256']!=candidate['weightsSha256']),None)
        if opponent is None:raise ValueError('distinct evaluation checkpoints unavailable')
        pair=['--candidate-checkpoint',candidate['path'],'--opponent-checkpoint',opponent['path']]
        phase('prepare-validation',['--resume',str(latest),'--prepare-arena',*pair],'prepare-arena-result.json',lambda p:p.get('status')=='completed')
        plan=read(directory/'prepare-arena-result.json')
        if plan.get('status')!='completed':raise ValueError('validation workload preparation incomplete')
        phase('validation',['--resume',str(latest),'--arena-plan',plan['plan'],*pair],f"evaluations/{plan['planSha256']}/report.json",lambda p:p.get('mode','strict')=='strict' and p.get('status')=='completed' and p.get('completePairs')==100 and p.get('completedGames')==200 and p.get('identity',{}).get('planSha256')==plan['planSha256'])
        result.update(status='phases-finished',reason='Inspect arena evidence and publish progress before considering the conditional overnight stage.')
        result['advancementEligible']=bool(continuation and result.get('healthPassed'))
    except PhaseIncomplete as error:
        result['reason']=str(error)
        # Expected unfinished strength work does not invalidate proven health.
        # Process failures and unclassified engine/correctness errors still stop.
        allowed={'budget','budget-expired','budget-exhausted-before-phase','resource-stop','resource-pause','node-limit','deadline',
                 'inference-budget','verification-budget','budget-or-resource-stop','opening-attempt-limit',
                 'verification-unfinished','search-recovery'}
        result['advancementEligible']=bool(continuation and result.get('healthPassed') and
            error.phase in ('prepare-validation','validation') and error.reason in allowed)
    except (ValueError,OSError,KeyError,subprocess.SubprocessError) as error:
        result['reason']=str(error)
    if 'plan' in locals():
        arena_report=directory/'evaluations'/plan['planSha256']/'report.json'
        if arena_report.exists():result['strengthEvaluation']=read(arena_report)
    if continuation:
        result.update(sequenceId=continuation['sequenceId'],phase=continuation['phase'],continuationSha256=contract_hash(continuation))
        if (directory/'latest.json').exists():
            latest=read(directory/'latest.json')
            result.update(recoveryCheckpoint=latest['checkpoint'],recoverySha256=latest['sha256'])
    if directory.exists():atomic_json(directory/'stage-result.json',result)
    return result


def main():
    install_stop_handlers()
    parser=argparse.ArgumentParser()
    for name in ('run-dir','activity-file','gate-report','parity-corpus'):
        parser.add_argument('--'+name,type=Path,required=True)
    parser.add_argument('--stage',choices=('initial','overnight'),required=True)
    parser.add_argument('--seed',type=int,required=True);parser.add_argument('--resume',type=Path)
    parser.add_argument('--continuation',type=Path)
    parser.add_argument('--development-cases',type=Path)
    parser.add_argument('--diagnostic',action='store_true');parser.add_argument('--opponent-checkpoint',type=Path)
    args=parser.parse_args()
    args.run_dir.parent.mkdir(parents=True,exist_ok=True)
    lock=(args.run_dir.parent/'coordinator.lock').open('a+')
    fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
    if args.diagnostic and (not args.resume or not args.opponent_checkpoint or args.continuation):parser.error('diagnostic requires both historical checkpoints, without continuation')
    result=execute_diagnostic(args) if args.diagnostic else execute(args)
    print(json.dumps(result,indent=2))
    if result['status']=='inconclusive':raise SystemExit(1)

if __name__=='__main__':main()
