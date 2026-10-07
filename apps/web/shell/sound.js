import { swipeProgress } from './navigation-motion.js';
// Device preference is independent of authentication. Only deliberate mute is inherited.
export const SOUND_KEY = 'righelt.device.sound-enabled';
export const INCOMING_REMINDER_MS = 30_000;

export const isOpponentMove = (game, commandId) => {
  const roles = game?.myRoles ?? [game?.myRole];
  if (!roles.some(role => role === 'Player 1' || role === 'Player 2')) return false;
  const move = game?.moves?.findLast(move => commandId && move.clientCommandId === commandId) ?? game?.moves?.at(-1);
  const role = move?.actorSide === 'P1' ? 'Player 1' : move?.actorSide === 'P2' ? 'Player 2' : null;
  return Boolean(role && !roles.includes(role));
};

export const createGameSound = ({
  storage,
  createAudio = () => new (globalThis.AudioContext || globalThis.webkitAudioContext)({latencyHint:'interactive'}),
  hidden = () => Boolean(globalThis.document?.hidden),
  focused = () => globalThis.document?.hasFocus?.() ?? true,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
} = {}) => {
  let enabled = true, audio, reminderTimer = null, pendingIncoming = false;
  const sequences = new Map(), localCommands = new Set(), localStates = new Map();
  const active = () => !hidden() && focused();
  const cue = (state, previous, fallback='move', confirmed=true) => confirmed && state?.outcome?.status && state.outcome.status !== 'ongoing' ? 'result' : previous?.pieces?.length > state?.pieces?.length ? 'capture' : previous && (previous.sideToMove !== state?.sideToMove || previous.turnIndex !== state?.turnIndex) ? 'turn' : fallback;
  try { enabled = storage?.getItem(SOUND_KEY) !== 'false'; } catch {}
  const cancelPreview = () => {}; // Hover never schedules audio. Retained for interaction reset callers.
  const clearIncoming = () => { if (reminderTimer !== null) clearTimer(reminderTimer); reminderTimer = null; pendingIncoming = false; };
  const gesture = () => {
    if (!enabled || !active()) return;
    try { audio ||= createAudio(); if (audio.state === 'suspended') void audio.resume().catch(() => {}); } catch {}
  };
  // Each cue has a hard stop. Only the explicit incoming notification may sound away from the game.
  const play = (kind, {duration: transitionDuration} = {}) => {
    if (kind === 'preview-hover' || kind === 'preview-leave') return false;
    if (!enabled || (kind !== 'incoming' && !active()) || !audio || audio.state !== 'running') return false;
    const palette = {select:[1050,.018,.045],preview:[1800,.003,.10],page:[1400,.004,.16],'page-back':[1400,.004,.16],flyout:[970,.012,.12],'flyout-back':[970,.012,.12],history:[1400,.004,.10],'history-back':[1400,.004,.10],cancel:[650,.012,.045],move:[820,.045,.075],capture:[510,.038,.105],turn:[1200,.024,.065],result:[560,.032,.16],enter:[720,.020,.09],leave:[520,.018,.09],intro:[970,.016,.08],'intro-back':[970,.016,.08],incoming:[460,.03,.13]};
    const [frequency, volume, cueDuration] = palette[kind] || palette.select;
    const duration = (kind === "enter" || kind === "leave") && Number.isFinite(transitionDuration) ? Math.max(.04, Math.min(1, transitionDuration)) : cueDuration;
    try {
      const t = audio.currentTime;
      if (kind === 'enter' || kind === 'leave') {
        // A breathy noise sweep follows the swipe without a pitched note.
        const up = kind === 'enter';
        const source = audio.createBufferSource(), filter = audio.createBiquadFilter(), envelope = audio.createGain();
        const buffer = audio.createBuffer(1, Math.ceil(audio.sampleRate * duration), audio.sampleRate);
        const samples = buffer.getChannelData(0);
        for (let i = 0; i < samples.length; i++) samples[i] = Math.random() * 2 - 1;
        source.buffer = buffer;
        filter.type = 'bandpass';filter.Q.value = .45;
        for (let i=0;i<=32;i++) {
          const elapsed=i/32, progress=swipeProgress(elapsed);
          filter.frequency.setValueAtTime(up ? 450 + 1350*progress : 1800 - 1350*progress, t+duration*elapsed);
          envelope.gain.setValueAtTime(Math.max(.0001,.017*Math.sin(Math.PI*progress)),t+duration*elapsed);
        }
        source.connect(filter);filter.connect(envelope);envelope.connect(audio.destination);
        source.start(t);source.stop(t + duration);
        source.onended = () => {source.disconnect();filter.disconnect();envelope.disconnect();};
        return true;
      }
      const buffer = audio.createBuffer(1, Math.ceil(audio.sampleRate * duration), audio.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i=0;i<data.length;i++){const reverse=['intro-back','history-back','page-back','flyout-back'].includes(kind);const offset=reverse?data.length-1-i:i;data[i]=(Math.random()*2-1)*Math.exp(-offset/(audio.sampleRate*(['preview','history','history-back','page','page-back','flyout','flyout-back'].includes(kind)?.035:.008)));}
      const source=audio.createBufferSource(), filter=audio.createBiquadFilter(), gain=audio.createGain();
      source.buffer=buffer;filter.type='bandpass';filter.frequency.value=frequency;filter.Q.value=kind==='preview'?.35:1.4;gain.gain.value=volume*3;
      source.connect(filter);filter.connect(gain);gain.connect(audio.destination);source.start(t);source.onended=()=>{source.disconnect();filter.disconnect();gain.disconnect();};
      if(['preview','history','history-back','page','page-back','flyout','flyout-back'].includes(kind))return true;
      const oscillator=audio.createOscillator(), envelope=audio.createGain();oscillator.frequency.value=frequency;oscillator.type='sine';
      if(kind==='intro-back'){envelope.gain.setValueAtTime(.0001,t);envelope.gain.exponentialRampToValueAtTime(volume,t+duration*.85);envelope.gain.exponentialRampToValueAtTime(.0001,t+duration);}else{envelope.gain.setValueAtTime(volume,t);envelope.gain.exponentialRampToValueAtTime(.0001,t+duration);}
      oscillator.connect(envelope);envelope.connect(audio.destination);oscillator.start(t);oscillator.stop(t+duration);oscillator.onended=()=>{oscillator.disconnect();envelope.disconnect();};
      return true;
    } catch { return false; }
  };
  const scheduleReminder = () => {
    if (!pendingIncoming || !enabled || reminderTimer !== null) return;
    reminderTimer=setTimer(()=>{
      reminderTimer=null;
      if(active() || !enabled){clearIncoming();return;}
      play('incoming');scheduleReminder();
    },INCOMING_REMINDER_MS);
  };
  const incoming = () => {
    if(!enabled || active())return false;
    // Several opponent actions form one outstanding reminder, never overlapping loops.
    if(pendingIncoming)return false;
    pendingIncoming=true;
    const played=play('incoming');scheduleReminder();return played;
  };
  return {
    enabled:()=>enabled, gesture, play, cancelPreview,
    activityChanged(){cancelPreview();if(active())clearIncoming();},
    toggle(){enabled=!enabled;cancelPreview();clearIncoming();try{storage?.setItem(SOUND_KEY,String(enabled));}catch{} if(enabled)gesture();else void audio?.suspend().catch(()=>{});return enabled;},
    hide(){cancelPreview();},
    leaveGame(){cancelPreview();clearIncoming();},
    interaction({kind,key}){
      if(!active()){cancelPreview();return;}
      if(kind==='preview-hover' || kind==='preview-leave')return;
      play(kind);
    },
    local(change, game, {silent=false}={}) {
      const id=change?.gameId, state=game?.currentSnapshot;
      if(!id || !state)return false;
      const previous=localStates.get(id);localStates.set(id,state);
      if(change.type!=='optimistic_enqueue' || !change.clientCommandId || localCommands.has(change.clientCommandId))return false;
      localCommands.add(change.clientCommandId);
      if(localCommands.size>1024)localCommands.delete(localCommands.values().next().value);
      cancelPreview();return !silent && play(cue(state,previous,'move',false));
    },
    observe(payload,{silent=false}={}){
      const id=payload?.game?.id, seq=payload?.eventSeq;
      if(!id || !Number.isSafeInteger(seq))return false;
      const previous=sequences.get(id);if(previous && seq<=previous.seq)return false;
      const state=payload.game.board?.state;
      const terminal=Boolean(state?.outcome?.status && state.outcome.status!=='ongoing');
      sequences.set(id,{seq,pieces:state?.pieces?.length,terminal});
      // Initial snapshots, replay and local acknowledgements never notify.
      if(silent || payload.type!=='event_appended' || !['move_recorded','turn_ended','moves_reverted'].includes(payload.reason))return false;
      if(!active())return payload.reason==='move_recorded' && isOpponentMove(payload.game,payload.clientCommandId) ? incoming() : false;
      clearIncoming();
      if(terminal && !previous?.terminal)return play('result');
      if(localCommands.has(payload.clientCommandId) || terminal)return false;
      if(payload.reason === "moves_reverted")return play("history-back");
      return play(state?.outcome?.status && state.outcome.status!=='ongoing'?'result':previous?.pieces>state?.pieces?.length?'capture':payload.reason==='turn_ended'?'turn':'move');
    },
  };
};
