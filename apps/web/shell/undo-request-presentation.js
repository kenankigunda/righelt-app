// Read existing server-projected consent only. These helpers neither grant
// eligibility nor submit, accept, or reject an Undo.
export const revertRequestKey = (gameId,requestId) => `${gameId}:${requestId}`;
export function activeRevertRequest(game,ignoredRequests) {
 const request=game?.approvableRevertRequest??null;
 if(!request?.requestId)return null;
 return ignoredRequests.has(revertRequestKey(game.id,request.requestId))?null:request;
}
export function activePendingRevertRequest(game) {
 const request=game?.myPendingRevertRequest??null;
 return request?.requestId?request:null;
}
