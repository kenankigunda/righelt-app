import copy
import gzip
import hashlib
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from righelt_training.attention_method import reconstruct_replay,transfer_state,digest,observed_projection
from righelt_training.architecture import architecture_binding
from righelt_training.pilot_recipe import DEFINITION,DEFINITION_SHA256
from righelt_training.replay import ReplayBuffer,partition_for_family

class AttentionMethodTest(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        self.root=Path(self.temp.name).resolve();self.run=self.root/'.ai-runs'/'restore';self.run.mkdir(parents=True)
        self.entries=[]
        self.family=next('f'+str(i) for i in range(100) if partition_for_family('f'+str(i))=='train')
    def binding(self,name,value):
        path=self.run/name;path.write_text(json.dumps(value));return {'path':str(path),'sha256':hashlib.sha256(path.read_bytes()).hexdigest()}
    def setup_method(self):
        self.entries=[]
        refs=['/old-mac/a.json.gz','/old-mac/b.json.gz'];hashes={}
        for number,ref in enumerate(refs):
            game={'id':str(number),'familyId':self.family,'partition':'train','termination':'truncated','outcome':{'status':'ongoing'},
                  'decisions':[{'id':str(number)+':position','legal':[0],'policy':[{'index':0,'probability':1.}],'encoded':[0.]*(46*100)}]}
            path=self.run/(str(number)+'.gz')
            with gzip.open(path,'wt') as stream:json.dump(game,stream)
            sha=hashlib.sha256(path.read_bytes()).hexdigest();hashes[ref]=sha
            self.entries.append({'reference':ref,'sha256':sha,'path':str(path.relative_to(self.root))})
        rows=[]
        for i in range(28):
            encoded=[0.]*(46*100);encoded[i]=1.
            rows.append({'id':'value'+str(i),'encoded':encoded,'legal':[0], 'policy':[],'policyMask':False,'terminalMask':True,'terminalValue':1.,'gameId':'observed'})
        marker={'kind':'observed-values-at-original-buffer-boundary-v1','binding':{'kind':'observed-user-values-v1'},'archivePrefix':refs[:1],'valuePositions':28}
        rows_binding=self.binding('rows.json',rows);guards='a'*64
        receipt={'schema':1,'kind':'portable-observed-values-qualification','rowsSha256':rows_binding['sha256'],'originalBinding':marker['binding'],
                 'archivePrefixSha256':digest(marker['archivePrefix']),'guardsSha256':guards,'policyTargets':False,'qualified':True,
                 'sanitization':{'schema':1,'originalIdsRemoved':True,'modelInputsUnchanged':True},
                 'originalModelInputProjectionSha256':digest(observed_projection(rows)), 'sanitizedModelInputProjectionSha256':digest(observed_projection(rows))}
        proof={'schema':1,'kind':'portable-inherited-replay-qualification','guardsSha256':guards,'qualified':True,
               'entries':[{'reference':ref,'sha256':hashes[ref],'eligible':True} for ref in refs]}
        method={'schema':1,'kind':'attention-incumbent-method-v1','sourceRevision':'0d2891aeaab7ab2bec440bbdd44f8bf3ac7bdb18','architecture':architecture_binding('board-attention-48x2-v1'),
                'pilotRecipe':{'schema':1,'kind':DEFINITION['kind'],'pretrainRounds':16,'definitionSha256':DEFINITION_SHA256,'curriculum':DEFINITION['curriculum'],
                               'teacher':{'path':'/original/teacher.pt','sha256':'b'*64,'manifestSha256':'c'*64}},
                'replayProof':self.binding('replay.json',proof),'supplementalRows':rows_binding,'supplementalReceipt':self.binding('receipt.json',receipt),
                'transferReceipt':self.binding('transfer.json',{}),'guardsSha256':guards}
        data={'recovery':{'archives':hashes,'state':{'archives':refs,'supplementalObservedValuesV1':marker}}}
        inventory=self.binding('portable.json',{'schema':1,'entries':self.entries})
        env={'RIGHELT_PORTABLE_CLOSURE_PATH':inventory['path'],'RIGHELT_PORTABLE_CLOSURE_SHA256':inventory['sha256'],'RIGHELT_PORTABLE_ROOT':str(self.root)}
        return method,data,env
    def test_observed_rows_stay_at_original_replay_age_and_native_eviction(self):
        method,data,env=self.setup_method();before=copy.deepcopy(data)
        buffer=ReplayBuffer(capacity=10)
        with patch.dict(os.environ,env):report=reconstruct_replay(buffer,data,method,base=self.run)
        self.assertEqual(report['archivePrefix'],1)
        self.assertEqual([p['id'] for p in buffer.positions],['value'+str(i) for i in range(19,28)]+['1:position'])
        self.assertEqual(data,before)
    def test_missing_qualification_changed_order_and_mask_upgrade_reject(self):
        for change in ('proof','order','mask'):
            method,data,env=self.setup_method()
            if change=='proof':method['replayProof']=self.binding('badproof.json',{'schema':1})
            if change=='order':data['recovery']['state']['archives'].reverse()
            if change=='mask':
                rows=json.loads(Path(method['supplementalRows']['path']).read_bytes());rows[0]['policyMask']=True
                method['supplementalRows']=self.binding('badrows.json',rows)
            with self.subTest(change=change),patch.dict(os.environ,env),self.assertRaises(ValueError):reconstruct_replay(ReplayBuffer(),data,method,base=self.run)
    def test_new_allocation_consumes_old_pending_job_without_restarting_old_clock(self):
        method,data,_=self.setup_method();state=data['recovery']['state']
        state.update(round=118,phase='generation',trainingBatch=256,nextJob=351,generationLaunched=4,generationElapsedSeconds=1505.,pendingGenerationJob={'id':'old-job-350'},
                     updates=55040,nonzeroUpdates=30208,pilotLearningRate=.0001,curriculumSwitched=False)
        data.update(updates=55040,round=118,recoverySha256='d'*64)
        ledger_path=self.run/'launches.jsonl';ledger_path.write_text(json.dumps({'jobId':'old-job-350'})+'\n')
        ledger={'path':str(ledger_path),'sha256':hashlib.sha256(ledger_path.read_bytes()).hexdigest()}
        cursor={key:state.get(key) for key in ('round','phase','trainingBatch','nextJob','generationLaunched','generationElapsedSeconds','pendingGenerationJob')}
        receipt={'schema':1,'kind':'attention-closed-allocation-transfer','checkpointSha256':'e'*64,'checkpointRecoverySha256':'d'*64,
                 'sourceAllocationClosed':True,'cursorSha256':digest(cursor),'initialization':'new-generation-boundary','pendingJobId':'old-job-350',
                 'pendingDisposition':'consumed-unfinished','sourceLaunchLedger':ledger}
        method['transferReceipt']=self.binding('transfer2.json',receipt)
        before=copy.deepcopy(data);result=transfer_state(data,method,'e'*64)
        self.assertEqual((result['updates'],result['inheritedUpdates'],result['nonzeroUpdates'],result['nextJob']),(55040,55040,0,351))
        self.assertIsNone(result['pendingGenerationJob']);self.assertIsNone(result['generationStartedMonotonic'])
        self.assertEqual(result['inheritedBoundary']['cursor'],cursor);self.assertEqual(data,before)
        with self.assertRaises(ValueError):transfer_state(data,method,'f'*64)

    def test_unissued_id_requires_counter_consumption_and_no_launch(self):
        method,data,_=self.setup_method();state=data['recovery']['state']
        state.update(round=118,phase='generation',trainingBatch=256,nextJob=351,generationLaunched=4,generationElapsedSeconds=1505.,pendingGenerationJob={'id':'initial-game-2026102701-350'},
                     updates=55040,nonzeroUpdates=30208,pilotLearningRate=.0001,curriculumSwitched=False)
        data.update(updates=55040,round=118,recoverySha256='d'*64)
        ledger_path=self.run/'empty-launches.jsonl';ledger_path.write_text('')
        ledger={'path':str(ledger_path),'sha256':hashlib.sha256(ledger_path.read_bytes()).hexdigest()}
        counter=self.binding('counter.json',{'jobs':{'initial:2026102701':351}})
        cursor={key:state.get(key) for key in ('round','phase','trainingBatch','nextJob','generationLaunched','generationElapsedSeconds','pendingGenerationJob')}
        receipt={'schema':1,'kind':'attention-closed-allocation-transfer','checkpointSha256':'e'*64,'checkpointRecoverySha256':'d'*64,
                 'sourceAllocationClosed':True,'cursorSha256':digest(cursor),'initialization':'new-generation-boundary','pendingJobId':'initial-game-2026102701-350',
                 'pendingDisposition':'consumed-unissued','sourceLaunchLedger':ledger,'sourceRecoveryLedger':counter,'sourceJobCounterKey':'initial:2026102701'}
        method['transferReceipt']=self.binding('unissued-transfer.json',receipt)
        result=transfer_state(data,method,'e'*64)
        self.assertIsNone(result['pendingGenerationJob']);self.assertEqual(result['nextJob'],351)
        self.assertEqual(result['inheritedBoundary']['pendingDisposition'],'consumed-unissued')
        receipt['sourceRecoveryLedger']=self.binding('badcounter.json',{'jobs':{'initial:2026102701':350}})
        method['transferReceipt']=self.binding('bad-transfer.json',receipt)
        with self.assertRaisesRegex(ValueError,'consumed counter'):transfer_state(data,method,'e'*64)

    def test_shared_calibration_fork_preserves_partial_training_cursor_and_seed(self):
        method,data,_=self.setup_method();state=data['recovery']['state']
        state.update(round=118,phase='training',trainingBatch=7,nextJob=351,generationLaunched=4,generationElapsedSeconds=1505.,pendingGenerationJob=None,
                     updates=55040,nonzeroUpdates=30208,pilotLearningRate=.0001,curriculumSwitched=False)
        data.update(updates=55040,round=118,recoverySha256='d'*64)
        source=self.binding('shared-result.json',{'kind':'compute-result','disposition':'complete','allWorkComplete':True,
            'execution':{'seed':107,'scientific':{'stage':'calibration','arm':'shared'}},'artifacts':[{'role':'checkpoint','sha256':'e'*64}]})
        cursor={key:state.get(key) for key in ('round','phase','trainingBatch','nextJob','generationLaunched','generationElapsedSeconds','pendingGenerationJob')}
        receipt={'schema':1,'kind':'attention-closed-allocation-transfer','checkpointSha256':'e'*64,'checkpointRecoverySha256':'d'*64,
                 'sourceAllocationClosed':True,'cursorSha256':digest(cursor),'initialization':'resume-training-cursor','pendingJobId':None,'sourceResult':source}
        method['transferReceipt']=self.binding('shared-transfer.json',receipt)
        before=copy.deepcopy(data);result=transfer_state(data,method,'e'*64,target_seed=107)
        self.assertEqual((result['phase'],result['trainingBatch'],result['round'],result['nextJob']),('training',7,118,351))
        self.assertEqual(result['inheritedBoundary']['inheritedReplayCount'],2)
        self.assertIsNone(result['generationStartedMonotonic']);self.assertEqual(data,before)
        with self.assertRaisesRegex(ValueError,'cursor and seed'):transfer_state(data,method,'e'*64,target_seed=108)

if __name__=='__main__':unittest.main()
