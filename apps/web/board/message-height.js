import {messageHeightTarget,messageHeightTransition} from './message-composition.js';

// Own only presentation height. Authority and semantic message updates remain
// synchronous; native presses defer board movement, never gameplay intent.
export function createMessageHeightController(label) {
 const slot=label?.closest?.('.board-message-slot'),doc=label?.ownerDocument,win=doc?.defaultView;
 if(!slot||!win?.ResizeObserver||!win?.MutationObserver)return {destroy(){}};
 const live=slot.querySelector('.board-message-live'),replicas=[...slot.querySelectorAll('.board-message-sizing')];
 let disposed=false,frame=null,animation=null,initial=true,metricChange=true,pointer=false,key=false,lastTarget=null,lastWidth=null;
 const measure=()=>{
  frame=null;if(disposed||!slot.isConnected)return;
  const width=slot.getBoundingClientRect().width;
  if(lastWidth!==null&&width!==lastWidth)metricChange=true;
  lastWidth=width;
  const floor=font=>Math.max(0,...replicas.filter(node=>node.dataset.sizingFont===font).map(node=>node.getBoundingClientRect().height));
  const target=messageHeightTarget({primaryRoutine:floor('primary'),fallbackRoutine:floor('fallback'),current:live.getBoundingClientRect().height});
  if(target===lastTarget&&!metricChange)return;
  const from=slot.getBoundingClientRect().height;
  const change=messageHeightTransition({from,to:target,initial,metricChange,reducedMotion:win.matchMedia('(prefers-reduced-motion: reduce)').matches,pressing:pointer||key});
  if(change.kind==='defer')return;
  animation?.cancel();animation=null;slot.dataset.heightManaged='true';slot.style.height=`${target}px`;lastTarget=target;
  if(change.kind==='animate'&&slot.animate)animation=slot.animate([{height:`${from}px`},{height:`${target}px`}],{duration:change.duration,easing:change.easing});
  initial=false;metricChange=false;
 };
 const schedule=()=>{if(!disposed&&frame===null)frame=win.requestAnimationFrame(measure);};
 const metrics=()=>{metricChange=true;schedule();};
 const resize=new win.ResizeObserver(schedule);for(const node of [live,...replicas])resize.observe(node);
 const mutations=new win.MutationObserver(schedule);mutations.observe(live,{subtree:true,childList:true,characterData:true,attributes:true});
 const starts=event=>{if(!label.contains(event.target?.closest?.('button')))return;if(event.type==='pointerdown')pointer=true;else if(event.key==='Enter'||event.key===' ')key=true;};
 const ends=event=>{if(event.type.startsWith('pointer'))pointer=false;else if(event.key==='Enter'||event.key===' ')key=false;schedule();};
 const retirePress=()=>{pointer=false;key=false;metricChange=true;schedule();};
 label.addEventListener('pointerdown',starts,true);label.addEventListener('keydown',starts,true);
 for(const type of ['pointerup','pointercancel','keyup'])doc.addEventListener(type,ends,true);
 win.addEventListener('resize',metrics);win.addEventListener('blur',retirePress);doc.addEventListener('visibilitychange',retirePress);doc.fonts?.addEventListener?.('loadingdone',metrics);
 const motion=win.matchMedia('(prefers-reduced-motion: reduce)');motion.addEventListener?.('change',metrics);
 measure();
 return {destroy(){disposed=true;if(frame!==null)win.cancelAnimationFrame(frame);animation?.cancel();resize.disconnect();mutations.disconnect();label.removeEventListener('pointerdown',starts,true);label.removeEventListener('keydown',starts,true);for(const type of ['pointerup','pointercancel','keyup'])doc.removeEventListener(type,ends,true);win.removeEventListener('resize',metrics);win.removeEventListener('blur',retirePress);doc.removeEventListener('visibilitychange',retirePress);doc.fonts?.removeEventListener?.('loadingdone',metrics);motion.removeEventListener?.('change',metrics);slot.style.removeProperty('height');delete slot.dataset.heightManaged;}};
}
