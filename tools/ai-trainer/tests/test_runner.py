import hashlib
import json
from pathlib import Path
import tempfile
import subprocess
import time
import unittest
from unittest.mock import patch, Mock
import torch
from righelt_training.runner import Runner, default_state, engine_command
from righelt_training.curriculum import Curriculum, simple_root
from righelt_training.model import PolicyValueNet
from righelt_training.trainer import make_optimizer
from righelt_training.replay import ReplayBuffer
from righelt_training.checkpoint import atomic_json
from righelt_training.config import ROOT, CONFIG


class RunnerTest(unittest.TestCase):
    def test_engine_fingerprint_ignores_counters_but_not_controller(self):
        state = simple_root(2)
        first = engine_command({'command': 'fingerprint', 'state': state}, timeout=10)['fingerprint']
        state['turnIndex'] = 900
        for piece in state['pieces']:
            piece['pushed'] = False; piece['shifted'] = False
        second = engine_command({'command': 'fingerprint', 'state': state}, timeout=10)['fingerprint']
        self.assertEqual(first, second)
        state['sideToMove'] = 'P1' if state['sideToMove'] == 'P2' else 'P2'
        third = engine_command({'command': 'fingerprint', 'state': state}, timeout=10)['fingerprint']
        self.assertNotEqual(first, third)

    def test_curriculum_preparation_uses_engine_and_keeps_continuation_lineage(self):
        curriculum = Curriculum(19)
        tested = set()
        for index in range(100):
            job = curriculum.job(index, 'test')
            if job['kind'] in tested:
                continue
            job['command'] = 'prepare'; job['budgetMs'] = 5000
            result = engine_command(job, timeout=6)
            self.assertEqual(result['type'], 'prepared')
            self.assertEqual(result['initialState']['outcome']['status'], 'ongoing')
            if job['kind'] == 'continuation':
                self.assertTrue(result['initialState']['continuation'])
                self.assertTrue(result['warmupActions'])
                self.assertIsNone(result['rootState']['continuation'])
            tested.add(job['kind'])
            if len(tested) == 3:
                break
        self.assertEqual(tested, {'normal', 'simple', 'continuation'})

    def test_checkpoint_restores_round_cursor_and_consumed_job_ids(self):
        torch.set_num_threads(1)
        with tempfile.TemporaryDirectory() as directory:
            runner = Runner.__new__(Runner)
            runner.device = torch.device("cpu")
            runner.directory = Path(directory)
            runner.runtime = {'parentCheckpointManifestSha256': 'test'}
            runner.manifest_hash = 'test'
            runner.model = PolicyValueNet(); runner.optimizer = make_optimizer(runner.model)
            runner.buffer = ReplayBuffer(); runner.state = default_state()
            runner.state.update({'nextJob': 7, 'phase': 'training', 'trainingBatch': 3})
            runner.checkpoint()
            checkpoint = Path(json.loads((Path(directory)/'latest.json').read_text())['checkpoint'])
            runner.state = default_state()
            runner.restore(checkpoint)
            self.assertEqual(runner.state['nextJob'], 7)
            self.assertEqual(runner.state['trainingBatch'], 3)
            self.assertEqual(runner.state['phase'], 'training')
            companion = checkpoint.with_suffix('.runner.json')
            data = json.loads(companion.read_text()); data['checkpointSha256'] = 'wrong'; atomic_json(companion, data)
            with self.assertRaises(ValueError): runner.restore(checkpoint)

    def test_expired_engine_bound_cannot_launch(self):
        with self.assertRaises(TimeoutError): engine_command({'command': 'fingerprint'}, timeout=0)

    def test_handoff_saves_recoverable_checkpoint_without_resetting_deadline(self):
        torch.set_num_threads(1)
        with tempfile.TemporaryDirectory() as directory:
            runner = Runner.__new__(Runner)
            runner.device = torch.device('cpu'); runner.directory = Path(directory)
            runner.started = time.monotonic(); runner.deadline = runner.started + 600
            runner.runtime = {'deadlineMonotonic': runner.deadline}
            runner.manifest_hash = 'test'
            runner.model = PolicyValueNet(); runner.optimizer = make_optimizer(runner.model)
            runner.buffer = ReplayBuffer(); runner.state = default_state()
            runner.generate_round = Mock(side_effect=AssertionError('handoff must precede generation'))
            atomic_json(runner.directory/'runtime.json', runner.runtime)
            marker = {'schema': 1, 'id': 'initial-validation', 'reason': 'validation', 'manifestSha256': 'test'}
            atomic_json(runner.directory/'handoff-request.json', marker)
            runner.run()
            checkpoint = Path(json.loads((runner.directory/'latest.json').read_text())['checkpoint'])
            runner.state = default_state(); runner.restore(checkpoint)
            self.assertEqual(runner.state['lastHandoffId'], marker['id'])
            self.assertIsNone(runner.handoff_requested())
            self.assertEqual(json.loads((runner.directory/'runtime.json').read_text()), runner.runtime)
            self.assertEqual(json.loads((runner.directory/'runner-result.json').read_text())['reason'], 'validation-handoff')
            events = [json.loads(line) for line in (runner.directory/'runner-events.jsonl').read_text().splitlines()]
            self.assertEqual(next(event for event in events if event['type']=='checkpoint-handoff')['deadlineMonotonic'], runner.deadline)
            marker['manifestSha256'] = 'another-run'
            atomic_json(runner.directory/'handoff-request.json', marker)
            with self.assertRaises(ValueError): runner.handoff_requested()

    def test_exact_replay_checks_truncation_cause_and_detects_tampering(self):
        script = '''
import {createInitialState,resolveToStability,deterministicStateHash} from './packages/game-engine/src/index.ts';
import {transition,encodeState,legalActionMap} from './packages/computer-player/src/index.ts';
let state=resolveToStability(createInitialState()), initialState=structuredClone(state), decisions=[];
for(let i=0;i<4;i++){
 const beforeHash=deterministicStateHash(state), controller=state.sideToMove,
 encoded=Array.from(encodeState(state)),legal=[...legalActionMap(state).keys()],action={type:'pass'};
 state=transition(state,action);decisions.push({beforeHash,controller,encoded,legal,action,afterHash:deterministicStateHash(state)});
}
console.log(JSON.stringify({initialState,decisions,finalHash:deterministicStateHash(state),outcome:state.outcome,
 termination:'truncated',truncationReason:'repetition'}));
'''
        game = json.loads(subprocess.check_output(['node', '--import', 'tsx', '--input-type=module', '-e', script], cwd=ROOT, text=True))
        result = engine_command({'command': 'replay', 'game': game}, timeout=10)
        self.assertEqual(result['type'], 'replayed')
        game['truncationReason'] = 'decision-cap'
        with self.assertRaises(RuntimeError): engine_command({'command': 'replay', 'game': game}, timeout=10)
        game['truncationReason'] = 'repetition'; game['decisions'][0]['encoded'][0] = 99
        with self.assertRaises(RuntimeError): engine_command({'command': 'replay', 'game': game}, timeout=10)

    def test_unfinished_verification_preserves_archive_without_training(self):
        with tempfile.TemporaryDirectory() as directory:
            runner = Runner.__new__(Runner)
            runner.device = torch.device("cpu")
            runner.directory = Path(directory); runner.state = default_state(); runner.buffer = ReplayBuffer()
            runner.last_checkpoint = time.monotonic(); runner.deadline = time.monotonic()+600
            runner.checkpoint_requested = False
            job = Curriculum(2).job(0, 'test')
            game = {**job, 'termination': 'truncated', 'outcome': {'status': 'ongoing'}, 'decisions': []}
            bound = time.monotonic()+10
            with patch('righelt_training.runner.verify_game', side_effect=TimeoutError) as verify:
                self.assertFalse(runner.accept_game(game, bound))
                self.assertLessEqual(verify.call_args.args[1], bound)
            self.assertEqual(len(runner.buffer.positions), 0)
            self.assertEqual(runner.state['replayChecks'], 0)
            self.assertEqual(runner.state['unfinishedGames'], 1)
            self.assertEqual(len(list((Path(directory)/'games').glob('*.gz'))), 1)

    def test_completed_game_records_kind_and_remains_recoverable(self):
        with tempfile.TemporaryDirectory() as directory:
            runner=Runner.__new__(Runner);runner.directory=Path(directory)
            runner.device=torch.device('cpu');runner.state=default_state();runner.buffer=ReplayBuffer()
            runner.last_checkpoint=time.monotonic();runner.deadline=time.monotonic()+600
            runner.checkpoint_requested=False
            job=Curriculum(2).job(0,'test')
            game={**job,'termination':'terminal','outcome':{'status':'p1_win'},'decisions':[]}
            with patch('righelt_training.runner.verify_game'):
                self.assertTrue(runner.accept_game(game,time.monotonic()+10))
            event=json.loads((runner.directory/'runner-events.jsonl').read_text())
            self.assertEqual(event['type'],'game');self.assertEqual(event['kind'],job['kind'])
            self.assertEqual(runner.state['terminalGames'],1)
            self.assertEqual(runner.buffer.game_ids,[game['id']])
            self.assertTrue((runner.directory/runner.state['archives'][0]).exists())

    def test_worker_persists_exact_state_before_inference(self):
        import selectors
        from righelt_training.runner import ENGINE,stop_worker
        with tempfile.TemporaryDirectory() as directory:
            path=Path(directory)/'decision.json'
            job={'command':'generate','id':'diagnostic-test','seed':107,'kind':'normal',
                 'familyId':'test','partition':'train','modelVersion':'weights','budgetMs':5000,'diagnosticPath':str(path)}
            process=subprocess.Popen(['node','--import','tsx',str(ENGINE)],cwd=ROOT,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL)
            selector=selectors.DefaultSelector();selector.register(process.stdout,selectors.EVENT_READ)
            try:
                process.stdin.write((json.dumps(job)+'\n').encode());process.stdin.flush()
                self.assertTrue(selector.select(timeout=6),'worker did not request inference')
                message=json.loads(process.stdout.readline())
                self.assertEqual(message['type'],'evaluate')
                diagnostic=json.loads(path.read_text())
                self.assertEqual(diagnostic['jobId'],job['id']);self.assertEqual(diagnostic['decision'],0)
                self.assertEqual(diagnostic['seed'],107);self.assertEqual(diagnostic['modelVersion'],'weights')
                self.assertGreater(len(diagnostic['state']['pieces']),0)
            finally:selector.close();stop_worker(process)

    def test_continuation_warmup_has_separate_engine_budget_and_records_state(self):
        with tempfile.TemporaryDirectory() as directory:
            path=Path(directory)/'warmup.json'
            job=next(Curriculum(19).job(i,'test') for i in range(100) if Curriculum(19).job(i,'test')['kind']=='continuation')
            job.update(command='prepare',budgetMs=5000,diagnosticPath=str(path))
            script="import {experimentConfig} from './packages/computer-player/src/index.ts'; experimentConfig.search.maxNodes=1; await import('./tools/ai-trainer/engine-worker.mjs');"
            process=subprocess.run(['node','--import','tsx','--input-type=module','-e',script],cwd=ROOT,input=json.dumps(job)+'\n',capture_output=True,text=True,timeout=7)
            self.assertEqual(process.returncode,0,process.stderr)
            result=json.loads(process.stdout)
            self.assertEqual(result['type'],'prepared')
            self.assertGreater(len(result['warmupActions']),0)
            self.assertIn('pieces',result['initialState'])
            self.assertEqual(json.loads(path.read_text())['phase'],'continuation-warmup')

    def test_generation_protocol_respects_persisted_round_count(self):
        with tempfile.TemporaryDirectory() as directory:
            worker = Path(directory)/'mock-engine.mjs'
            worker.write_text("import{createInterface}from'node:readline';const r=createInterface({input:process.stdin});r.once('line',l=>{const j=JSON.parse(l);console.log(JSON.stringify({type:'game',game:{id:j.id}}));r.close();process.stdin.destroy();});")
            runner = Runner.__new__(Runner)
            runner.device = torch.device("cpu")
            runner.directory = Path(directory); runner.state = default_state()
            runner.last_checkpoint = time.monotonic(); runner.deadline = time.monotonic()+180
            runner.runtime={'startedMonotonic':runner.last_checkpoint,'deadlineMonotonic':runner.deadline,'reserveSeconds':30}
            runner.checkpoint_requested = False; runner.stage = 'initial'; runner.model_version = 'test'
            runner.curriculum = Curriculum(2); runner.checkpoint = Mock()
            runner.allocation = Mock(return_value={'workers': 2, 'paused': False, 'stop': False})
            runner.accept_game = Mock(return_value=True)
            with patch('righelt_training.runner.ENGINE', worker), patch.dict(CONFIG['training'], {'roundGames': 2}):
                runner.generate_round()
                self.assertEqual(runner.accept_game.call_count, 2)
                self.assertEqual(runner.state['nextJob'], 2)
                self.assertEqual(runner.state['generationLaunched'], 2)
                runner.generate_round()
                self.assertEqual(runner.accept_game.call_count, 2)

if __name__ == '__main__': unittest.main()
