import {messageHeightTarget,messageHeightTransition} from './message-composition.js';

// Own only presentation height. Authority and semantic message updates remain
// synchronous; native presses defer board movement, never gameplay intent.
export function createMessageHeightController(label) {
 const slot=label?.closest?.('.board-message-slot'),doc=label?.ownerDocument,win=doc?.defaultView;
 if(!slot||!win?.ResizeObserver||!win?.MutationObserver)return {destroy(){}};
 const live=slot.querySelector('.board-message-live'),replicas=[...slot.querySelectorAll('.board-message-sizing')];
 let disposed=false,frame=null,animation=null,initial=true,metricChange=true,pointer=false,key=false,lastTarget=null,lastWidth=null,lastFont=null,pressedControl=null,pendingContent=null,publishingContent=false;
 const measure=(forceSnap=false)=>{
  if(forceSnap&&frame!==null)win.cancelAnimationFrame(frame);
  frame=null;if(disposed||!slot.isConnected)return;
  // Admit the managed box before measuring its guard or absolute replicas.
  slot.dataset.heightManaged='true';
  if(pendingContent&&!pointer&&!key){const publish=pendingContent;pendingContent=null;publish();}
  const width=slot.getBoundingClientRect().width;
  if(lastWidth!==null&&width!==lastWidth)metricChange=true;
  lastWidth=width;
  const font=win.getComputedStyle?.(live);
  const fontKey=font?`${font.fontSize}:${font.fontFamily}:${font.lineHeight}`:null;
  if(lastFont!==null&&fontKey!==lastFont)metricChange=true;
  lastFont=fontKey;
  const floor=font=>Math.max(0,...replicas.filter(node=>node.dataset.sizingFont===font).map(node=>node.getBoundingClientRect().height));
  const slotStyle=win.getComputedStyle?.(slot);
  const outerPadding=(parseFloat(slotStyle?.paddingTop)||0)+(parseFloat(slotStyle?.paddingBottom)||0);
  const target=messageHeightTarget({primaryRoutine:floor('primary'),fallbackRoutine:floor('fallback'),current:live.getBoundingClientRect().height})+outerPadding;
  if(target===lastTarget&&!metricChange&&!forceSnap)return;
  const from=slot.getBoundingClientRect().height;
  const change=messageHeightTransition({from,to:target,initial,metricChange:metricChange||forceSnap,reducedMotion:win.matchMedia('(prefers-reduced-motion: reduce)').matches,pressing:pointer||key});
  if(change.kind==='defer')return;
  animation?.cancel();animation=null;slot.dataset.heightManaged='true';slot.style.height=`${target}px`;lastTarget=target;
  if(change.kind==='animate'&&slot.animate)animation=slot.animate([{height:`${from}px`},{height:`${target}px`}],{duration:change.duration,easing:change.easing});
  initial=false;metricChange=false;
 };
 const schedule=()=>{if(!disposed&&frame===null)frame=win.requestAnimationFrame(()=>measure());};
 const metrics=()=>{metricChange=true;schedule();};
 const resize=new win.ResizeObserver(schedule);for(const node of [live,...replicas])resize.observe(node);
 const mutations=new win.MutationObserver(schedule);mutations.observe(live,{subtree:true,childList:true,characterData:true,attributes:true});
 const starts=event=>{
  const button=event.target?.closest?.('button');
  const ownMessage=button&&label.contains(button),ownCell=button?.matches?.('.cell')&&label.closest('[data-shell-panel="board"]')?.contains(button);
  if(!ownMessage&&!ownCell)return;
  if(event.type==='pointerdown')pointer=true;else if(event.key==='Enter'||event.key===' ')key=true;else return;
  pressedControl=ownMessage?button:null;
  // A press can begin halfway through an earlier expansion/collapse. Freeze
  // that actual interpolated box before any further native hit testing.
  if(animation){const height=slot.getBoundingClientRect().height;animation.cancel();animation=null;slot.style.height=`${height}px`;lastTarget=null;}
 };
 const ends=event=>{if(event.type.startsWith('pointer'))pointer=false;else if(event.key==='Enter'||event.key===' ')key=false;schedule();};
 const retirePress=()=>{pointer=false;key=false;metricChange=true;schedule();};
 doc.addEventListener('pointerdown',starts,true);doc.addEventListener('keydown',starts,true);
 for(const type of ['pointerup','pointercancel','keyup'])doc.addEventListener(type,ends,true);
 win.addEventListener('resize',metrics);win.addEventListener('blur',retirePress);doc.addEventListener('visibilitychange',retirePress);doc.fonts?.addEventListener?.('loadingdone',metrics);
 const motion=win.matchMedia('(prefers-reduced-motion: reduce)');motion.addEventListener?.('change',metrics);
 measure();
 return {
 deferContent(html,publish){
  if(publishingContent)return false;
  const active=doc.activeElement;
  const focused=active?.matches?.('button')&&label.contains(active)?active:null;
  const control=pressedControl||focused;
  if(!control){pendingContent=null;return false;}
  const next=doc.createElement('span');next.innerHTML=html;
  const attribute=control.hasAttribute('data-board-message-action')?'data-board-message-action':'data-board-preview-action';
  const id=control.getAttribute(attribute);
  const candidate=[...next.querySelectorAll('button')].find(node=>node.getAttribute(attribute)===id);
  const survives=candidate&&candidate.disabled===control.disabled&&candidate.textContent===control.textContent;
  if((pointer||key)&&pressedControl){
   if(survives){pendingContent=publish;return true;}
   pointer=false;key=false;pressedControl=null;pendingContent=null;return false;
  }
  pendingContent=null;
  if(!focused||!survives||focused.disabled)return false;
  // Publish through the full runtime path, including its final availability
  // sync. Only this nested publication bypasses this interception.
  publishingContent=true;
  try{
   publish();
   if(doc.activeElement===focused&&label.contains(focused)&&!focused.disabled){
    const rect=focused.getBoundingClientRect(),box=slot.getBoundingClientRect();
    const style=win.getComputedStyle?.(focused);
    const ring=(parseFloat(style?.outlineWidth)||0)+Math.max(0,parseFloat(style?.outlineOffset)||0);
    const half=Math.max(44,rect.height)/2;
    const center=rect.top+rect.height/2;
    if(center-half-ring<box.top||center+half+ring>box.bottom)measure(true);
   }
  }finally{publishingContent=false;}
  return true;
 },
 destroy(){disposed=true;pendingContent=null;pressedControl=null;if(frame!==null)win.cancelAnimationFrame(frame);animation?.cancel();resize.disconnect();mutations.disconnect();doc.removeEventListener('pointerdown',starts,true);doc.removeEventListener('keydown',starts,true);for(const type of ['pointerup','pointercancel','keyup'])doc.removeEventListener(type,ends,true);win.removeEventListener('resize',metrics);win.removeEventListener('blur',retirePress);doc.removeEventListener('visibilitychange',retirePress);doc.fonts?.removeEventListener?.('loadingdone',metrics);motion.removeEventListener?.('change',metrics);slot.style.removeProperty('height');delete slot.dataset.heightManaged;}};
}
