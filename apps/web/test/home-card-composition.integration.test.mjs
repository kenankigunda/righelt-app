import {normalizeStaticGameCard,buildStaticGameCardFromGame,buildStaticGameCardFromScenario} from '../shell/static-game-cards.js';
import {buildScenarioStaticPreviewModel} from '../shell/static-preview-model.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {scenarioPreviewStatus,createHomeCardRendering} from '../shell/home-card-rendering.js';
import {escapeDebug} from '../shell/computer-view.js';

function renderer(identityId = 'owner') {
  const registered = [];
  const rendering=createHomeCardRendering({
    getTransport:()=>({getIdentityId:()=>identityId}),
    toStableKey:JSON.stringify,escapeHtml:escapeDebug,
    buildGameHash:id=>`#/game/${id}`,getCurrentFlyoutState:()=>({}),
    formatClientDateTime:String,
    renderMiniBoardPreviewRoot:value=>{registered.push(value);return '<div data-mini-board-preview></div>';},
  });
  return {render:rendering.renderHomeGameCard,registered};
}

const snapshot = (status = 'ongoing') => ({sideToMove:'P2', pieces:[], outcome:{status}});
const card = (overrides = {}) => ({
  id:'same-game', eventSeq:8, gameplayRevision:3, confirmedOutcomeStatus:'ongoing',
  moveCount:4, createdAt:'2026-10-01', myRole:'Player 1', myRoles:['Player 1'],
  player1:{identityId:'owner', profile:{displayName:'<Kenan>'}, connected:true},
  player2:{identityId:'other', profile:{displayName:'Ada'}, connected:true},
  previewSnapshot:snapshot(), ...overrides,
});
const statusHtml = html => html.match(/<p class="small mini-board-preview-status">([\s\S]*?)<\/p>/)?.[1];

test('confirmed result and pending Undo retain quiet canonical identities, winner label color and Review game', () => {
  for (const manual of [false, true]) {
    const input = card({confirmedOutcomeStatus:'p2_win', pendingPreviewSnapshot:snapshot(),
      computer:{manual, seats:{p1:null,p2:'horus'}}});
    const before = structuredClone(input), h = renderer();
    const html = h.render(input);
    assert.match(html, /data-winner-side="p2"/);
    assert.match(html, /<div class="home-card-result"><strong class="player-tone-p2"><bdi>Horus won<\/bdi><\/strong><span class="small">You lost<\/span><\/div>/);
    assert.match(html, /<span class="small">You lost<\/span>/);
    assert.equal(statusHtml(html), 'Review game');
    assert.match(html, /<span class="sr-only">Red: <\/span><bdi dir="auto">You<\/bdi>/);
    assert.match(html, /<span class="sr-only">Blue: <\/span><bdi dir="auto">Horus<\/bdi>/);
    assert.doesNotMatch(html, /connection-status-icon|Computer player|to play/);
    assert.match(html, /4 moves/);
    assert.match(html, /Update pending/);
    assert.equal(h.registered.length, 1);
    assert.deepEqual(h.registered[0].snapshot, input.previewSnapshot);
    assert.deepEqual(input, before, 'rendering cannot change result, authority or control settings');
  }
});

