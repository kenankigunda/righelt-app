// Join failures belong to the exact invitation visit and account that submitted
// them. A late response cannot restore an error or navigate a newer visit.
export function createJoinFeedback({getScope}) {
 let sequence=0,current=null,error=false;
 const same=(a,b)=>Boolean(a&&b&&a.gameId===b.gameId&&a.owner===b.owner&&a.generation===b.generation&&a.visit===b.visit&&a.route===b.route);
 const isCurrent=token=>Boolean(token&&current===token&&same(token.scope,getScope(token.scope.gameId)));
 return {
  begin(gameId){error=false;current={sequence:++sequence,scope:getScope(gameId)};return current;},
  isCurrent,
  fail(token){if(!isCurrent(token))return false;error=true;return true;},
  complete(token){if(!isCurrent(token))return false;error=false;current=null;return true;},
  clear(){sequence++;current=null;error=false;},
  message(gameId){return error&&isCurrent(current)&&current.scope.gameId===gameId?'Could not join. Try again':null;},
 };
}
