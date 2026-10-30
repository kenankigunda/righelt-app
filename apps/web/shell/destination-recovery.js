import {createForegroundRecoveryWait} from './foreground-recovery.js';
import {SYNC_TIMING} from '../generated/packages/shared-types/src/sync-protocol.js';

export const destinationFailureKind = error => {
  const code = error?.code ?? error?.message ?? '';
  if (['upgrade_required','protocol_mismatch'].includes(code)) return 'upgrade';
  if (/invalid_(snapshot|response|confirmation)|integrity|corrupt/.test(code)) return 'integrity';
  if ([401,403].includes(error?.status) || ['invalid_credentials','account_required','session_expired','invalid_session','unauthorized','forbidden'].includes(code)) return 'auth';
  if ([404,410].includes(error?.status) || ['game_not_found','not_found'].includes(code)) return 'missing';
  if (error?.status >= 500 || [408,429].includes(error?.status) || error?.name === 'TypeError' || error?.name === 'AbortError' || /network|fetch|timeout|offline|unavailable|connection/i.test(code)) return 'retry';
  return 'unavailable';
};

export const destinationRecoveryMessage = (state,route='game') => {
  if(!state?.show)return null;
  const destination=route==='home'?'your games':'your game';
  const messages={auth:'Sign in to open this game.',missing:'This game is no longer available.',upgrade:'Righelt has an update. Reload to keep playing.',integrity:'We couldn’t safely open this game. Try reloading.',unavailable:'We couldn’t open this game.'};
  const terminal=state.kind && state.kind!=='retry';
  return {message:terminal?messages[state.kind]:state.actions?`Still opening ${destination}. We’ll keep trying.`:`Opening ${destination}`,
    action:terminal?state.kind==='auth'?'signin':['upgrade','integrity','unavailable'].includes(state.kind)?'reload':null:state.actions?'retry':null,
    home:Boolean(terminal || state.actions)};
};

// This owner schedules reads only. Durable actions never enter its retry path.
export function createDestinationRecovery({clock=Date.now,setTimer=setTimeout,clearTimer=clearTimeout,onChange=()=>{},onRetry=()=>{}}={}) {
  let state=null,timer=null,active=true,attempt=0;
  const wait=createForegroundRecoveryWait({clock,setTimer,clearTimer,onChange});
  const cancelRetry=()=>{if(timer!==null)clearTimer(timer);timer=null;};
  const reset=()=>{cancelRetry();wait.reset();state=null;attempt=0;};
  const schedule=()=>{
    if(!active || !state || state.pending || state.kind!=='retry' || timer!==null)return;
    const owner=state;
    const delay=SYNC_TIMING.retryDelaysMs[Math.min(attempt,SYNC_TIMING.retryDelaysMs.length-1)];
    timer=setTimer(()=>{timer=null;if(state===owner && active){attempt++;onRetry();}},delay);
  };
  return {
    reset,
    currentScope:()=>state?.scope,
    begin(scope,{blocked=true}={}){if(state?.scope!==scope)reset();cancelRetry();state={scope,pending:true,kind:null,blocked};},
    fail(scope,error){if(state?.scope!==scope)return;state={scope,pending:false,kind:destinationFailureKind(error),blocked:state.blocked};schedule();},
    update({scope,visible}){
      active=visible;
      if(state && state.scope!==scope)reset();
      if(!active)cancelRetry();else schedule();
      const elapsed=wait.update({scope,active,blocked:Boolean(state?.blocked)});
      return state ? {...state,elapsed,show:Boolean(state.kind && state.kind!=='retry') || Boolean(state.blocked && elapsed>=SYNC_TIMING.reconnectAlertMs),actions:elapsed>=SYNC_TIMING.confirmationBudgetMs} : null;
    },
    retry(){if(!state || state.kind && state.kind!=='retry')return;cancelRetry();onRetry();},
  };
}