// These original approved cases deliberately bypass normal Home normalization.
// They preserve the old raw-fixture fallback, not evidence of a native producer path.
for (const [label, overrides, expected] of [
  ['pending terminal with ongoing preview', {pendingPreviewSnapshot:snapshot('p1_win')}, 'Confirming result… · View game'],
  ['pending terminal with terminal preview', {pendingPreviewSnapshot:snapshot('p1_win'), previewSnapshot:snapshot('p1_win')}, 'Confirming result… · View game'],
  ['unknown acknowledged result', {confirmedOutcomeStatus:'future_status'}, 'Game status unavailable'],
  ['unacknowledged metadata', {eventSeq:null}, 'Game status unavailable'],
  ['missing preview', {previewSnapshot:null}, 'Snapshot unavailable'],
  ['terminal preview without confirmed result', {previewSnapshot:snapshot('p1_win')}, 'Blue to play'],
  ['unknown preview outcome', {previewSnapshot:snapshot('future_status')}, 'Blue to play'],
]) test(`actual Home renderer preserves plain status for ${label}`, () => {
  const input = card(overrides), before = structuredClone(input), h = renderer();
  const html = h.render(input);
  assert.equal(statusHtml(html), expected);
  assert.doesNotMatch(statusHtml(html), /<strong|player-tone-|<bdi>/);
  assert.doesNotMatch(html, /data-winner-side=|class="home-card-result/);
  assert.deepEqual(input, before);
});

test('only genuinely ongoing Home status uses the preview actor, retaining real names and nonvisual affiliation', () => {
  for (const manual of [false, true]) for (const pending of [false, true]) {
    const input = card({myRole:'Both Players', selfPlayMode:true,
      player2:{identityId:'owner', profile:{displayName:'<Kenan>'}, connected:false, computerProfile:'babs'},
      computer:{manual, seats:{p1:null,p2:'horus'}},
      ...(pending ? {pendingPreviewSnapshot:snapshot()} : {})});
    const before = structuredClone(input), h = renderer();
    const html = h.render(input);
    assert.equal(statusHtml(html), '<strong class="player-tone-p2"><span class="sr-only">Blue: </span><bdi>Horus</bdi></strong> to play');
    assert.match(html, /<span class="sr-only">Red: <\/span><bdi dir="auto">You<\/bdi>/);
    assert.match(html, /Computer player/);
    assert.doesNotMatch(html, /You play both sides|<bdi>Babs<\/bdi>|Review game|data-winner-side=/);
    assert.deepEqual(input, before, 'manual control and conflicting stale profile markers remain untouched');
  }
});

for(const status of ['p1_win','p2_win','draw','future_status'])test(`Home normalization refuses contradictory acknowledged ongoing and ${status} preview before rendering`,()=>{
 const raw=card({previewSnapshot:snapshot(status)}),before=structuredClone(raw);
 const normalized=normalizeStaticGameCard(raw);
 assert.equal(normalized.confirmedOutcomeStatus,null);
 const html=renderer().render(normalized);
 assert.equal(statusHtml(html),'Game status unavailable');assert.doesNotMatch(statusHtml(html),/to play|player-tone-|<bdi>/);
 assert.deepEqual(raw,before);
});

test('full-game Home producer takes both confirmed status and preview from the authoritative live snapshot',()=>{
 const ongoing=snapshot(),finished=snapshot('p2_win');
 for(const [live,display,expected] of [[finished,ongoing,'Review game'],[ongoing,finished,null]]){
  const game={...card(),liveCurrentSnapshot:live,board:{state:display}};
  const before=structuredClone(game),normalized=buildStaticGameCardFromGame(game,{eventSeq:8,confirmed:true});
  assert.equal(normalized.confirmedOutcomeStatus,live.outcome.status);assert.deepEqual(normalized.previewSnapshot,live);
  const html=renderer().render(normalized);
  if(expected){assert.equal(statusHtml(html),expected);assert.doesNotMatch(statusHtml(html),/to play/);}
  else assert.match(statusHtml(html),/<bdi>Ada<\/bdi><\/strong> to play/);
  assert.deepEqual(game,before);
 }
});

for(const status of ['p1_win','p2_win','draw','future_status'])test(`actual scenario preview ${status} never claims an active turn`,()=>{
 const scenario={id:'preview',initialState:snapshot(),resultingState:snapshot(status)},before=structuredClone(scenario);
 const model=buildScenarioStaticPreviewModel(scenario),normalized=buildStaticGameCardFromScenario(scenario);
 assert.equal(model.snapshot.outcome.status,status);assert.equal(normalized.previewSnapshot.outcome.status,status);
 for(const activeGame of [null,card(),card({confirmedOutcomeStatus:'p2_win'})]){
  const result=scenarioPreviewStatus(activeGame,model.snapshot);
  assert.equal(result.statusMarkup,null);assert.equal(result.statusText,status==='future_status'?'Preview status unavailable':'Preview finished');
  assert.doesNotMatch(result.statusText,/to play|won|winner/);
 }
 assert.deepEqual(scenario,before);
});

test('ongoing scenario preview names the preview actor without borrowing live turn authority',()=>{
 const scenario={id:'preview',initialState:snapshot()},model=buildScenarioStaticPreviewModel(scenario);
 const active=card({confirmedOutcomeStatus:'p1_win'}),before=structuredClone(active);
 const named=scenarioPreviewStatus(active,model.snapshot);
 assert.match(named.statusMarkup,/^Preview: .*Blue: <\/span><bdi>Ada<\/bdi><\/strong> to play$/);
 assert.equal(scenarioPreviewStatus(null,model.snapshot).statusText,'Preview: Blue to play');
 assert.equal(scenarioPreviewStatus(null,null).statusText,'Snapshot unavailable');
 assert.deepEqual(active,before);
});

// Literal expected labels and tones are independent of homeCardResult's implementation.
for (const [name, overrides, identityId, label, tone, detail] of [
  ['owned Red win', {confirmedOutcomeStatus:'p1_win'}, 'owner', 'You won', 'p1', null],
  ['owned Blue loss', {confirmedOutcomeStatus:'p2_win'}, 'owner', 'Ada won', 'p2', 'You lost'],
  ['viewer Red win', {confirmedOutcomeStatus:'p1_win',myRole:'Viewer'}, 'visitor', '&lt;Kenan&gt; won', 'p1', null],
  ['viewer Blue win', {confirmedOutcomeStatus:'p2_win',myRole:'Viewer'}, 'visitor', 'Ada won', 'p2', null],
  ['self-play Red win', {confirmedOutcomeStatus:'p1_win',myRole:'Both Players',selfPlayMode:true,player2:{identityId:'owner'}}, 'owner', 'Red won', 'p1', null],
  ['self-play Blue win', {confirmedOutcomeStatus:'p2_win',myRole:'Both Players',selfPlayMode:true,player2:{identityId:'owner'}}, 'owner', 'Blue won', 'p2', null],
  ['actual draw', {confirmedOutcomeStatus:'draw'}, 'owner', 'Draw', null, 'No winner'],
]) test(`completed Home result colors only its winning label: ${name}`, () => {
  const input=card(overrides), before=structuredClone(input);
  const html=renderer(identityId).render(input);
  const result=html.match(/<div class="home-card-result">([\s\S]*?)<\/div>/)?.[1];
  assert.ok(result, 'result container remains neutral');
  assert.equal(result, `<strong${tone ? ` class="player-tone-${tone}"` : ''}><bdi>${label}</bdi></strong>${detail ? `<span class="small">${detail}</span>` : ''}`);
  assert.equal(statusHtml(html),'Review game');
  assert.match(html, /<article class="mini-board-card"/);
  assert.match(html, /data-flyout-link="game"/);
  assert.match(html, /data-game-id="same-game"/);
  assert.deepEqual(input,before);
});
