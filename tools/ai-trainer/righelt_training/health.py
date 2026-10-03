"""Audit experiment health from replay archives and recoverable model weights."""
import argparse
import gzip
import hashlib
import json
from pathlib import Path
import time
import torch
from .checkpoint import atomic_json, load_checkpoint
from .config import ROOT
from .model import PolicyValueNet
from .replay import partition_for_family
from .runner import verify_game


def finite_tree(value):
    if isinstance(value, torch.Tensor):
        return bool(torch.isfinite(value).all())
    if isinstance(value, dict):
        return all(finite_tree(v) for v in value.values())
    if isinstance(value, (list, tuple)):
        return all(finite_tree(v) for v in value)
    if isinstance(value, float):
        return __import__('math').isfinite(value)
    return True


def audit(directory, deadline, *, verifier=verify_game, clock=time.monotonic):
    directory=Path(directory).resolve()
    result={'schema':1,'terminalGames':0,'truncatedGames':0,'replayChecks':0,
            'distinctRecoverableTrainedCheckpoints':0,'finiteNonzeroUpdates':False,
            'unresolvedCorrectnessFailures':0,'complete':False,'progressReportPublished':False,
            'healthy':False,'productionPromotion':False,'failures':[],'checkpoints':[]}
    try:
        latest=json.loads((directory/'latest.json').read_text())
        path=Path(latest['checkpoint']).resolve()
        if not path.is_relative_to(directory):raise ValueError('checkpoint outside run')
        companion=json.loads(path.with_suffix('.runner.json').read_text())
        if companion['checkpointSha256']!=latest['sha256'] or hashlib.sha256(path.read_bytes()).hexdigest()!=latest['sha256']:
            raise ValueError('latest checkpoint identity mismatch')
        state=companion['state'];seen=set()
        if state['updates']!=latest['updates']:raise ValueError('latest update count mismatch')
        manifest=json.loads((directory/'manifest.json').read_text())['sha256']
        for name in state['archives']:
            if clock()>=deadline-5:raise TimeoutError('health replay audit unfinished within stage budget')
            archive=(directory/name).resolve()
            if not archive.is_relative_to(directory.parent):raise ValueError('archive outside experiment allocation')
            with gzip.open(archive,'rt') as stream:game=json.load(stream)
            if game['id'] in seen:raise ValueError('duplicate archived game')
            seen.add(game['id'])
            if game['partition']!='train' or partition_for_family(game['familyId'])!='train':raise ValueError('training split violation')
            verifier(game,min(deadline,clock()+20))
            if game['termination']=='terminal' and game['outcome']['status'] in ('p1_win','p2_win','draw'):
                result['terminalGames']+=1
            elif game['termination']=='truncated' and game['outcome']['status']=='ongoing':result['truncatedGames']+=1
            else:raise ValueError('invalid terminal/truncation record')
            result['replayChecks']+=1
        weights=set()
        for checkpoint in [path]+[p for p in sorted((directory/'checkpoints').glob('*.pt'),reverse=True) if p!=path]:
            if clock()>=deadline-2:raise TimeoutError('checkpoint recovery audit unfinished within stage budget')
            meta=json.loads(checkpoint.with_suffix('.json').read_text())
            model=PolicyValueNet();optimizer=torch.optim.AdamW(model.parameters())
            data=load_checkpoint(checkpoint,model,optimizer,manifest_sha256=manifest)
            if data['updates']!=meta['updates'] or not finite_tree(data['model']) or not finite_tree(data['optimizer']):
                raise ValueError('invalid checkpoint parameters or optimizer state')
            if data['updates']<=0:continue
            optimizer_steps=[float(entry.get('step',0)) for entry in data['optimizer']['state'].values()]
            if not optimizer_steps or max(optimizer_steps)!=data['updates']:raise ValueError('optimizer update count mismatch')
            digest=hashlib.sha256()
            for name,tensor in sorted(model.state_dict().items()):
                digest.update(name.encode());digest.update(tensor.detach().cpu().contiguous().numpy().tobytes())
            weights.add(digest.hexdigest())
            result['checkpoints'].append({'path':str(checkpoint),'sha256':meta['sha256'],
                'weightsSha256':digest.hexdigest(),'updates':data['updates']})
            if len(weights)>=2:break
        result['distinctRecoverableTrainedCheckpoints']=len(weights)
        result['finiteNonzeroUpdates']=bool(weights) and state['updates']>0 and state['nonzeroUpdates']==state['updates']
        supervisor=directory/'supervisor-result.json'
        if supervisor.exists() and json.loads(supervisor.read_text())['reason'] in ('runner-failed','telemetry-failed'):
            raise ValueError('unresolved supervisor failure')
        result['complete']=True
        result['healthy']=result['terminalGames']>=100 and len(weights)>=2 and result['finiteNonzeroUpdates']
    except TimeoutError as error:
        result['failures'].append(str(error))
    except (ValueError,KeyError,OSError,RuntimeError) as error:
        result['unresolvedCorrectnessFailures']+=1
        result['failures'].append(str(error))
    return result


def main():
    parser=argparse.ArgumentParser();parser.add_argument('--run-dir',type=Path,required=True);args=parser.parse_args()
    directory=args.run_dir.resolve()
    if not directory.is_relative_to((ROOT/'.ai-runs').resolve()):raise ValueError('expected supervised experiment directory')
    runtime=json.loads((directory/'runtime.json').read_text())
    import psutil
    if runtime['bootTime']!=psutil.boot_time():raise ValueError('cannot reuse deadline after reboot')
    torch.set_num_threads(1)
    result=audit(directory,runtime['deadlineMonotonic'])
    atomic_json(directory/'health-report.json',result);print(json.dumps(result,indent=2))

if __name__=='__main__':main()
