import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { createAccountController, safeAccountIntent } from '../shell/account-controller.js';
import { createOpponentStoryDialog } from '../shell/opponent-stories.js';

// An explicit immutable source copy permits failing-first proof without
// replacing the candidate's working tree. CI always uses its actual app source.
const source = readFileSync(process.env.RIGHELT_STARTUP_REGRESSION_SOURCE
  || new URL('../shell/app.js', import.meta.url), 'utf8');
function extract(start, end) {
  const first = source.indexOf(start), last = source.indexOf(end, first);
  assert.ok(first >= 0 && last > first, `Missing application boundary: ${start}`);
  return source.slice(first, last);
}

function fixture() {
  let clock = 0, nextTimer = 0, transitions = 0, signIns = 0, routeSyncs = 0;
  const timers = new Map(), bootstrap = [], posts = [], nodes = new Map();
  const storage = new Map(), listeners = new Map();
  const trigger = { name: 'Friend' };
  const document = {
    hidden: false, activeElement: trigger, body: { append() {} },
    addEventListener() {}, removeEventListener() {}, querySelector: () => trigger,
    createElement: () => ({ setAttribute() {}, remove() {} }),
  };
  function node(selector) {
    if (!nodes.has(selector)) nodes.set(selector, {
      dataset: {}, setAttribute(name, value) { this[name] = value; },
      focus() { document.activeElement = this; },
    });
    return nodes.get(selector);
  }
  const element = {
    open: false, dataset: {},
    querySelector: node, querySelectorAll: () => [],
    addEventListener(name, callback) { listeners.set(name, callback); },
  };
  const createModal = ({ onClose }) => ({
    element,
    open(_markup, source) { element.open = true; element.trigger = source; node('[data-story-play]').focus(); },
    close(reason) { if (!element.open) return; element.open = false; onClose(reason); document.activeElement = element.trigger; },
    destroy() {},
  });
  const setTimeout = (callback, milliseconds) => {
    timers.set(++nextTimer, { callback, at: clock + milliseconds, milliseconds });
    return nextTimer;
  };
  const clearTimeout = id => timers.delete(id);
  let context;
  const account = createAccountController({
    storage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) },
    eventTarget: null, document: null, channelFactory: null,
    bootstrapTimers: { setTimeout, clearTimeout },
    onTransition() {
      transitions++;
      // DOM/transport reset boundary: real account adoption retires dialogs.
      context?.story.close();
    },
    fetcher: (url, init) => {
      if (url.endsWith('/bootstrap')) {
        let resolve;
        const promise = new Promise((yes, no) => {
          resolve = yes;
          init.signal.addEventListener('abort', () => no(Object.assign(new Error('aborted'), { name: 'AbortError' })), { once: true });
        });
        bootstrap.push({ resolve, signal: init.signal });
        // A redundant third bootstrap must actually settle and trigger the
        // real controller's guest retirement, not merely fail a call count.
        if (bootstrap.length > 2) resolve(Response.json({ authProtocolVersion: 2, accountsRequired: false }));
        return promise;
      }
      assert.equal(url, '/api/shell/games');
      posts.push(JSON.parse(init.body));
      return Promise.resolve(Response.json({ ok: true }));
    },
  });
  let committed;
  context = {
    account, safeAccountIntent, createOpponentStoryDialog: options => createOpponentStoryDialog({ ...options, document }), createModal, document,
    window: { location: { hash: '#/' }, sessionStorage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value) } },
    navigator: { onLine: true }, setTimeout, clearTimeout,
    preparation: { cancel() {} }, opponentSession: { cancel() {} },
    getComputerReadiness: () => ({ state: 'ready' }), prepareOpponent() {},
    gameSound: { play() {} },
    createMiniBoardPreview: () => ({ destroy() {} }),
    createInitialBoardSnapshot: () => ({}), createEngineBoardAdapter() {},
    accountDialog: { open() { signIns++; } },
    transport: { createGame(options) {
      committed = account.fetch('/api/shell/games', { method: 'POST', body: JSON.stringify(options) });
      return { result: { id: 'created-game' }, committed };
    } },
    currentRoute: { name: 'home' }, startGameEntryRouteTransition() {},
    buildGameHash: id => `#/game/${id}`, getCurrentFlyoutState: () => ({}),
    navigateTo(hash) { context.window.location.hash = hash; }, openFriendInvite() {},
    routeHydrated: true, accountStartupError: '', render() {}, syncLiveChannels() {},
    syncScenarioCatalog: async () => {}, startRouteSync() { routeSyncs++; },
  };
  // Keep the VM's exported bindings, including the same modal instance.
  const vmContext = { ...context, trigger };
  runInNewContext(`
    ${extract('const storyDialog = createOpponentStoryDialog', "\n\ndocument.addEventListener('visibilitychange'")}
    ${extract('const waitForAccountGate = async', 'const openBoardAccountGate = async')}
    ${extract('let startupFlight = false', 'window.addEventListener("offline", () => clearTimeout(startupRetryTimer))')}
    globalThis.story = storyDialog; globalThis.startup = initialRender;
    globalThis.startupDone = () => startupComplete;
    globalThis.create = async () => {
      const action = 'create-game', actionGameId = null, actionEl = trigger;
      const event = { preventDefault() {} };
      ${extract('  const accountGatedActions = new Set', '  if (action === "view-result")')}
      ${extract('  if (action === "create-game" || action === \'create-self-play\')', '  if (action === "launch-history-branch"')}
    };
  `, vmContext);
  context = vmContext;
  return {
    account, bootstrap, posts, element, document, trigger, context,
    transitions: () => transitions, signIns: () => signIns, routeSyncs: () => routeSyncs,
    advance(milliseconds) {
      clock += milliseconds;
      for (const [id, timer] of [...timers]) if (timer.at <= clock) { timers.delete(id); timer.callback(); }
    },
    confirm: () => listeners.get('click')({ target: { closest: selector => selector === '[data-story-play]' ? node('[data-story-play]') : null } }),
    committed: () => committed,
  };
}

