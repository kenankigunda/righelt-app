// Loading content shares the loaded flow boxes. No placeholder is an action or identity.
export const loadingText = (width = '72%', sample = '&nbsp;') => `<span class="panel-loading-text skeleton-pulse" style="--placeholder-width:${width}" aria-hidden="true">${sample}</span>`;

export const renderSummarySlots = ({title, started, role, turn, latest}) => `
  <h2>${title}</h2><div class="section-stack">
    <p class="small">${started}</p><p class="small" data-testid="game-role">${role}</p>
    <div class="section-followup"><p class="small" data-testid="active-turn-label">${turn}</p><p class="small">${latest}</p></div>
  </div>`;

export const renderSummaryLoading = (title = `Game ${loadingText('8ch')}`) => `<div class="panel-loading-content" aria-hidden="true">${renderSummarySlots({
  title, started:loadingText('auto','Started Jan 00, 0000, 0:00 AM'), role:loadingText('auto','Role: both players'),
  turn:loadingText('auto','Active turn: 1 · Player 1 · 0 move(s)'), latest:loadingText('auto','Latest: You’re now playing both sides'),
})}</div>`;

export const loadingAction = (sample) => `<span class="panel-loading-action skeleton-pulse"><span class="panel-loading-action-icon"></span><span>${sample}</span></span>`;

export const renderPlayersLoading = () => `
  <div class="panel-loading-content" aria-hidden="true"><h2>Players</h2>
    <ul class="participant-list perspective-participants panel-loading-players" data-testid="participants-list">
      ${[0,1].map(()=>`<li><span class="participant-identity"><span class="participant-profile"><span class="panel-loading-emblem skeleton-pulse"></span><span class="player-name-stack"><span class="player-name">${loadingText('8ch')}</span></span><span class="panel-loading-presence skeleton-pulse"></span></span></span></li>`).join('')}
      <li class="viewers-row"><span class="participant-empty"><span class="panel-loading-viewers skeleton-pulse"></span>${loadingText('8ch')}</span></li>
    </ul><div class="row section-actions panel-loading-actions">${loadingAction('Invite someone to view')}</div><div class="invite-feedback"></div>
  </div>`;

export const renderHistorySlots = ({rows, extra = '', after = '', before = ''}) => `<h2>History</h2><div class="section-followup">${before}<ol class="history-list" data-testid="history-list">${rows}</ol>${extra}</div>${after}`;
export const renderHistoryLoading = () => `<div class="panel-loading-content" aria-hidden="true">${renderHistorySlots({rows:`<li class="history-item history-item-waiting history-empty-line"><span class="history-move-line">${loadingText('auto','Live · Waiting on you to move')}</span></li>`,extra:'<div><ol class="history-list"></ol></div>'})}</div>`;

export const renderInvitationLoading = ({actions = 3} = {}) => `<div class="panel-loading-content" aria-hidden="true">
  <p class="small invite-gate-kicker">${loadingText('10ch')}</p><h2>${loadingText('17ch')}</h2>
  <div class="invite-choice-list">${(actions===2?['Join as viewer','Back home']:['Play as Blue','Join as viewer','Back home']).map(label=>`<div class="invite-choice-row">${loadingAction(label)}</div>`).join('')}</div>
</div>`;
