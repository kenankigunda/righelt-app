import copy
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import unittest
from unittest.mock import Mock,patch
from righelt_training import consumption_transfer as transfer
from righelt_training.cloud_launch import REPLACEMENT
from righelt_training.recovery import RecoveryLedger
from righelt_training.runner import Runner,default_state
from righelt_training.curriculum import Curriculum


def sha(raw):return hashlib.sha256(raw).hexdigest()


def fixture(root):
    seed=17;parent='/workspace/righelt/.ai-runs/'+REPLACEMENT['consumedCampaignId'];rows=[];claims={}
    for index in range(351,355):
        job=f'initial-game-{seed}-{index}';key=sha(('training:'+job).encode());claim={'generation':1,'phaseIndex':0,'at':1000}
        claims[key]=claim;rows.append({'jobId':job,'claimKey':key,'claim':claim,
            'launch':{'directory':parent+'/run','jobId':job,'claimedAt':2},
            'disposition':'terminal-evidence-only' if index<353 else 'unfinished-consumed'})
    value={'schema':1,'kind':'closed-exploratory-consumed-work-floor','episodeId':REPLACEMENT['episodeId'],
        'parentCampaignId':REPLACEMENT['consumedCampaignId'],'parentGeneration':1,'seed':seed,'stage':'initial',
        'originalCheckpoint':{'sha256':'b'*64,'recoverySha256':'c'*64,'nextJob':351,'updates':7},
        'closedCheckpoint':{'sha256':'d'*64,'nextJob':355,'updates':7,'freshOptimizerUpdates':0},
        'consumedJobs':rows,'minimumNextJob':355,'controllerClaims':claims,
        'allocationRecoveryLedger':{'schema':1,'checkpoints':11,'jobs':{'initial:17':355}},
        'controllerCounters':{sha((parent+':job:initial:17').encode()):355,sha((parent+':checkpoint:').encode()):11},
        'parentAttempt':{'uncertain':False,'endedAt':3000},'parentClosed':True,'parentCleanupVerified':True,
        'sameAllocationResumes':0,'newGenerationFromOriginalCheckpoint':True,
        'p3GameTreatment':{'replacementReplayIncluded':False,'replacementFreshAccountingIncluded':False,
            'preservedAsImmutableEvidence':True,'excludedGameHashes':['e'*64,'f'*64]}}
    data={'updates':7,'recoverySha256':'c'*64,'recovery':{'state':{'nextJob':351},'archives':{'original-only':'a'*64}}}
    path=root/'evidence.json'
    def publish():
        raw=json.dumps(value).encode();path.write_bytes(raw);return {'path':str(path),'sha256':sha(raw)}
    return value,data,publish


class ConsumptionTransferTest(unittest.TestCase):
    def test_real_first_claim_and_metadata_child_spawn_follow_atomic_floor(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);value,data,publish=fixture(root);binding=publish();runner=Runner.__new__(Runner)
            runner.directory=root/'new-allocation/run';runner.directory.mkdir(parents=True)
            runner.ledger=RecoveryLedger(runner.directory.parent);runner.seed=17;runner.stage='initial'
            runner.state=default_state();runner.state.update(nextJob=351,pendingGenerationJob={'id':'old-pending'},phase='training')
            runner.manifest={'manifest':{'exploratoryWindow':{'launchAuthorityId':REPLACEMENT['id'],'consumedWorkTransfer':binding}}}
            def persisted():
                saved=json.loads((runner.ledger.root/'recovery-ledger.json').read_bytes())
                self.assertGreaterEqual(saved['jobs']['initial:17'],355)
            claims=[]
            def transport(action,payload):
                persisted()
                if action=='counter':return {'value':payload['minimum']}
                if action=='claim':claims.append(payload['key']);return {'created':True}
                raise AssertionError(action)
            spawned=root/'spawned.json';actual_popen=subprocess.Popen
            def spawn(argv,**kwargs):
                persisted();self.assertEqual(claims,[sha(b'training:initial-game-17-355')])
                child="import json,sys;from pathlib import Path;j=json.loads(sys.stdin.readline());Path(sys.argv[1]).write_text(json.dumps(j));print(json.dumps({'type':'unavailable-start'}),flush=True)"
                return actual_popen([sys.executable,'-c',child,str(spawned)],**kwargs)
            runner.model_version='frozen';runner.curriculum=Curriculum(17);runner.deadline=time.monotonic()+3600
            runner.runtime={'startedMonotonic':time.monotonic(),'deadlineMonotonic':runner.deadline,'reserveSeconds':60}
            runner.event=Mock();runner.checkpoint=Mock(side_effect=persisted);runner.maybe_checkpoint=Mock()
            runner.allocation=Mock(return_value={'workers':1,'paused':False,'stop':False})
            runner.handoff_requested=Mock(side_effect=[None,{'id':'done'}]);runner.generation_round_deadline=Mock(return_value=time.monotonic()+300)
            with patch.dict(REPLACEMENT,{'consumptionEvidenceSha256':binding['sha256']}):
                transfer.apply(runner,data,'b'*64)
                self.assertIsNone(runner.state['pendingGenerationJob']);self.assertEqual(runner.state['phase'],'generation')
                with patch('righelt_training.hosted_receipts.enabled',return_value=True),patch('righelt_training.hosted_receipts.request',side_effect=transport),patch('righelt_training.runner.subprocess.Popen',side_effect=spawn):
                    runner.generate_round()
            job=json.loads(spawned.read_bytes());self.assertEqual(job['id'],'initial-game-17-355')
            self.assertEqual(runner.state['nextJob'],356);self.assertEqual(runner.state['archives'],[])
            self.assertEqual(len(runner.ledger.launches()),1);self.assertEqual(claims,[sha(b'training:initial-game-17-355')])

    def test_altered_claim_counter_seed_closure_or_game_inclusion_cannot_seed_any_floor(self):
        changes=[lambda r:r.update(parentClosed=False),lambda r:r.update(seed=18),
            lambda r:r['controllerClaims'].clear(),lambda r:r['consumedJobs'][0].update(claimKey='0'*64),
            lambda r:r['allocationRecoveryLedger']['jobs'].update({'initial:17':354}),
            lambda r:r['parentAttempt'].update(uncertain=True),lambda r:r['closedCheckpoint'].update(freshOptimizerUpdates=1),
            lambda r:r['p3GameTreatment'].update(replacementReplayIncluded=True)]
        for change in changes:
            with self.subTest(change=change),tempfile.TemporaryDirectory() as d:
                root=Path(d);value,data,publish=fixture(root);change(value);binding=publish()
                with patch.dict(REPLACEMENT,{'consumptionEvidenceSha256':binding['sha256']}),self.assertRaises(ValueError):
                    transfer.verify(binding,data,seed=17,stage='initial',checkpoint_sha256='b'*64)
                self.assertFalse((root/'recovery-ledger.json').exists())
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);value,data,publish=fixture(root);binding=publish()
            with self.assertRaises(ValueError):transfer.verify(binding,data,seed=17,stage='initial',checkpoint_sha256='b'*64)
            ledger=RecoveryLedger(root/'new');ledger.job('initial',17)
            with self.assertRaises(ValueError):ledger.seed_job_floor('initial',17,355,{'verified':True})


if __name__=='__main__':unittest.main()
