import {connectionLegendProperties,connectionStroke} from './board/connection-styles.js';
export function getCommandLegendColor(snapshot, selectedPieceId = null) {
  const selectedPiece =
    snapshot?.pieces?.find?.((piece) => piece.id === selectedPieceId) ?? null;
  const owner = selectedPiece?.owner ?? snapshot?.sideToMove ?? "P1";
  return owner === "P2" ? "var(--player-p2)" : "var(--player-p1)";
}

export function getCommandLegendSwatchStyle(snapshot, selectedPieceId = null) {
  return `--swatch-command-color: ${getCommandLegendColor(snapshot, selectedPieceId)};${Object.entries(connectionLegendProperties()).map(([name,value])=>`${name}:${value};`).join('')}`;
}

export function applyCommandLegendSwatch(element, snapshot, selectedPieceId = null) {
  if (!element) {
    return;
  }
  element.style.setProperty("--swatch-command-color", getCommandLegendColor(snapshot, selectedPieceId));
  for(const [name,value] of Object.entries(connectionLegendProperties()))element.style.setProperty(name,value);
}

// Ignore identical visual updates so ordinary board renders cannot interrupt motion.
export function updateLegendVisibility(legend, visible, reducedMotion = false) {
  if (!legend) return;
  const changes = Object.entries(visible).flatMap(([key, value]) => {
    const item = legend.querySelector(`[data-legend-entry="${key}"]`);
    return item && item.hidden === value ? [{ item, hidden: !value }] : [];
  });
  if (!changes.length) return;
  const from = legend.getBoundingClientRect().height;
  legend.getAnimations().forEach(animation => animation.cancel());
  for (const { item, hidden } of changes) item.hidden = hidden;
  const to = legend.scrollHeight;
  if (!reducedMotion && from !== to) {
    legend.animate([{ height: `${from}px` }, { height: `${to}px` }], { duration: 180, easing: 'ease-out' });
  }
}


const ownerColor = owner => owner === 'P2' ? 'var(--player-p2)' : 'var(--player-p1)';
export function getInspectionLegendState(snapshot, {selectedPieceId=null,inspection=null,networkInspections={},networkOwners={}} = {}) {
  const selected = snapshot?.pieces?.find(piece=>piece.id===selectedPieceId);
  const fallback = selected?.owner ?? snapshot?.sideToMove ?? 'P1';
  const inspected = snapshot?.pieces?.find(piece=>piece.id===inspection?.pieceId);
  const commandLayer = networkInspections.command ?? (inspection?.kind==='networks'?inspection.command:null);
  const supplyLayer = networkInspections.supply ?? (inspection?.kind==='networks'?inspection.supply:null);
  const commandOwner = commandLayer?.owner ?? (['command','combined'].includes(inspection?.kind)?inspection.owner??inspected?.owner:null) ?? networkOwners.command ?? fallback;
  const supplyOwner = supplyLayer?.owner ?? (['supply','combined'].includes(inspection?.kind)?inspection.owner??inspected?.owner:null) ?? networkOwners.supply ?? fallback;
  return {
    command:{owner:commandOwner,color:ownerColor(commandOwner),selected:Boolean(commandLayer || inspection?.kind==='command')},
    supply:{owner:supplyOwner,color:ownerColor(supplyOwner),selected:Boolean(supplyLayer || inspection?.kind==='supply')},
  };
}

/** Colors and independent pressed states share the runtime's inspection context. */
export function updateInspectionLegend(legend, snapshot, context = {}) {
  if (!legend) return;
  const state=getInspectionLegendState(snapshot,context);
  for(const [name,value] of Object.entries(connectionLegendProperties()))legend.style.setProperty(name,value);
  for (const kind of ['command','supply']) {
    const button=legend.querySelector(`[data-board-inspection="${kind}"]`),entry=state[kind];
    button?.setAttribute('aria-pressed',String(entry.selected));
    button?.setAttribute('data-inspection-owner',entry.owner);
    button?.setAttribute('aria-label',`${entry.owner==='P2'?'Blue':'Red'} ${kind==='command'?'commander':'supply point'} inspection`);
    button?.style.setProperty('--legend-owner-color',entry.color);
    const icon=button?.querySelector(kind==='command'?'.commander-key':'.supply-point');
    icon?.style.setProperty(kind==='command'?'--swatch-command-color':'--supply-owner',entry.color);
    legend.querySelector(kind==='command'?'.swatch.command':'.swatch.supply')?.style.setProperty(kind==='command'?'--swatch-command-color':'--swatch-supply-color',connectionStroke(kind,entry.owner));
  }
}
