"""Pure validation of the planned pilot-to-main transfer inside one fixed24h round."""
import hashlib,json
from pathlib import Path
from .architecture import record_architecture
from .training_recipe import record_recipe
from .manifest_envelope import active_envelope
from .round_contract import stamp,ROUND_SECONDS,PILOT_SECONDS,RELEASE_RESERVE_SECONDS

def digest(path):return hashlib.sha256(Path(path).read_bytes()).hexdigest()
def checked_phase_transfer(target,checkpoint,directory):
 binding=target.get('phaseContinuation')
 if binding is None:
  if target.get('pilotRecipe')and target.get('roundContract',{}).get('phase')=='main':raise ValueError('Main requires explicit selected pilot checkpoint transfer')
  return None
 if (not isinstance(binding,dict)or set(binding)!={'kind','checkpoint','preserveState'}
     or binding['kind']!='same-round-pilot-to-main-v1'or binding['preserveState']is not True):raise ValueError('Unknown main phase transfer')
 ref=binding['checkpoint']
 if not isinstance(ref,dict)or set(ref)!={'path','sha256','manifestSha256'}or checkpoint is None:raise ValueError('Explicit phase checkpoint required')
 actual=Path(checkpoint).resolve();expected=Path(ref['path']);destination=Path(directory).resolve()
 if not expected.is_absolute():raise ValueError('Absolute phase checkpoint required')
 path=expected.resolve()
 if path.parent.name!='checkpoints'or path.parent.parent==destination:raise ValueError('Phase transfer must use another owned pilot run checkpoint')
 if (destination/'latest.json').exists():
  # A later main-phase resume restores its own current checkpoint, while the
  # immutable transfer reference continues to identify the original pilot parent.
  latest=json.loads((destination/'latest.json').read_text())
  if actual!=Path(latest['checkpoint']).resolve()or not actual.is_relative_to(destination/'checkpoints')or digest(actual)!=latest['sha256']:raise ValueError('Main resume differs from explicit owned latest checkpoint')
 else:
  if actual!=path:raise ValueError('Initial main phase must restore its exact selected pilot checkpoint')
 if digest(path)!=ref['sha256']:raise ValueError('Phase checkpoint changed')
 source_dir=path.parent.parent;active_envelope(source_dir)
 original=json.loads((source_dir/'manifest.json').read_text());authorized={original['sha256']}
 journal=source_dir/'source-amendments.jsonl'
 if journal.exists():authorized.update(json.loads(line)['newManifest']for line in journal.read_text().splitlines()if line.strip())
 parent_hash=ref['manifestSha256']
 if parent_hash not in authorized:raise ValueError('Phase parent outside reviewed source lineage')
 record=original if original['sha256']==parent_hash else json.loads((source_dir/'manifests'/(parent_hash+'.json')).read_text())
 if record['sha256']!=parent_hash or hashlib.sha256(json.dumps(record['manifest'],sort_keys=True,allow_nan=False).encode()).hexdigest()!=parent_hash:raise ValueError('Phase parent manifest changed')
 origin=record['manifest'];meta=json.loads(path.with_suffix('.json').read_text());companion=json.loads(path.with_suffix('.runner.json').read_text())
 updates=companion['state'].get('updates');nonzero=companion['state'].get('nonzeroUpdates')
 if type(updates)is not int or type(nonzero)is not int or not 0<nonzero<=updates:raise ValueError('Impossible phase checkpoint optimization progress')
 if(meta['sha256']!=ref['sha256']or meta['manifestSha256']!=parent_hash or companion['checkpointSha256']!=ref['sha256']
    or companion['state']['updates']!=meta['updates']or companion['state'].get('nonzeroUpdates',0)<=0):raise ValueError('Phase checkpoint recovery progress mismatch')
 if record_architecture(origin)!=record_architecture(target)or record_architecture(meta)!=record_architecture(target)or record_recipe(origin)!=record_recipe(target)or record_recipe(meta)!=record_recipe(target):raise ValueError('Phase transfer changes architecture or training recipe')
 for key in ('seed','stage','config','configSha256','pilotRecipe','replaySeed','warmStart','productionCorpus','finalFamilies','roundDataBinding','explorationAdoption','dependencies','lockHashes','continuation'):
  if origin.get(key)!=target.get(key):raise ValueError('Phase transfer changes frozen model/data/initialization contract: '+key)
 before,after=origin['roundContract'],target['roundContract']
 for key in ('schema','kind','executionStartedAt','deadline','statePath','checkpointReserveSeconds'):
  if before.get(key)!=after.get(key):raise ValueError('Phase transfer resets original round: '+key)
 start,end=stamp(after['executionStartedAt']),stamp(after['deadline'])
 if (end-start!=ROUND_SECONDS or before['phase']!='pilot'or after['phase']!='main'
     or stamp(before['phaseDeadline'])>start+PILOT_SECONDS or stamp(after['phaseDeadline'])>end-RELEASE_RESERVE_SECONDS
     or not start<stamp(before['phaseDeadline'])<stamp(after['phaseDeadline'])):raise ValueError('Invalid planned phase boundaries')
 return binding
