// Decorative waiting only. This owner never drives route reads or readiness.
export const ROUTE_HELD_PULSE_DELAY_MS = 200;
const eligible = state => Boolean(state?.owner && state.scope && state.scope === state.pendingScope
  && state.current && state.phase === 'covered' && state.pending === true && !state.ready
  && !state.failure && state.visible && !state.reducedMotion);

export function createRouteHeldPulse({getState,onChange,setTimer=setTimeout,clearTimer=clearTimeout,delayMs=ROUTE_HELD_PULSE_DELAY_MS}) {
  let waiting=null,timer=null,pulsing=false,disposed=false;
  const paint=value=>{if(value!==pulsing){pulsing=value;onChange(value);}};
  const stop=()=>{waiting=null;if(timer!==null)clearTimer(timer);timer=null;paint(false);};
  const update=()=>{
    if(disposed)return;
    const state=getState();
    if(!eligible(state)){stop();return;}
    if(waiting?.owner===state.owner && waiting.scope===state.scope)return;
    stop();
    const owned={owner:state.owner,scope:state.scope};waiting=owned;
    timer=setTimer(()=>{
      if(disposed||waiting!==owned)return;
      timer=null;
      const now=getState();
      if(!eligible(now)||now.owner!==owned.owner||now.scope!==owned.scope){stop();return;}
      paint(true);
    },delayMs);
  };
  return {update,stop,destroy(){if(disposed)return;disposed=true;stop();}};
}

// Real event binding shared by the app and integration proof. Dependencies are
// read lazily so mounting cannot adopt or mutate route/recovery ownership.
export function mountRouteHeldPulse({element,document,window,getState}) {
  let pageHidden=false,disposed=false;
  const media=window.matchMedia?.('(prefers-reduced-motion: reduce)');
  element.setAttribute('data-held-pulse','false');
  const owner=createRouteHeldPulse({
    getState:()=>({...getState(),visible:!document.hidden&&!pageHidden,reducedMotion:media?.matches===true}),
    onChange:active=>element.setAttribute('data-held-pulse',String(active)),
    setTimer:(callback,ms)=>window.setTimeout(callback,ms),clearTimer:id=>window.clearTimeout(id),
  });
  const update=()=>owner.update();
  const hide=()=>{pageHidden=true;owner.stop();};
  const show=()=>{pageHidden=false;owner.update();};
  document.addEventListener('visibilitychange',update);
  window.addEventListener('pagehide',hide);window.addEventListener('pageshow',show);
  media?.addEventListener?.('change',update);
  return {update,stop:()=>owner.stop(),destroy(){if(disposed)return;disposed=true;owner.destroy();document.removeEventListener('visibilitychange',update);window.removeEventListener('pagehide',hide);window.removeEventListener('pageshow',show);media?.removeEventListener?.('change',update);element.setAttribute('data-held-pulse','false');}};
}
