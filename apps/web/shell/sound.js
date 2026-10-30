import { createDestructionSoundTracker, playStoneCrack } from './destruction-sound.js';
import { swipeProgress } from './navigation-motion.js';
import { getGameResult } from './game-result.js';
import { resultSound } from './result-presentation.js';
import { createOpponentMoveTracker, isOpponentAction } from './opponent-move-sound.js';
// Device preference is independent of authentication. Only deliberate mute is inherited.
export const SOUND_KEY = 'righelt.device.sound-enabled';
export const INCOMING_REMINDER_MS = 30_000;
const OPPONENT_CUE_SPACING_MS = 160;

export const isOpponentMove = (game, commandId, identityId = null) => {
  const move = game?.moves?.findLast(move => commandId && move.clientCommandId === commandId) ?? game?.moves?.at(-1);
  return isOpponentAction(game, move, identityId);
};

export const createGameSound = ({
  storage,
  createAudio = () => new (globalThis.AudioContext || globalThis.webkitAudioContext)({latencyHint:'interactive'}),
  hidden = () => Boolean(globalThis.document?.hidden),
  focused = () => globalThis.document?.hasFocus?.() ?? true,
  getIdentityId = () => null,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
} = {}) => {
  let enabled = true, audio, reminderTimer = null, pendingIncoming = false;
  const destructionSounds = createDestructionSoundTracker();
  const opponentMoves = createOpponentMoveTracker();
  const unseenGames=new Set();
  const displayedMoves=new Set();
  const opponentCueTimers = new Set();
  let nextOpponentCueAt = 0;
  const sequences = new Map(), localCommands = new Set(), localStates = new Map();
  const active = () => !hidden() && focused();
  const cue = (state, previous, fallback='move', confirmed=true) => confirmed && state?.outcome?.status && state.outcome.status !== 'ongoing' ? 'result' : previous && (previous.sideToMove !== state?.sideToMove || previous.turnIndex !== state?.turnIndex) ? 'turn' : fallback;
  try { enabled = storage?.getItem(SOUND_KEY) !== 'false'; } catch {}
  const cancelPreview = () => {}; // Hover never schedules audio. Retained for interaction reset callers.
  const clearIncoming = () => { if (reminderTimer !== null) clearTimer(reminderTimer); reminderTimer = null; pendingIncoming = false; };
  const clearOpponentCues = () => { for (const timer of opponentCueTimers) clearTimer(timer); opponentCueTimers.clear(); nextOpponentCueAt = 0; };
  const gesture = () => {
    if (!enabled || !active()) return;
    try { audio ||= createAudio(); if (audio.state === 'suspended') void audio.resume().catch(() => {}); } catch {}
  };
  // Each cue has a hard stop. Only the explicit incoming notification may sound away from the game.
  const play = (kind, {duration: transitionDuration} = {}) => {
    if (kind === 'preview-hover' || kind === 'preview-leave') return false;
    if (!enabled || (kind !== 'incoming' && !active()) || !audio || audio.state !== 'running') return false;
    const palette = {select:[1050,.018,.045],preview:[1800,.003,.10],page:[1400,.004,.16],'page-back':[1400,.004,.16],flyout:[970,.012,.12],'flyout-back':[970,.012,.12],history:[1400,.004,.10],'history-back':[1400,.004,.10],cancel:[650,.012,.045],move:[820,.045,.075],capture:[510,.038,.105],turn:[1200,.024,.065],result:[560,.032,.16],enter:[720,.020,.09],leave:[520,.018,.09],intro:[970,.016,.08],'intro-back':[970,.016,.08],incoming:[460,.06,.22]};
    const [frequency, volume, cueDuration] = palette[kind] || palette.select;
    const duration = (kind === "enter" || kind === "leave") && Number.isFinite(transitionDuration) ? Math.max(.04, Math.min(1, transitionDuration)) : cueDuration;
    try {
      const t = audio.currentTime;
      if (kind === 'destruction') {playStoneCrack(audio);return true;}
      if (['result-victory','result-defeat','result-draw'].includes(kind)) {
        const notes = kind === 'result-victory' ? [560,700,840] : kind === 'result-defeat' ? [420,360] : [520,520];
        for (const [index,frequency] of notes.entries()) {
          const oscillator=audio.createOscillator(),envelope=audio.createGain(),start=t+index*.1;
          oscillator.type='sine';oscillator.frequency.value=frequency;
          envelope.gain.setValueAtTime(.0001,start);envelope.gain.exponentialRampToValueAtTime(kind==='result-defeat'?.018:.025,start+.012);envelope.gain.exponentialRampToValueAtTime(.0001,start+.16);
          oscillator.connect(envelope);envelope.connect(audio.destination);oscillator.start(start);oscillator.stop(start+.17);oscillator.onended=()=>{oscillator.disconnect();envelope.disconnect();};
        }
        return true;
      }
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
      // A prominent ascending pair distinguishes an unseen update from the
      // short movement cue. It shares the same preference and audio context.
      if(kind==='incoming'){
        const bell=audio.createOscillator(),gain=audio.createGain(),at=t+.16;
        bell.frequency.value=690;bell.type='sine';gain.gain.setValueAtTime(volume*.9,at);gain.gain.exponentialRampToValueAtTime(.0001,at+.24);
        bell.connect(gain);gain.connect(audio.destination);bell.start(at);bell.stop(at+.24);bell.onended=()=>{bell.disconnect();gain.disconnect();};
      }
      return true;
    } catch { return false; }
  };
  const scheduleReminder = () => {
    if (!pendingIncoming || !enabled || reminderTimer !== null) return;
    reminderTimer=setTimer(()=>{
      reminderTimer=null;
      if(!pendingIncoming || !enabled){clearIncoming();return;}
      play('incoming');scheduleReminder();
    },INCOMING_REMINDER_MS);
  };
  const incoming = (gameId='legacy') => {
    unseenGames.add(gameId);
    if(!enabled)return false;
    // Several opponent actions form one outstanding reminder, never overlapping loops.
    if(pendingIncoming)return false;
    pendingIncoming=true;
    const played=play('incoming');scheduleReminder();return played;
  };
  const opponentCue = kind => {
    if (!enabled || !active() || !audio || audio.state !== 'running') return false;
    const now = Date.now(), delay = Math.max(0, nextOpponentCueAt - now);
    nextOpponentCueAt = now + delay + OPPONENT_CUE_SPACING_MS;
    if (delay === 0) return play(kind);
    const timer = setTimer(() => { opponentCueTimers.delete(timer); if (active()) play(kind); }, delay);
    opponentCueTimers.add(timer);
    return false;
  };
  return {
    enabled:()=>enabled, gesture, play, cancelPreview,
    activityChanged(){cancelPreview();if(!active())clearOpponentCues();},
    toggle(){enabled=!enabled;cancelPreview();clearIncoming();clearOpponentCues();try{storage?.setItem(SOUND_KEY,String(enabled));}catch{} if(enabled)gesture();else void audio?.suspend().catch(()=>{});return enabled;},
    hide(){cancelPreview();clearOpponentCues();},
    leaveGame(){cancelPreview();clearOpponentCues();if(unseenGames.size)incoming(unseenGames.values().next().value);},
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
      if(game.pendingComputerSaveStartedAt != null || game.pendingMoves?.some(move => move.clientCommandId === change.clientCommandId && move.computerProof)) return false;
      localCommands.add(change.clientCommandId);
      if(localCommands.size>1024)localCommands.delete(localCommands.values().next().value);
      cancelPreview();return !silent && play(cue(state,previous,'move',false));
    },
    authoritative(game, { sequence, scope, silent = false, deferComputer = false, unseen = false } = {}) {
      const observed = opponentMoves.update(game, { sequence, scope, baseline: silent });
      const updates=observed.moves.filter(move=>isOpponentAction(game,move,getIdentityId()));
      if(!silent&&updates.length)unseenGames.add(game.id);
      const fresh = updates.filter(move => !(deferComputer && move.computerProof));
      const lastMove = game?.moves?.findLast(move => !move.undone);
      const finished = observed.finished && isOpponentAction(game, lastMove, getIdentityId()) && !(deferComputer && lastMove?.computerProof);
      if (silent || !fresh.length && !finished) return false;
      if (unseen || game.inHistoryMode || game.replaying || !active()) return fresh.length ? incoming(game.id) : false;
      let played = false;
      fresh.forEach(move => {
        const terminal = finished && move === lastMove;
        played = opponentCue(terminal ? resultSound(getGameResult(game, getIdentityId())) : 'move') || played;
      });
      if (finished && !fresh.includes(lastMove)) played = opponentCue(resultSound(getGameResult(game, getIdentityId()))) || played;
      return played;
    },
    resetUpdates(){unseenGames.clear();clearIncoming();clearOpponentCues();},
    viewing({gameId,live=false,playbackFinished=true}={}){
      if(live&&active()&&playbackFinished){unseenGames.delete(gameId);if(!unseenGames.size)clearIncoming();}
      else if(!live&&unseenGames.has(gameId))incoming(gameId);
    },
    displayed(move,game,{scope=''}={}){
      const key=`${scope}:${game.id}:${move.moveId}`;
      if(displayedMoves.has(key)||!active()||!isOpponentAction(game,move,getIdentityId()))return false;
      displayedMoves.add(key);if(displayedMoves.size>1024)displayedMoves.delete(displayedMoves.values().next().value);
      return play(move.snapshot?.outcome?.status&&move.snapshot.outcome.status!=='ongoing'?resultSound(getGameResult({...game,board:{state:move.snapshot}},getIdentityId())):'move');
    },
    observe(payload,{silent=false, opponentNotifications = true}={}){
      const id=payload?.game?.id, seq=payload?.eventSeq;
      if(!id || !Number.isSafeInteger(seq))return false;
      const previous=sequences.get(id);if(previous && seq<=previous.seq)return false;
      const state=payload.game.board?.state;
      const terminal=Boolean(state?.outcome?.status && state.outcome.status!=='ongoing');
      sequences.set(id,{seq,pieces:state?.pieces?.length,terminal});
      const destructionBatches=destructionSounds.update(payload.game,{commandId:payload.clientCommandId,sequence:seq,baseline:silent || payload.type!=='event_appended' || !['move_recorded','turn_ended'].includes(payload.reason)});
      // Initial snapshots and replay never notify. Local acknowledgements may
      // confirm a destruction; their ordinary move cue is still deduplicated.
      if(silent || payload.type!=='event_appended' || !['move_recorded','turn_ended','moves_reverted'].includes(payload.reason))return false;
      if(!active())return opponentNotifications && payload.reason==='move_recorded' && isOpponentMove(payload.game,payload.clientCommandId,getIdentityId()) ? incoming(payload.game.id) : false;
      clearIncoming();
      let destroyed=false;
      for(let i=0;i<destructionBatches;i++)destroyed=play('destruction') || destroyed;
      if (!opponentNotifications && isOpponentMove(payload.game, payload.clientCommandId, getIdentityId())) return destroyed;
      if(terminal && previous?.terminal===false)return play(resultSound(getGameResult(payload.game,getIdentityId()))) || destroyed;
      if(localCommands.has(payload.clientCommandId) || terminal)return destroyed;
      if(destroyed)return true;
      if(payload.reason === "moves_reverted")return play("history-back");
      return play(state?.outcome?.status && state.outcome.status!=='ongoing'?'result':payload.reason==='turn_ended'?'turn':'move');
    },
  };
};
