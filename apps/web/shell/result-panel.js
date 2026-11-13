import {renderGameTitle} from './game-title.js';
import {getGameResult,renderResultText} from './game-result.js';
import {renderResultMark} from './result-presentation.js';
import {icon} from './ui.js';
export function renderResultPanel(game,{transport,escapeHtml}) {

  const confirmed = transport.getAuthoritativeGame(game.id);
  const result = getGameResult(confirmed, transport.getIdentityId());
  if (!result) return "";
  const titleGame={...confirmed,myRole:result.controlsBothSides?'Both Players':result.side==='p1'?'Player 1':result.side==='p2'?'Player 2':'Viewer'};
  return `<section class="panel game-result" data-testid="game-result" data-result-tone="${result.tone}" data-winner="${result.winner ?? ''}"><p class="small">Game finished</p>${renderResultMark(result)}<h1 tabindex="-1">${renderResultText(result,'title')}</h1><p>${renderResultText(result,'reason')}</p><p>${renderGameTitle(titleGame,{identityId:transport.getIdentityId()})}</p><div class="story-modal-actions"><button data-action="analysis" data-game-id="${escapeHtml(game.id)}">${icon('back')}Review game</button><button${result.tone === "victory" ? "" : ' class="secondary"'} data-action="rematch" data-game-id="${escapeHtml(game.id)}">${icon('rematch')}Play again</button><a class="button-link secondary" href="#/">${icon('home')}Home</a></div></section>`;

}
