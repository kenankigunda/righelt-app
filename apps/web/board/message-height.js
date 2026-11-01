import {messageHeightTarget,messageHeightTransition} from './message-composition.js';

// Own only presentation height. Authority and semantic message updates remain
// synchronous; native presses defer board movement, never gameplay intent.
export function createMessageHeightController(label) {
 const slot=label?.closest?.('.board-message-slot'),doc=label?.ownerDocument,win=doc?.defaultView;
 if(!slot||!win?.ResizeObserver||!win?.MutationObserver)return {destroy(){}};
 const live=slot.querySelector('.board-message-live'),replicas=[...slot.querySelectorAll('.board-message-sizing')];
 let disposed=false,frame=null,animation=null,initial=true,metricChange=true,pointer=false,key=false,lastTarget=null,lastWidth=null,lastFont=null,pressedControl=null,pendingContent=null;
 const measure=()=>{
  frame=null;if(disposed||!slot.isConnected)return;
  if(pendingContent&&!pointer&&!key){const publish=pendingContent;pendingContent=null;publish();}
  const width=slot.getBoundingClientRect().width;
  if(lastWidth!==null&&width!==lastWidth)metricChange=true;
  lastWidth=width;
  const font=win.getComputedStyle?.(live);
  const fontKey=font?`${font.fontSize}:${font.fontFamily}:${font.lineHeight}`:null;
  if(lastFont!==null&&fontKey!==lastFont)metricChange=true;
  lastFont=fontKey;
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
 const starts=event=>{
  const button=event.target?.closest?.('button');
  const ownMessage=button&&label.contains(button),ownCell=button?.matches?.('.cell')&&label.closest('[data-shell-panel="board"]')?.contains(button);
  if(!ownMessage&&!ownCell)return;
  if(event.type==='pointerdown')pointer=true;else if(event.key==='Enter'||event.key===' ')key=true;else return;
  pressedControl=ownMessage?button:null;
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
  if(!(pointer||key)||!pressedControl){pendingContent=null;return false;}
  const next=doc.createElement('span');next.innerHTML=html;
  const attribute=pressedControl.hasAttribute('data-board-message-action')?'data-board-message-action':'data-board-preview-action';
  const id=pressedControl.getAttribute(attribute);
  const candidate=[...next.querySelectorAll('button')].find(node=>node.getAttribute(attribute)===id);
  if(candidate&&candidate.disabled===pressedControl.disabled&&candidate.textContent===pressedControl.textContent){pendingContent=publish;return true;}
  pointer=false;key=false;pressedControl=null;pendingContent=null;return false;
 },
 destroy(){disposed=true;pendingContent=null;pressedControl=null;if(frame!==null)win.cancelAnimationFrame(frame);animation?.cancel();resize.disconnect();mutations.disconnect();doc.removeEventListener('pointerdown',starts,true);doc.removeEventListener('keydown',starts,true);for(const type of ['pointerup','pointercancel','keyup'])doc.removeEventListener(type,ends,true);win.removeEventListener('resize',metrics);win.removeEventListener('blur',retirePress);doc.removeEventListener('visibilitychange',retirePress);doc.fonts?.removeEventListener?.('loadingdone',metrics);motion.removeEventListener?.('change',metrics);slot.style.removeProperty('height');delete slot.dataset.heightManaged;}};
}
