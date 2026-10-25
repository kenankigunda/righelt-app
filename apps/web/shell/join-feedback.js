// Join failures and keyboard focus belong to the exact invitation visit and
// account that submitted them. Deferred renders must restore focus at commit,
// rather than while an Enter gesture still holds the old control in the DOM.
const joinActions = new Set(["join-player", "join-viewer", "accept-invite-player", "accept-invite-viewer"]);
export function createJoinFeedback({getScope}) {
 let sequence=0,current=null,error=false;
 const same=(a,b)=>Boolean(a&&b&&a.gameId===b.gameId&&a.owner===b.owner&&a.generation===b.generation&&a.visit===b.visit&&a.route===b.route);
 const isCurrent=token=>Boolean(token&&current===token&&same(token.scope,getScope(token.scope.gameId)));
 const matchesFocus=(target,token)=>{
  const control=target?.closest?.('[data-action]');
  return Boolean(control&&control.getAttribute('data-action')===token.focusAction&&control.getAttribute('data-game-id')===token.scope.gameId);
 };
 return {
  begin(gameId,{focusAction=null}={}){error=false;current={sequence:++sequence,scope:getScope(gameId),focusAction:joinActions.has(focusAction)?focusAction:null};return current;},
  isCurrent,
  fail(token){if(!isCurrent(token))return false;error=true;return true;},
  complete(token){if(!isCurrent(token))return false;error=false;current=null;return true;},
  clear(){sequence++;current=null;error=false;},
  message(gameId){return error&&isCurrent(current)&&current.scope.gameId===gameId?'Could not join. Try again':null;},
  noteFocus(target){if(isCurrent(current)&&current.focusAction&&!matchesFocus(target,current))current.focusAction=null;},
  restoreFocus({document,root,previousActive}){
   const token=current;
   if(!error||!isCurrent(token)||!token.focusAction)return false;
   if(previousActive!==document.body&&!matchesFocus(previousActive,token)){token.focusAction=null;return false;}
   if(document.activeElement!==document.body||document.hidden||document.hasFocus?.()===false)return false;
   const control=[...root.querySelectorAll('[data-action]')].find(node=>matchesFocus(node,token));
   if(!control||control.disabled||control.getAttribute('aria-disabled')==='true')return false;
   control.focus({preventScroll:true});
   return document.activeElement===control;
  },
 };
}
