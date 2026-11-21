// Immutable production evidence becomes verified starts, never imitation labels.
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {createInitialState,deterministicStateHash,resolveToStability} from '../../packages/game-engine/src/index.ts';
import {encodeState,transition} from '../../packages/computer-player/src/index.ts';
import {transitionArchivedAction} from './archived-action.mjs';
import {archivedRetreatSemantics} from '../../packages/shared-types/src/retreat-rules.ts';
import {legacyCommanderReplayState} from './decision-replay.mjs';
import {createEngineOperationBudget} from './engine-operation-budget.mjs';
import {proveRelevantContinuation} from '../../packages/game-engine/src/early-ending-proof.ts';
import {probeTerminalSettlement} from '../../packages/game-engine/src/terminal-settlement.ts';

export const HELD_OUT_GAMES = Object.freeze([
  'game-13279b470a8f68382082d12268fcdb585a90',
  'game-8661089e1008698531149ffeba8e3e4b6b05',
]);
export const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function encodingHash(state) {
  const values=encodeState(state),bytes=Buffer.alloc(values.length*4);
  values.forEach((value,index)=>bytes.writeFloatLE(value,index*4));
  return createHash('sha256').update(bytes).digest('hex');
}
let sharedPrefixHashes;
export function sharedOpening(state) {
  if(!sharedPrefixHashes) {
    const initial=resolveToStability(createInitialState(),{artifactMode:'full'});
    sharedPrefixHashes=new Set([encodingHash(initial),encodingHash(transition(initial,{type:'pass'}))]);
  }
  return sharedPrefixHashes.has(encodingHash(state));
}

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

// Replay-only recognition of a recorded automatic rush ending. No synthetic
// End Turn is inserted. Both complete continuation proof and the exact retained
// physical board are required, and unknown proofs retain the quarantine.
export function replayProductionDecision(before,action,expected,bounded=operation=>operation(),retreatSemantics,options={}) {
  const next=transitionArchivedAction(before,action,bounded,retreatSemantics);
  try{return {state:exactRetainedState(next,expected,bounded),automaticEnding:null};}
  catch(error){
    if(next.outcome.status!=='ongoing'||expected.outcome.status==='ongoing'||next.continuation?.type!=='rush')throw error;
    const {expectedCause,...proofOptions}=options;
    const proof=bounded(()=>proveRelevantContinuation(next,next.continuation.owner,proofOptions));
    if(proof.kind!=='proven-terminal'||proof.complete!==true||proof.candidateOutcome.status!==expected.outcome.status)throw Error('Unverified production automatic ending');
    // Historical optional traversal counts are diagnostic, not finality identity.
    // The current complete proof, outcome, required endpoints and exact retained
    // settled board remain independently verified below.
    if(expectedCause?.kind!=='relevant-continuation-finality'||expectedCause.endpointCount!==proof.endpointCount)throw Error('Unverified production automatic ending cause');
    const settled=bounded(()=>probeTerminalSettlement(next,undefined,{artifactMode:expected.artifacts?.mode??'full'}));
    if(settled.kind!=='settled'||!settled.persistable)throw Error('Unverified production automatic settlement');
    const state=exactRetainedState(settled.frame.occupancy,expected,bounded);
    return {state,automaticEnding:{kind:proof.kind,visitedNodes:proof.visitedNodes,endpointCount:proof.endpointCount,exactStateHash:deterministicStateHash(state),causeVerified:true}};
  }
}

