export const icon = (name) => {
  const paths = { left:'M14 5l-7 7 7 7', right:'M10 5l7 7-7 7', close:'M6 6l12 12M6 18L18 6', sound:'M11 5L6 9H3v6h3l5 4V5zM15 8q6 4 0 8M18 5q10 7 0 14', muted:'M11 5L6 9H3v6h3l5 4V5zM16 9l6 6M16 15l6-6', friend:'M8 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM1 22v-3a7 7 0 0 1 14 0v3M18 3a4 4 0 0 1 0 8M18 14a6 6 0 0 1 5 6' };
  return `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${paths[name]?`<path d="${paths[name]}"/>`:''}</svg>`;
};
export const soundToggle = (enabled) => `<button class="ui-icon-button sound-toggle" data-action="toggle-sound" aria-label="${enabled?'Mute':'Enable'} sound" aria-pressed="${enabled}" title="Sound ${enabled?'on':'off'}">${icon(enabled?'sound':'muted')}</button>`;
