import test from 'node:test';
import assert from 'node:assert/strict';
import {createPasswordSessionResourceOwner, passwordSessionResourcesFixture} from '../../../e2e/support/password-session-resources.mjs';

function resources(overrides = {}) {
  const events = [];
  const sibling = {close: async () => { events.push('close sibling'); }};
  const other = {};
  const separate = {
    newPage: async () => { events.push('create other'); return other; },
    close: async () => { events.push('close separate'); },
  };
  const context = {
    newPage: async () => { events.push('create sibling'); return sibling; },
    close: () => assert.fail('must not close base context'),
  };
  const page = {context: () => context, close: () => assert.fail('must not close base page')};
  const browser = {
    newContext: async options => { assert.deepEqual(options, {ignoreHTTPSErrors: true}); events.push('create separate'); return separate; },
    close: () => assert.fail('must not close browser'),
  };
  return Object.assign({events, sibling, other, separate, context, page, browser}, overrides);
}
const [fixture, options] = passwordSessionResourcesFixture;

test('actual fixture is lazy and keeps its shared setup/teardown slot separate', async () => {
  const r = resources();
  assert.deepEqual(options, {timeout: 5000});
  await fixture(r, async owner => {
    assert.deepEqual(r.events, []);
    r.events.push('registration in body');
    assert.equal(await owner.newSiblingPage(), r.sibling);
    r.events.push('sibling navigation in body');
    const separate = await owner.newIndependentContext();
    assert.equal(await separate.newPage(), r.other);
    r.events.push('all product assertions in body');
  });
  assert.deepEqual(r.events, ['registration in body', 'create sibling', 'sibling navigation in body', 'create separate', 'create other', 'all product assertions in body', 'close sibling', 'close separate']);
});

test('independent page creation failure still closes both already-owned resources', async () => {
  const r = resources(), failure = new Error('new page failed');
  r.separate.newPage = async () => { throw failure; };
  await assert.rejects(fixture(r, async owner => {
    await owner.newSiblingPage();
    await (await owner.newIndependentContext()).newPage();
  }), error => error === failure);
  assert.deepEqual(r.events, ['create sibling', 'create separate', 'close sibling', 'close separate']);
});

test('independent context creation failure still closes the sibling and propagates', async () => {
  const r = resources(), failure = new Error('new context failed');
  r.browser.newContext = async () => { throw failure; };
  await assert.rejects(fixture(r, async owner => {
    await owner.newSiblingPage();
    await owner.newIndependentContext();
  }), error => error === failure);
  assert.deepEqual(r.events, ['create sibling', 'close sibling']);
});

test('sibling creation failure propagates without closing unowned base resources', async () => {
  const r = resources(), failure = new Error('sibling failed');
  r.context.newPage = async () => { throw failure; };
  await assert.rejects(fixture(r, owner => owner.newSiblingPage()), error => error === failure);
  assert.deepEqual(r.events, []);
});

test('one synchronous close failure cannot prevent the other close; disposal is idempotent', async () => {
  const r = resources(), failure = new Error('sibling close failed');
  r.sibling.close = () => { r.events.push('close sibling'); throw failure; };
  const owner = createPasswordSessionResourceOwner(r);
  await owner.newSiblingPage();
  await owner.newIndependentContext();
  const disposal = owner.dispose();
  assert.equal(owner.dispose(), disposal);
  await assert.rejects(disposal, error => error instanceof AggregateError && error.errors.length === 1 && error.errors[0] === failure);
  assert.deepEqual(r.events, ['create sibling', 'create separate', 'close sibling', 'close separate']);
  assert.throws(() => owner.newSiblingPage(), /unavailable/);
  assert.throws(() => owner.newIndependentContext(), /unavailable/);
});

test('both rejected closes are reported, including when the body also failed', async () => {
  const r = resources(), body = new Error('body failed'), sibling = new Error('sibling close'), separate = new Error('context close');
  r.sibling.close = async () => { r.events.push('close sibling'); throw sibling; };
  r.separate.close = async () => { r.events.push('close separate'); throw separate; };
  await assert.rejects(fixture(r, async owner => {
    await owner.newSiblingPage();
    await owner.newIndependentContext();
    throw body;
  }), error => {
    assert.equal(error.errors[0], body);
    assert.deepEqual(error.errors[1].errors, [sibling, separate]);
    return true;
  });
  assert.deepEqual(r.events, ['create sibling', 'create separate', 'close sibling', 'close separate']);
});

test('a body error propagates unchanged after successful independent cleanup', async () => {
  const r = resources(), failure = new Error('product assertion failed');
  await assert.rejects(fixture(r, async owner => {
    await owner.newSiblingPage();
    await owner.newIndependentContext();
    throw failure;
  }), error => error === failure);
  assert.deepEqual(r.events.slice(-2), ['close sibling', 'close separate']);
});

test('retirement waits for an in-flight creation and closes it exactly once', async () => {
  const r = resources();
  let finish;
  r.browser.newContext = () => new Promise(resolve => { finish = resolve; });
  const owner = createPasswordSessionResourceOwner(r);
  const creating = owner.newIndependentContext();
  await Promise.resolve();
  const disposing = owner.dispose();
  assert.throws(() => owner.newSiblingPage(), /unavailable/);
  assert.deepEqual(r.events, []);
  finish(r.separate);
  assert.equal(await creating, r.separate);
  await disposing;
  await owner.dispose();
  assert.deepEqual(r.events, ['close separate']);
});

test('the resource owner refuses duplicate creation before or after settlement', async () => {
  const r = resources(), owner = createPasswordSessionResourceOwner(r);
  const sibling = owner.newSiblingPage(), context = owner.newIndependentContext();
  assert.throws(() => owner.newSiblingPage(), /unavailable/);
  assert.throws(() => owner.newIndependentContext(), /unavailable/);
  await Promise.all([sibling, context]);
  assert.throws(() => owner.newSiblingPage(), /unavailable/);
  await owner.dispose();
  assert.deepEqual(r.events, ['create sibling', 'create separate', 'close sibling', 'close separate']);
});
