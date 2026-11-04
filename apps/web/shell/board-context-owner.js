// Owns context lifetime and the exact committed Board intent. The app supplies
// the real account/route/displayed-view scope, never an authoritative substitute.
export function createBoardContextOwner({store,getScope,onRetire=()=>{},onIntentChange=()=>{}}) {
 let scope=null,epoch=0,intent=null;
 const retire=()=>{scope=null;epoch++;intent=null;store.clear();onRetire();};
 const sync=()=>{
  const next=getScope();
  if(!scope||scope.owner!==next.owner||scope.key!==next.key){
   if(scope)retire();
   scope=next;
  }
  return JSON.stringify([scope.key,epoch]);
 };
 return {
  scope:sync,
  retire,
  commit(value){sync();if(value===intent)return false;intent=value;onIntentChange();return true;},
  intent(){sync();return intent;},
  capture(){return {scope:sync(),intent};},
  current(token){return token?.scope===sync()&&token.intent===intent;},
 };
}

// A return belongs to the native intent that started it. New outside pointer,
// focus, key, window blur or hidden-page intent wins even if it focuses nothing.
// Replacing a host alone never turns body focus into permission to steal focus.
export function createBoardContextFocus({doc,owner,reveal=()=>{},enqueue=queueMicrotask}) {
 const win=doc.defaultView,returns=new Set();let disposed=false;
 const begin=(trigger,{allows=()=>false,allowRemoval=false,onRetire=()=>{}}={},activation=false)=>{
  const token=owner.capture(),original=doc.activeElement;
  let live=!disposed&&(activation||original===trigger)&&Boolean(trigger?.isConnected);
  const owned=target=>target===trigger||allows(target);
  const retire=()=>{if(!live)return;live=false;onRetire();};
  const focus=event=>{if(!owned(event.target))retire();};
  const pointer=event=>{if(!owned(event.target))retire();};
  const key=event=>{if(!owned(event.target)||event.key==='Tab')retire();};
  const visibility=()=>{if(doc.hidden)retire();};
  doc.addEventListener('focusin',focus);doc.addEventListener('pointerdown',pointer,true);doc.addEventListener('keydown',key,true);
  doc.addEventListener('visibilitychange',visibility);win.addEventListener('blur',retire);
  const release=()=>{
   retire();returns.delete(release);
   doc.removeEventListener('focusin',focus);doc.removeEventListener('pointerdown',pointer,true);doc.removeEventListener('keydown',key,true);
   doc.removeEventListener('visibilitychange',visibility);win.removeEventListener('blur',retire);
  };
  returns.add(release);
  const current=()=>live&&!disposed&&!doc.hidden&&owner.current(token)
   &&(owned(doc.activeElement)||(activation&&doc.activeElement===original)||(allowRemoval&&doc.activeElement===doc.body&&(!trigger.isConnected||trigger.closest?.('[inert]'))));
  const restoreNow=resolve=>{
   if(!current()){release();return null;}
   const target=resolve();
   if(target?.isConnected&&!target.disabled&&!target.closest?.('[inert]')){
    target.focus({preventScroll:true});
    if(doc.activeElement===target)reveal(target,()=>!disposed&&owner.current(token)&&doc.activeElement===target&&!doc.hidden);
   }
   release();return doc.activeElement===target?target:null;
  };
  return {
   current,release,restoreNow,
   consume(){const valid=current();release();return valid;},
   restore(resolve){return new Promise(done=>enqueue(()=>done(restoreNow(resolve))));},
  };
 };
 return {begin,
  // Explicit activation owns its continuation even on browsers that leave
  // native buttons unfocused. It grants no permission to move focus.
  activate(trigger,options){const {current,release,consume}=begin(trigger,options,true);return {current,release,consume};},
  retire(){for(const release of [...returns])release();},destroy(){disposed=true;this.retire();}};
}
