import { SUPPLY_POINTS } from '../generated/packages/game-engine/src/deterministic.js';

const gcd = (left, right) => {
  let a = Math.abs(left);
  let b = Math.abs(right);
  while (b !== 0) {
    const next = a % b;
    a = b;
    b = next;
  }
  return a || 1;
};

export const normalizeConnectionPath = (path) => {
  if (!Array.isArray(path) || path.length < 2) {
    return Array.isArray(path) ? [...path] : [];
  }

  const normalized = [{ ...path[0] }];
  for (let index = 0; index < path.length - 1; index += 1) {
    const from = path[index];
    const to = path[index + 1];
    if (!from || !to) {
      continue;
    }

    const deltaRow = to.row - from.row;
    const deltaCol = to.col - from.col;
    const steps = gcd(deltaRow, deltaCol);
    const rowStep = deltaRow / steps;
    const colStep = deltaCol / steps;

    for (let step = 1; step <= steps; step += 1) {
      normalized.push({
        row: from.row + rowStep * step,
        col: from.col + colStep * step,
      });
    }
  }

  return normalized;
};

const samePoint = (a, b) => Boolean(a && b && a.row === b.row && a.col === b.col);
export const supplyPointForOwner = owner => SUPPLY_POINTS[owner] ? {...SUPPLY_POINTS[owner]} : null;
export const supplyOwnerAt = point => Object.entries(SUPPLY_POINTS).find(([, value]) => samePoint(point, value))?.[0] ?? null;

/** Resolve only recorded engine paths. Inspection never computes alternate routes. */
export function inspectionPaths(snapshot, inspection) {
  if (inspection?.kind === 'networks') return [inspection.command,inspection.supply].filter(Boolean).flatMap(layer=>inspectionPaths(snapshot,layer));
  if (!inspection || !['supply', 'command', 'combined'].includes(inspection.kind)) return [];
  const pieces = snapshot?.pieces ?? [];
  const selected = inspection.pieceId ? pieces.find(piece => piece.id === inspection.pieceId) : null;
  if (inspection.pieceId && !selected) return [];
  const owner = selected?.owner ?? inspection.owner ?? snapshot?.sideToMove;
  const candidates = selected ? [selected] : pieces.filter(piece => piece.owner === owner);
  const supply = snapshot?.artifacts?.supply?.find(item => item.player === owner)?.shortestPathByPieceId ?? {};
  const command = snapshot?.artifacts?.command?.shortestPathToCommanderByPieceId ?? {};
  const paths = [];
  for (const piece of candidates) {
    for (const kind of inspection.kind === 'combined' ? ['supply', 'command'] : [inspection.kind]) {
      const path = normalizeConnectionPath((kind === 'supply' ? supply : command)[piece.id] ?? []);
      if (path.length < 2) continue;
      if (inspection.point && !path.some(point => samePoint(point, inspection.point))) continue;
      paths.push({kind, owner, path});
    }
  }
  return paths;
}

export function inspectionSegments(snapshot, inspection) {
  const seen = new Set();
  return inspectionPaths(snapshot, inspection).flatMap(({kind, owner, path}) => path.slice(1).flatMap((to, index) => {
    const from = path[index];
    const key = `${kind}:${[`${from.row},${from.col}`, `${to.row},${to.col}`].sort().join(':')}`;
    if (seen.has(key)) return [];
    seen.add(key);
    return [{kind, owner, from, to}];
  }));
}
