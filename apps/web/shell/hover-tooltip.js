import {placeEventLabels} from '../board/event-labels.js';

/** Decorative hover mirror of an existing accessible name; no extra focus stop. */
export function mountHoverTooltips(root) {
  const doc=root.ownerDocument,view=doc.defaultView;
  let anchor=null,node=null,hideTimer,dismissed=null;
  const cancelHide=()=>{view.clearTimeout(hideTimer);};
  const hide=()=>{cancelHide();node?.remove();node=null;anchor=null;};
  const place=()=>{
    if(!node||!anchor?.isConnected||doc.hidden){hide();return;}
    const visual=view.visualViewport,bounds={left:visual?.offsetLeft??0,top:visual?.offsetTop??0,width:visual?.width??view.innerWidth,height:visual?.height??view.innerHeight};
    node.style.maxWidth=`${Math.max(1,bounds.width-16)}px`;
    const rect=node.getBoundingClientRect(),position=placeEventLabels({viewport:bounds,items:[{id:'tooltip',anchor:anchor.getBoundingClientRect(),width:rect.width,height:rect.height}]})[0];
    if(position){node.style.left=`${position.left}px`;node.style.top=`${position.top}px`;}
  };
  const over=event=>{
    if(event.pointerType==='touch')return;
    if(node?.contains(event.target)){cancelHide();return;}
    const next=event.target.closest?.('[data-tooltip]');
    if(!next||!root.contains(next)||next===dismissed)return;
    if(next===anchor){cancelHide();return;}
    hide();anchor=next;node=doc.createElement('span');node.className='hover-tooltip';node.setAttribute('aria-hidden','true');node.textContent=next.dataset.tooltip;doc.body.append(node);place();
  };
  const out=event=>{
    if(dismissed?.contains(event.target)&&!dismissed.contains(event.relatedTarget))dismissed=null;
    if(!anchor)return;
    if(anchor.contains(event.relatedTarget)||node?.contains(event.relatedTarget)){cancelHide();return;}
    if(anchor.contains(event.target)||node?.contains(event.target))hideTimer=view.setTimeout(hide,150);
  };
  const key=event=>{if(event.key==='Escape'){if(anchor)dismissed=anchor;hide();}};
  const visibility=()=>{if(doc.hidden){dismissed=null;hide();}};
  const mutation=new view.MutationObserver(()=>{if(dismissed&&!dismissed.isConnected)dismissed=null;if(anchor&&!anchor.isConnected)hide();else if(anchor&&node){node.textContent=anchor.dataset.tooltip;place();}});
  mutation.observe(root,{childList:true,subtree:true,attributes:true,attributeFilter:['data-tooltip']});
  doc.addEventListener('pointerover',over);doc.addEventListener('pointerout',out);doc.addEventListener('keydown',key);doc.addEventListener('visibilitychange',visibility);view.addEventListener('resize',hide);view.addEventListener('scroll',hide,true);
  return {destroy(){hide();mutation.disconnect();doc.removeEventListener('pointerover',over);doc.removeEventListener('pointerout',out);doc.removeEventListener('keydown',key);doc.removeEventListener('visibilitychange',visibility);view.removeEventListener('resize',hide);view.removeEventListener('scroll',hide,true);}};
}
