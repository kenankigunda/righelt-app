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
 assert.equal(renderComputerProgress(game,{phase:'other-device',phaseElapsedMs:30000}), '');
 assert.match(renderComputerProgress(game,{phase:'idle',activity:{showRecoveryNotice:true}}), /Tau hasn’t resumed/);
 assert.match(renderComputerProgress(game,{phase:'idle',activity:{showRecoveryNotice:true}}), /Resume here/);
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


test('routine status stays on the board; delayed recovery has no progress bar or timer', () => {
 const game={id:'g',computer:{seats:{p1:null,p2:'tau'},modelId:CURRENT_COMPUTER_MODEL.id,takeoverTurn:null},canControlComputer:true,computerTurn:'tau'};
 for (const phase of ['checking','looking-ahead','saving','preparing','initializing-verified-runtime']) {
  const html=renderComputerProgress(game,{phase,elapsedMs:60000,phaseElapsedMs:60000,progress:{completed:40,total:100}});
  assert.doesNotMatch(html,/<progress|computer-progress|60s|40|100/);
  assert.match(html,phase==='saving'?/Saving the move is taking longer/:/Interrupt/);
 }
 assert.equal(renderComputerProgress({...game,canControlComputer:false},{phase:'checking'}),'');
 const pending={...game,computerTurn:null,pendingComputerProfile:'babs',pendingComputerSaveStartedAt:50000};
 assert.equal(renderComputerProgress(pending,{phase:'checking',elapsedMs:60000,phaseElapsedMs:60000,observedAt:59999}),'');
 assert.match(renderComputerProgress(pending,{phase:'checking',elapsedMs:60000,phaseElapsedMs:60000,observedAt:60000}),/Saving the move is taking longer/);
 const state={drafts:new Map(),notes:[],attempts:new Map(),open:new Set(),items:[]};
 assert.match(renderDecisionDebug({game:{...game,currentSnapshot:{}},status:{phase:'checking',phaseElapsedMs:765},state,signedIn:false}),/<dt>Computer phase<\/dt><dd>checking<\/dd><dt>Phase elapsed \(ms\)<\/dt><dd>765<\/dd>/);
});


test('pending save recovery remains actionable immediately, with its separate clock only in debug', () => {
 const game={id:'g',pendingComputerSaveStartedAt:100,canControlComputer:true,computer:{seats:{p1:'tau',p2:null},modelId:CURRENT_COMPUTER_MODEL.id},currentSnapshot:{}};
 const status={phase:'recovery',phaseElapsedMs:17,profile:'tau',observedAt:700};
 const html=renderComputerProgress(game,status);assert.match(html,/Retry/);assert.doesNotMatch(html,/Saving the move|progress|600ms/);
 const state={drafts:new Map(),notes:[],attempts:new Map(),open:new Set(),items:[]};
 const debug=renderDecisionDebug({game,status,state,signedIn:false});
 assert.match(debug,/<dt>Computer phase<\/dt><dd>recovery<\/dd>/);assert.match(debug,/<dt>Pending save elapsed \(ms\)<\/dt><dd>600<\/dd>/);
});


test('shared stalled-turn eligibility offers friendly recovery without device internals',()=>{
 const game={id:'remote',computer:{seats:{p1:null,p2:'tau'},modelId:CURRENT_COMPUTER_MODEL.id},canControlComputer:true,computerTurn:'tau'};
 assert.equal(renderComputerProgress(game,{phase:'other-device',phaseElapsedMs:29999}), '');
 assert.equal(renderComputerProgress(game,{phase:'other-device',phaseElapsedMs:30000}), '');
 const html=renderComputerProgress(game,{phase:'idle',activity:{showRecoveryNotice:true}});
 assert.match(html,/Tau hasn’t resumed/);assert.match(html,/data-control="resume-here"/);assert.match(html,/Resume here/);
 assert.match(html,/data-notification-activity="static"/);assert.doesNotMatch(html,/device|lease|worker|Interrupt|Continue play/);
 assert.equal(renderComputerProgress({...game,canControlComputer:false},{phase:'idle',activity:{showRecoveryNotice:true}}),'');
 const update=renderComputerProgress({...game,computerTurn:null,computer:{...game.computer,modelId:'previous'}},{phase:'idle'});
 assert.match(update,/An opponent update is available/);assert.match(update,/Update opponent/);assert.match(update,/Keep current/);
 assert.doesNotMatch(update,/new computer model|Use new model/);
});
