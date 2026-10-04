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


def read(path):
    return json.loads(Path(path).read_text())


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


def execute(args, invoke=None):
    directory=args.run_dir.resolve()
    result={'schema':1,'stage':args.stage,'status':'inconclusive','phase':'training','productionPromotion':False}
    common=[sys.executable,'-m','righelt_training.supervisor','--run-dir',str(directory),
            '--activity-file',str(args.activity_file.resolve()),'--gate-report',str(args.gate_report.resolve()),
            '--stage',args.stage,'--seed',str(args.seed)]
    if invoke is None:
        invoke=invoke_supervisor
    revision=read(args.gate_report)['sourceRevision']
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
        invoke(common+flags)
        report=read(directory/'supervisor-result.json')
        if report['reason']!='completed':raise ValueError(f"{name}: {report['reason']}")
        if proof is None or not proof.exists() or not valid(read(proof)):raise ValueError(f'{name}: completion evidence incomplete')
        atomic_json(receipt_path,{'schema':1,'sourceRevision':revision,'proofSha256':hashlib.sha256(proof.read_bytes()).hexdigest()})
    try:
        # Existing allocation requires an explicit checkpoint; supervisor preserves
        # source, stage claim and original deadline, including all stopped time.
        if args.stage=='initial':phase('canary',['--canary','--parity-corpus',str(args.parity_corpus.resolve())],'canary-report.json',lambda p:p.get('passed') is True)
        checkpoint=args.resume
        if checkpoint is None and (directory/'latest.json').exists():checkpoint=Path(read(directory/'latest.json')['checkpoint'])
        phase('training',['--resume',str(checkpoint.resolve())] if checkpoint else [],'runner-result.json',lambda p:p.get('reason')=='validation-handoff')
        latest=Path(read(directory/'latest.json')['checkpoint']).resolve()
        phase('export-parity',['--resume',str(latest),'--export-parity','--parity-corpus',str(args.parity_corpus.resolve())],'trained-export-parity.json',lambda p:p.get('complete') is True and p.get('numericPassed') is True)
        parity=read(directory/'trained-export-parity.json')
        if not parity.get('complete') or not parity.get('numericPassed'):raise ValueError('trained export parity incomplete or failed')
        phase('health',['--resume',str(latest),'--health'],'health-report.json',lambda p:p.get('complete') is True)
        health=read(directory/'health-report.json')
        result['health']=health
        if not health.get('healthy'):raise ValueError('pipeline health gate unmet')
        checkpoints=health['checkpoints'];candidate=checkpoints[0]
        opponent=next((p for p in checkpoints[1:] if p['weightsSha256']!=candidate['weightsSha256']),None)
        if opponent is None:raise ValueError('distinct evaluation checkpoints unavailable')
        pair=['--candidate-checkpoint',candidate['path'],'--opponent-checkpoint',opponent['path']]
        phase('prepare-validation',['--resume',str(latest),'--prepare-arena',*pair],'prepare-arena-result.json',lambda p:p.get('status')=='completed')
        plan=read(directory/'prepare-arena-result.json')
        if plan.get('status')!='completed':raise ValueError('validation workload preparation incomplete')
        phase('validation',['--resume',str(latest),'--arena-plan',plan['plan'],*pair],f"evaluations/{plan['planSha256']}/report.json",lambda p:p.get('mode','strict')=='strict' and p.get('status')=='completed' and p.get('completePairs')==100 and p.get('completedGames')==200 and p.get('identity',{}).get('planSha256')==plan['planSha256'])
        result.update(status='phases-finished',reason='Inspect arena evidence and publish progress before considering the conditional overnight stage.')
    except (ValueError,OSError,KeyError,subprocess.SubprocessError) as error:
        result['reason']=str(error)
    if directory.exists():atomic_json(directory/'stage-result.json',result)
    return result


def main():
    install_stop_handlers()
    parser=argparse.ArgumentParser()
    for name in ('run-dir','activity-file','gate-report','parity-corpus'):
        parser.add_argument('--'+name,type=Path,required=True)
    parser.add_argument('--stage',choices=('initial','overnight'),required=True)
    parser.add_argument('--seed',type=int,required=True);parser.add_argument('--resume',type=Path)
    args=parser.parse_args()
    args.run_dir.parent.mkdir(parents=True,exist_ok=True)
    lock=(args.run_dir.parent/'coordinator.lock').open('a+')
    fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
    result=execute(args);print(json.dumps(result,indent=2))
    if result['status']=='inconclusive':raise SystemExit(1)

if __name__=='__main__':main()
