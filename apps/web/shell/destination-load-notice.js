const actionLabel = action => action === 'signin' ? 'Sign in' : action === 'reload' ? 'Reload' : 'Retry';

export const quietFieldDestinationNotice = ({transition,message}={}) => Boolean(
  message && transition?.type === 'game-entry' && ['covering','covered','revealing'].includes(transition.phase)
);

export const renderQuietFieldDestinationNotice = ({message,escapeHtml,icon,homeHref}) => {
  const action=message.action?`<button type="button" class="destination-load-field-action" data-destination-action="${escapeHtml(message.action)}">${icon(message.action==='signin'?'account':'rematch')}<span>${actionLabel(message.action)}</span></button>`:'';
  const home=message.home?`<a class="destination-load-field-action" data-destination-action="home" href="${escapeHtml(homeHref)}">${icon('home')}<span>Home</span></a>`:'';
  return `<div class="destination-load-field-content">
    <div class="destination-load-field-copy">
      <h2>${escapeHtml(message.heading??message.message)}</h2>
      ${message.support?`<p>${escapeHtml(message.support)}</p>`:''}
    </div>
    ${action||home?`<div class="destination-load-field-actions">${action}${home}</div>`:''}
  </div>`;
};
