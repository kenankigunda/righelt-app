import {CURRENT_COMPUTER_MODEL,getComputerModel} from '../apps/web/generated/packages/shared-types/src/computer-play.js';

/** An explicit candidate must never silently fall back to the incumbent. */
export function computerParityModel(requestedId=CURRENT_COMPUTER_MODEL.id){
  const model=getComputerModel(requestedId);
  if(!model)throw Error(`Unknown computer model for parity: ${requestedId}`);
  return model;
}

export function computerParityModelFromArgs(args){
  const index=args.indexOf('--model-id');
  if(index===-1)return computerParityModel();
  const id=args[index+1];
  if(typeof id!=='string'||!id.trim()||id.startsWith('--'))throw Error('Missing value for --model-id');
  if(args.indexOf('--model-id',index+1)!==-1)throw Error('Duplicate --model-id');
  return computerParityModel(id);
}
