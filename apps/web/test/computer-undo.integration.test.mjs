import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../shell/app.js', import.meta.url), 'utf8');
const start = source.indexOf('  if (action === "revert-to-move" || action === "undo-last-move")');
const end = source.indexOf('  if (action === "join-viewer"', start);
assert.ok(start > 0 && end > start);
const undo = new vm.Script(`(async () => {${source.slice(start, end)}})()`);
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

for (const boundary of ['pause', 'committed', 'acquire']) {
  test(`undo never continues in a different game or account after ${boundary}`, async () => {
    for (const change of ['game', 'account', 'transport', 'none']) {
      const held = deferred(), reached = deferred(), calls = [];
      const wait = async point => { if (point === boundary) { reached.resolve(); await held.promise; } };
      const game = { computer: { manual: true, lease: { deviceId: 'other-valid-lease' } }, canControlComputer: true };
      const transport = { getGameViewModel: () => game, requestRevertToMove: () => { calls.push('revert'); return { committed: wait('committed') }; } };
      const context = vm.createContext({
        action: 'undo-last-move', actionEl: { getAttribute: name => name === 'data-game-id' ? 'original' : 'move' },
        transport, account: { snapshot: () => ({ generation: context.generation }) }, generation: 1,
        viewedGame: 'original', getCurrentViewedGameId: () => context.viewedGame,
        computerSession: { action: async action => { calls.push(action); await wait(action); }, tick: async () => { calls.push('tick'); await wait('acquire'); } },
      });
      const result = undo.runInContext(context);
      await reached.promise;
      if (change === 'game') context.viewedGame = 'another-owned-game';
      if (change === 'account') context.generation++;
      if (change === 'transport') context.transport = { ...transport };
      held.resolve(); await result;
      assert.equal(calls.includes('resume'), change === 'none');
      if (change === 'none') assert.deepEqual(calls, ['pause', 'revert', 'tick', 'resume']);
      else if (boundary === 'pause') assert.deepEqual(calls, ['pause']);
      else if (boundary === 'committed') assert.deepEqual(calls, ['pause', 'revert']);
      else assert.deepEqual(calls, ['pause', 'revert', 'tick']);
    }
  });
}
