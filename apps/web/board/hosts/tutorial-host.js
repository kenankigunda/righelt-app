import { listLegalActions } from '../../generated/packages/game-engine/src/legal.js';
import { buildPieceMoveResponse } from '../client-move-generation.js';
export const createTutorialBoardHost = controller => ({
 async loadInitialState(){const state=controller.current().state;return {state,legalActions:listLegalActions(state)};},
 async loadLegalActions(){const state=controller.current().state;return {ok:true,state,legalActions:listLegalActions(state)};},
 async loadPieceMoves(state,pieceId){return buildPieceMoveResponse({state,legalActions:listLegalActions(state),pieceId});},
 async applyAction(state,action){if(JSON.stringify(state)!==JSON.stringify(controller.current().state))return {accepted:false,state:controller.current().state};return controller.handleAction(action);},
 async endTurn(){return controller.handleEndTurn();},
 canInteract(){return controller.current().phase==='exercise';}
});
