import { TUTORIAL_CHAPTER_TITLES } from "../generated/packages/shared-types/src/tutorial.js";
import { createInitialState } from '../generated/packages/game-engine/src/state.js';
import { resolveToStability } from '../generated/packages/game-engine/src/resolve.js';

const piece = ([id, owner, kind, row, col]) => ({ id, owner, kind, position: {row,col}, supplied:true, commanded:true });
export const lessonPosition = (pieces, sideToMove='P1') => resolveToStability({...createInitialState(), sideToMove, pieces:pieces.map(piece)}, {artifactMode:'full'});
const action = (type, actorId, row, col, toRow, toCol) => ({type,actorId,from:{row,col},to:{row:toRow,col:toCol}});
const initial = () => resolveToStability(createInitialState(),{artifactMode:'full'});
const pushPosition = () => lessonPosition([['C1','P1','commander',3,1],['C2','P2','commander',6,2],['A','P1','unit',4,1],['D','P2','unit',4,2]]);
const destroyPosition = () => lessonPosition([['C1','P1','commander',3,6],['C2','P2','commander',8,1],['A','P1','unit',4,5],['B','P1','unit',5,4],['E','P1','unit',6,5],['D','P2','unit',5,5]]);
const winPosition = () => lessonPosition([['C1','P1','commander',7,2],['C2','P2','commander',6,3],['A','P1','unit',9,2]]);
const connected = () => lessonPosition([['C1','P1','commander',3,6],['C2','P2','commander',6,3],['A','P1','unit',3,4]]);
// Reduced to piece coordinates from catalog scenario 066b5c11, resolved afresh by the engine.
const rushPosition = () => lessonPosition([["C1", "P1", "commander", 4, 6], ["U1-1", "P1", "unit", 5, 6], ["U1-10", "P1", "unit", 1, 6], ["U1-11", "P1", "unit", 7, 6], ["U1-12", "P1", "unit", 3, 2], ["U1-2", "P1", "unit", 3, 4], ["U1-3", "P1", "unit", 5, 4], ["U1-4", "P1", "unit", 4, 2], ["U1-6", "P1", "unit", 1, 4], ["U1-7", "P1", "unit", 1, 2], ["U1-8", "P1", "unit", 4, 4], ["U1-9", "P1", "unit", 3, 6], ["C2", "P2", "commander", 6, 3], ["U2-1", "P2", "unit", 5, 3], ["U2-2", "P2", "unit", 6, 5], ["U2-3", "P2", "unit", 6, 2], ["U2-4", "P2", "unit", 4, 3], ["U2-5", "P2", "unit", 6, 6], ["U2-6", "P2", "unit", 3, 1], ["U2-7", "P2", "unit", 6, 0], ["U2-8", "P2", "unit", 4, 0], ["U2-9", "P2", "unit", 5, 1]], "P2");
const rushActions = [{"type": "rush", "actorId": "U2-4", "from": {"row": 4, "col": 3}, "to": {"row": 3, "col": 3}}, {"type": "rush", "actorId": "C2", "from": {"row": 6, "col": 3}, "to": {"row": 6, "col": 4}}, {"type": "rush", "actorId": "U2-1", "from": {"row": 5, "col": 3}, "to": {"row": 4, "col": 3}}];
export const TUTORIAL_CHAPTERS = [
 {id:'build',title:TUTORIAL_CHAPTER_TITLES[0],exercises:[
  {id:'meet',position:initial,inspect:'C1',prompt:'Select your red Commander. Your supply point is the red corner.',hint:'Select the red Commander on row 3, column 6. Select it again to see its connections.',success:'The Commander leads your pieces. Every piece needs a path to its own supply point.'},
  {id:'move',position:initial,action:action('move','C1',3,6,2,6),prompt:'Move your Commander one square up, to row 2, column 6.',hint:'Select the Commander, then the square just above it. Confirm the move using the normal board control.',success:'Only Commanders move this way. One action usually ends your turn.'},
  {id:'project',position:initial,action:action('project','C1',3,6,3,4),prompt:'Project a Unit two squares left, to row 3, column 4.',hint:'Select the Commander, then row 3, column 4. The middle square must be empty.',success:'Projection creates a Unit. The original piece stays where it is.',hold:true}
 ]},
 {id:'connections',title:TUTORIAL_CHAPTER_TITLES[1],exercises:[
  {id:'lines',position:connected,inspect:'A',prompt:'Select the red Unit twice to reveal its supply and command lines.',hint:'Select the Unit at row 3, column 4, then select it again.',success:'Supply follows open orthogonal paths. Command connects friendly pieces back to the Commander.'},
  {id:'command',position:connected,action:action('move','C1',3,6,2,6),prompt:'Move the Commander up and watch the Unit lose command.',hint:'Move the Commander from row 3, column 6 to row 2, column 6.',success:'The Unit is supplied but uncommanded, so it cannot act. Command uses clear straight lines or one-square diagonals.',hold:true},
  {id:'destroy',position:destroyPosition,action:action('project','C1',3,6,5,6),prompt:'Project to row 5, column 6 to close the blue Unit’s last supply path.',hint:'Select the red Commander at row 3, column 6. Project two squares down.',success:'The blue Unit disappears when its supply is cut. During rush and push sequences, removals wait until the sequence closes.',hold:true}
 ]},
 {id:'rush',title:TUTORIAL_CHAPTER_TITLES[2],exercises:[
  {id:'rush-open',position:rushPosition,action:rushActions[0],prompt:'Rush the blue Unit at row 4, column 3 up one square.',hint:'Select that Unit and choose row 3, column 3.',success:'A rush moves next to an enemy. This Unit temporarily loses supply, so the chain must reconnect it.'},
  {id:'rush-commander',carry:true,action:rushActions[1],prompt:'Continue with the blue Commander. Rush right to row 6, column 4.',hint:'Each piece rushes at most once. Use the Commander at row 6, column 3.',success:'A different piece continues the same turn. Eligibility comes from the start of the sequence.'},
  {id:'rush-connect',carry:true,action:rushActions[2],prompt:'Rush the blue Unit at row 5, column 3 up to reconnect the group.',hint:'Choose row 4, column 3 with the Unit below it.',success:'The chain is supplied again. Now you can end the turn.'},
  {id:'rush-end',carry:true,endTurn:true,prompt:'End the rush turn now that the group has supply.',hint:'Use End turn. You cannot finish a chain while its required pieces remain unsupplied.',success:'Rush is a team effort, not repeated moves by one piece.',hold:true}
 ]},
 {id:'push',title:TUTORIAL_CHAPTER_TITLES[3],exercises:[
  {id:'push',position:pushPosition,action:action('push','A',4,1,4,2),prompt:'Push the blue Unit with the red Unit beside it.',hint:'Select the red Unit at row 4, column 1, then the blue Unit to its right. Your two-piece group is stronger.',success:'Push strength counts orthogonally adjacent friendly pieces. The defender retreats next.'},
  {id:'retreat',carry:true,action:action('retreat','D',4,2,5,2),prompt:'You now control blue. Retreat the pushed Unit down to row 5, column 2.',hint:'Select the pushed blue Unit, then the square below it.',success:'The defender chooses a retreat. Now control returns to red.'},
  {id:'follow',carry:true,action:action('follow','C1',3,1,4,1),prompt:'Follow with the red Commander into row 4, column 1.',hint:'The Commander can fill the square the pushing Unit left behind.',success:'Follow fills the gap. The sequence closes when no follow remains. Push, retreat and follow belong to one connected turn.',hold:true}
 ]},
 {id:'win',title:TUTORIAL_CHAPTER_TITLES[4],exercises:[
  {id:'pass',position:initial,action:{type:'pass'},prompt:'Pass this turn to hand play to blue.',hint:'Use Pass. Passing gives the turn to your opponent.',success:'You may pass instead of taking a piece action.'},
  {id:'win',position:winPosition,action:action('project','A',9,2,9,0),prompt:'Project onto the blue supply point at row 9, column 0.',hint:'Select the red Unit at row 9, column 2 and project two squares left.',success:'You win by cutting the opposing Commander’s supply. If both Commanders lose supply together, the game is a draw.',hold:true}
 ]}
];
export const HOST_LINES = {
 horus:{welcome:'Take a seat. I’ll explain what everyone else is doing wrong.',success:'A sound decision. I was beginning to suspect you.',finish:'A well-earned victory. Fortunately, this one was a lesson.',error:'A useful experiment. Try the move I pointed out.'},
 babs:{welcome:'Take a seat! Every good rivalry starts somewhere.',success:'That goes in the research notebook.',finish:'Ready for a rematch? I mean, your first match.',error:'Research! Let’s try the suggested move next.'},
 tau:{welcome:'Take your time. Good positions grow from good connections.',success:'That’s coming along nicely.',finish:'A good foundation. Let’s see what grows from it.',error:'No hurry. Follow the suggested connection.'}
};
