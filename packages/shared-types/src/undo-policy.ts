/** Only a different human controller needs to approve an Undo.
 * Computer seats and both sides of self-play belong to their human owner.
 * Callers must establish the requester's player role before applying this policy.
 */
export const requiresUndoApproval = (requesterIdentityId: string, opposingControllerIdentityId: string | null | undefined): boolean =>
  Boolean(opposingControllerIdentityId && opposingControllerIdentityId !== requesterIdentityId);
