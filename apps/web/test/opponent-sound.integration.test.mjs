import test from 'node:test';
import assert from 'node:assert/strict';
import { createLiveTransportStore } from '../shell/live-transport.js';
import { createGameSound } from '../shell/sound.js';
import { createInitialState } from '../generated/packages/game-engine/src/state.js';

const audioFixture = () => {
  const notes = [], timers = new Map(); let id = 0, hidden = false;
  const node = () => ({ connect() {}, disconnect() {}, frequency: {}, Q: {}, gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, start() {}, stop() {} });
  const audio = { state: 'running', currentTime: 0, sampleRate: 8000, createBuffer: (_, n) => ({ getChannelData: () => new Float32Array(n) }), createBufferSource: node, createBiquadFilter: node, createGain: node, createOscillator: () => { const n = node(); n.start = () => notes.push(n.frequency.value); return n; }, suspend: () => Promise.resolve(), resume: () => Promise.resolve() };
  const sound = createGameSound({ createAudio: () => audio, hidden: () => hidden, focused: () => true, setTimer: (fn, ms) => { timers.set(++id, { fn, ms }); return id; }, clearTimer: key => timers.delete(key) });
  sound.gesture();
  return { sound, notes, timers, hide: () => { hidden = true; sound.activityChanged(); }, show: () => { hidden = false; sound.activityChanged(); }, flush: () => { const pending = [...timers.values()]; timers.clear(); pending.forEach(timer => timer.fn()); } };
};
const move = id => ({ moveId: id, clientCommandId: id, actorSide: 'P2', action: { type: 'pass' } });
const game = (revision, moves) => ({ id: 'g', createdAt: '2026-10-30T00:00:00Z', updatedAt: '2026-10-30T00:00:00Z', gameplayRevision: revision, moves, turns: [], myRoles: ['Player 1'], board: { state: createInitialState() } });

test('real transport WS, HTTP refresh and reconciliation share one authoritative incoming sound boundary', async t => {
  const f = audioFixture(), storage = new Map(); let response = { game: game(0, []), eventSeq: 1 };
  const store = createLiveTransportStore({ storage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) }, fetcher: async () => new Response(JSON.stringify({ ...response, protocolVersion: 2, gameId: 'g', gameplayRevision: response.game.gameplayRevision, commandOutcomes: [] }), { headers: { 'Content-Type': 'application/json' } }) });
  t.after(() => store.retire());
  store.subscribe(change => { if (['authoritative_update', 'history_mode_changed'].includes(change.type)) f.sound.authoritative(store.getAuthoritativeGame(change.gameId), { sequence: store.getLastEventSeq(change.gameId) }); });
  store.applyLiveGameUpdate(response); assert.deepEqual(f.notes, []);
  response = { game: game(1, [move('a')]), eventSeq: 2 };
  await store.loadGame('g'); assert.deepEqual(f.notes, [820]);
  store.applyLiveGameUpdate(response); assert.deepEqual(f.notes, [820]);
  f.sound.observe({ ...response, type: 'event_appended', reason: 'move_recorded', clientCommandId: 'a' }, { opponentNotifications: false });
  assert.deepEqual(f.notes, [820]);
  response = { game: game(2, [move('a'), move('b')]), eventSeq: 3 };
  await store.reconcileGame('g'); f.flush(); assert.deepEqual(f.notes, [820, 820]);
});

test('foreground catch-up sounds each move, while mute, backgrounding and leaving cancel queued cues', () => {
  for (const cancel of ['toggle', 'hide', 'leaveGame']) {
    const f = audioFixture(); f.sound.authoritative(game(0, []));
    assert.equal(f.sound.authoritative(game(3, [move('a'), move('b'), move('c')])), true);
    assert.deepEqual(f.notes, [820]); assert.equal(f.timers.size, 2);f.sound.viewing({gameId:'g',live:true});
    if (cancel === 'hide') f.hide(); else f.sound[cancel]();
    assert.equal(f.timers.size, 0); f.flush(); assert.deepEqual(f.notes, [820]);
  }
  const f = audioFixture(); f.sound.authoritative(game(0, []));
  f.sound.authoritative(game(3, [move('a'), move('b'), move('c')])); f.flush();
  assert.deepEqual(f.notes, [820, 820, 820]);
});

test('computer optimistic publication never sounds or suppresses its authoritative opponent move', () => {
  const f = audioFixture(), computer = { ...game(0, []), computer: {}, myRoles: ['Player 1', 'Player 2'] };
  f.sound.authoritative(computer);
  assert.equal(f.sound.local({ gameId: 'g', type: 'optimistic_enqueue', clientCommandId: 'computer' }, { ...computer, currentSnapshot: computer.board.state, pendingComputerSaveStartedAt: 0 }), false);
  const current = { ...computer, gameplayRevision: 1, moves: [{ ...move('computer'), computerProof: { profile: 'babs' } }] };
  assert.equal(f.sound.authoritative(current), true); assert.deepEqual(f.notes, [820]);
  f.sound.observe({ game: current, eventSeq: 1, type: 'event_appended', reason: 'move_recorded', clientCommandId: 'computer' }, { opponentNotifications: false });
  assert.deepEqual(f.notes, [820]);
});

