import {displayedReplayMatchesPreviousTurnEpisode} from './displayed-replay.js';

const INITIAL_LABEL='Changes by opponent';
const REPLAY_LABEL='Replay';

export function createPreviousTurnKeyInteraction(root,{
  doc=root?.ownerDocument,
  win=doc?.defaultView,
  getSupportsHover=()=>root?.dataset?.hoverCapability==='hover',
  getReplayDescriptor=()=>null,
  onReplay=()=>false,
}={}) {
  const control=()=>root?.querySelector?.('[data-previous-turn-key]');
  const currentEpisode=()=>root?.querySelector?.('#shell-board')?.getAttribute?.('data-previous-turn-episode')??null;
  const supplied=(descriptor=getReplayDescriptor())=>{
    if(getSupportsHover())return false;
    const key=control(),current=currentEpisode();
    return Boolean(key&&current&&!key.closest?.('[inert],[hidden],[aria-hidden="true"]')&&displayedReplayMatchesPreviousTurnEpisode(descriptor,current));
  };
  let episode=null,stage='initial';
  const render=()=>{
    const key=control();if(!key)return;
    const replay=stage==='replay'&&!getSupportsHover();
    key.dataset.mobileStage=replay?'replay':'changes';
    const label=key.querySelector?.('[data-previous-turn-key-label]'),copy=replay?REPLAY_LABEL:INITIAL_LABEL;
    if(label?.textContent!==copy)label.replaceChildren(copy);
    const replayIcon=key.querySelector?.('.previous-turn-key-replay');if(replayIcon&&replayIcon.hidden===replay)replayIcon.hidden=!replay;
    if(getSupportsHover())key.removeAttribute('aria-pressed');else key.setAttribute('aria-pressed',String(replay));
    key.setAttribute('aria-label',replay?'Replay previous opponent turn':`${INITIAL_LABEL}. Activate to emphasize changed squares`);
  };
  const retire=()=>{
    stage='initial';
    const key=control();
    key?.setAttribute('data-hover-retired','true');
    render();
    if(doc?.activeElement===key)key.blur();
  };
  const sync=()=>{
    const nextEpisode=currentEpisode();
    if(episode!==nextEpisode){retire();episode=nextEpisode;}
    render();
  };
  const pointerdown=event=>{if(event.target.closest?.('#shell-board .cell'))retire();};
  const pointermove=event=>{const key=event.target.closest?.('[data-previous-turn-key]');if(key){sync();key.removeAttribute('data-hover-retired');}};
  const click=event=>{
    const key=event.target.closest?.('[data-previous-turn-key]');
    if(!key)return;
    event.preventDefault();sync();
    if(getSupportsHover())return;
    if(stage==='initial'){
      if(!supplied())return;
      stage='replay';render();return;
    }
    const descriptor=getReplayDescriptor();
    if(!supplied(descriptor)||onReplay({episode,currentEpisode:currentEpisode(),descriptor,trigger:key})!==true)retire();
  };
  const keydown=event=>{if(event.key==='Escape'||(['Enter',' '].includes(event.key)&&event.target.closest?.('#shell-board .cell')))retire();};
  const visibility=()=>{if(doc.hidden)retire();};
  root?.addEventListener('pointerdown',pointerdown,true);
  root?.addEventListener('pointermove',pointermove,true);
  root?.addEventListener('click',click);
  doc?.addEventListener('keydown',keydown,true);
  doc?.addEventListener('visibilitychange',visibility);
  win?.addEventListener('blur',retire);
  const mutations=win?.MutationObserver?new win.MutationObserver(sync):null;
  mutations?.observe(root,{childList:true,subtree:true,attributes:true,attributeFilter:['data-previous-turn-episode','data-shell-layout-mode','data-hover-capability','hidden','inert','aria-hidden']});sync();
  return {sync,retire,supplies:supplied,destroy(){mutations?.disconnect();root?.removeEventListener('pointerdown',pointerdown,true);root?.removeEventListener('pointermove',pointermove,true);root?.removeEventListener('click',click);doc?.removeEventListener('keydown',keydown,true);doc?.removeEventListener('visibilitychange',visibility);win?.removeEventListener('blur',retire);}};
}
