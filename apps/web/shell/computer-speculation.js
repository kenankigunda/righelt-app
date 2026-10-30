import {computerProfileFor} from '../generated/packages/shared-types/src/computer-play.js';
import {deterministicStateHash} from '../generated/packages/game-engine/src/hash.js';

/** A candidate is local calculation only: no evidence writes or gameplay admission. */
export function createComputerSpeculation({compute,onChange=()=>{}}){
 let candidate=null;
 const matches=(game,scope)=>Boolean(candidate&&candidate.scope===scope&&game?.id===candidate.gameId
  &&game.gameplayRevision===candidate.revision&&game.computer?.generation===candidate.generation
  &&game.computer?.modelId===candidate.modelId&&(!candidate.proof?.profile||computerProfileFor(game.computer,game.board?.state?.sideToMove,game.board?.state?.turnIndex)===candidate.proof.profile)&&!game.computer?.paused&&!game.computer?.manual
  &&game.board?.state?.outcome?.status==='ongoing'&&deterministicStateHash(game.board.state)===candidate.hash);
 return {
  start(input){
   if(candidate)return null;
   const next=candidate={...input,state:structuredClone(input.state),hash:deterministicStateHash(input.state),phase:'computing',response:null,error:null,cancelled:false};
   next.promise=Promise.resolve().then(()=>next.cancelled?null:compute(input.request,progress=>{
    if(!next.cancelled){next.progress=progress;next.onProgress?.(progress);if(candidate===next)onChange();}
   })).then(response=>{next.response=response;return response;},error=>{next.error=error;return null;}).finally(()=>{next.phase='ready';if(candidate===next)onChange();});
   onChange();return next;
  },
  matches,
  take(game,scope){if(!matches(game,scope))return null;const next=candidate;candidate=null;return next;},
  discard(){if(candidate)candidate.cancelled=true;candidate=null;},
  snapshot(){return candidate?{phase:candidate.phase,gameId:candidate.gameId,revision:candidate.revision,hash:candidate.hash}:null;},
 };
}
