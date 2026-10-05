// Device preference is independent of authentication. Only deliberate mute is inherited.
export const SOUND_KEY = 'righelt.device.sound-enabled';
export const PREVIEW_SETTLE_MS = 200;
export const createGameSound = ({ storage, createAudio = () => new (globalThis.AudioContext || globalThis.webkitAudioContext)({latencyHint:"interactive"}), hidden = () => globalThis.document?.hidden, setTimer = setTimeout, clearTimer = clearTimeout } = {}) => {
  let enabled = true, audio, timer = null, hoverKey = null;
  const sequences = new Map();
  const localCommands = new Set(), localStates = new Map();
  const cue = (state, previous, fallback="move") => state?.outcome?.status && state.outcome.status !== "ongoing" ? "result" : previous?.pieces?.length > state?.pieces?.length ? "capture" : previous && (previous.sideToMove !== state?.sideToMove || previous.turnIndex !== state?.turnIndex) ? "turn" : fallback;
  try { enabled = storage?.getItem(SOUND_KEY) !== 'false'; } catch {}
  const cancelPreview = () => { if (timer !== null) clearTimer(timer); timer = null; hoverKey = null; };
  const gesture = () => {
    if (!enabled || hidden()) return;
    try { audio ||= createAudio(); if (audio.state === 'suspended') void audio.resume().catch(() => {}); } catch {}
  };
  // A short filtered noise impulse excites damped wooden resonances; no sustained beep.
  const play = (kind) => {
    if (!enabled || hidden() || !audio || audio.state !== 'running') return false;
    const palette = { select: [1050,.018,.045], preview: [1450,.010,.025], cancel: [650,.012,.045], move: [820,.045,.075], capture: [510,.038,.105], turn: [1200,.024,.065], result: [560,.032,.16], enter: [720,.020,.09], intro: [970,.016,.08] };
    const [frequency, volume, duration] = palette[kind] || palette.select;
    try {
      const t = audio.currentTime;
      const buffer = audio.createBuffer(1, Math.ceil(audio.sampleRate * duration), audio.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i=0;i<data.length;i++) data[i]=(Math.random()*2-1)*Math.exp(-i/(audio.sampleRate*.008));
      const source=audio.createBufferSource(), filter=audio.createBiquadFilter(), gain=audio.createGain();
      source.buffer=buffer;filter.type='bandpass';filter.frequency.value=frequency;filter.Q.value=1.4;gain.gain.value=volume*3;
      source.connect(filter);filter.connect(gain);gain.connect(audio.destination);source.start(t);source.onended=()=>{source.disconnect();filter.disconnect();gain.disconnect();};
      for (const ratio of [1]) {
        const oscillator=audio.createOscillator(), envelope=audio.createGain();oscillator.frequency.value=frequency*ratio;oscillator.type='sine';
        envelope.gain.setValueAtTime(volume,t);envelope.gain.exponentialRampToValueAtTime(.0001,t+duration);
        oscillator.connect(envelope);envelope.connect(audio.destination);oscillator.start(t);oscillator.stop(t+duration);oscillator.onended=()=>{oscillator.disconnect();envelope.disconnect();};
      }
      return true;
    } catch { return false; }
  };
  return {
    enabled:()=>enabled, gesture, play, cancelPreview,
    toggle(){enabled=!enabled;cancelPreview();try{storage?.setItem(SOUND_KEY,String(enabled));}catch{} if(enabled)gesture();else void audio?.suspend().catch(()=>{});return enabled;},
    hide(){cancelPreview();void audio?.suspend().catch(()=>{});},
    interaction({kind,key}){ if(kind==='preview-hover'){if(hoverKey===key)return;cancelPreview();hoverKey=key;timer=setTimer(()=>{timer=null;play('preview');},PREVIEW_SETTLE_MS);return;} cancelPreview();if(kind!=='preview-leave')play(kind); },
    local(change, game, {silent=false}={}) {
      const id=change?.gameId, state=game?.currentSnapshot;
      if(!id || !state) return false;
      const previous=localStates.get(id);localStates.set(id,state);
      if(change.type!=='optimistic_enqueue' || !change.clientCommandId || localCommands.has(change.clientCommandId))return false;
      localCommands.add(change.clientCommandId);
      if(localCommands.size>1024)localCommands.delete(localCommands.values().next().value);
      cancelPreview();
      return !silent && play(cue(state,previous));
    },
    observe(payload,{silent=false}={}){
      const id=payload?.game?.id, seq=payload?.eventSeq;
      if(!id || !Number.isSafeInteger(seq))return false;
      const previous=sequences.get(id);if(previous && seq<=previous.seq)return false;
      sequences.set(id,{seq,pieces:payload.game.board?.state?.pieces?.length});
      // Snapshot baselines and replays never produce audio. Only new authoritative events do.
      if(silent || localCommands.has(payload.clientCommandId) || payload.type!=='event_appended' || !['move_recorded','turn_ended'].includes(payload.reason))return false;
      const state=payload.game.board?.state;
      return play(state?.outcome?.status && state.outcome.status!=='ongoing'?'result':previous?.pieces>state?.pieces?.length?'capture':payload.reason==='turn_ended'?'turn':'move');
    },
  };
};
