import {renderBoardMessageHtml} from './message-presentation.js';
import {COMPUTER_PROFILES} from '../generated/packages/shared-types/src/computer-play.js';

// The finite next-action grammar is also the height owner's sizing input.
// Explanations, recorded narration and arbitrary coordinate lists are context.
export const BOARD_PROMPT=Object.freeze({
 piece:'Select a piece',move:'Select a move',anotherPiece:'Select another piece',
 anotherMove:'Select another move',rush:'Select a rush',requiredRush:'Select a rush to restore supply',
 follow:'Select a follow',history:'Choose a move in History',complete:'Review the game in History',
 following:'Following the push',replay:'Watch replay',manualReplay:'Next',loadingReplay:'Preparing replay',failedReplay:'Replay unavailable',
});

export function boardPromptSizingModels({boardSize=10}={}) {
 const edge=Math.max(0,boardSize-1),point={row:edge,col:edge},coordinate=`(${edge}, ${edge})`;
 const at=text=>({text:`${text} for piece at ${coordinate}`,coordinates:[point]});
 const models=[
  ...Object.values(BOARD_PROMPT).map(text=>({text})),
  {text:'Select a piece or',action:{id:'pass',label:'Pass'}},
  ...['Select a move','Select another move','Select a retreat','Supply and command lines','Opponent’s supply and command lines'].map(at),
  {text:'Select a rush or',action:{id:'end-turn',label:'End turn'}},
  {text:BOARD_PROMPT.requiredRush,badge:'Obligatory',actions:[{id:'retry-rush-guidance',label:'Try again'}]},
  {text:BOARD_PROMPT.rush,actions:[{id:'end-turn',label:'End turn'},{id:'retry-rush-guidance',label:'Try again'}]},
  {text:BOARD_PROMPT.loadingReplay,action:{id:'replay-cancel',label:'Cancel replay'}},
  {text:BOARD_PROMPT.failedReplay,actions:[{id:'replay-computer',label:'Try again'},{id:'replay-dismiss',label:'Dismiss'}]},
  {text:BOARD_PROMPT.replay,action:{id:'replay-stop',label:'Stop replay'}},
  {text:BOARD_PROMPT.manualReplay,actions:[{id:'replay-next',label:'Next'},{id:'replay-stop',label:'Stop replay'}]},
  ...['continue rush on','continue push on','move commander to','project new piece to','rush piece to','push piece onto','follow piece to','retreat piece to','move to'].map(text=>({text:'Confirm',confirmation:{text,point}})),
  ...['Select a retreat','Opponent’s supply and command lines','Supply and command lines','Command lines','Supply lines','No command connection','No supply connection','No connection','Waiting for the game','Waiting for your opponent','Loading play','Play could not finish loading'].map(text=>({text})),
 ];
 for(const name of new Set(['Computer',...Object.values(COMPUTER_PROFILES).map(profile=>profile.name)])){
  for(const suffix of ['needs a hand','needs help','is making their move','is thinking','is saving their move','is paused'])models.push({text:`${name} ${suffix}`});
  models.push({text:`Waiting for ${name}`});
 }
 // Same12ch visual bound and full-name accessibility as actual actor labels.
 const actorName='MMMMMMMMMMMMMMMM';models.push({text:`${actorName} to play`,actorName},{text:`${actorName} is making their move`,actorName},{text:`${actorName} needs help`,actorName,action:{id:'retry-confirmed-playback',label:'Retry'}});
 return models;
}

const promptSignature=html=>String(html)
 .replace(/<bdi\b[^>]*class="board-message-name"[^>]*>[\s\S]*?<\/bdi>/g,'actor')
 .replace(/<[^>]*>/g,'').replace(/\b\d+,\s*\d+\b/g,'coordinate').replace(/\s+/g,' ').trim();
let knownPromptSignatures=null;
export function isMappedBoardPromptHtml(html){
 knownPromptSignatures??=new Set(boardPromptSizingModels().map(model=>promptSignature(renderBoardMessageHtml(model))));
 return knownPromptSignatures.has(promptSignature(html));
}