test('queued startup retry preserves a Friend introduction after the create gate adopts its guest session', async () => {
  const f = fixture();
  try {
    const first = f.context.startup();
    assert.equal(f.bootstrap.length, 1);
    f.advance(5000);
    await first;
    assert.equal(f.bootstrap[0].signal.aborted, true);
    assert.equal(f.account.snapshot().ready, false);

    const create = f.context.create();
    assert.equal(f.bootstrap.length, 2);
    assert.equal(f.element.open, false);
    f.bootstrap[1].resolve(Response.json({ authProtocolVersion: 2, accountsRequired: false }));
    await create;
    const dialog = f.element, focus = f.document.activeElement;
    assert.equal(dialog.open, true);
    assert.equal(f.transitions(), 1);
    assert.equal(f.signIns(), 0);
    assert.equal(f.posts.length, 0);

    f.advance(1000);
    await new Promise(setImmediate);
    assert.equal(f.element, dialog);
    assert.equal(dialog.open, true, 'the queued startup retry must not retire the adopted session and close Friend');
    assert.equal(f.document.activeElement, focus, 'the pending Start action retains focus');
    assert.equal(f.bootstrap.length, 2);
    assert.equal(f.transitions(), 1);
    assert.equal(f.context.startupDone(), true);
    assert.equal(f.routeSyncs(), 1, 'startup still completes route hydration');
    assert.equal(f.signIns(), 0);
    assert.equal(f.posts.length, 0, 'initial adoption and startup retry never create a game');

    await f.confirm();
    await f.committed();
    assert.equal(f.posts.length, 1);
    assert.equal(f.posts[0].selfPlayMode, false);
    assert.equal(f.context.window.location.hash, '#/game/created-game');

    f.context.window.location.hash = '#/';
    await f.context.create();
    assert.equal(f.element.open, true);
    f.account.retire({ authenticated: true, contextId: 'new-account', account: { id: 'another-user' } });
    assert.equal(f.element.open, false, 'a real identity retirement still cancels the introduction');
    assert.equal(f.posts.length, 1);
  } finally { f.account.destroy(); }
});
