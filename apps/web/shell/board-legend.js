import {getCommandLegendSwatchStyle} from '../legend.js';
import {renderPieceSymbol} from '../piece-symbols.js';

const legendRow = ({entry, icon, label, className = '', hidden = false}) => `
  <span class="legend-key-row ${className}" data-legend-entry="${entry}"${hidden ? ' hidden' : ''}>
    ${icon}<span class="legend-key-label">${label}</span>
  </span>`;

/**
 * Render the semantic Board-label families without taking ownership of which
 * conditional cues are visible. The runtime continues to reveal only labels
 * for overlays that it actually painted.
 */
export function renderBoardLegend(snapshot) {
  const side = snapshot?.sideToMove === 'P2' ? 'p2' : 'p1';
  return `<div class="overlay-key" aria-label="Board legend">
    <div class="legend-family" role="group" aria-label="Commander and command line" data-legend-family="command">
      <button type="button" class="legend-inspection legend-key-row" data-board-inspection="command" aria-pressed="false"><i class="swatch commander-key legend-key-icon" aria-hidden="true">${renderPieceSymbol('commander')}</i><span class="legend-inspection-label legend-key-label">Commander</span></button>
      ${legendRow({entry:'command',className:'legend-family-child',hidden:true,icon:`<i id="shell-command-legend-swatch" class="swatch command legend-key-icon" aria-hidden="true" style="${getCommandLegendSwatchStyle(snapshot ?? null)}"></i>`,label:'Command line'})}
    </div>
    <div class="legend-family" role="group" aria-label="Supply point and supply line" data-legend-family="supply">
      <button type="button" class="legend-inspection legend-key-row" data-board-inspection="supply" aria-pressed="false"><i class="swatch supply-point legend-key-icon" aria-hidden="true" style="--supply-owner:var(--player-${side})">${renderPieceSymbol('supply')}</i><span class="legend-inspection-label legend-key-label">Supply point</span></button>
      ${legendRow({entry:'supply',className:'legend-family-child',hidden:true,icon:'<i class="swatch supply legend-key-icon" aria-hidden="true"></i>',label:'Supply line'})}
    </div>
    ${legendRow({entry:'group',className:'legend-peer',hidden:true,icon:'<i class="swatch group legend-key-icon" aria-hidden="true"></i>',label:'Group strength'})}
    ${legendRow({entry:'previousTurn',className:'legend-context-row',hidden:true,icon:'<i class="previous-turn-key-swatch legend-key-icon" aria-hidden="true"></i>',label:'Previous turn'})}
  </div>`;
}
