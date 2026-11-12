import test from 'node:test';
import assert from 'node:assert/strict';
import { mountMobileNavigation, MOBILE_NAVIGATION } from '../shell/mobile-navigation.js';

test('explicit reveal clears prior downward travel before residual scrolling and keeps normal hide behavior', () => {
  const listeners = new Map(), timers = new Map(); let timerId = 0;
  const controls = { toggleAttribute(name, value) { this[name] = value; } };
  const revealer = { setAttribute(name, value) { this[name] = value; } };
  const nav = { dataset: {}, contains: () => false, matches: () => false,
    querySelector: selector => selector.includes('controls') ? controls : revealer };
  const window = { scrollY: 1471, innerHeight: 800,
    addEventListener: (name, callback) => listeners.set(name, callback), removeEventListener() {},
    setTimeout: callback => { timers.set(++timerId, callback); return timerId; },
    clearTimeout: id => timers.delete(id), matchMedia: () => ({ matches: false }) };
  const document = { documentElement: { scrollHeight: 4000 }, activeElement: null,
    querySelector: () => nav, addEventListener() {}, removeEventListener() {} };
  const mounted = mountMobileNavigation({ window, document, isNarrow: () => true });
  const scroll = y => { window.scrollY = y; listeners.get('scroll')(); };
  scroll(1948);
  assert.equal(nav.dataset.visible, 'false');
  mounted.reveal();
  scroll(1950); // Late native scroll from the movement preceding the reveal.
  assert.equal(nav.dataset.visible, 'true');
  assert.equal(controls.inert, false);
  scroll(1948 + MOBILE_NAVIGATION.hideDistance);
  assert.equal(nav.dataset.visible, 'false');
  mounted.reveal();
  timers.get(timerId)();
  assert.equal(nav.dataset.visible, 'false'); // The normal idle policy remains.
  mounted.destroy();
});

// Controlled event leaves exercise the actual owner. They do not simulate the
// browser's default Tab traversal or claim native :focus-visible timing.
function handoffFixture() {
  const listeners = { window: new Map(), document: new Map() }, timers = new Map();
  let serial = 0, narrow = true, blocked = false, focusVisible = false;
  const events = kind => ({
    addEventListener(name, callback) { listeners[kind].set(name, callback); },
    removeEventListener(name, callback) { if (listeners[kind].get(name) === callback) listeners[kind].delete(name); },
  });
  const controls = { inert: false, toggleAttribute(name, value) { this[name] = value; } };
  const reveal = { matches: selector => selector === '[data-mobile-nav-reveal]' || selector === ':focus-visible' && focusVisible,
    setAttribute(name, value) { this[name] = value; } };
  const players = { matches: selector => selector === ':focus-visible' && focusVisible };
  const outside = { matches: () => false };
  const nav = { dataset: {}, contains: node => node === reveal || node === players, matches: () => false,
    querySelector: selector => selector.includes('controls') ? controls : reveal };
  const window = { ...events('window'), scrollY: 0, innerHeight: 800,
    setTimeout(callback, delay) { assert.equal(delay, 3000); timers.set(++serial, callback); return serial; },
    clearTimeout(id) { timers.delete(id); }, matchMedia: () => ({ matches: false }) };
  const document = { ...events('document'), activeElement: reveal, documentElement: { scrollHeight: 4000 }, querySelector: () => nav };
  const mounted = mountMobileNavigation({ window, document, isNarrow: () => narrow, isBlocked: () => blocked });
  const fire = (kind, name, fields = {}) => {
    const event = { type: name, key: 'Tab', isTrusted: true, target: document.activeElement,
      preventDefault() { assert.fail('default native traversal must remain untouched'); }, ...fields };
    listeners[kind].get(name)?.(event); return event;
  };
  return { nav, controls, reveal, players, outside, window, document, timers, listeners, mounted, fire,
    focus(node, visible = false) { document.activeElement = node; focusVisible = visible; fire('document', 'focusin'); },
    narrow(value) { narrow = value; }, blocked(value) { blocked = value; },
    scroll(y) { window.scrollY = y; fire('window', 'scroll'); },
    expire() { const [id, callback] = [...timers].at(-1); timers.delete(id); callback(); },
    close() { mounted.destroy(); assert.equal(timers.size, 0); assert.equal(listeners.window.size + listeners.document.size, 0); },
  };
}

for (const altKey of [false, true]) test(`visible first ${altKey ? 'Alt+Tab' : 'Tab'} handoff protects downward scroll before focusin`, () => {
  const f = handoffFixture();
  try {
    f.mounted.reveal(); f.fire('document', 'keydown', { altKey });
    f.scroll(100);
    assert.equal(f.controls.inert, false, 'default Tab scroll must not hide its destinations');
  } finally { f.close(); }
});

