import test from 'node:test';
import assert from 'node:assert/strict';
import { probeTerminalSettlement } from '../../src/terminal-settlement.ts';
import { resolveToStability } from '../../src/resolve.ts';
import { deterministicStateHash } from '../../src/hash.ts';
import { serializeState, deserializeState } from '../../src/serialize.ts';
import { terminalPushFrame } from '../../src/terminal-push-frame.ts';
import { EngineComputationLimit, withEngineComputationGuard } from '../../src/computation-guard.ts';
import { commander, unit, makeState } from '../helpers/state-builders.mjs';

const pushFixture = (kind = 'commander', terminal = true) => {
  const defender = kind === 'commander'
    ? commander('C2', 'P2', 4, 5, { supplied: false, commanded: false, pushed: true, shifted: false })
    : unit('D', 'P2', 4, 5, { supplied: false, commanded: false, pushed: true, shifted: false });
  const pieces = [commander('C1', 'P1', 3, 6), unit('A', 'P1', 4, 5, { shifted: true }), defender];
  if (kind === 'unit') {
    pieces.push(commander('C2', 'P2', terminal ? 4 : 6, terminal ? 4 : 3));
    if (terminal) pieces.push(unit('wall-n', 'P1', 3, 4), unit('wall-s', 'P1', 5, 4), unit('wall-w', 'P1', 4, 3));
  }
  const state = makeState({ sideToMove: 'P2', turnIndex: 4, pieces,
    continuation: { type: 'push', phase: 'retreat', owner: 'P2', attackerOwner: 'P1', pushedPieceId: defender.id,
      followPoint: { row: 4, col: 4 }, followGroupPieceIds: ['A'], chainLength: 1 } });
  return { state, push: { decisionId: 'acknowledged-physical-frame', frameHash: deterministicStateHash(state),
    action: { type: 'push', actorId: 'A', targetId: defender.id, from: { row: 4, col: 4 }, to: { row: 4, col: 5 } } } };
};
const refresh = input => { input.push.frameHash = deterministicStateHash(input.state); return input; };
const resolveCandidate = (state, excludedId) => {
  const value = structuredClone(state), removals = [];
  if (excludedId) value.pieces = value.pieces.filter(piece => piece.id !== excludedId);
  value.continuation = null;
  return { occupancy: resolveToStability(value, { artifactMode: 'full', onRemoval: event => removals.push(structuredClone(event)) }), removals };
};
const naiveClearPushed = state => {
  const value = structuredClone(state);
  value.continuation = null;
  for (const piece of value.pieces) piece.pushed = false;
  return resolveToStability(value, { artifactMode: 'full' });
};
const references = (value, found = new Set()) => {
  if (!value || typeof value !== 'object' || found.has(value)) return found;
  found.add(value);
  for (const child of Object.values(value)) references(child, found);
  return found;
};
const independent = (input, result) => {
  const seen = references(input);
  for (const value of [result.frame.recorded, result.frame.occupancy, result.frame.displacement, result.removals]) {
    const own = references(value);
    for (const ref of own) assert.equal(seen.has(ref), false, 'evidence groups never share mutable references');
    for (const ref of own) seen.add(ref);
  }
  if (result.frame.displacement) {
    const { action, piece } = result.frame.displacement;
    assert.notEqual(action.from, action.to);
    assert.notEqual(action.from, piece.position);
    assert.notEqual(action.to, piece.position);
  }
};
const canonical = result => {
  const bytes = serializeState(result.frame.occupancy), restored = deserializeState(bytes);
  assert.equal(serializeState(restored), bytes);
  assert.equal(deterministicStateHash(restored), deterministicStateHash(result.frame.occupancy));
  assert.deepEqual(restored.terminalDisplacement, result.frame.displacement);
};

