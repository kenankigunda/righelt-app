import test from "node:test";
import assert from "node:assert/strict";
import { getGameResult, createResultTransitions, createRematchDialog } from "../shell/game-result.js";
const game = (status = "ongoing") => ({ id: "g", player1: { identityId: "red" }, player2: { identityId: "blue" }, board: { state: { outcome: { status, reason: "p2_commander_unsupplied" } } } });
test("results use authoritative outcome and selected self-play side, with swapped rematch side", () => {
  assert.equal(getGameResult(game(), "red"), null);
  assert.equal(getGameResult(game("p1_win"), "red").title, "You won");
  assert.equal(getGameResult(game("p1_win"), "blue").title, "Your opponent won");
  assert.equal(getGameResult(game("p1_win"), "viewer").title, "Player 1 wins");
  assert.equal(getGameResult(game("draw"), "blue").title, "Draw");
  const self = { ...game("p1_win"), selfPlayMode: true, selfPlayStartSide: "p2", currentSnapshot: { outcome: { status: "ongoing" } } };
  assert.equal(getGameResult(self, "viewer").title, "Player 1 wins");
  assert.equal(getGameResult(self, "viewer").side, null);
  assert.deepEqual(getGameResult(self, "red"), { title: "Your opponent won", side: "p2", winner: "p1", tone: "defeat", reason: "Your commander lost its supply.", opponent: "self", rematchSide: "p1" });
});
test("result automatic entry happens once on an observed live finish, never hydration/history/hidden/story", () => {
  const tracker = createResultTransitions();
  assert.equal(tracker.observe(game("p1_win")), false);
  tracker.clear(); assert.equal(tracker.observe(game()), false);
  assert.equal(tracker.observe(game("p1_win")), true);
  assert.equal(tracker.observe(game("p1_win")), false);
  for (const option of ["inHistory", "hidden", "storyOpen"]) {
    tracker.clear(); tracker.observe(game());
    assert.equal(tracker.observe(game("draw"), { [option]: true }), false);
    assert.equal(tracker.observe(game("draw")), false);
  }
});

test('actual defeat causes remain distinct and legacy push results are interpreted without rewriting history',()=>{
 const captured={...game('p1_win'),board:{state:{outcome:{status:'p1_win',reason:'p2_commander_destroyed'},pieces:[{id:'C1',supplied:true}]}}};
 assert.equal(getGameResult(captured,'red').reason,'Your opponent’s commander was destroyed.');
 assert.equal(getGameResult(captured,'red').tone,'victory');assert.equal(getGameResult(captured,'blue').tone,'defeat');assert.equal(getGameResult(captured,'viewer').tone,'neutral');
 const legacy=structuredClone(captured);legacy.board.state.outcome.reason='p2_commander_unsupplied';const original=structuredClone(legacy);
 assert.equal(getGameResult(legacy,'red').reason,'Your opponent’s commander was destroyed.');assert.deepEqual(legacy,original);
 legacy.board.state.pieces.push({id:'C2',supplied:false});assert.equal(getGameResult(legacy,'red').reason,'Your opponent’s commander lost its supply.');
 assert.equal(getGameResult(game('draw'),'red').tone,'draw');
 const watch={...captured,computer:{seats:{p1:'tau',p2:'horus'},manual:false}};assert.equal(getGameResult(watch,'red').tone,'neutral');
});


test("cancelled rematch gate cannot create or close a reopened dialog", async () => {
  let click, release, created = 0;
  const nodes = { "[name=rematch-opponent]:checked": { value: "self" }, "[name=rematch-side]:checked": { value: "p2" }, "[data-rematch-start]": { dataset: {}, setAttribute() {}, removeAttribute() {} }, "[role=status]": {} };
  const element = { open: false, dataset: {}, querySelector: selector => nodes[selector], addEventListener: (_, fn) => { click = fn; } };
  const createModal = ({ onClose }) => ({ element, open() { element.open = true; }, close() { element.open = false; onClose(); } });
  const gate = new Promise(resolve => { release = resolve; });
  const dialog = createRematchDialog({ createModal, onStart: async (_intent, { isCurrent }) => { await gate; if (isCurrent()) created++; } });
  dialog.open({ opponent: "self", rematchSide: "p2" });
  const pending = click({ target: { closest: selector => selector === '[data-rematch-start]' } });
  dialog.close(); dialog.open({ opponent: "friend", rematchSide: "p1" });
  release(); await pending;
  assert.equal(created, 0); assert.equal(element.open, true);
});

test('spectators of computer games see a neutral winner', () => {
  const played = { ...game('p1_win'), computer: { seats: { p1: null, p2: 'horus' }, manual: false } };
  assert.equal(getGameResult(played, 'red').title, 'You won');
  assert.equal(getGameResult(played, 'spectator').title, 'Player 1 wins');
  assert.equal(getGameResult(played, null).side, null);
});


