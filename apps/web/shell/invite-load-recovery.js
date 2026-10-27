import { icon } from './ui.js';

const escape = value => String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));

// Retry only an inconclusive read. A confirmed missing or expired invitation
// remains unavailable until the user follows a different invitation.
export const invitationLoadFailureKind = error => error?.status === 410 ? 'expired'
  : error?.status === 404 || error?.code === 'invite_not_found' || error?.code === 'invalid_invite_token' ? 'unavailable' : 'retry';

export const renderInviteLoadRecovery = ({ pending = false, kind = 'retry', homeHref = '#/', loadingKey = 'invitation-load' } = {}) => `
  <div class="invite-load-recovery" data-testid="invite-load-recovery" aria-busy="${pending}">
    <p class="small invite-gate-kicker">Invitation</p>
    <h2 id="invite-surface-title">${kind === 'retry' ? 'Open invitation' : 'Invitation unavailable'}</h2>
    <div class="invite-load-status"><p role="status">${pending ? 'Loading your invitation' : kind === 'expired' ? 'This invitation has expired' : kind === 'unavailable' ? 'This invitation is no longer available' : 'We couldn’t load your invitation'}</p><p class="invite-load-status-sizing" aria-hidden="true">We couldn’t load your invitation</p></div>
    <div class="invite-choice-list">
      ${kind === 'retry' ? `<div class="invite-choice-row"><button type="button" data-action="retry-invite-load" data-loading-key="${escape(loadingKey)}" data-loading-state="${pending ? 'pending' : 'idle'}"${pending ? ' disabled aria-busy="true"' : ''}>${icon('rematch')}Retry</button></div>` : ''}
      <div class="invite-choice-row"><a class="button-link secondary" href="${escape(homeHref)}" data-flyout-link="home">${icon('home')}Home</a></div>
    </div>
  </div>`;