export function productionCorpus(games,decisions,{heldOut=HELD_OUT_GAMES,seconds=60}={}) {
  const deadline=performance.now()+seconds*1000;
  const check=()=>{if(performance.now()>=deadline)throw Error('Production replay deadline');};
  const {bounded,stats}=createEngineOperationBudget('replay',2048,check);
  const starts=[],reports=[];
  for(const game of games) {
    check();
    const retainedGame=JSON.parse(game.state_json);
    const rows=decisions.filter(d=>d.game_id===game.game_id)
      .sort((a,b)=>a.event_seq-b.event_seq || a.event_ordinal-b.event_ordinal);
    const partition=heldOut.includes(game.game_id)?'validation':'train';
    let current=null,verified=0;
    const known=new Map(),knownPaths=new Map(),moves=new Map(),candidates=[];
    let activePath=[];
    const remember=()=>{
      const hash=deterministicStateHash(current);known.set(hash,current);
      const previous=knownPaths.get(hash);
      knownPaths.set(hash,knownPaths.has(hash)&&JSON.stringify(previous)!==JSON.stringify(activePath)?null:activePath?.slice()??null);
    };
    const report={gameId:game.game_id,partition,verifiedDecisions:0,restorations:0,turns:0,excluded:[]};
    for(const row of rows) {
      check();const record=JSON.parse(row.payload_json);
      try {
        if(record.kind==='initial') {
          if(record.partial)throw Error('Partial production root');
          current=record.state;activePath=[];remember();
        } else if(record.kind==='decision') {
          const move=record.move;
          if(!current)throw Error('Unverified production lineage');
          exactRetainedState(current,move.selectionSnapshot,bounded);
          const before=current;
          const replayed=replayProductionDecision(before,move.action,move.snapshot,bounded,move.retreatSemantics,{expectedCause:retainedGame.terminalOutcome?.decisive?.decisionId===record.id?retainedGame.terminalOutcome.cause:undefined});
          current=replayed.state;
          if(replayed.automaticEnding){report.automaticEndings??=[];report.automaticEndings.push({recordId:record.id,...replayed.automaticEnding});}
          activePath=activePath?[...activePath,record.id]:null;
          remember();moves.set(record.id,move);verified++;
          if(before.outcome.status==='ongoing')candidates.push({
            gameId:game.game_id,decisionId:record.id,revision:record.revision,
            state:structuredClone(before),stateHash:deterministicStateHash(before),partition,
            encodingHash:encodingHash(before),sharedOpening:sharedOpening(before),
            category:before.continuation?.type??(move.displayMoveNumber===1?'opening':'ordinary'),
            historicalAction:move.action,historicalRetreatSemantics:archivedRetreatSemantics(move.retreatSemantics),computerProof:move.computerProof??null,
          });
        } else if(record.kind==='turn') {
          if(!current)throw Error('Unverified turn lineage');
          current=exactRetainedState(transitionArchivedAction(current,{type:'end_turn'},bounded),record.state,bounded);
          remember();report.turns++;
        } else if(record.kind==='finalization') {
          const move=moves.get(record.targetDecisionId);
          if(!move)throw Error('Finalization target absent');
          // Finalization updates the retained move after End Turn. The following
          // turn event advances chronological state; do not apply it twice.
          exactRetainedState(transitionArchivedAction(move.snapshot,{type:'end_turn'},bounded),record.finalizedMove.snapshot,bounded);
        } else if(record.kind==='restoration') {
          const restored=known.get(deterministicStateHash(record.state));
          if(!restored)throw Error('Restoration target not independently replayed');
          activePath=knownPaths.get(deterministicStateHash(record.state))?.slice()??null;
          current=restored;report.restorations++;
        } else throw Error('Unsupported production event '+record.kind);
      } catch(error) {
        report.excluded.push({recordId:record.id,kind:record.kind,reason:error.message});
        // Never restart trust from a later self-reported selection snapshot.
        // A restoration to an independently verified position can recover it.
        current=null;
        if(record.kind==='restoration')activePath=null;
      }
    }
    report.verifiedDecisions=verified;
    const live=retainedGame.board.state;
    report.currentStateVerified=!!current && deterministicStateHash(current)===deterministicStateHash(live);
    report.recordedOutcome=live.outcome;
    report.finalHash=current?deterministicStateHash(current):null;
    report.activeLineVerified=activePath!==null;
    const activeIds=new Set(activePath??[]);
    reports.push(report);starts.push(...candidates.map(p=>({...p,historyStatus:activePath===null?'unknown':activeIds.has(p.decisionId)?'active':'undone'})));
  }
  // Shared opening prefixes and identical positions cannot leak into training
  // from a second game. All withheld-position hashes take precedence.
  const withheld=new Set(starts.filter(x=>x.partition!=='train').map(x=>x.stateHash));
  const protectedEncodings=new Set(starts.filter(x=>x.partition!=='train'&&!x.sharedOpening).map(x=>x.encodingHash));
  const seen=new Set();const positions=starts.sort((a,b)=>(a.historyStatus==='active'?0:1)-(b.historyStatus==='active'?0:1)).filter(x=>{
    if(x.partition==='train' && (withheld.has(x.stateHash)||protectedEncodings.has(x.encodingHash)))return false;
    const key=x.partition+':'+x.stateHash;if(seen.has(key))return false;
    seen.add(key);return true;
  });
  const result={schema:1,kind:'production-starts-v1',heldOut:[...heldOut],reports,positions,
    evaluationScope:'Shared initial and single-Pass opening prefixes are labeled separately; unique withheld encodings are excluded from every learned replay source.',
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
