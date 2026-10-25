// Immutable production evidence becomes verified starts, never imitation labels.
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {deterministicStateHash,resolveToStability} from '../../packages/game-engine/src/index.ts';
import {transitionArchivedAction} from './archived-action.mjs';
import {legacyCommanderReplayState} from './decision-replay.mjs';
import {createEngineOperationBudget} from './engine-operation-budget.mjs';

export const HELD_OUT_GAMES = Object.freeze([
  'game-13279b470a8f68382082d12268fcdb585a90',
  'game-8661089e1008698531149ffeba8e3e4b6b05',
]);
export const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');

export function exactRetainedState(actual,expected,bounded=operation=>operation()) {
  const hash=deterministicStateHash(expected);
  if(deterministicStateHash(actual)===hash)return actual;
  // Runtime search uses minimal artifacts; retained server snapshots carry full
  // artifacts. Recompute the expected representation from authoritative state,
  // never discard fields from the recorded snapshot to make a match pass.
  actual=bounded(()=>resolveToStability(actual,{artifactMode:expected.artifacts?.mode??'full'}));
  if(deterministicStateHash(actual)===hash)return actual;
  const retained=legacyCommanderReplayState(actual,hash);
  if(!retained)throw Error('Production replay state mismatch');
  return retained;
}

export function productionCorpus(games,decisions,{heldOut=HELD_OUT_GAMES,seconds=60}={}) {
  const deadline=performance.now()+seconds*1000;
  const check=()=>{if(performance.now()>=deadline)throw Error('Production replay deadline');};
  const {bounded,stats}=createEngineOperationBudget('replay',2048,check);
  const starts=[],reports=[];
  for(const game of games) {
    check();
    const rows=decisions.filter(d=>d.game_id===game.game_id)
      .sort((a,b)=>a.event_seq-b.event_seq || a.event_ordinal-b.event_ordinal);
    const partition=heldOut.includes(game.game_id)?'validation':'train';
    let current=null,verified=0;
    const known=new Map(),moves=new Map(),candidates=[];
    const report={gameId:game.game_id,partition,verifiedDecisions:0,restorations:0,turns:0,excluded:[]};
    for(const row of rows) {
      check();const record=JSON.parse(row.payload_json);
      try {
        if(record.kind==='initial') {
          if(record.partial)throw Error('Partial production root');
          current=record.state;known.set(deterministicStateHash(current),current);
        } else if(record.kind==='decision') {
          const move=record.move;
          if(!current)throw Error('Unverified production lineage');
          exactRetainedState(current,move.selectionSnapshot,bounded);
          const before=current;
          current=exactRetainedState(transitionArchivedAction(before,move.action,bounded),move.snapshot,bounded);
          known.set(deterministicStateHash(current),current);moves.set(record.id,move);verified++;
          if(before.outcome.status==='ongoing')candidates.push({
            gameId:game.game_id,decisionId:record.id,revision:record.revision,
            state:structuredClone(before),stateHash:deterministicStateHash(before),partition,
            category:before.continuation?.type??(move.displayMoveNumber===1?'opening':'ordinary'),
            historicalAction:move.action,computerProof:move.computerProof??null,
          });
        } else if(record.kind==='turn') {
          if(!current)throw Error('Unverified turn lineage');
          current=exactRetainedState(transitionArchivedAction(current,{type:'end_turn'},bounded),record.state,bounded);
          known.set(deterministicStateHash(current),current);report.turns++;
        } else if(record.kind==='finalization') {
          const move=moves.get(record.targetDecisionId);
          if(!move)throw Error('Finalization target absent');
          // Finalization updates the retained move after End Turn. The following
          // turn event advances chronological state; do not apply it twice.
          exactRetainedState(transitionArchivedAction(move.snapshot,{type:'end_turn'},bounded),record.finalizedMove.snapshot,bounded);
        } else if(record.kind==='restoration') {
          const restored=known.get(deterministicStateHash(record.state));
          if(!restored)throw Error('Restoration target not independently replayed');
          current=restored;report.restorations++;
        } else throw Error('Unsupported production event '+record.kind);
      } catch(error) {
        report.excluded.push({recordId:record.id,kind:record.kind,reason:error.message});
        // Never restart trust from a later self-reported selection snapshot.
        // A restoration to an independently verified position can recover it.
        current=null;
      }
    }
    report.verifiedDecisions=verified;
    const live=JSON.parse(game.state_json).board.state;
    report.currentStateVerified=!!current && deterministicStateHash(current)===deterministicStateHash(live);
    report.recordedOutcome=live.outcome;
    report.finalHash=current?deterministicStateHash(current):null;
    reports.push(report);starts.push(...candidates);
  }
  // Shared opening prefixes and identical positions cannot leak into training
  // from a second game. All withheld-position hashes take precedence.
  const withheld=new Set(starts.filter(x=>x.partition!=='train').map(x=>x.stateHash));
  const seen=new Set();const positions=starts.filter(x=>{
    if(x.partition==='train' && withheld.has(x.stateHash))return false;
    const key=x.partition+':'+x.stateHash;if(seen.has(key))return false;
    seen.add(key);return true;
  });
  const result={schema:1,kind:'production-starts-v1',heldOut:[...heldOut],reports,positions,
    engineBudget:stats,rawHistoricalPolicyTargets:false};
  return {...result,sha256:digest(result)};
}

if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  const [directory,output]=process.argv.slice(2);
  if(!directory||!output)throw Error('Usage: production-corpus.mjs SNAPSHOT_DIRECTORY OUTPUT');
  const manifest=JSON.parse(readFileSync(directory+'/manifest.json'));
  for(const name of ['games','decisions']) {
    const actual=createHash('sha256').update(readFileSync(directory+'/'+name+'.json')).digest('hex');
    if(actual!==manifest.files[name]?.sha256)throw Error('Production snapshot checksum mismatch: '+name);
  }
  const result=productionCorpus(JSON.parse(readFileSync(directory+'/games.json')),
    JSON.parse(readFileSync(directory+'/decisions.json')));
  writeFileSync(output,JSON.stringify(result,null,2)+'\n',{flag:'wx',mode:0o600});
  console.log(JSON.stringify({positions:result.positions.length,games:result.reports.length,
    exclusions:result.reports.reduce((n,r)=>n+r.excluded.length,0),sha256:result.sha256}));
}
