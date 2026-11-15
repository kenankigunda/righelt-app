import {BOARD_CONTEXT_PURPOSE} from './board-context-purpose.js';
import {renderBoardMessageHtml} from '../board/message-presentation.js';
import {icon} from './ui.js';

const escape = value => String(value).replace(/[&<>"']/g, character => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));

export function incomingNarrationContext(contexts, gameId) {
  return contexts.find(context => context.gameId === gameId && [BOARD_CONTEXT_PURPOSE.INCOMING,BOARD_CONTEXT_PURPOSE.SEQUENCE].includes(context.purpose)) ?? null;
}

const supported = context => [BOARD_CONTEXT_PURPOSE.INCOMING,BOARD_CONTEXT_PURPOSE.SEQUENCE].includes(context?.purpose);

export function renderIncomingNarration(context, {layout, replayEnabled = false} = {}) {
  if (!supported(context) || layout !== 'wide') return '';
  const side = context.actorSide === 'P1' ? 'p1' : context.actorSide === 'P2' ? 'p2' : 'neutral';
  const key = escape(context.key), body = {...context.message};
  delete body.action; delete body.actions; delete body.context;
  const copy = `<div class="incoming-narration-copy">${renderBoardMessageHtml(body)}</div>`;
  const replay = context.replay ? `<button type="button" class="secondary incoming-narration-replay" data-action="replay-board-context" data-board-context-key="${key}"${replayEnabled?'':' disabled'}>${icon('rematch')}Show me again</button>` : '';
  const attrs = `data-board-context="${key}" data-incoming-context data-context-active-host="true" data-key="incoming:${key}" aria-live="off"`;
  return `<div class="history-incoming incoming-owner-${side}" ${attrs}>${copy}${replay}</div>`;
}