test('first native Tab handoff protects idle and downward scroll before focusin without assuming focus-visible', () => {
  const f = handoffFixture();
  try {
    f.mounted.reveal(); f.expire();
    assert.equal(f.controls.inert, true, 'pointer-focused reveal retains normal touch idle');
    f.fire('document', 'keydown');
    assert.equal(f.controls.inert, false, 'Tab must reopen before default traversal');
    f.scroll(100); // Focus-induced movement can precede focusin/:focus-visible.
    assert.equal(f.nav.dataset.visible, 'true');
    f.expire();
    assert.equal(f.controls.inert, false, 'held first key still owns navigation focus');
    f.focus(f.players, false);
    f.scroll(200);
    assert.equal(f.controls.inert, false, 'focusin need not expose :focus-visible yet');
    f.focus(f.players, true); f.fire('document', 'keyup');
    f.expire();
    assert.equal(f.controls.inert, false, 'normal keyboard focus takes ownership after keyup');
    f.focus(f.outside); f.expire();
    assert.equal(f.controls.inert, true, 'leaving navigation restores idle hiding');
  } finally { f.close(); }
});

test('first Tab reopens downward-hidden navigation and keyup restores pointer idle policy', () => {
  const f = handoffFixture();
  try {
    f.mounted.reveal(); f.scroll(100); assert.equal(f.controls.inert, true);
    f.fire('document', 'keydown'); assert.equal(f.controls.inert, false);
    f.fire('document', 'keyup'); f.expire(); assert.equal(f.controls.inert, true);
  } finally { f.close(); }
});

for (const [name, prepare, event] of [
  ['untrusted', () => {}, { isTrusted: false }],
  ['other key', () => {}, { key: 'Enter' }],
  ['backward Tab', () => {}, { shiftKey: true }],
  ['Control Tab', () => {}, { ctrlKey: true }],
  ['Meta Tab', () => {}, { metaKey: true }],
  ['prevented Tab', () => {}, { defaultPrevented: true }],
  ['unfocused event target', () => {}, { target: {} }],
  ['another focused control', f => f.focus(f.players), {}],
  ['foreign reveal', f => f.focus({ matches: () => true }), {}],
  ['wide view', f => f.narrow(false), {}],
  ['blocked view', f => f.blocked(true), {}],
]) test(`first Tab ownership rejects ${name}`, () => {
  const f = handoffFixture();
  try { f.mounted.reveal(); f.expire(); prepare(f); f.fire('document', 'keydown', event); assert.equal(f.controls.inert, true); }
  finally { f.close(); }
});

for (const end of ['pointerdown', 'blur', 'outside focus']) test(`first Tab handoff ends on ${end}`, () => {
  const f = handoffFixture();
  try {
    f.mounted.reveal(); f.fire('document', 'keydown');
    if (end === 'outside focus') f.focus(f.outside);
    else f.fire(end === 'blur' ? 'window' : 'document', end);
    f.expire(); assert.equal(f.controls.inert, true);
    f.focus(f.reveal, false); f.mounted.reveal(); f.expire();
    assert.equal(f.controls.inert, true, 'old handoff cannot revive on later pointer focus');
  } finally { f.close(); }
});

test('new incoming flyout hides tabs once, preserves deliberate reveal and never hides focused navigation',()=>{
 const f=handoffFixture();
 try{
  f.focus(f.outside);f.mounted.reveal();assert.equal(f.mounted.incoming('turn:1'),true);
  assert.equal(f.nav.dataset.visible,'false');assert.equal(f.controls.inert,true);assert.equal(f.timers.size,0);
  f.mounted.reveal();assert.equal(f.mounted.incoming('turn:1'),false);assert.equal(f.nav.dataset.visible,'true','quiet same-turn publication cannot override deliberate navigation');
  f.focus(f.players,false);assert.equal(f.mounted.incoming('turn:2'),false);assert.equal(f.nav.dataset.visible,'true');assert.equal(f.controls.inert,false);
  assert.equal(f.timers.size,0,'arrival retires the old idle timer while preserving focused navigation');
  f.focus(f.outside);assert.equal(f.mounted.incoming('turn:3'),true);f.scroll(100);f.scroll(80);assert.equal(f.nav.dataset.visible,'true','existing upscroll reveal remains authoritative');
  f.mounted.incoming(null);f.mounted.reveal();f.expire();assert.equal(f.nav.dataset.visible,'false','ordinary idle behavior returns when the incoming host retires');
 }finally{f.close();}
});