test('rematch and branch entry require readiness, expose retry and keep manual choices usable', async () => {
  for (const title of ['Play again', 'Create a new game here']) {
    const handlers = {}, changes = [], starts = [];
    let readiness = { state: 'preparing', message: 'Preparing' }, closes = 0;
    const controls = [{}, {}];
    const nodes = { '[name=rematch-opponent]:checked': { value: 'babs' }, '[name=rematch-side]:checked': { value: 'p2' }, '[data-rematch-start]': { dataset: {}, setAttribute() {} }, '[role=status]': { dataset: {} }, '[data-rematch-retry]': {}, '[data-rematch-friend-help]': {} };
    const element = { open: false, dataset: {}, querySelector: selector => nodes[selector], querySelectorAll: () => controls, addEventListener: (event, fn) => { handlers[event] = fn; } };
    const createModal = ({ onClose }) => ({ element, open() { element.open = true; }, close() { element.open = false; onClose(); } });
    const dialog = createRematchDialog({ title, createModal, getReadiness: opponent => opponent === 'friend' ? { state: 'ready' } : readiness, onOpponentChange: opponent => changes.push(opponent), onRetry: () => { readiness = { state: 'preparing' }; }, onClose: () => { closes++; }, onStart: intent => starts.push(intent) });
    const click = selector => handlers.click({ target: { closest: match => match === selector } });
    dialog.open({ opponent: 'babs', rematchSide: 'p2' });
    assert.equal(nodes['[data-rematch-friend-help]'].hidden, true);
    assert.deepEqual(changes, ['babs']); assert.equal(nodes['[data-rematch-start]'].disabled, true);
    await click('[data-rematch-start]'); assert.equal(starts.length, 0);
    readiness = { state: 'error', message: 'Try again' }; dialog.refresh();
    assert.equal(nodes['[data-rematch-retry]'].hidden, false);
    await click('[data-rematch-retry]'); assert.equal(nodes['[data-rematch-start]'].disabled, true);
    readiness = { state: 'ready', message: 'Ready' }; dialog.refresh();
    assert.equal(nodes['[data-rematch-start]'].disabled, false);
    // Readiness can be revoked between paint and activation.
    readiness = { state: 'preparing' }; await click('[data-rematch-start]'); assert.equal(starts.length, 0);
    nodes['[name=rematch-opponent]:checked'].value = 'friend'; handlers.change({ target: { name: 'rematch-opponent' } });
    assert.equal(nodes['[data-rematch-friend-help]'].hidden, false);
    nodes['[name=rematch-opponent]:checked'].value = 'self'; handlers.change({ target: { name: 'rematch-opponent' } });
    assert.equal(nodes['[data-rematch-friend-help]'].hidden, true);
    nodes['[name=rematch-opponent]:checked'].value = 'friend'; handlers.change({ target: { name: 'rematch-opponent' } });
    assert.equal(nodes['[data-rematch-start]'].disabled, false);
    await click('[data-rematch-start]'); assert.deepEqual(starts, [{ opponent: 'friend', side: 'p2' }]); assert.equal(closes, 1);
  }
});

test('failed Start stays static through transport readiness refreshes until explicit retry',async()=>{
 const handlers={},controls=[];
 let readiness={state:'ready',message:''},attempts=0,release;
 const retry=new Promise(resolve=>release=resolve);
 const nodes={'[name=rematch-opponent]:checked':{value:'self'},'[name=rematch-side]:checked':{value:'p1'},'[data-rematch-start]':{dataset:{},setAttribute(){}},'[role=status]':{dataset:{}},'[data-rematch-retry]':{},'[data-rematch-friend-help]':{}};
 const element={open:false,dataset:{},querySelector:selector=>nodes[selector],querySelectorAll:()=>controls,addEventListener:(event,fn)=>handlers[event]=fn};
 const createModal=({onClose})=>({element,open(){element.open=true;},close(){element.open=false;onClose();}});
 const dialog=createRematchDialog({createModal,getReadiness:()=>readiness,onStart:async()=>{attempts++;if(attempts===1)throw Error('rejected');await retry;}});
 const click=()=>handlers.click({target:{closest:selector=>selector==='[data-rematch-start]'}});
 dialog.open({opponent:'self',rematchSide:'p1'});await click();
 const status=nodes['[role=status]'];
 assert.equal(status.textContent,'Could not start. Try again.');
 for(const state of ['ready','preparing','ready']){
  readiness={state,message:state==='preparing'?'Updating this game':''};dialog.refresh();
  assert.equal(status.textContent,'Could not start. Try again.');
  assert.equal(status.dataset.loadingState,'idle','Failure never inherits a processing pulse');
  assert.equal(nodes['[data-rematch-start]'].disabled,state!=='ready');
 }
 const pending=click();assert.equal(attempts,2);assert.equal(status.textContent,'');
 assert.equal(nodes['[data-rematch-start]'].disabled,true);release();await pending;
 assert.equal(element.open,false);
 dialog.open({opponent:'self',rematchSide:'p1'});assert.equal(status.textContent,'');
});
