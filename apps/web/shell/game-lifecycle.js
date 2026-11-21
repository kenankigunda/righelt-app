import {isTerminalOutcome} from '../generated/packages/shared-types/src/engine.js';
export {isTerminalOutcome};

// History can display an earlier position while the authoritative game is over.
const outcome = game => (game?.liveCurrentSnapshot ?? game?.board?.state)?.outcome?.status;
export const isCompletedGame = game => isTerminalOutcome(outcome(game)) || (!outcome(game) && game?.status === 'finished');
export const isOngoingGame = game => !isCompletedGame(game) && outcome(game) === 'ongoing';

// The decisive command owns the finish turn, including closure and sole-Pass
// endings that append no move. Older records fall back to retained history.
export const completedTurnIndex = game => {
 if(!isCompletedGame(game))return null;
 const decisive=game?.terminalOutcome?.decisive?.turnIndex;
 if(Number.isSafeInteger(decisive)&&decisive>=0)return decisive;
 const active=(game?.moves??[]).filter(move=>move?.undone!==true&&Number.isSafeInteger(move?.turnIndex));
 if(active.length)return active.at(-1).turnIndex;
 const recorded=(game?.turns??[]).filter(turn=>Number.isSafeInteger(turn?.index)&&(turn?.endedAt||turn?.moveIndexes?.length));
 if(recorded.length)return recorded.at(-1).index;
 const boardIndex=(game?.liveCurrentSnapshot??game?.board?.state)?.turnIndex;
 return Number.isSafeInteger(boardIndex)&&boardIndex>=0?boardIndex:null;
};
