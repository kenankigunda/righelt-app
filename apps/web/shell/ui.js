import {icon} from '../icons.js';
export {icon} from '../icons.js';
export const soundToggle = (enabled) => `<button class="ui-icon-button sound-toggle" data-action="toggle-sound" aria-label="${enabled?'Mute':'Enable'} sound" aria-pressed="${enabled}" title="Sound ${enabled?'on':'off'}">${icon(enabled?'sound':'muted')}</button>`;

export const headerActionContent = (name, label) => `${icon(name)}<span class="header-action-label">${label}</span>`;
