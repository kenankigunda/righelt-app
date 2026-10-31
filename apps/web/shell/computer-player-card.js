import {computerKindIcon} from './ui.js';
import { COMPUTER_PROFILES } from '../generated/packages/shared-types/src/computer-play.js';
import { renderPlayerEmblem } from './player-emblem.js';

const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

export function renderComputerPlayerCard(person, { gameId, side, expanded = false, activity } = {}) {
  const name = COMPUTER_PROFILES[person.computerProfile]?.name ?? 'Computer';
  const current = activity ?? {state:'attention',label:'Needs attention',showResume:true,disabledReason:'Connecting to the game…'};
  const key = `computer:${gameId}:${side}`, id = `computer-details-${gameId}-${side}`, reasonId = `${id}-reason`;
  const resume = current.showResume ? `<button class="secondary" data-key="${escape(key)}:resume" data-action="computer-control" data-control="resume-here" data-computer-side="${escape(side)}" ${current.disabledReason ? `disabled aria-describedby="${escape(reasonId)}"` : ''}>Resume here</button>` : '';
  return `<span class="participant-identity" data-key="${escape(key)}" data-player-side="${escape(side.toLowerCase())}">
    <button class="participant-profile participant-computer" data-key="${escape(key)}:toggle" data-action="toggle-computer-card" data-game-id="${escape(gameId)}" data-computer-side="${escape(side)}" aria-label="${escape(`${name}, ${side === 'P1' ? 'Red' : 'Blue'}, ${current.label}`)}" aria-description="Computer player" aria-expanded="${expanded}" aria-controls="${escape(id)}">
      ${renderPlayerEmblem(person.computerProfile)}<span class="player-name-stack"><span class="player-name">${escape(name)}</span>${computerKindIcon()}</span>
      <span class="computer-tab-status" data-computer-activity="${escape(current.state)}"><span class="connection-status-icon ${current.activeHere ? 'is-connected' : 'is-disconnected'}" aria-hidden="true"></span><span>${escape(current.label)}</span></span>
    </button>
    <span class="player-profile-details computer-player-details" data-key="${escape(key)}:details" id="${escape(id)}" ${expanded ? '' : 'hidden'}>${expanded ? `${current.disabledReason && current.showResume ? `<span id="${escape(reasonId)}">${escape(current.disabledReason)}</span>` : ''}${resume}` : ''}</span>
  </span>`;
}
