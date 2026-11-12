import {BOARD_CONTEXT_PURPOSE} from './board-context-purpose.js';
import {renderBoardMessageHtml} from '../board/message-presentation.js';
import {icon} from './ui.js';

const escape = value => String(value).replace(/[&<>"']/g, character => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));

export function incomingNarrationContext(contexts, gameId) {
  return contexts.find(context => context.gameId === gameId && context.purpose === BOARD_CONTEXT_PURPOSE.INCOMING) ?? null;
}

const episode = context => context.replay
  ? JSON.stringify([context.gameId, context.replay.turnIndex, context.replay.moveIds])
  : context.key;

// This owns presentation only. Expanding or reading narration never reports a
// seen move, changes History selection, or admits a game/replay command.
export function createIncomingNarrationState() {
  let current = null, identity = null, expanded = true;
  return {
    observe(context) {
      if (!context || context.purpose !== BOARD_CONTEXT_PURPOSE.INCOMING) {
        current = null; identity = null; expanded = true;
        return {context:null, expanded:false, arrival:false, episode:null};
      }
      const next = episode(context), arrival = next !== identity;
      if (arrival) expanded = true;
      current = context; identity = next;
      return {context, expanded, arrival, episode:identity};
    },
    toggle(key) {
      if (!current || current.key !== key) return false;
      expanded = !expanded;
      return true;
    },
    retire() {current = null; identity = null; expanded = true;},
  };
}

export function renderIncomingNarration(context, {layout, expanded = true, replayEnabled = false} = {}) {
  if (!context || context.purpose !== BOARD_CONTEXT_PURPOSE.INCOMING || !['wide','narrow'].includes(layout)) return '';
  const side = context.actorSide === 'P1' ? 'p1' : context.actorSide === 'P2' ? 'p2' : 'neutral';
  const key = escape(context.key), body = {...context.message};
  delete body.action; delete body.actions; delete body.context;
  const copy = `<div class="incoming-narration-copy">${renderBoardMessageHtml(body)}</div>`;
  const replay = context.replay ? `<button type="button" class="secondary incoming-narration-replay" data-action="replay-board-context" data-board-context-key="${key}"${replayEnabled?'':' disabled'}>${icon('rematch')}Show me again</button>` : '';
  const attrs = `data-board-context="${key}" data-incoming-context data-context-active-host="true" data-key="incoming:${key}" aria-live="off"`;
  if (layout === 'wide') return `<div class="history-incoming incoming-owner-${side}" ${attrs}>${copy}${replay}</div>`;
  return `<aside class="incoming-move-flyout incoming-owner-${side}" ${attrs} aria-label="Previous turn" data-expanded="${expanded}">
    ${expanded?`<div id="shell-incoming-move-body" class="incoming-narration-content">${copy}${replay}</div>`:''}
    <button type="button" class="secondary incoming-narration-toggle" data-key="incoming-toggle:${escape(context.gameId)}" data-action="toggle-incoming-narration" data-board-context-key="${key}" aria-expanded="${expanded}"${expanded?' aria-controls="shell-incoming-move-body"':''}>${expanded?'Hide previous turn':'Show previous turn'}${icon(expanded?'down':'up')}</button>
  </aside>`;
}
