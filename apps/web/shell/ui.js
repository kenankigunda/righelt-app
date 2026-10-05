export const icon = (name) => {
  const paths = {
    scenarios:'M3 3h7v7H3ZM14 3h7v7h-7ZM3 14h7v7H3ZM14 14h7v7h-7Z',
    debug:'M8 7l2-3h4l2 3v12l-3 2h-2l-3-2ZM3 9h5M16 9h5M3 15h5M16 15h5M5 4l3 3M19 4l-3 3M5 21l3-3M19 21l-3-3M8 12h8',
    account:'M9 3h6l3 3v4l-3 3H9l-3-3V6ZM3 22v-3l4-4h10l4 4v3',
    left:'M15 4L7 12l8 8M7 12h13', right:'M9 4l8 8-8 8M4 12h13',
    back:'M10 4l-7 7 7 7M3 11h12l5 5v5', close:'M5 5l14 14M5 19L19 5',
    play:'M6 3h3l12 9L9 21H6Z',
    invite:'M6 3h4l2 2v4l-2 2H6L4 9V5ZM2 21v-5l3-3h6l3 3v5M18 8v8M14 12h8',
    copy:'M8 3h10l3 3v12h-3M3 7h10l3 3v11H6l-3-3Z',
    rematch:'M4 9a8 8 0 0 1 14-4l3 3M21 3v5h-5M20 15a8 8 0 0 1-14 4l-3-3M3 21v-5h5',
    sound:'M3 9h4l5-5v16l-5-5H3ZM16 8l3 4-3 4M19 5l4 7-4 7',
    muted:'M3 9h4l5-5v16l-5-5H3ZM16 9l6 6M16 15l6-6'
  };
  return `<svg class="righelt-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="square" stroke-linejoin="miter">${paths[name]?`<path d="${paths[name]}"/>`:''}</svg>`;
};
export const soundToggle = (enabled) => `<button class="ui-icon-button sound-toggle" data-action="toggle-sound" aria-label="${enabled?'Mute':'Enable'} sound" aria-pressed="${enabled}" title="Sound ${enabled?'on':'off'}">${icon(enabled?'sound':'muted')}</button>`;

export const headerActionContent = (name, label) => `${icon(name)}<span class="header-action-label">${label}</span>`;
