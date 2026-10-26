"""Metadata-only transfer contracts. Actual model/RNG restore needs its separate run proof."""
import copy,hashlib,json,pathlib,tempfile,unittest
from righelt_training.phase_transfer import checked_phase_transfer
from righelt_training.architecture import architecture_binding
from righelt_training.training_recipe import recipe_binding
class PhaseTransferTest(unittest.TestCase):
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup);self.root=pathlib.Path(self.temp.name);self.source=self.root/'pilot';(self.source/'checkpoints').mkdir(parents=True);self.destination=self.root/'main';self.destination.mkdir();self.checkpoint=self.source/'checkpoints/checkpoint-000092.pt';self.checkpoint.write_bytes(b'metadata-only fixture, not neural weights');self.cp_sha=hashlib.sha256(self.checkpoint.read_bytes()).hexdigest()
  contract={'schema':1,'kind':'followup-round-24h-v1','executionStartedAt':'2026-10-25T22:47:32+00:00','deadline':'2026-10-26T22:47:32+00:00','phase':'pilot','phaseDeadline':'2026-10-26T06:47:32+00:00','statePath':str(self.root/'state.json'),'checkpointReserveSeconds':60}
  self.origin={'sourceRevision':'a'*40,'seed':17,'stage':'initial','config':{'id':'same'},'configSha256':'f'*64,'trainingRecipe':recipe_binding(),'modelArchitecture':architecture_binding(),'pilotRecipe':{'fixture':'equal-opaque-pilot-recipe'},'warmStart':{'path':'/healthy1554','sha256':'d'*64},'productionCorpus':{'path':'/sealed/corpus','sha256':'e'*64},'finalFamilies':{'path':'/sealed/final','sha256':'c'*64},'roundDataBinding':{'cutoff':'sealed'},'dependencies':['locked'],'lockHashes':{'python':'same'},'roundContract':contract}
  self.parent_hash=hashlib.sha256(json.dumps(self.origin,sort_keys=True,allow_nan=False).encode()).hexdigest();(self.source/'manifest.json').write_text(json.dumps({'manifest':self.origin,'sha256':self.parent_hash}))
  self.checkpoint.with_suffix('.json').write_text(json.dumps({'sha256':self.cp_sha,'manifestSha256':self.parent_hash,'updates':400,'trainingRecipe':recipe_binding(),'modelArchitecture':architecture_binding()}));self.checkpoint.with_suffix('.runner.json').write_text(json.dumps({'checkpointSha256':self.cp_sha,'state':{'updates':400,'nonzeroUpdates':100,'lastHandoffId':'consumed','archives':['games/retained.gz']}}))
  self.target=copy.deepcopy(self.origin);self.target['sourceRevision']='b'*40;self.target['roundContract'].update(phase='main',phaseDeadline='2026-10-26T17:47:32+00:00');self.target['phaseContinuation']={'kind':'same-round-pilot-to-main-v1','preserveState':True,'checkpoint':{'path':str(self.checkpoint),'sha256':self.cp_sha,'manifestSha256':self.parent_hash}}
 def check(self,target=None,checkpoint=None):return checked_phase_transfer(target or self.target,checkpoint or self.checkpoint,self.destination)
 def test_positive_warm_lineage_keeps_selected_checkpoint_and_input_state(self):
  before=copy.deepcopy(self.target);self.assertEqual(self.check(),self.target['phaseContinuation']);self.assertEqual(self.target,before)
 def test_wrong_selected_checkpoint_rejects(self):
  other=self.source/'checkpoints/other.pt';other.write_bytes(b'other')
  with self.assertRaises(ValueError):self.check(checkpoint=other)
 def test_missing_main_transfer_rejects(self):
  self.target.pop('phaseContinuation')
  with self.assertRaises(ValueError):self.check()
 def test_data_recipe_seed_or_architecture_change_rejects(self):
  for key,value in [('roundDataBinding',{'cutoff':'new'}),('seed',18),('warmStart',None),('trainingRecipe',None),('modelArchitecture',architecture_binding('board-attention-48x2-v1'))]:
   with self.subTest(key=key):
    target=copy.deepcopy(self.target);target[key]=value
    with self.assertRaises((ValueError,KeyError,TypeError)):self.check(target)
 def test_original_clock_and_release_reserve_cannot_extend(self):
  for key,value in [('deadline','2026-10-27T22:47:32+00:00'),('phaseDeadline','2026-10-26T18:47:32+00:00'),('phase','pilot')]:
   target=copy.deepcopy(self.target);target['roundContract'][key]=value
   with self.assertRaises(ValueError):self.check(target)
 def test_corrupt_checkpoint_or_companion_rejects(self):
  self.checkpoint.write_bytes(b'changed')
  with self.assertRaises(ValueError):self.check()
 def test_companion_hash_updates_and_nonzero_progress_rejects(self):
  p=self.checkpoint.with_suffix('.runner.json'); original=json.loads(p.read_text())
  for key,value in [('checkpointSha256','0'*64),('updates',401),('nonzeroUpdates',401)]:
   with self.subTest(key=key):
    item=copy.deepcopy(original)
    if key=='checkpointSha256':item[key]=value
    else:item['state'][key]=value
    p.write_text(json.dumps(item))
    with self.assertRaises(ValueError):self.check()
  p.write_text(json.dumps(original))
 def test_discarding_state_is_not_permitted(self):
  self.target['phaseContinuation']['preserveState']=False
  with self.assertRaises(ValueError):self.check()
 def test_later_main_resume_uses_own_latest_but_retains_pilot_parent(self):
  (self.destination/'checkpoints').mkdir();current=self.destination/'checkpoints/current.pt';current.write_bytes(b'current-main');digest=hashlib.sha256(current.read_bytes()).hexdigest();(self.destination/'latest.json').write_text(json.dumps({'checkpoint':str(current),'sha256':digest,'updates':500}));self.assertEqual(self.check(checkpoint=current)['checkpoint']['path'],str(self.checkpoint))
  wrong=self.destination/'checkpoints/wrong.pt';wrong.write_bytes(b'wrong')
  with self.assertRaises(ValueError):self.check(checkpoint=wrong)
 def test_old_pilot_without_transfer_still_has_legacy_behavior(self):
  self.assertIsNone(checked_phase_transfer(self.origin,self.checkpoint,self.source))
if __name__=='__main__':unittest.main()
