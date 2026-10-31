import { createInitialState, listLegalActions, applyAction, resolveToStability } from '../../generated/packages/game-engine/src/index.js';

const piece = (id, owner, kind, row, col, extra = {}) => ({id,owner,kind,position:{row,col},supplied:true,commanded:true,...extra});
export function followState({ second = false, multiple = false } = {}) {
  return { ...createInitialState(), continuation:{type:'push',owner:'P1',attackerOwner:'P1',phase:'follow',followPoint:{row:4,col:3},followGroupPieceIds:['A1','F1',...(second?['F2']:[]),...(multiple?['F3']:[])],chainLength:1},
    pieces:[piece('C1','P1','commander',0,0),piece('C2','P2','commander',9,9),piece('A1','P1','unit',4,4,{shifted:true}),piece('F1','P1','unit',4,2),piece('D1','P2','unit',4,6),...(second?[piece('F2','P1','unit',4,1)]:[]),...(multiple?[piece('F3','P1','unit',3,3)]:[])] };
}
export const followGame = (options = {}) => {
  const state = followState(options);
  return {id:'g',gameplayRevision:2,board:{state},legalActions:listLegalActions(state),moves:[],myRoles:['Player 1'],player1:{identityId:'human'},player2:{identityId:'friend'}};
};
export const applyFollow = (game, action, id = 'follow-command') => {
  const before = structuredClone(game.board.state), state = resolveToStability(applyAction(before,action).state);
  const move = {moveId:`move-${id}`,clientCommandId:id,action:structuredClone(action),actorSide:'P1',turnIndex:before.turnIndex,turnMoveIndex:game.moves.length,selectionSnapshot:before,snapshot:structuredClone(state)};
  return {...game,gameplayRevision:game.gameplayRevision+1,board:{state},legalActions:listLegalActions(state),moves:[...game.moves,move]};
};
