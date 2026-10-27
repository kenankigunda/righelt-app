import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {buildScenarioFromGame,buildHistoryBranchSeedFromGame,loadScenarioCatalog} from '../shell/scenarios.js';
import {isValidScenarioShape} from '../../../scripts/dev-web-auto.mjs';
import {asScenarioRecord,applyScenarioToGame,createInitialGame,exportScenarioFromGame,applyServerAction} from '../../../packages/api-handler/src/shell-live-core.ts';
import {CURRENT_RETREAT_SEMANTICS,LEGACY_RETREAT_SEMANTICS,equivalentGameStates} from '../../../packages/game-engine/src/index.ts';
const f=JSON.parse(readFileSync(new URL('../../../packages/game-engine/test/fixtures/completion-preserving-retreat.json',import.meta.url),'utf8'));
const raw=()=>({formatVersion:2,id:'0066b0ed-c5ba-4a89-a81a-1811d08d2d9d',title:'Retained retreat',description:'Retained retreat',initialState:structuredClone(f.states.prePush),moves:[
 {turnIndex:f.states.prePush.turnIndex,turnMoveIndex:0,actorSide:'P2',notation:'Push',action:f.push.action,retreatSemantics:CURRENT_RETREAT_SEMANTICS},
 {turnIndex:f.states.afterPush.turnIndex,turnMoveIndex:1,actorSide:'P1',notation:'Retreat',action:f.retreat.action,retreatSemantics:LEGACY_RETREAT_SEMANTICS},
],resultingState:structuredClone(f.states.afterRetreat),expectedFinalStateHash:f.retreat.afterHash,expectedOutcome:'ongoing'});

test('catalog import/export preserves mixed per-move semantics and original stranded history',async()=>{
 const source=raw(),original=structuredClone(source),parsed=asScenarioRecord(source);
 assert.ok(parsed);const game=createInitialGame({gameId:'g',identityId:'owner',selfPlayMode:true});
 applyScenarioToGame(game,parsed);
 assert.equal(equivalentGameStates(game.board.state,source.resultingState),true);
 assert.deepEqual(game.moves.map(move=>move.action),source.moves.map(move=>move.action));
 const api=exportScenarioFromGame(game,{scenarioId:source.id,title:source.title,description:source.description,moveLimit:game.moves.length});
 const browser=await buildScenarioFromGame(game,{scenarioId:source.id,title:source.title,description:source.description});
 for(const exported of [api,browser])assert.deepEqual(exported.moves.map(move=>move.retreatSemantics),[CURRENT_RETREAT_SEMANTICS,LEGACY_RETREAT_SEMANTICS]);
 assert.deepEqual(source,original);
 const branch=buildHistoryBranchSeedFromGame(game,1);
 assert.equal(branch.scenario.moves[0].retreatSemantics,CURRENT_RETREAT_SEMANTICS);
 assert.deepEqual(branch.scenario.moves[0].action,f.push.action);
});

test('unversioned old catalog stays historical while live submission cannot select that interpretation',()=>{
 const source=raw();delete source.moves[1].retreatSemantics;
 const parsed=asScenarioRecord(source);assert.ok(parsed);assert.equal('retreatSemantics' in parsed.moves[1],false);
 const game=createInitialGame({gameId:'g',identityId:'owner',selfPlayMode:true});applyScenarioToGame(game,parsed);
 assert.equal(equivalentGameStates(game.board.state,source.resultingState),true);
 const live=createInitialGame({gameId:'live',identityId:'owner',selfPlayMode:true});
 const prefix={...raw(),moves:raw().moves.slice(0,1),resultingState:f.states.afterPush};applyScenarioToGame(live,asScenarioRecord(prefix));
 assert.equal(applyServerAction(live,f.retreat.action).ok,false);
});

for(const value of [null,'unknown-retreat'])test(`catalog layers reject ${String(value)} provenance instead of stripping it`,async t=>{
 const source=raw();source.moves[1].retreatSemantics=value;
 assert.equal(asScenarioRecord(source),null);assert.equal(isValidScenarioShape(source),false);
 const previous=globalThis.fetch;t.after(()=>{globalThis.fetch=previous;});
 globalThis.fetch=async()=>Response.json({scenarios:[source]});
 await assert.rejects(loadScenarioCatalog(),/Unknown archived retreat semantics/);
});
