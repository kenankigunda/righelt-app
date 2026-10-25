import test from 'node:test';
import assert from 'node:assert/strict';
import { renderDecisionDebug, renderComputerProgress } from '../shell/computer-view.js';
import { COMPUTER_PROFILES, CURRENT_COMPUTER_MODEL } from '../generated/packages/shared-types/src/computer-play.js';
import { computerBoardMessage } from '../shell/computer-narration.js';
import { renderBoardMessageSlot, updateComputerBoardLoading } from '../shell/board-message-layout.js';

test('client-reported search diagnostics cannot inject markup or break date rendering', () => {
 const state = { drafts: new Map(), notes: [], attempts: new Map(), open: new Set(), items: [], attemptPages: {
  computer: { items: [{ attemptId: 'reported', attempt: { startedAt: 'invalid date', result: { actions: [{ index: '<img src=x onerror=alert(1)>', visits: '<script>bad</script>', prior: 1, value: 0 }] } } }], cursor: null },
 }};
 const html = renderDecisionDebug({ game: null, status: {}, state, signedIn: true });
 assert.doesNotMatch(html, /<img|<script>/);
 assert.match(html, /&lt;img/); assert.match(html, /Unavailable/);
 state.attemptPages.computer.items[0].attempt.result.actions = { unexpected: 'shape' };
 assert.doesNotThrow(() => renderDecisionDebug({ game: null, status: {}, state, signedIn: true }));
 const nonPrimitive = JSON.parse('{"toString":null,"valueOf":null}');
 state.attemptPages.computer.items[0].attempt = { startedAt: nonPrimitive, outcome: nonPrimitive, result: { action: {type: nonPrimitive, actorId: nonPrimitive, from: {row: nonPrimitive, col: nonPrimitive}}, value: nonPrimitive, actions: [{index: nonPrimitive, visits: nonPrimitive, prior: nonPrimitive, value: nonPrimitive, immediate: nonPrimitive, tactical: nonPrimitive}] } };
 assert.doesNotThrow(() => renderDecisionDebug({ game: null, status: {}, state, signedIn: true }));
 assert.match(renderDecisionDebug({ game: null, status: {}, state, signedIn: true }), /Unavailable/);
});

test('guest debug offers public computer searches without private account tools', () => {
 const state={drafts:new Map(),notes:[],attempts:new Map(),open:new Set(),items:[]};
 const html=renderDecisionDebug({game:null,status:{},state,signedIn:false});
 assert.match(html,/data-kind="computer"/);
 assert.doesNotMatch(html,/data-kind="analysis"|data-action="debug-save-note"|data-action="debug-analyze"/);
});

test('computer recovery controls wait for their own phase thresholds', () => {
 const game={id:'g',computer:{seats:{p1:null,p2:'tau'},modelId:'initial-1554',takeoverTurn:null},canControlComputer:true,computerTurn:'tau'};
 assert.equal(renderComputerProgress(game,{phase:'looking-ahead',elapsedMs:29999}), '');
 assert.match(renderComputerProgress(game,{phase:'looking-ahead',elapsedMs:30000}), /Interrupt/);
 assert.equal(renderComputerProgress(game,{phase:'saving',elapsedMs:60000,phaseElapsedMs:9999}), '');
 const slowSave=renderComputerProgress(game,{phase:'saving',elapsedMs:60000,phaseElapsedMs:10000});
 assert.match(slowSave,/Saving the move is taking longer/);assert.doesNotMatch(slowSave,/Interrupt/);
 assert.match(renderComputerProgress(game,{phase:'recovery',elapsedMs:0}),/Retry/);
 assert.equal(renderComputerProgress(game,{phase:'other-device',phaseElapsedMs:29999}), '');
 assert.match(renderComputerProgress(game,{phase:'other-device',phaseElapsedMs:30000}), /Continue on this device/);
 assert.equal(renderComputerProgress({...game,computerTurn:null},{phase:'other-device',phaseElapsedMs:30000}), '');
});

test('every profile keeps plain board copy and a persistent cue while ordinary external progress stays quiet',()=>{
 for(const [profile,{name}] of Object.entries(COMPUTER_PROFILES)){
  const game={id:'thinking-game',gameplayRevision:7,canControlComputer:true,computerTurn:profile,computer:{seats:{p1:profile,p2:null},modelId:CURRENT_COMPUTER_MODEL.id}};
  const cue={dataset:{},hasAttribute:()=>false};let key;
  for(const phase of ['preparing','checking','looking-ahead','initializing-verified-runtime','saving']){
   const status={profile,phase,attemptId:'thinking-attempt',detailed:false};
   assert.equal(renderComputerProgress(game,status),'',`${profile}/${phase} has no early external notice or CTA`);
   const message=computerBoardMessage(game,status);
   assert.equal(message,['preparing','initializing-verified-runtime'].includes(phase)?`Preparing ${name}`:`${name} is thinking`);
   assert.doesNotMatch(message,/…|\.\.\./);
   updateComputerBoardLoading(cue,game,status);
   assert.equal(cue.dataset.loadingState,'pending');
   key??=cue.dataset.loadingKey;assert.equal(cue.dataset.loadingKey,key,'phase changes keep the same loading operation');
  }
 }
 assert.match(renderBoardMessageSlot(),/class="board-message-activity" aria-hidden="true" data-loading-state="idle" data-loading-context="external"/);
});

test('human-readable profile versions omit the qualifier while raw evidence stays unchanged', () => {
 const proof={profile:'tau',profileVersion:'experimental-v1',modelId:'initial-1554',seed:107,attemptId:'attempt'};
 const game={id:'game',moves:[{moveId:'move',index:0,action:{type:'pass'},computerProof:proof}],currentSnapshot:{sideToMove:'P1',turnIndex:1}};
 const state={drafts:new Map(),notes:[],attempts:new Map(),open:new Set(['decision']),items:[]};
 const html=renderDecisionDebug({game,status:{},state,signedIn:false});
 assert.match(html,/<dt>Profile version<\/dt><dd>v1<\/dd>/);
 assert.equal(proof.profileVersion,'experimental-v1');
 assert.match(html,/&quot;profileVersion&quot;: &quot;experimental-v1&quot;/);
});
