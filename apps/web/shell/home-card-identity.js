import { COMPUTER_PROFILES } from '../generated/packages/shared-types/src/computer-play.js';

const escape = value => String(value ?? '').replace(/[&<>"']/g, character =>
  ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));
const seatForRole = role => role === 'Player 1' ? 'p1' : role === 'Player 2' ? 'p2' : null;

const participant = (person, side) => {
  const computer = COMPUTER_PROFILES[person?.computerProfile];
  return {
    side,
    name: computer?.name || person?.profile?.displayName || person?.profile?.username || (person ? 'Guest' : 'Open seat'),
    identityId: person?.identityId,
    computer: Boolean(computer),
    presence: computer || person?.connected === true ? 'connected' : person ? 'disconnected' : 'open',
  };
};

/** Explicit role and the captured current identity determine perspective, never whose turn it is. */
export function homeCardMatchup(game, { identityId } = {}) {
  const seats = [participant(game?.player1, 'p1'), participant(game?.player2, 'p2')];
  let ownSide = seatForRole(game?.myRole);
  const computers = seats.filter(seat => seat.computer);
  // Computer seats may share their owner's identity. Keep the human in their real color.
  if (ownSide && computers.length === 1) ownSide = seats.find(seat => !seat.computer).side;
  if (!ownSide && game?.myRole === 'Both Players' && computers.length === 1 && identityId != null) {
    const human = seats.find(seat => !seat.computer);
    if (human.identityId === identityId) ownSide = human.side;
  }
  const own = seats.find(seat => seat.side === ownSide);
  if (computers.length === 2 || !own?.identityId || (identityId != null && own.identityId !== identityId)) ownSide = null;
  const sameHuman = computers.length === 0 && seats[0].identityId && seats[0].identityId === seats[1].identityId;
  if (sameHuman && (ownSide || (game?.myRole === 'Both Players' && identityId != null)) &&
      (identityId == null || seats[0].identityId === identityId)) return { kind: 'self', seats };
  return { kind: ownSide ? 'player' : sameHuman ? 'watched-self' : 'viewer', ownSide, seats };
}

const renderName = (seat, label = seat.name) => `<strong class="player-tone-${seat.side}"><bdi>${escape(label)}</bdi></strong>`;
const renderParticipant = seat => {
  const status = seat.presence === 'open' ? 'open to join' : seat.presence;
  const label = seat.computer ? 'Computer player' : `${seat.name} ${status}`;
  return `<span class="mini-board-card-connection-item">${renderName(seat)}<span class="connection-status-icon is-${seat.presence}" role="img" aria-label="${escape(label)}" title="${escape(label)}"></span></span>`;
};

export function renderHomeCardIdentity(game, options) {
  const matchup = homeCardMatchup(game, options);
  if (matchup.kind === 'self') return '<span class="home-card-matchup"><strong class="player-tone-both">You play both sides</strong></span>';
  if (matchup.kind === 'player') {
    const own = matchup.seats.find(seat => seat.side === matchup.ownSide);
    const other = matchup.seats.find(seat => seat !== own);
    return `<span class="home-card-matchup">${renderName(own, 'You')} <span>vs.</span> ${renderParticipant(other)}</span>`;
  }
  return `<span class="home-card-matchup">${renderParticipant(matchup.seats[0])} <span>${matchup.kind === 'watched-self' ? '/' : 'vs.'}</span> ${renderParticipant(matchup.seats[1])}${matchup.kind === 'watched-self' ? ' <span>· Both sides</span>' : ''}</span>`;
}
