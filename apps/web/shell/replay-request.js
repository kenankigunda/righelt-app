const sameContext = (a, b) => b?.visible !== false && ['owner', 'scope', 'gameId', 'revision', 'lineageHead'].every(key => a?.[key] === b?.[key]);

// Archive reads may outlive the user's intent. Only the current request may
// publish loading/error state or start playback, including after a failed read.
export function createReplayRequest({onChange = () => {}} = {}) {
  let active = null, feedback = null;
  const cancel = () => {active = null; feedback = null; onChange();};
  const current = (token, context) => token === active && sameContext(token.context, context);
  return {
    begin(context) {const token = {context};active = token;feedback = {gameId:context.gameId,phase:'loading'};onChange();return token;},
    current,
    ready(token, context) {if(!current(token, context))return false;feedback=null;onChange();return true;},
    fail(token, context) {if(!current(token, context))return false;feedback={gameId:context.gameId,phase:'error'};onChange();return true;},
    reconcile(context) {if(active && !sameContext(active.context,context))cancel();},
    cancel,
    snapshot: () => feedback,
  };
}
