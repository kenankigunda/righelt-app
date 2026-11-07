// Preserve an already focused History heading through one synchronous shell
// replacement. Native input and account/route scope retire the old ownership.
export function createHistoryHeadingFocus({doc,getScope}) {
 const win=doc.defaultView;let current=null,disposed=false;
 const heading=node=>Boolean(node?.matches?.('[data-game-panel="history"] h2'));
 const usable=node=>node?.isConnected&&!node.closest?.('[inert]')&&!doc.hidden&&doc.hasFocus?.()!==false;
 const retire=()=>{current=null;};
 const onFocus=event=>{
  if(!disposed&&heading(event.target)&&usable(event.target))current={node:event.target,scope:getScope()};
  else retire();
 };
 const onPointer=event=>{if(current&&!current.node.contains(event.target))retire();};
 const onKey=event=>{if(current&&(event.key==='Tab'||!current.node.contains(event.target)))retire();};
 const onVisibility=()=>{if(doc.hidden)retire();};
 doc.addEventListener('focusin',onFocus);doc.addEventListener('pointerdown',onPointer,true);doc.addEventListener('mousedown',onPointer,true);doc.addEventListener('keydown',onKey,true);
 doc.addEventListener('visibilitychange',onVisibility);win.addEventListener('blur',retire);
 return {
  capture(){
   if(disposed||!current||!usable(current.node)||doc.activeElement!==current.node||current.scope!==getScope()){retire();return null;}
   return current;
  },
  restore(token,resolve){
   if(!token||token!==current||disposed)return false;
   if(doc.hidden||doc.hasFocus?.()===false||token.scope!==getScope()){retire();return false;}
   if(token.node.isConnected)return false;
   if(doc.activeElement!==doc.body){retire();return false;}
   const replacement=resolve();
   // No pending retry: only this commit can transfer the existing focus.
   if(!heading(replacement)||!usable(replacement)){retire();return false;}
   replacement.tabIndex=-1;replacement.focus({preventScroll:true});
   const restored=doc.activeElement===replacement;
   if(!restored)retire();
   return restored;
  },
  retire,
  destroy(){disposed=true;retire();doc.removeEventListener('focusin',onFocus);doc.removeEventListener('pointerdown',onPointer,true);doc.removeEventListener('mousedown',onPointer,true);doc.removeEventListener('keydown',onKey,true);doc.removeEventListener('visibilitychange',onVisibility);win.removeEventListener('blur',retire);},
 };
}
