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
