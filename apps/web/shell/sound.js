const KEY = "righelt.device.sound-enabled";
export const createGameSound = ({ storage, createAudio = () => new (globalThis.AudioContext || globalThis.webkitAudioContext)(), hidden = () => globalThis.document?.hidden } = {}) => {
  let enabled = false, unlocked = false, audio;
  try { enabled = storage?.getItem(KEY) === "true"; } catch { /* A private browser may deny local preferences. */ }
  const sequences = new Map();
  const gesture = () => {
    if (!enabled || hidden()) return;
    try { audio ||= createAudio(); unlocked = true; Promise.resolve(audio.resume()).catch(() => { unlocked = false; }); } catch { unlocked = false; }
  };
  return {
    enabled: () => enabled,
    toggle() { enabled = !enabled; try { storage?.setItem(KEY, String(enabled)); } catch {} if (enabled) gesture(); else { unlocked = false; Promise.resolve(audio?.suspend()).catch(() => {}); } return enabled; },
    gesture,
    hide() { unlocked = false; Promise.resolve(audio?.suspend()).catch(() => {}); },
    reset() { sequences.clear(); },
    observe(payload, { initial = false, inHistory = false } = {}) {
      const id = payload?.game?.id, seq = payload?.eventSeq;
      if (!id || !Number.isSafeInteger(seq)) return false;
      const previous = sequences.get(id);
      sequences.set(id, Math.max(previous ?? -1, seq));
      if (previous === undefined || seq <= previous || initial || inHistory || hidden() || !enabled || !unlocked || payload.type !== "event_appended" || !["move_recorded", "turn_ended"].includes(payload.reason)) return false;
      const state = payload.game.board?.state;
      const frequency = state?.outcome?.status !== "ongoing" ? 660 : state?.continuation ? 440 : 330;
      try {
        const oscillator = audio.createOscillator(), gain = audio.createGain();
        oscillator.frequency.value = frequency; oscillator.type = "sine";
        gain.gain.setValueAtTime(0.035, audio.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + 0.12);
        oscillator.connect(gain); gain.connect(audio.destination);
        oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
        oscillator.start(); oscillator.stop(audio.currentTime + 0.13); return true;
      } catch { return false; }
    },
  };
};
