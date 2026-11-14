import {renderGameParticipantLabel,renderGameParticipantReferences,renderGameRoleLine} from './game-role-presentation.js';
import {renderGameTitle} from './game-title.js';
import {renderSummarySlots} from './panel-loading.js';

const escape=value=>String(value??'').replace(/[&<>"']/g,character=>({
  '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;',
}[character]));

const latestSummaryNote = rawNote => ({
  'Player request approved':'Join request approved',
  'Play as both players enabled':'You’re now playing both sides',
  'Undo applied':'Move undone',
})[rawNote]
  ?? (/accepted the undo request$/.test(rawNote) ? 'Undo request accepted'
    : /rejected the undo request$/.test(rawNote) ? 'Undo request declined. Play can continue.'
      : /rescinded the undo request$/.test(rawNote) ? 'Undo request cancelled. Play can continue.'
        : rawNote);

export function renderGameSummaryPanel(game,{identityId,formatDateTime=value=>String(value)}={}) {
  const rawNote=game.notifications[0]||'Ready',latestNote=latestSummaryNote(rawNote);
  return renderSummarySlots({
    title:renderGameTitle(game,{identityId}),
    started:`Started ${escape(formatDateTime(game.createdAt))}`,
    role:renderGameRoleLine(game),
    turn:`Active turn: ${game.currentTurn
      ? `${escape(String(game.currentTurn.index+1))} · ${renderGameParticipantLabel(game.currentTurn.playerSeat,game,{identityId})} · ${escape(String(game.currentTurn.moveIndexes.length))} move(s)`
      : 'n/a'}`,
    latest:`Latest: ${renderGameParticipantReferences(latestNote,game,{identityId})}`,
  });
}
