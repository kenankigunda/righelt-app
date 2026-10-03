"""Sequence one approved allocation; every compute phase remains supervised."""
import argparse
import json
from pathlib import Path
import subprocess
import sys
from .checkpoint import atomic_json
from .config import ROOT


def read(path):
    return json.loads(Path(path).read_text())


def execute(args, invoke=None):
    directory=args.run_dir.resolve()
    result={'schema':1,'stage':args.stage,'status':'inconclusive','phase':'training','productionPromotion':False}
    common=[sys.executable,'-m','righelt_training.supervisor','--run-dir',str(directory),
            '--activity-file',str(args.activity_file.resolve()),'--gate-report',str(args.gate_report.resolve()),
            '--stage',args.stage,'--seed',str(args.seed)]
    if invoke is None:
        invoke=lambda argv:subprocess.run(argv,cwd=ROOT,check=True)
    def phase(name,flags):
        result['phase']=name
        if directory.exists():atomic_json(directory/'stage-result.json',result)
        invoke(common+flags)
        report=read(directory/'supervisor-result.json')
        if report['reason']!='completed':raise ValueError(f"{name}: {report['reason']}")
    try:
        # Existing allocation requires an explicit checkpoint; supervisor preserves
        # source, stage claim and original deadline, including all stopped time.
        phase('training',['--resume',str(args.resume.resolve())] if args.resume else [])
        latest=Path(read(directory/'latest.json')['checkpoint']).resolve()
        phase('export-parity',['--resume',str(latest),'--export-parity','--parity-corpus',str(args.parity_corpus.resolve())])
        parity=read(directory/'trained-export-parity.json')
        if not parity.get('complete') or not parity.get('numericPassed'):raise ValueError('trained export parity incomplete or failed')
        phase('health',['--resume',str(latest),'--health'])
        health=read(directory/'health-report.json')
        result['health']=health
        if not health.get('healthy'):raise ValueError('pipeline health gate unmet')
        checkpoints=health['checkpoints'];candidate=checkpoints[0]
        opponent=next((p for p in checkpoints[1:] if p['weightsSha256']!=candidate['weightsSha256']),None)
        if opponent is None:raise ValueError('distinct evaluation checkpoints unavailable')
        pair=['--candidate-checkpoint',candidate['path'],'--opponent-checkpoint',opponent['path']]
        phase('prepare-validation',['--resume',str(latest),'--prepare-arena',*pair])
        plan=read(directory/'prepare-arena-result.json')
        if plan.get('status')!='completed':raise ValueError('validation workload preparation incomplete')
        phase('validation',['--resume',str(latest),'--arena-plan',plan['plan'],*pair])
        result.update(status='phases-finished',reason='Inspect arena evidence and publish progress before considering the conditional overnight stage.')
    except (ValueError,OSError,KeyError,subprocess.SubprocessError) as error:
        result['reason']=str(error)
    if directory.exists():atomic_json(directory/'stage-result.json',result)
    return result


def main():
    parser=argparse.ArgumentParser()
    for name in ('run-dir','activity-file','gate-report','parity-corpus'):
        parser.add_argument('--'+name,type=Path,required=True)
    parser.add_argument('--stage',choices=('initial','overnight'),required=True)
    parser.add_argument('--seed',type=int,required=True);parser.add_argument('--resume',type=Path)
    args=parser.parse_args();result=execute(args);print(json.dumps(result,indent=2))
    if result['status']=='inconclusive':raise SystemExit(1)

if __name__=='__main__':main()
