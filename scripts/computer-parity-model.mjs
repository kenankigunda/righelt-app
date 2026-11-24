import {CURRENT_COMPUTER_MODEL,getComputerModel} from '../apps/web/generated/packages/shared-types/src/computer-play.js';

/** An explicit candidate must never silently fall back to the incumbent. */
export function computerParityModel(requestedId=CURRENT_COMPUTER_MODEL.id){
  const model=getComputerModel(requestedId);
  if(!model)throw Error(`Unknown computer model for parity: ${requestedId}`);
  return model;
}
