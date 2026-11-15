export function createPreviousTurnKeyInteraction(root,{doc=root?.ownerDocument,win=doc?.defaultView,getSupportsHover=()=>root?.dataset?.hoverCapability==='hover'}={}) {
  const control=()=>root?.querySelector?.('[data-previous-turn-key]');
  const currentEpisode=()=>root?.querySelector?.('#shell-board')?.getAttribute?.('data-previous-turn-episode')??null;
  let episode;
  const retire=()=>{
    const key=control();
    if(key?.hasAttribute('aria-pressed'))key.setAttribute('aria-pressed','false');
    key?.setAttribute('data-hover-retired','true');
    if(doc?.activeElement===key)key.blur();
  };
  const sync=()=>{
    const key=control();if(!key)return;
    const nextEpisode=currentEpisode();
    if(episode!==undefined&&episode!==nextEpisode)retire();
    episode=nextEpisode;
    if(getSupportsHover())key.removeAttribute('aria-pressed');
    else if(!key.hasAttribute('aria-pressed'))key.setAttribute('aria-pressed','false');
  };
  const pointerdown=event=>{if(event.target.closest?.('#shell-board .cell'))retire();};
  const pointermove=event=>{const key=event.target.closest?.('[data-previous-turn-key]');if(key){sync();key.removeAttribute('data-hover-retired');}};
  const click=event=>{
    const key=event.target.closest?.('[data-previous-turn-key]');
    if(!key)return;
    event.preventDefault();
    sync();if(!getSupportsHover())key.setAttribute('aria-pressed',String(key.getAttribute('aria-pressed')!=='true'));
  };
  const keydown=event=>{if(event.key==='Escape'||(['Enter',' '].includes(event.key)&&event.target.closest?.('#shell-board .cell')))retire();};
  const visibility=()=>{if(doc.hidden)retire();};
  root?.addEventListener('pointerdown',pointerdown,true);
  root?.addEventListener('pointermove',pointermove,true);
  root?.addEventListener('click',click);
  doc?.addEventListener('keydown',keydown,true);
  doc?.addEventListener('visibilitychange',visibility);
  win?.addEventListener('blur',retire);
  const mutations=win?.MutationObserver?new win.MutationObserver(sync):null;mutations?.observe(root,{childList:true,subtree:true,attributes:true,attributeFilter:['data-previous-turn-episode']});sync();
  return {sync,retire,destroy(){mutations?.disconnect();root?.removeEventListener('pointerdown',pointerdown,true);root?.removeEventListener('pointermove',pointermove,true);root?.removeEventListener('click',click);doc?.removeEventListener('keydown',keydown,true);doc?.removeEventListener('visibilitychange',visibility);win?.removeEventListener('blur',retire);}};
}