test('background authoritative moves retain one immediate incoming cue and one reminder loop', () => {
  const f = audioFixture(); f.sound.authoritative(game(0, [])); f.hide();
  f.sound.authoritative(game(1, [move('a')])); assert.deepEqual(f.notes, [460,690]); assert.equal(f.timers.size, 1);
  f.sound.authoritative(game(2, [move('a'), move('b')])); assert.deepEqual(f.notes, [460,690]); assert.equal(f.timers.size, 1);
  assert.equal([...f.timers.values()][0].ms, 30000); f.flush(); assert.deepEqual(f.notes, [460, 690, 460, 690]);
  f.show(); assert.equal(f.timers.size, 1);f.sound.viewing({gameId:'g',live:true});assert.equal(f.timers.size,0);
});

test('history and replay inspection receive an update chime while human acknowledgements stay quiet', () => {
  const f = audioFixture(), initial = game(0, []);
  f.sound.authoritative(initial);
  f.sound.local({ gameId: 'g', type: 'optimistic_enqueue', clientCommandId: 'human' }, { ...initial, currentSnapshot: initial.board.state });
  assert.deepEqual(f.notes, [820]);
  const human = { ...move('human'), actorSide: 'P1' };
  f.sound.authoritative(game(1, [human]));
  f.sound.observe({ game: game(1, [human]), eventSeq: 1, type: 'event_appended', reason: 'move_recorded', clientCommandId: 'human' }, { opponentNotifications: false });
  assert.deepEqual(f.notes, [820]);
  f.sound.authoritative({ ...game(2, [human, move('opponent')]), inHistoryMode: true, currentSnapshot: initial.board.state, replaying: true });
  assert.deepEqual(f.notes, [820, 460,690]);
  f.sound.toggle(); f.sound.authoritative(game(3, [human, move('opponent'), move('muted')]));
  f.sound.toggle(); f.sound.authoritative(game(3, [human, move('opponent'), move('muted')]));
  assert.deepEqual(f.notes, [820, 460,690]);
});

test('opponent terminal finalization sounds once when its move was already received', () => {
  const f = audioFixture(); f.sound.authoritative(game(0, []));
  const current = game(1, [move('opponent')]); f.sound.authoritative(current);
  const terminal = { ...current, gameplayRevision: 2, board: { state: { ...current.board.state, outcome: { status: 'p2_win' } } } };
  f.sound.authoritative(terminal); f.flush(); assert.deepEqual(f.notes, [820, 560]);
  f.sound.observe({ game: terminal, eventSeq: 2, type: 'event_appended', reason: 'turn_ended' }, { opponentNotifications: false });
  f.sound.authoritative(terminal); assert.deepEqual(f.notes, [820, 560]);
});

test('one unseen batch keeps its shared update chime through History and Players until live playback finishes',()=>{
 const f=audioFixture();f.sound.authoritative(game(0,[]));f.hide();const update=game(1,[move('a')]);f.sound.authoritative(update,{unseen:true});assert.deepEqual(f.notes,[460,690]);assert.equal(f.timers.size,1);
 f.show();f.sound.viewing({gameId:'g',live:false});f.sound.authoritative(update,{unseen:true});f.sound.viewing({gameId:'g',live:false});assert.deepEqual(f.notes,[460,690]);assert.equal(f.timers.size,1);
 f.flush();assert.deepEqual(f.notes,[460,690,460,690]);f.sound.viewing({gameId:'g',live:true,playbackFinished:false});assert.equal(f.timers.size,1);f.sound.viewing({gameId:'g',live:true,playbackFinished:true});assert.equal(f.timers.size,0);
 f.sound.authoritative(game(2,[move('a'),move('b')]),{unseen:true});assert.deepEqual(f.notes,[460,690,460,690,460,690]);assert.equal(f.timers.size,1);
});
test('computer receipt is silent until displayed movement, with identity dedupe and muted preference',()=>{
 const f=audioFixture(),initial={...game(0,[]),computer:{}};f.sound.authoritative(initial);const entry={...move('computer'),computerProof:{profile:'babs'},snapshot:initial.board.state},update={...game(1,[entry]),computer:{}};
 f.sound.authoritative(update,{deferComputer:true});assert.deepEqual(f.notes,[]);assert.equal(f.sound.displayed(entry,update),true);assert.equal(f.sound.displayed(entry,update),false);assert.deepEqual(f.notes,[820]);
 f.sound.toggle();f.sound.displayed({...entry,moveId:'muted'},update);assert.deepEqual(f.notes,[820]);
});

test('ordinary receipt observers cannot reset an unseen batch and replay its initial chime',()=>{
 const f=audioFixture();f.sound.authoritative(game(0,[]));const first=game(1,[move('a')]);f.sound.authoritative(first,{unseen:true});
 f.sound.observe({game:first,eventSeq:1,type:'event_appended',reason:'move_recorded',clientCommandId:'a'},{opponentNotifications:false,silent:false});
 const next=game(2,[move('a'),move('b')]);f.sound.observe({game:next,eventSeq:2,type:'event_appended',reason:'move_recorded',clientCommandId:'b'},{opponentNotifications:false,silent:false});f.sound.authoritative(next,{unseen:true});
 assert.deepEqual(f.notes,[460,690]);assert.equal(f.timers.size,1);
});
