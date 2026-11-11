import {icon} from '../icons.js';

// Presentation of the activity producer's states, never control inference.
export const COMPUTER_STATUS_SYMBOLS = Object.freeze({
  here:'check', idle:'minus', paused:'pause', elsewhere:'window-out',
  resuming:'resume-arrow', attention:'warning-solid', finished:'finish-flag', moving:'play',
});

export function renderComputerStatusBadge(state) {
  const current=Object.hasOwn(COMPUTER_STATUS_SYMBOLS,state)?state:'attention';
  return `<span class="computer-tab-status computer-status-badge" data-computer-activity="${current}" aria-hidden="true">${icon('bot')}<span class="computer-status-mark">${icon(COMPUTER_STATUS_SYMBOLS[current])}</span></span>`;
}
