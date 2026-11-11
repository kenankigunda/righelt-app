// The finite prompt never participates in message-driven size growth. A separate
// Board-wrap clearance centers the actual grid where the viewport has room.
// Floating notices and incoming narration are deliberately absent from metrics.
export function createBoardContextLayout(doc=document) {
 const win=doc.defaultView;
 let key=null,frameOwner=null,raf=null,pointer=false,keyboard=false,nativeKey=false,disposed=false,intentEpoch=0;
 const observedBodies=new Set();
 const syncOverflow=()=>{
  if(disposed)return;
  const current=new Set();
  for(const body of doc.querySelectorAll('.board-context-body')){
   const overflow=body.scrollHeight>body.clientHeight+1;body.tabIndex=overflow?0:-1;
   body.closest('.board-context-notice,.board-context-detail')?.setAttribute('data-context-overflow',String(overflow));
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
  const wrap=frame?.querySelector('[data-testid="game-board-wrap"]');
  if(!frame||app.dataset.shellLayoutMode!=='narrow'){
   frameOwner?.style.removeProperty('--board-center-clearance');wrap?.style.removeProperty('--board-center-clearance');frameOwner=null;key=null;return;
  }
  const grid=wrap?.querySelector('[data-testid="game-board"]'),legend=frame.querySelector('.overlay-key');
  if(!wrap||!grid||wrap.closest?.('[inert]'))return;
  // An unpainted replacement can admit its own initial geometry. A mounted
  // native press keeps the geometry it started with until its matching release.
  if((pointer||nativeKey)&&frameOwner===wrap)return;
  const rect=grid.getBoundingClientRect(),legendRect=legend?.getBoundingClientRect();
  const previous=parseFloat(wrap.style.getPropertyValue('--board-center-clearance'))||0;
  const scroll=Number.isFinite(win.scrollY)?win.scrollY:0,viewport=win.visualViewport;
  const top=Number.isFinite(viewport?.offsetTop)?viewport.offsetTop:0;
  const height=Number.isFinite(viewport?.height)?viewport.height:win.innerHeight;
  if(![rect.top,rect.height,height].every(Number.isFinite)||rect.height<=0||height<=0)return;
  const naturalCenter=rect.top+rect.height/2+scroll-previous;
  const naturalLegendBottom=legendRect?legendRect.bottom+scroll-previous:null;
  const style=win.getComputedStyle(frame);
  // Document coordinates make ordinary page scrolling a no-op. No scroll
  // listener, focus movement, Board remount or message-slot height is involved.
  const nextKey=JSON.stringify([win.innerWidth,height,top,naturalCenter,naturalLegendBottom,rect.height,style.fontSize,style.fontFamily]);
  if(key===nextKey&&frameOwner===wrap)return;
  const desired=Math.max(0,top+height/2-naturalCenter);
  const available=Number.isFinite(naturalLegendBottom)?Math.max(0,top+height-8-naturalLegendBottom):desired;
  const clearance=`${Math.max(0,Math.min(desired,available))}px`;
  if(wrap.style.getPropertyValue('--board-center-clearance')!==clearance)wrap.style.setProperty('--board-center-clearance',clearance);
  frameOwner=wrap;key=nextKey;
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
   const viewport=win.visualViewport,viewportTop=Number.isFinite(viewport?.offsetTop)?viewport.offsetTop:0;
   const viewportBottom=viewportTop+(Number.isFinite(viewport?.height)?viewport.height:win.innerHeight);
   const top=Math.max(viewportTop,notice?.getBoundingClientRect().bottom??0),navRect=nav?.getBoundingClientRect();
   const incoming=app.querySelector('.incoming-move-flyout');
   const incomingRect=incoming&&!incoming.closest?.('[inert],[hidden],[aria-hidden="true"]')?incoming.getBoundingClientRect():null;
   const bottom=Math.min(viewportBottom,navRect?.height?navRect.top:viewportBottom,incomingRect?.height?incomingRect.top:viewportBottom),rect=original.getBoundingClientRect();
   if(rect.top>=top+8&&rect.bottom<=bottom-8)return;
   // Native window scrolling may round to whole CSS pixels. Round the needed
   // distance outward so a fractional control edge still clears the full 8px.
   // The margin includes that rounding without a second scroll or retry loop.
   original.style.scrollMarginBlockStart=`${rect.top-Math.floor(rect.top-(top+8))}px`;
   original.style.scrollMarginBlockEnd=`${win.innerHeight-rect.bottom+Math.ceil(rect.bottom-(bottom-8))}px`;
   // Only explicit native focus or a still-owned user action may reveal Board.
   original.scrollIntoView({block:'nearest',inline:'nearest',behavior:'instant'});
  };
  if(immediate)apply();else queueMicrotask(apply);
 };
 const focus=event=>{
  const target=event.target;
  if(!keyboard||pointer||!target?.matches?.('#shell-board-preview-label button,#shell-board .cell,#shell-board,.board-message-live,.board-context-detail button,.board-context-detail .board-context-body'))return;
  reveal(target);
 };
 const down=event=>{intentEpoch++;if(!pointer)pointer=String(event.pointerId??'native');keyboard=false;};
 const up=event=>{if(pointer!==String(event.pointerId??'native'))return;pointer=false;schedule();};
 const keyup=event=>{if(event.key===nativeKey){nativeKey=false;schedule();}};
 const retire=()=>{intentEpoch++;pointer=false;nativeKey=false;key=null;schedule();};
 const keys=event=>{intentEpoch++;if(!['Shift','Control','Alt','Meta'].includes(event.key))keyboard=true;if((event.key==='Enter'||event.key===' ')&&!nativeKey)nativeKey=event.key;};
 doc.addEventListener('focusin',focus);doc.addEventListener('pointerdown',down,true);
 doc.addEventListener('pointerup',up,true);doc.addEventListener('pointercancel',up,true);doc.addEventListener('keydown',keys,true);doc.addEventListener('keyup',keyup,true);
 win.addEventListener('blur',retire);doc.addEventListener('visibilitychange',retire);win.addEventListener('resize',metrics);win.visualViewport?.addEventListener('resize',metrics);win.visualViewport?.addEventListener('scroll',metrics);doc.fonts?.addEventListener?.('loadingdone',metrics);
 return {
  reveal,
  sync(){measure();syncOverflow();},
  destroy(){disposed=true;if(raf!==null)win.cancelAnimationFrame(raf);bodyObserver?.disconnect();observedBodies.clear();frameOwner?.style.removeProperty('--board-center-clearance');doc.removeEventListener('focusin',focus);doc.removeEventListener('pointerdown',down,true);doc.removeEventListener('pointerup',up,true);doc.removeEventListener('pointercancel',up,true);doc.removeEventListener('keydown',keys,true);doc.removeEventListener('keyup',keyup,true);win.removeEventListener('blur',retire);doc.removeEventListener('visibilitychange',retire);win.removeEventListener('resize',metrics);win.visualViewport?.removeEventListener('resize',metrics);win.visualViewport?.removeEventListener('scroll',metrics);doc.fonts?.removeEventListener?.('loadingdone',metrics);},
 };
}
