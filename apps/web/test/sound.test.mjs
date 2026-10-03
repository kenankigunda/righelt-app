import test from "node:test";
import assert from "node:assert/strict";
import { createGameSound } from "../shell/sound.js";
const event = (eventSeq, patch = {}) => ({ type: "event_appended", reason: "move_recorded", eventSeq, game: { id: "g", board: { state: { outcome: { status: "ongoing" }, continuation: null } } }, ...patch });
const fixture = () => {
  let tones = 0, hidden = false; const saved = new Map();
  const audio = { currentTime: 0, destination: {}, resume: async () => {}, suspend: async () => {}, createOscillator: () => ({ frequency: {}, connect() {}, disconnect() {}, start() { tones++; }, stop() {} }), createGain: () => ({ gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {}, disconnect() {} }) };
  return { saved, sound: createGameSound({ storage: { getItem: key => saved.get(key), setItem: (key, value) => saved.set(key, value) }, createAudio: () => audio, hidden: () => hidden }), tones: () => tones, hide: () => { hidden = true; }, show: () => { hidden = false; } };
};
test("sound is muted on a new device, then emits at most once per confirmed live event", () => {
  const f = fixture(); assert.equal(f.sound.enabled(), false);
  f.sound.observe(event(0)); f.sound.observe(event(1)); assert.equal(f.tones(), 0);
  f.sound.toggle(); assert.equal([...f.saved.values()][0], "true");
  assert.equal(f.sound.observe(event(2)), true); f.sound.observe(event(2)); f.sound.observe(event(1)); assert.equal(f.tones(), 1);
  f.sound.toggle(); f.sound.observe(event(3)); assert.equal(f.tones(), 1);
});
test("hydration, reconnect, history, undo and hidden events remain silent and consumed", () => {
  const f = fixture(); f.sound.toggle();
  f.sound.observe(event(1), { initial: true });
  f.sound.observe(event(2), { inHistory: true }); f.sound.observe(event(2));
  f.sound.observe(event(3, { type: "state_sync", reason: "connected" }));
  f.sound.observe(event(4, { reason: "moves_reverted" }));
  f.hide(); f.sound.hide(); f.sound.observe(event(5)); f.show(); f.sound.observe(event(6));
  assert.equal(f.tones(), 0);
  f.sound.gesture(); f.sound.observe(event(7)); assert.equal(f.tones(), 1);
});
test("storage and unavailable audio never block play", () => {
  const sound = createGameSound({ storage: { getItem() { throw Error(); }, setItem() { throw Error(); } }, createAudio: () => { throw Error(); } });
  assert.doesNotThrow(() => { sound.toggle(); sound.gesture(); sound.observe(event(0)); sound.observe(event(1)); sound.hide(); });
});