if (process.env.RIGHELT_SETTLEMENT_BEHAVIOR_CONTROL === 'clear-pushed') {
  test('behavioral failing-first: generic clear-pushed must not resurrect the displaced commander', { timeout: 15000 }, () => {
    const { state } = pushFixture();
    const naive = naiveClearPushed(state);
    assert.equal(naive.pieces.find(piece => piece.id === 'C2').supplied, true, 'real resolver witness: displaced commander was resupplied');
    assert.equal(naive.outcome.status, 'p1_win', 'EXPECTED ASSERTION FAILURE: naive clear-pushed returns ongoing instead of the exclusion settlement');
  });
} else {
  test('commander exclusion defeats clear-pushed resurrection using the actual resolver', { timeout: 15000 }, () => {
    const input = pushFixture(), before = structuredClone(input);
    const naive = naiveClearPushed(input.state);
    assert.equal(naive.outcome.status, 'ongoing');
    const result = probeTerminalSettlement(input.state, input.push, { artifactMode: 'full' });
    assert.equal(result.kind, 'settled');
    assert.equal(result.persistable, true);
    assert.deepEqual(result.frame.occupancy.outcome, { status: 'p1_win', reason: 'p2_commander_destroyed' });
    assert.equal(result.frame.occupancy.pieces.some(piece => piece.id === 'C2'), false);
    assert.equal(result.frame.occupancy.pieces.filter(piece => piece.position.row === 4 && piece.position.col === 5).length, 1);
    assert.deepEqual(result.frame.displacement.piece, input.state.pieces.find(piece => piece.id === 'C2'));
    assert.deepEqual(result.frame.displacement.action, input.push.action);
    assert.equal(result.removals.some(event => event.piece.id === 'C2'), false, 'displacement is not destruction evidence');
    const expected = resolveCandidate(input.state, 'C2');
    assert.deepEqual(result.frame.occupancy.outcome, expected.occupancy.outcome);
    assert.deepEqual(result.removals, expected.removals);
    assert.deepEqual(result.frame.recorded, input.state);assert.deepEqual(input, before);
    independent(input, result);canonical(result);
  });

  test('ordinary defender cannot relay supply; resolved removals/statuses replace constructor occupancy', { timeout: 15000 }, () => {
    const input = pushFixture('unit');
    input.state.pieces.push(unit('R', 'P2', 0, 0), unit('corner-e', 'P1', 0, 1), unit('corner-s', 'P1', 1, 0));refresh(input);
    const before = structuredClone(input), expected = resolveCandidate(input.state, 'D');
    const naive = naiveClearPushed(input.state);
    assert.equal(naive.pieces.find(piece => piece.id === 'C2').supplied, true, 'ordinary displaced defender can contaminate supply if resurrected');
    const result = probeTerminalSettlement(input.state, input.push, { artifactMode: 'full' });
    assert.equal(result.kind, 'settled');assert.equal(result.persistable, true);
    assert.equal(result.frame.occupancy.outcome.status, 'p1_win');
    assert.equal(result.frame.occupancy.pieces.find(piece => piece.id === 'C2').supplied, false);
    assert.equal(result.frame.occupancy.pieces.some(piece => piece.id === 'R'), false);
    assert.deepEqual(result.removals, expected.removals);
    assert.deepEqual(result.removals.map(event => [event.piece.id, event.reason]), [['R', 'loss_of_supply']]);
    assert.equal(result.removals[0].piece.supplied, false);
    assert.equal(result.frame.occupancy.pieces.some(piece => piece.id === 'D'), false);
    assert.equal(JSON.stringify(result.frame.occupancy.artifacts).includes('"D"'), false);
    const constructor = terminalPushFrame(input.state, expected.occupancy.outcome, input.push);
    assert.equal(constructor.kind, 'normalized');
    assert.equal(constructor.frame.occupancy.pieces.some(piece => piece.id === 'R'), true, 'constructor alone is not settled evidence');
    assert.deepEqual(input, before);assert.deepEqual(result.frame.recorded, before.state);
    independent(input, result);canonical(result);
    result.frame.occupancy.pieces[0].position.row = 0;
    result.removals[0].piece.position.row = 9;
    assert.deepEqual(result.frame.recorded, before.state);assert.deepEqual(input, before);
    assert.deepEqual(result.frame.displacement.piece, before.state.pieces.find(piece => piece.id === 'D'));
  });

  test('ongoing displaced evidence is nonpersistable, lossless and has no terminal metadata', { timeout: 15000 }, () => {
    const input = pushFixture('unit', false), before = structuredClone(input);
    const result = probeTerminalSettlement(input.state, input.push, { artifactMode: 'full' });
    assert.equal(result.kind, 'settled');assert.equal(result.persistable, false);
    assert.equal(result.frame.occupancy.outcome.status, 'ongoing');
    assert.equal('terminalDisplacement' in result.frame.occupancy, false);
    assert.deepEqual(result.frame.occupancy, resolveCandidate(input.state, 'D').occupancy);
    assert.deepEqual(result.frame.displacement.action, input.push.action);
    assert.deepEqual(result.frame.displacement.piece, input.state.pieces.find(piece => piece.id === 'D'));
    assert.deepEqual(result.frame.recorded, before.state);assert.deepEqual(input, before);
    independent(input, result);
  });

  for (const terminal of [false, true]) {
    test(`ordinary ${terminal ? 'terminal' : 'ongoing'} settlement matches clone plus real resolver without applying an action`, { timeout: 15000 }, () => {
      const pieces = [commander('C1', 'P1', 3, 6), commander('C2', 'P2', 6, 3), unit('R', 'P2', 0, 0), unit('corner-e', 'P1', 0, 1), unit('corner-s', 'P1', 1, 0)];
      if (terminal) pieces.push(unit('n', 'P2', 2, 6), unit('s', 'P2', 4, 6), unit('w', 'P2', 3, 5), unit('e', 'P2', 3, 7));
      const state = makeState({ sideToMove: 'P1', turnIndex: 17, pieces,
        continuation: { type: 'rush', owner: 'P1', chainLength: 1, rushedPieceIds: ['C1'], frozenOwner: 'P1', frozenPieceStatesById: { C1: { supplied: true, commanded: true } } } });
      const before = structuredClone(state), expected = resolveCandidate(state);
      const result = probeTerminalSettlement(state, undefined, { artifactMode: 'full' });
      assert.equal(result.kind, 'settled');assert.equal(result.persistable, terminal);
      assert.deepEqual(result.frame.occupancy, expected.occupancy);assert.deepEqual(result.removals, expected.removals);
      assert.equal(result.frame.occupancy.sideToMove, before.sideToMove);assert.equal(result.frame.occupancy.turnIndex, before.turnIndex);
      assert.equal(result.frame.occupancy.continuation, null);
      assert.equal(result.removals.some(event => event.piece.id === 'R' && event.reason === 'loss_of_supply'), true);
      assert.deepEqual(state, before);assert.deepEqual(result.frame.recorded, before);independent({ state }, result);
      if (terminal) canonical(result);
    });
  }

  const unsupported = [
    ['missing linkage', input => { input.push = undefined; }],
    ['wrong frame hash', input => { input.push.frameHash = '0'.repeat(64); }],
    ['empty decision', input => { input.push.decisionId = ''; }],
    ['wrong target', input => { input.push.action.targetId = 'not-defender'; }],
    ['wrong source', input => { input.push.action.from.row = 0; }],
    ['wrong target square', input => { input.push.action.to.row = 0; }],
    ['wrong retreat owner', input => { input.state.continuation.owner = 'P1'; }],
    ['wrong attacker owner', input => { input.state.continuation.attackerOwner = 'P2'; }],
    ['follow-phase overlap', input => { input.state.continuation.phase = 'follow'; }],
    ['duplicate attacker identity', input => { input.state.pieces.push(unit('A', 'P1', 1, 1)); }],
    ['duplicate defender identity', input => { input.state.pieces.push(unit('C2', 'P2', 1, 1)); }],
    ['another ordinary target occupant', input => { input.state.pieces.push(unit('collision', 'P1', 4, 5)); }],
    ['second pushed piece', input => { input.state.pieces.push(unit('other', 'P2', 1, 1, { pushed: true })); }],
    ['action extra', input => { input.push.action.extra = 'unsupported'; }],
    ['recursive action coordinate', input => { input.push.action.from.extra = input.push.action.from; }],
    ['recursive defender coordinate', input => { input.state.pieces[2].position.extra = input.state.pieces[2].position; }],
    ['recursive defender metadata', input => { input.state.pieces[2].extra = input.state.pieces[2]; }],
    ['nonboolean defender display flag', input => { input.state.pieces[2].displaySupplied = 'unsupported'; }],
  ];
  for (const [name, mutate] of unsupported) {
    test(`unsupported ${name} remains unknown and does not mutate its frame`, { timeout: 15000 }, () => {
      const input = pushFixture();mutate(input);const before = structuredClone(input);
      assert.deepEqual(probeTerminalSettlement(input.state, input.push), { kind: 'unknown', reason: 'unsupported' });
      assert.deepEqual(input, before);
    });
  }

  test('malformed push metadata is rejected before input hashing/cloning or resolver work', { timeout: 15000 }, () => {
    const input = pushFixture();input.push.action.extra = input.push.action;
    let reads = 0;
    Object.defineProperty(input.state, 'artifacts', { enumerable: true, get() { reads++;throw new Error('hash/clone must not start'); } });
    assert.equal(probeTerminalSettlement(input.state, input.push).kind, 'unknown');assert.equal(reads, 0);
  });

  test('ordinary collisions and unsupported pushed/nonoverlap frames stay unknown', { timeout: 15000 }, () => {
    const state = makeState({ pieces: [commander('C1', 'P1', 3, 6), commander('C2', 'P2', 6, 3), unit('overlap', 'P1', 3, 6)] });
    assert.equal(probeTerminalSettlement(state).kind, 'unknown');
    const input = pushFixture();input.state.pieces[2].pushed = false;
    assert.equal(probeTerminalSettlement(input.state, input.push).kind, 'unknown');
  });

  test('completed historical input stays unknown unchanged', { timeout: 15000 }, () => {
    const input = pushFixture();input.state.outcome = { status: 'p2_win', reason: 'historical' };const before = structuredClone(input);
    assert.equal(probeTerminalSettlement(input.state, input.push).kind, 'unknown');assert.deepEqual(input, before);
  });

  test('a genuinely removed attacker cannot widen the terminal displacement representation', { timeout: 15000 }, () => {
    const input = pushFixture();input.state.pieces.push(unit('n', 'P2', 3, 5), unit('s', 'P2', 5, 5), unit('w', 'P2', 4, 4), unit('e', 'P2', 4, 6));refresh(input);
    const expected = resolveCandidate(input.state, 'C2');
    assert.equal(expected.occupancy.outcome.status, 'p1_win');
    assert.equal(expected.removals.some(event => event.piece.id === 'A'), true);
    const before = structuredClone(input);
    assert.equal(probeTerminalSettlement(input.state, input.push).kind, 'unknown');assert.deepEqual(input, before);
  });

  test('typed guard interruption is unknown, never cached as negative evidence', { timeout: 15000 }, () => {
    const input = pushFixture();const before = structuredClone(input);let checks = 0;
    const interrupted = withEngineComputationGuard(() => { if (++checks === 3) throw new EngineComputationLimit(); }, () => probeTerminalSettlement(input.state, input.push));
    assert.deepEqual(interrupted, { kind: 'unknown', reason: 'rules_budget_exceeded' });assert.deepEqual(input, before);
    assert.equal(probeTerminalSettlement(input.state, input.push).kind, 'settled');
  });

  test('real resolver max-pass and non-typed dependency failures propagate', { timeout: 15000 }, () => {
    const input = pushFixture();
    assert.throws(() => probeTerminalSettlement(input.state, input.push, { maxPasses: 0 }), /resolveToStability exceeded max passes \(0\)/);
    const failure = new Error('Rules calculation exceeded its resource budget');let checks = 0;
    assert.throws(() => withEngineComputationGuard(() => { if (++checks === 2) throw failure; }, () => probeTerminalSettlement(input.state, input.push)), error => error === failure);
  });
}
