import test from 'node:test';
import assert from 'node:assert/strict';
import { renderComputerProgress, renderDecisionDebug } from '../shell/computer-view.js';
import { COMPUTER_PROFILES, CURRENT_COMPUTER_MODEL } from '../generated/packages/shared-types/src/computer-play.js';

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

test('every computer thinking label leaves ellipsis to the existing animated loading cue',()=>{
 for(const [profile,{name}] of Object.entries(COMPUTER_PROFILES))for(const phase of ['preparing','checking','looking-ahead','initializing-verified-runtime','saving']){
  const game={id:'thinking-game',gameplayRevision:7,canControlComputer:true,computerTurn:profile,computer:{seats:{p1:profile,p2:null},modelId:CURRENT_COMPUTER_MODEL.id}};
  const html=renderComputerProgress(game,{profile,phase,attemptId:'thinking-attempt',detailed:false});
  assert(html.includes(`>${name} is thinking</span>`),`${profile}/${phase} has plain thinking copy`);
  assert.doesNotMatch(html,/…|\.\.\./);
  assert.match(html,/<span role="status" data-loading-state="pending" data-loading-context="external" data-loading-key="computer:thinking-game:thinking-attempt">/);
 }
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
