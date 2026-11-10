import {getGameResult,renderResultText} from './game-result.js';
import {renderResultMark} from './result-presentation.js';
import {playerDisplayName} from './perspective-labels.js';
import {icon} from './ui.js';
export function renderResultPanel(game,{transport,escapeHtml,formatDisplayGameId}) {

  const confirmed = transport.getAuthoritativeGame(game.id);
  const result = getGameResult(confirmed, transport.getIdentityId());
  if (!result) return "";
  const names = ['P1','P2'].map(side => playerDisplayName(confirmed,side));
  const isolatedName = (name,index) => `<span class="player-tone-p${index+1}"><bdi dir="auto">${escapeHtml(name)}</bdi></span>`;
  return `<section class="panel game-result" data-testid="game-result" data-result-tone="${result.tone}" data-winner="${result.winner ?? ''}"><p class="small">Game finished</p>${renderResultMark(result)}<h1 tabindex="-1">${renderResultText(result,'title')}</h1><p>${renderResultText(result,'reason')}</p><p>${result.controlsBothSides ? "You play both sides" : names.map(isolatedName).join(" vs ")}</p><p class="small">Game ${escapeHtml(formatDisplayGameId(game.id))}</p><div class="story-modal-actions"><button data-action="analysis" data-game-id="${escapeHtml(game.id)}">${icon('back')}Review game</button><button${result.tone === "victory" ? "" : ' class="secondary"'} data-action="rematch" data-game-id="${escapeHtml(game.id)}">${icon('rematch')}Play again</button><a class="button-link secondary" href="#/">${icon('home')}Home</a></div></section>`;

}
