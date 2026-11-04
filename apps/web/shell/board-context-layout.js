import {renderBoardContext} from './board-context.js';

// Reserve the same bounded view before context exists. Message arrival, hover
// and dismissal never participate in this measurement or move the Board.
export function createBoardContextLayout(doc=document) {
 const win=doc.defaultView;
 let key=null,frameOwner=null,probe=null,raf=null,pointer=false,keyboard=false,nativeKey=false,probeObserver=null,disposed=false,intentEpoch=0;
 const observedBodies=new Set();
 const syncOverflow=()=>{
  if(disposed)return;
  const current=new Set();
  for(const body of doc.querySelectorAll('.board-context-body')){
   const overflow=body.scrollHeight>body.clientHeight+1;body.tabIndex=overflow?0:-1;
   body.closest('.board-context-notice')?.setAttribute('data-context-overflow',String(overflow));
   // The natural content can change while its capped scrollport stays fixed.
   current.add(body);if(body.firstElementChild)current.add(body.firstElementChild);
  }
  for(const node of observedBodies)if(!current.has(node)){bodyObserver?.unobserve(node);observedBodies.delete(node);}
  for(const node of current)if(!observedBodies.has(node)){bodyObserver?.observe(node);observedBodies.add(node);}
 };
 const bodyObserver=win.ResizeObserver?new win.ResizeObserver(syncOverflow):null;
 const measure=()=>{
  raf=null;if(disposed)return;
  const app=doc.getElementById('app'),frame=app?.querySelector('[data-game-shell-root]');
  if(!frame||app.dataset.shellLayoutMode!=='narrow'){frame?.style.removeProperty('--board-context-reserve');frameOwner=null;key=null;return;}
  // A replacement frame has not painted yet and needs its initial reservation.
  // Existing frames still defer metric changes throughout a native press.
  if((pointer||nativeKey)&&frameOwner===frame)return;
  const anchor=app.querySelector('.shell-header-status'),heading=frame.querySelector('.board-heading');
  if(!anchor||!heading)return;
  const style=win.getComputedStyle(frame),width=anchor.getBoundingClientRect().width;
  const nextKey=`${win.innerWidth}:${win.innerHeight}:${width}:${style.fontSize}:${style.fontFamily}`;
  if(key===nextKey&&frameOwner===frame)return;
  if(!probe){
   probe=doc.createElement('div');probe.className='board-context-sizing';probe.setAttribute('aria-hidden','true');probe.inert=true;
   probe.innerHTML=renderBoardContext({key:'sizing',message:{text:'Board explanation'},replay:{}});
   doc.body.append(probe);if(win.ResizeObserver){probeObserver=new win.ResizeObserver(metrics);probeObserver.observe(probe);}
  }
  probe.style.width=`${width}px`;
  const previous=parseFloat(frame.style.getPropertyValue('--board-context-reserve'))||0;
  const naturalTop=heading.getBoundingClientRect().top-previous;
  const clearance=Math.max(0,Math.ceil(anchor.getBoundingClientRect().top+probe.getBoundingClientRect().height+12-naturalTop));
  frame.style.setProperty('--board-context-reserve',`${clearance}px`);
  frameOwner=frame;key=nextKey;
 };
 const schedule=()=>{if(!disposed&&raf===null)raf=win.requestAnimationFrame(measure);};
 const metrics=()=>{syncOverflow();key=null;schedule();};
 const reveal=(original,isCurrent=()=>doc.activeElement===original,{immediate=false}={})=>{
  const epoch=intentEpoch,frame=doc.getElementById('app')?.querySelector('[data-game-shell-root]'),gameId=frame?.dataset?.gameId;
  const apply=()=>{
   const currentFrame=doc.getElementById('app')?.querySelector('[data-game-shell-root]');
   if(disposed||doc.hidden||epoch!==intentEpoch||currentFrame!==frame||currentFrame?.dataset?.gameId!==gameId||pointer||!isCurrent()||doc.activeElement!==original||!original.isConnected)return;
   const app=doc.getElementById('app'),notice=app?.querySelector('[data-alert-stack-card].is-active'),nav=app?.querySelector('.shell-mobile-tabbar');
   if(app?.dataset.shellLayoutMode!=='narrow')return;
   const top=notice?.getBoundingClientRect().bottom??0,navRect=nav?.getBoundingClientRect();
   const bottom=navRect?.height?navRect.top:win.innerHeight,rect=original.getBoundingClientRect();
   if(rect.top>=top+8&&rect.bottom<=bottom-8)return;
   original.style.scrollMarginBlockStart=`${top+8}px`;
   original.style.scrollMarginBlockEnd=`${Math.max(0,win.innerHeight-bottom)+8}px`;
   // Only explicit native focus or a still-owned user action may reveal Board.
   original.scrollIntoView({block:'nearest',inline:'nearest',behavior:'instant'});
  };
  if(immediate)apply();else queueMicrotask(apply);
 };
 const focus=event=>{
  const target=event.target;
  if(!keyboard||pointer||!target?.matches?.('#shell-board-preview-label button,#shell-board .cell,#shell-board,.board-message-live'))return;
  reveal(target);
 };
 const down=()=>{intentEpoch++;pointer=true;keyboard=false;};
 const up=()=>{pointer=false;schedule();};
 const keyup=event=>{if(event.key==='Enter'||event.key===' '){nativeKey=false;schedule();}};
 const retire=()=>{intentEpoch++;pointer=false;nativeKey=false;key=null;schedule();};
 const keys=event=>{intentEpoch++;if(!['Shift','Control','Alt','Meta'].includes(event.key))keyboard=true;if(event.key==='Enter'||event.key===' ')nativeKey=true;};
 doc.addEventListener('focusin',focus);doc.addEventListener('pointerdown',down,true);
 doc.addEventListener('pointerup',up,true);doc.addEventListener('pointercancel',up,true);doc.addEventListener('keydown',keys,true);doc.addEventListener('keyup',keyup,true);
 win.addEventListener('blur',retire);doc.addEventListener('visibilitychange',retire);win.addEventListener('resize',metrics);doc.fonts?.addEventListener?.('loadingdone',metrics);
 return {
  reveal,
  sync(){measure();syncOverflow();},
  destroy(){disposed=true;if(raf!==null)win.cancelAnimationFrame(raf);probeObserver?.disconnect();bodyObserver?.disconnect();observedBodies.clear();probe?.remove();frameOwner?.style.removeProperty('--board-context-reserve');doc.removeEventListener('focusin',focus);doc.removeEventListener('pointerdown',down,true);doc.removeEventListener('pointerup',up,true);doc.removeEventListener('pointercancel',up,true);doc.removeEventListener('keydown',keys,true);doc.removeEventListener('keyup',keyup,true);win.removeEventListener('blur',retire);doc.removeEventListener('visibilitychange',retire);win.removeEventListener('resize',metrics);doc.fonts?.removeEventListener?.('loadingdone',metrics);},
 };
}
