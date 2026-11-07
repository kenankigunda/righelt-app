// Test-only passive observation. No focus, scroll, timeout or authority action.
export function installNativeFocusTrail(originalPrimary,profile){
 const name='__RIGHELT_NATIVE_FOCUS_TRAIL__';
 if(window[name])throw Error('Native focus observation already installed');
 const tokens=new WeakMap(),events=[];let next=0,dropped=0,projectionErrors=0,cleanupErrors=0,closed=false,currentPrimary=originalPrimary;
 const token=node=>{if(!node||typeof node!=='object')return null;if(!tokens.has(node))tokens.set(node,++next);return tokens.get(node);};
 const project=node=>{
  if(!(node instanceof Element))return {token:token(node),kind:node===document?'document':node===window?'window':'other'};
  const style=getComputedStyle(node),rect=node.getBoundingClientRect(),ancestors=[];
  for(let parent=node.parentElement;parent&&ancestors.length<8;parent=parent.parentElement){const s=getComputedStyle(parent);if(s.overflowX!=='visible'||s.overflowY!=='visible'||s.clipPath!=='none'||parent.hasAttribute('inert'))ancestors.push({tag:parent.tagName,inert:parent.hasAttribute('inert'),overflowX:s.overflowX,overflowY:s.overflowY,clipPath:s.clipPath});}
  return {token:token(node),tag:node.tagName,connected:node.isConnected,tabIndex:node.tabIndex,disabled:Boolean(node.disabled),action:node.getAttribute('data-board-message-action'),panel:node.getAttribute('data-panel'),role:node.getAttribute('role'),inert:Boolean(node.closest('[inert]')),display:style.display,visibility:style.visibility,position:style.position,rect:rect.toJSON(),ancestors};
 };
 const sample=(kind,event)=>{
  if(closed)return;
  if(events.length===256){dropped++;return;}
  try{events.push({kind,at:performance.now(),trusted:event?.isTrusted??null,key:event?.key??null,alt:Boolean(event?.altKey),shift:Boolean(event?.shiftKey),defaultPrevented:Boolean(event?.defaultPrevented),documentFocused:document.hasFocus(),hidden:document.hidden,scrollY,viewport:{width:innerWidth,height:innerHeight},active:project(document.activeElement),target:project(event?.target),originalPrimary:project(originalPrimary),currentPrimary:project(currentPrimary),samePrimary:currentPrimary===originalPrimary,activeIsCurrent:document.activeElement===currentPrimary});}catch(error){projectionErrors++;events.push({kind:'projection-error',sourceKind:kind,name:error?.name??'Error'});}
 };
 const registrations=[];
 for(const [target,type,capture]of [[document,'keydown',true],[window,'keydown',false],[document,'focusin',true],[document,'focusout',true],[window,'blur',false],[window,'focus',false],[document,'visibilitychange',false]]){
  const listener=event=>{if(type!=='keydown'||event.key==='Tab')sample(type+(capture?'-capture':'-bubble'),event);};
  target.addEventListener(type,listener,capture);registrations.push({target,type,listener,capture});
 }
 window[name]={checkpoint(node){currentPrimary=node;sample('checkpoint');return node===document.activeElement;},finish(){try{sample('finish');}finally{closed=true;for(const r of registrations){try{r.target.removeEventListener(r.type,r.listener,r.capture);}catch{cleanupErrors++;}}try{delete window[name];}catch{cleanupErrors++;}}return {schema:1,profile,events,dropped,projectionErrors,cleanupErrors,complete:dropped===0&&projectionErrors===0&&cleanupErrors===0};}};
 sample('installed');
}
export function nativeFocusCheckpoint(current){
 const observer=window.__RIGHELT_NATIVE_FOCUS_TRAIL__;
 if(!observer)throw Error('Native focus observer missing');
 return observer.checkpoint(current);
}
export function finishNativeFocusTrail(){
 const observer=window.__RIGHELT_NATIVE_FOCUS_TRAIL__;
 if(!observer)throw Error('Native focus observer missing at teardown');
 return observer.finish();
}
