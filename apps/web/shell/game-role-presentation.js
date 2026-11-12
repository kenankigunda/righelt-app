import {playerIdentityLabel} from './perspective-labels.js';

const escape = value => String(value ?? '').replace(/[&<>"']/g, character => ({
  '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;',
}[character]));

const sideForRole = role => role === 'Player 1' ? 'P1' : role === 'Player 2' ? 'P2' : null;
const personForSide = (game, side) => game?.[side === 'P1' ? 'player1' : 'player2'];
const computerForSide = (game, side) => Boolean(
  personForSide(game, side)?.computerProfile
  || game?.computer?.seats?.[side === 'P1' ? 'p1' : 'p2'],
);
const sameParticipantOwnsBothSeats = game => Boolean(game?.player1?.identityId)
  && game.player1.identityId === game?.player2?.identityId;
const toneForSide = side => side === 'P1' ? 'player-tone-p1' : 'player-tone-p2';

const renderIdentity = (game, side) => {
  const identity = playerIdentityLabel(game, side);
  return `<strong class="${toneForSide(side)}" aria-label="${escape(identity.accessibleName)}"><bdi dir="auto">${escape(identity.text)}</bdi></strong>`;
};

/** Game summary prose names participants while stored seat roles remain the
 * source of authority. Unknown roles retain a neutral, escaped fallback. */
export function renderGameParticipantLabel(role, game = null) {
  const side = sideForRole(role);
  return side ? renderIdentity(game, side) : `<strong>${escape(role || 'Unknown')}</strong>`;
}

/** Replace only authoritative seat tokens from server-authored summary text.
 * Escape all other text before composing identity markup. */
export function renderGameParticipantReferences(text, game = null) {
  const source = String(text ?? '');
  let html = '';
  let cursor = 0;
  for (const match of source.matchAll(/Player [12]/g)) {
    html += escape(source.slice(cursor, match.index));
    html += renderGameParticipantLabel(match[0], game);
    cursor = match.index + match[0].length;
  }
  return html + escape(source.slice(cursor));
}

/** Presentation only: roles continue to carry authority while the summary uses
 * the participant identity people recognize elsewhere in the game. */
export function renderGameRoleLabel(role, game = null) {
  const side = sideForRole(role);
  if (side) {
    const computers = ['P1','P2'].filter(candidate => computerForSide(game, candidate));
    if (computers.length === 2) {
      return '<strong class="player-tone-both" aria-label="watching computers, Red and Blue">watching computers</strong>';
    }
    if (computers.length === 1) {
      const humanSide = computers[0] === 'P1' ? 'P2' : 'P1';
      return renderIdentity(game, humanSide);
    }
    if (sameParticipantOwnsBothSeats(game)) {
      return '<strong class="player-tone-both" aria-label="both players, Red and Blue">both players</strong>';
    }
    return renderIdentity(game, side);
  }
  if (role === 'Both Players') {
    return '<strong class="player-tone-both" aria-label="both players, Red and Blue">both players</strong>';
  }
  return `<strong>${escape(role || 'Unknown')}</strong>`;
}

export const renderGameRoleLine = game => `Role: ${renderGameRoleLabel(game?.myRole, game)}`;
