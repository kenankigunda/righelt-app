"""Local, checkpointed tactical practice with a shared pilot and an untouched washout."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import time
from functools import lru_cache

from .config import CONFIG, ROOT
from .portable import file_sha256, read_bound, resolve_reference


def read(path):
    return json.loads(Path(path).read_bytes())


def binding(path):
    path = Path(path).resolve()
    return {'path':str(path), 'sha256':file_sha256(path)}


def fixed(path, value):
    from .fresh_health import immutable_json
    path = Path(path)
    if not path.exists():
        immutable_json(path, value)
    if read(path) != value:
        raise ValueError('frozen campaign record differs: '+str(path))
    return value


def configure(inputs):
    closure = inputs['portableClosure']
    os.environ.update(RIGHELT_TRAINING_DEVICE='mps', RIGHELT_COMPACT_RECOVERY='1',
        RIGHELT_EXPLORATORY_LOCAL='1', RIGHELT_RESOURCE_POLICY='dedicated-local-24g-v1',
        RIGHELT_PORTABLE_ROOT=str(ROOT), RIGHELT_PORTABLE_CLOSURE_PATH=str(ROOT/closure['path']),
        RIGHELT_PORTABLE_CLOSURE_SHA256=closure['sha256'])
    if os.environ.get('RIGHELT_HOSTED') == '1':
        raise ValueError('dedicated local campaign required')


def continuation(directory, manifest):
    from .fresh_health import allocation_record
    practice = manifest['tacticalPractice']
    event = allocation_record(directory)
    authority = json.loads(read_bound(practice['authority']))
    if (event.get('practice') != practice or manifest['seconds'] != event['seconds'] or
            event['seconds'] != authority['trainingSeconds'] or
            practice['checkpoint']['sha256'] not in authority['parent'].values() or
            authority['cloud'] is not False):
        raise ValueError('tactical practice allocation differs from authority')
    return {'kind':'local-tactical-practice', 'freshHealth':True, 'policyOnlyFresh':False,
            'preserveState':True, 'recoveryCheckpoint':str(resolve_reference(practice['checkpoint']['path'])),
            'recoverySha256':practice['checkpoint']['sha256']}


def prepare(directory, inputs_path, evaluator, development):
    from .execution_recipe import record, digest
    from .manifest import build_manifest, write_manifest
    from .allocation import Allocation, append
    from .fresh_health import immutable_json
    from .checkpoint import atomic_json
    inputs = read(inputs_path)
    directory = Path(directory).resolve()
    control = Path(inputs_path).resolve().parent
    directory.mkdir(parents=True, exist_ok=True)
    authority = json.loads(read_bound(inputs['authority']))
    qualification = read(ROOT/'.ai-runs/qualification/recovery-qualified.json')
    if qualification.get('qualified') is not True or qualification['sourceCheckpoint'] != inputs['checkpoint']:
        raise ValueError('exact parent recovery qualification missing')
    settings = {**inputs, 'packet':binding(control/'packet.json'), 'isolation':binding(control/'isolation.json'),
                'finalPanelInventory':binding(control/'sealed-inventory.json'),'science':binding(control/'science.json'),
                'lineages':binding(control/'parent-lineages.json'), 'firstJobIndex':1397,
                'development':binding(development), 'evaluator':binding(evaluator),
                'qualification':binding(ROOT/'.ai-runs/qualification/recovery-qualified.json')}
    for key in ('packet','isolation','lineages','trainingRecipe','method'):
        read_bound(settings[key])
    data_sha = digest(settings)
    recipe_path = directory/'execution-recipe.json'
    if not recipe_path.exists():
        recipe = record(inputs['checkpoint']['path'], data_sha, mode='attention-tactical-practice',
                        training_recipe=json.loads(read_bound(inputs['trainingRecipe'])),
                        attention_method=json.loads(read_bound(inputs['method'])))
        immutable_json(recipe_path, recipe)
    if read(recipe_path)['dataSha256'] != data_sha:
        raise ValueError('practice input binding changed')
    program = {**settings, 'executionRecipe':binding(recipe_path)}
    fixed(directory/'program.json', program)
    seed = 2026112501
    manifest_path = directory/'manifest.json'
    if not manifest_path.exists():
        native = build_manifest(seed,'initial',training_recipe=json.loads(read_bound(inputs['trainingRecipe'])))
        native.update(seconds=authority['trainingSeconds'], modelArchitecture=json.loads(read_bound(inputs['method']))['architecture'],
                      warmStart=inputs['checkpoint'], evaluationGuards=inputs['guards'],
                      tacticalPractice=program, witnessBlockSize=256, jobPrefix=authority['campaign'])
        write_manifest(manifest_path,native)
    stored = read(manifest_path)
    if stored['manifest']['tacticalPractice'] != program:
        raise ValueError('manifest differs from frozen program')
    if not Allocation(directory.parent,directory).events():
        append(directory.parent/'allocation-events.jsonl', {'event':'created','allocation':str(directory),
            'stage':'initial','seconds':authority['trainingSeconds'],'id':authority['campaign'],
            'observedAt':time.time(),'practice':program})
    continuation(directory, stored['manifest'])
    atomic_json(directory/'allocation.json', {'paused':False,'stop':False,'workers':2,'reason':'qualification'})


def environment(directory, program, checkpoint):
    from .checkpoint import atomic_json
    from .execution_recipe import verify_runtime
    recipe = program['executionRecipe']
    os.environ.update(RIGHELT_EXECUTION_RECIPE_PATH=str(resolve_reference(recipe['path'], expected_sha256=recipe['sha256'])),
                      RIGHELT_EXECUTION_RECIPE_SHA256=recipe['sha256'])
    settings = verify_runtime()
    if settings['settings']['mode'] != 'attention-tactical-practice':
        raise ValueError('incorrect tactical execution recipe')
    context = directory/'execution-context.json'
    atomic_json(context, {'execution':{'inputCheckpointSha256':program['checkpoint']['sha256'],
        'dataSha256':settings['dataSha256']},'recoveryFiles':[{'path':checkpoint['path'],'sha256':checkpoint['sha256']}]})
    os.environ['RIGHELT_EXECUTION_CONTEXT']=str(context)


def washout_population(runner, packet, lineages):
    from .evaluation_families import family_aliases, family_from_anchors
    excluded_games = set(packet['sourceGameIds'])
    excluded_families = set(packet['sourceFamilies'])
    related_geometry = {lineages['initialGeometry'][g] for g in excluded_games if g in lineages['initialGeometry']}
    excluded_games.update(g for g, geo in lineages['initialGeometry'].items() if geo in related_geometry)
    families = dict(lineages['families'])
    for game, receipt in runner.state['freshTraining']['games'].items():
        job = receipt['job']
        families[game] = job['familyId']
        if 'tacticalStart' in job:
            excluded_games.add(game)
    excluded_games.update(game for game, family in families.items() if family in excluded_families)
    # Exclude all geometrical aliases of the teaching boards, including historic
    # demonstrations, even in unrelated games passing through similar positions.
    offsets = [CONFIG['planes'].index(side+'.commander') * 100 for side in ('P1','P2')]
    def anchors(encoded):
        try:
            return tuple(encoded.index(1,start,start+100)-start for start in offsets)
        except ValueError:
            return ()
    def state_for(pair):
        return {'pieces':[{'kind':'commander','owner':side,'position':{'row':square//10,'col':square%10}}
            for side,square in zip(('P1','P2'),pair)]}
    guarded = set()
    for lesson in packet['rows']:
        pair = anchors(lesson['encoded'])
        if len(pair) == 2:
            guarded.update(family_aliases(state_for(pair)))
    for start in packet['eligibleStarts']:
        if start.get('earlier'):guarded.update(family_aliases(start['earlier']))
    @lru_cache(maxsize=10000)
    def distinct(pair):
        return len(pair)==2 and family_from_anchors([(s,x//10,x%10) for s,x in zip(('P1','P2'),pair)]) not in guarded
    return [row for row in runner.buffer.positions if row['gameId'] in families and row['gameId'] not in excluded_games
            and distinct(anchors(row['encoded']))]


class Campaign:
    def __init__(self, runner, program):
        self.runner = runner
        self.directory = runner.directory
        self.program = program
        self.packet = json.loads(read_bound(program['packet']))
        self.lineages = json.loads(read_bound(program['lineages']))
        self.marks = self.directory/'milestones'
        self.marks.mkdir(exist_ok=True)
        self.seed = runner.seed

    def active(self):
        clock = read(self.directory/'clock.json')
        return clock['charged']+(max(0,time.monotonic()-clock['lastMonotonic']) if clock['running'] else 0)

    def stop_at(self, active_seconds):
        return min(self.runner.deadline,time.monotonic()+max(0,active_seconds-self.active()))

    def available(self):
        allocation = self.runner.allocation()
        if allocation['paused'] or allocation.get('stop'):
            raise InterruptedError('local allocation held: '+allocation['reason'])
        self.runner.report_device_memory()

    def mark(self, name):
        self.runner.checkpoint()
        pointer = read(self.directory/'latest.json')
        return fixed(self.marks/(name+'.json'),pointer)

    def marked(self, name):
        target=self.marks/(name+'.json')
        return read(target) if target.exists() else None

    def restore(self, pointer):
        """Pilot forks share precisely the same ordered buffer, including fresh games."""
        from .checkpoint import load_checkpoint
        runner=self.runner
        path=resolve_reference(pointer['checkpoint'],expected_sha256=pointer['sha256'])
        if path.parent != self.directory/'checkpoints':
            raise ValueError('branch checkpoint escaped this campaign')
        if runner.model_version == pointer['sha256']:
            return
        data=load_checkpoint(path,runner.model,runner.optimizer,manifest_sha256=runner.manifest_hash,
                             require_recovery=True,training_recipe=runner.training_recipe)
        if data['replayIds'] != runner.state['archives']:
            raise ValueError('pilot branch reached a different replay population')
        runner.state=data['recovery']['state']
        runner.model_version=pointer['sha256']
        runner.fresh_previous_checkpoint=None
        runner.model.eval()

    def train(self, label, schedule, target, seed, deadline, *, ordinary_only=False, cycle_offset=0):
        from .tactical_practice import PracticeBatches
        from .trainer import train_round
        from .fresh_health import eligible_game_ids
        r=self.runner
        cursor=r.state.get('practiceCursor')
        if not cursor or cursor['stage']!=label:
            cursor={'stage':label,'completed':0,'startUpdates':r.state['updates'],'certified':0,'ordinary':0,'prepared':0}
            r.state['practiceCursor']=cursor
        if r.state['updates'] != cursor['startUpdates']+cursor['completed']:
            raise ValueError('practice cursor differs from actual optimizer updates')
        ordinary=washout_population(r,self.packet,self.lineages) if ordinary_only else list(r.buffer.positions)
        prepared={game for game,receipt in r.state['freshTraining']['games'].items() if 'tacticalStart' in receipt['job']}
        batches=PracticeBatches(ordinary,self.packet['rows'],seed)
        eligible=eligible_game_ids(r.state)
        r.state['phase']='training'
        while cursor['completed']<target and time.monotonic()<deadline-40:
            self.available()
            offset=cursor['completed']
            count=min(CONFIG['training']['maxMinibatches'],target-offset)
            def record(metrics):
                cursor['completed']+=1
                cursor['certified']+=len(metrics['certifiedSamples'])
                cursor['ordinary']+=metrics['ordinarySamples']
                cursor['prepared']+=sum(g['positions'] for g in metrics.get('sampledGames',[]) if g['gameId'] in prepared)
                r.record_training_batch(metrics)
            result=train_round(r.model,r.optimizer,[],device=r.device,seed=seed,deadline=deadline,
                operation=r.operation,on_batch=record,evidence_game_ids=eligible,
                planned_batch=lambda i:batches.batch(schedule,cycle_offset+offset+i),planned_count=count,
                should_pause=lambda:r.allocation()['paused'])
            cursor['batchSeconds']=cursor.get('batchSeconds',0)+sum(b['seconds'] for b in result['batches'])
            r.event('practice-chunk',stage=label,completed=cursor['completed'],ordinaryPopulation=len(ordinary),
                    sampleCounts={k:cursor[k] for k in ('certified','ordinary','prepared')},stop=result['stopped'])
            del result
            r.checkpoint()
            if offset==cursor['completed']:
                self.available()
                break
        return cursor['completed']==target

    def generate(self, stop):
        r=self.runner
        self.available()
        saved=r.deadline
        try:
            r.deadline=min(stop,saved)
            r.generate_round()
            self.available()
        finally:
            r.deadline=saved
        r.state.update(phase='training',trainingBatch=0,generationLaunched=0,generationStartedMonotonic=None)
        r.state['round']+=1
        r.checkpoint()

    def export(self, name, checkpoint):
        from .export import export_onnx
        from .checkpoint import inspect_checkpoint
        from .model import model_from_record
        destination=self.directory/'endpoints'/name
        destination.mkdir(parents=True,exist_ok=True)
        receipt=destination/'export.json'
        model=destination/'model.onnx'
        if not receipt.exists():
            # Export a distinct CPU copy. Reconciliation may occur after new
            # self-play games, so restoring the learner would rewind its replay.
            path=resolve_reference(checkpoint['checkpoint'],expected_sha256=checkpoint['sha256'])
            data=inspect_checkpoint(path,manifest_sha256=self.runner.manifest_hash,require_recovery=True)
            import torch
            with torch.random.fork_rng(devices=[]):
                frozen=model_from_record(data)
                frozen.load_state_dict(data['model'])
            temp=destination/'model.tmp.onnx'
            metadata=export_onnx(frozen,temp)
            os.replace(temp,model)
            fixed(receipt,{'checkpoint':checkpoint,'export':metadata})
        stored=read(receipt)
        if stored['checkpoint']!=checkpoint or file_sha256(model)!=stored['export']['sha256']:
            raise ValueError('endpoint export differs from selected checkpoint')
        return model

    def score(self,name,checkpoint,seconds):
        model=self.export(name,checkpoint)
        target=model.parent/'pilot'
        evaluator=self.program['evaluator']
        if file_sha256(evaluator['path'])!=evaluator['sha256'] or file_sha256(self.program['development']['path'])!=self.program['development']['sha256']:
            raise ValueError('development scorer changed during pilot')
        if seconds>8:
            self.available()
            try:
                result=subprocess.run(['node','--import','tsx',evaluator['path'],'--model',str(model),'--out',str(target),
                    '--development',self.program['development']['path'],'--seeds','4','--pilot',
                    '--seconds',str(max(1,int(seconds-6)))],cwd=ROOT,timeout=seconds+2,check=False)
                if result.returncode not in (0,2):
                    raise RuntimeError('pilot scorer failed: '+str(result.returncode))
            except subprocess.TimeoutExpired:
                self.runner.event('pilot-evaluation-time-bound',endpoint=name,allottedSeconds=seconds)
        path=target/'summary.json'
        return read(path)['results'] if path.exists() else []

    def pilot(self):
        if self.marked('pilot-winner'):
            return read(self.directory/'pilot-result.json')
        r=self.runner
        if not self.marked('common'):
            self.generate(self.stop_at(1800))
            if not r.state['freshTraining']['games']:
                raise ValueError('no accepted fresh common games')
            self.mark('common')
        if not self.marked('acquisition'):
            if (r.state.get('practiceCursor') or {}).get('stage')!='acquisition':
                self.restore(self.marked('common'))
            if not self.train('acquisition','acquire',512,self.seed+1,self.stop_at(9000)):
                raise TimeoutError('common acquisition did not complete')
            self.mark('acquisition')
        stages=[('practice',2048,self.seed+2),('washout',2048,self.seed+3)]
        # Both arms must complete a stage for its scores to enter the comparison.
        # Reserve at least ten minutes to play the paired complete turns.
        arms=('concentrated','spaced')
        latest_stage='acquisition'
        for stage,count,seed in stages:
            for arm in arms:
                name=arm+'-'+stage
                if self.marked(name):
                    continue
                if self.active()>=10140:
                    break
                if (r.state.get('practiceCursor') or {}).get('stage')!=name:
                    self.restore(self.marked('acquisition' if stage=='practice' else arm+'-practice'))
                if self.train(name,'ordinary' if stage=='washout' else arm,count,seed,self.stop_at(10140),
                              ordinary_only=stage=='washout'):
                    ptr=self.mark(name)
                    fixed(self.marks/(name+'-samples.json'),dict(r.state['practiceCursor']))
                    self.export(name,ptr)
            if not all(self.marked(arm+'-'+stage) for arm in arms):
                break
            latest_stage=stage
        observations={}
        for i,arm in enumerate(arms):
            label='acquisition' if latest_stage=='acquisition' else arm+'-'+latest_stage
            allotted=max(0,(10800-self.active()-30)/(len(arms)-i))
            observations[arm]=self.score(label,self.marked(label),min(450,allotted))
        def indexed(rows):
            return {(x['item'],x['profile'],x['seed']):x for x in rows if x['status']!='technical-incomplete'}
        left,right=(indexed(observations[arm]) for arm in arms)
        shared=sorted(left.keys() & right.keys())
        def metrics(rows):
            return (sum(rows[k]['status']=='loss' and rows[k]['knownViable'] for k in shared),
                    -sum(rows[k]['status'] in ('win','protected','material-gain') for k in shared))
        winner='concentrated' if metrics(left)<metrics(right) else 'spaced'
        retained=self.marked('acquisition') if latest_stage=='acquisition' else self.marked(winner+'-practice')
        result={'schedule':winner,'matchedStage':latest_stage,'matchedObservations':len(shared),
                'scores':{arm:{'errors':m[0],'successes':-m[1]} for arm,m in zip(arms,(metrics(left),metrics(right)))},
                'scoredStages':{a:[s for s,_,_ in stages if self.marked(a+'-'+s)] for a in arms},
                'tie':metrics(left)==metrics(right),'preWashoutCheckpoint':retained}
        if (self.directory/'pilot-result.json').exists():
            result=read(self.directory/'pilot-result.json')
            retained=result['preWashoutCheckpoint']
        else:
            fixed(self.directory/'pilot-result.json',result)
        self.restore(retained)
        fixed(self.marks/'pilot-winner.json',retained)
        self.export('pilot-winner',retained)
        return result

    def run(self):
        from .checkpoint import atomic_json
        r=self.runner
        for label in ('concentrated-practice','spaced-practice','concentrated-washout','spaced-washout',
                      'pilot-winner','12h','20h','pre-final-washout','post-final-washout'):
            endpoint=self.marked(label)
            if endpoint:self.export(label,endpoint)
        result=self.pilot()
        if not r.state.get('selectedPilot'):
            self.restore(result['preWashoutCheckpoint'])
            r.state['selectedPilot']=result['schedule']
            r.state['mainPracticeUpdates']=0
            r.state.update(phase='generation',generationLaunched=0,generationStartedMonotonic=None)
            r.checkpoint()
        # Measure final washout runway on this Mac using both completed pilot stages.
        # Conservative floor is 35 minutes, with headroom for one generation round.
        measured=[self.marked(arm+'-washout-samples') for arm in ('spaced','concentrated')]
        reserve=max([2100]+[m['batchSeconds']*1.6+240 for m in measured if m])
        for milestone,at in [('12h',43200),('20h',72000),('pre-final-washout',86400-reserve)]:
            if self.marked(milestone):
                continue
            while self.active()<at-45:
                self.available()
                end=self.stop_at(at)
                if r.state['phase']=='generation':
                    if end-time.monotonic()<180:
                        break
                    self.generate(end)
                label='consolidation-'+str(r.state['round'])
                done=self.train(label,result['schedule'],256,self.seed+r.state['round']+100,end,
                                cycle_offset=r.state['mainPracticeUpdates'])
                if not done:
                    break
                r.state['mainPracticeUpdates']+=256
                r.state.update(phase='generation',generationLaunched=0,generationStartedMonotonic=None)
                r.checkpoint()
            pointer=self.mark(milestone)
            self.export(milestone,pointer)
        if not self.marked('post-final-washout'):
            if not self.train('final-washout','ordinary',2048,self.seed+4,self.stop_at(86400),ordinary_only=True):
                raise TimeoutError('final ordinary-only washout did not fit')
            pointer=self.mark('post-final-washout')
            self.export('post-final-washout',pointer)
        # Spend remaining compute on fresh outcome games from the final weights.
        # No further optimizer step can change the eligible final endpoint.
        while self.active()<86400-45:
            self.available()
            before=self.active()
            r.state['phase']='generation'
            self.generate(self.stop_at(86400))
            if self.active()-before<10 and r.state.get('admissionStop'):
                break
        pointer=self.marked('post-final-washout')
        atomic_json(self.directory/'training-result.json',{'reason':'completed-final-retention',
            'selectedSchedule':result['schedule'],'finalEligible':pointer,'latestAccounting':read(self.directory/'latest.json'),
            'activeSecondsAtFinish':self.active(),'newUpdates':pointer['updates']-r.state['inheritedUpdates']})


def worker(directory, qualification):
    from .runner import Runner
    from .runner_monitor import RunnerMonitor
    from .arithmetic import ieee_fp32
    program=read(directory/'program.json')
    selected=read(directory/'latest.json') if (directory/'latest.json').exists() else program['checkpoint']
    pointer={'path':selected.get('checkpoint',selected.get('path')),'sha256':selected['sha256']}
    environment(directory,program,pointer)
    owner=read(directory/'runtime.json')['supervisorPid']
    launched=time.time()
    def check_owner():
        activity=directory/'operator-activity.json'
        if os.getppid()!=owner or time.time()-max(launched,activity.stat().st_mtime if activity.exists() else launched)>20:
            raise RuntimeError('local resource supervisor lost')
    def expire():
        import signal
        if os.getpgid(0)==os.getpid():os.killpg(os.getpid(),signal.SIGKILL)
        os._exit(70)
    with ieee_fp32(), RunnerMonitor(directory,check_owner=check_owner,expire=expire) as monitor:
        with monitor.operation('qualified-parent-or-durable-restore',600):
            runner=Runner(directory,2026112501,'initial',resume=Path(pointer['path']),monitor=monitor)
        campaign=Campaign(runner,program)
        if qualification:
            if runner.state['updates']!=161280 or runner.state['freshTraining']['games']:
                raise ValueError('qualification must have zero new training')
            from .trainer import tensor_batch
            from .model import training_loss
            from .checkpoint import weights_sha256
            from .tactical_practice import PracticeBatches
            import torch
            import random
            before=weights_sha256(runner.model.state_dict())
            rng=(random.getstate(),torch.get_rng_state(),torch.mps.get_rng_state())
            isolated=washout_population(runner,campaign.packet,campaign.lineages)
            batch=PracticeBatches(isolated,campaign.packet['rows'],campaign.seed).batch('acquire',0)
            inputs,legal,policy,value,mask,policy_mask=tensor_batch(batch,runner.device)
            logits,values=runner.model(inputs)
            loss,_,_=training_loss(logits,values,legal,policy,value,mask,policy_mask,preference_rows=batch)
            if not torch.isfinite(loss):raise ValueError('nonfinite native qualification objective')
            loss.backward()
            if not all(torch.isfinite(p.grad).all() for p in runner.model.parameters() if p.grad is not None):
                raise ValueError('nonfinite native qualification gradient')
            runner.optimizer.zero_grad(set_to_none=True)
            if weights_sha256(runner.model.state_dict())!=before:raise ValueError('qualification changed weights')
            if rng[0]!=random.getstate() or not torch.equal(rng[1],torch.get_rng_state()) or not torch.equal(rng[2],torch.mps.get_rng_state()):
                raise ValueError('native qualification changed recovered random state')
            fixed(directory/'native-objective.json',{'qualified':True,'weightsSha256':before,'washoutEligible':len(isolated),
                'teachingRows':sum('preference' in row for row in batch),'optimizerSteps':0,'device':str(runner.device)})
            if not campaign.marked('qualified'):campaign.mark('qualified')
        else:
            campaign.run()


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('mode',choices=['prepare','qualify','train'])
    parser.add_argument('--directory',required=True,type=Path)
    parser.add_argument('--inputs',required=True,type=Path)
    parser.add_argument('--evaluator',type=Path)
    parser.add_argument('--development',type=Path)
    args=parser.parse_args()
    configure(read(args.inputs))
    if args.mode=='prepare':
        prepare(args.directory,args.inputs,args.evaluator,args.development)
    else:
        worker(args.directory.resolve(),args.mode=='qualify')


if __name__=='__main__':
    main()
