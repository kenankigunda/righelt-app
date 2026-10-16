import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { createAccountController } from "../shell/account-controller.js";

const source = readFileSync(new URL("../shell/app.js", import.meta.url), "utf8");
const extract = (start, end) => {
  const from = source.indexOf(start), to = source.indexOf(end, from);
  assert.ok(from >= 0 && to > from, `shell source boundaries: ${start}`);
  return source.slice(from, to);
};
const gate = extract("const waitForAccountGate =", "const openBoardAccountGate =");
const action = extract("  if (action === 'opponent-story')", '  if (action === "create-game" ||');

// Integrate the real account adoption and shell continuation. Native modal/focus
// behavior and the actual bootstrap endpoint are covered by home-create-refresh.
for (const accountsRequired of [false, true]) {
  test(`initial session adoption finishes before the introduction opens (accounts=${accountsRequired})`, async () => {
    let release;
    const held = new Promise(resolve => { release = resolve; });
    const events = [];
    let open = false;
    const account = createAccountController({
      storage: null, eventTarget: null, document: null, channelFactory: null,
      fetcher: async url => {
        if (url.endsWith('/bootstrap')) {
          await held;
          return Response.json({ authProtocolVersion: 2, accountsRequired });
        }
        assert.equal(url, '/api/auth/session');
        return Response.json({ ok: true, authenticated: false });
      },
      onTransition: () => { open = false; events.push('retired'); },
    });
    const context = { account, window: { location: { hash: '#/' } },
      gameSound: { play() {} }, prepareOpponent() {},
      storyDialog: { open: opponent => { open = true; events.push(opponent); } },
      actionEl: { dataset: { opponent: 'babs' } } };
    runInNewContext(`${gate}\nglobalThis.open = async () => { const action = 'opponent-story'; ${action} };`, context);
    try {
      const startup = account.start();
      const opening = context.open();
      await Promise.resolve();
      assert.equal(open, false);
      release();
      await Promise.all([startup, opening]);
      assert.equal(account.snapshot().ready, true);
      assert.equal(account.snapshot().session.authenticated, false);
      assert.equal(open, true, "informational introduction does not require signing in");
      assert.deepEqual(events, accountsRequired ? ['babs'] : ['retired', 'babs']);
    } finally { release(); account.destroy(); }
  });
}

test("navigation during initial session adoption cancels the old introduction", async () => {
  let release;
  const held = new Promise(resolve => { release = resolve; });
  const account = createAccountController({
    storage: null, eventTarget: null, document: null, channelFactory: null,
    fetcher: async () => { await held; return Response.json({ authProtocolVersion: 2, accountsRequired: false }); },
  });
  const events = [];
  const context = { account, window: { location: { hash: '#/' } },
    gameSound: { play: () => events.push('sound') }, prepareOpponent: () => events.push('prepare'),
    storyDialog: { open: () => events.push('open') }, actionEl: { dataset: { opponent: 'babs' } } };
  runInNewContext(`${gate}\nglobalThis.open = async () => { const action = 'opponent-story'; ${action} };`, context);
  try {
    const opening = context.open();
    context.window.location.hash = '#/tutorial';
    release();
    await opening;
    assert.deepEqual(events, []);
  } finally { release(); account.destroy(); }
});
