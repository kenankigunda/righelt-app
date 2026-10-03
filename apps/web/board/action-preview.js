import { applyAction } from "../generated/packages/game-engine/src/apply.js";
import { resolveToStability } from "../generated/packages/game-engine/src/resolve.js";

// Preview uses the same apply/resolve steps as authority; it never mutates live state.
export const buildImmediateActionPreview = (state, action) => {
  const before = resolveToStability(state, { artifactMode: "full" });
  const applied = applyAction(before, action);
  const after = resolveToStability(applied.state, { artifactMode: "full" });
  const previous = new Map(before.pieces.map((piece) => [piece.id, piece]));
  const next = new Map(after.pieces.map((piece) => [piece.id, piece]));
  const removed = before.pieces.filter((piece) => !next.has(piece.id));
  const changed = after.pieces.filter((piece) => {
    const old = previous.get(piece.id);
    return !old || old.position.row !== piece.position.row || old.position.col !== piece.position.col ||
      old.supplied !== piece.supplied || old.commanded !== piece.commanded;
  });
  const supplyChanges = changed.filter((piece) => previous.has(piece.id) && previous.get(piece.id).supplied !== piece.supplied);
  const commandChanges = changed.filter((piece) => previous.has(piece.id) && previous.get(piece.id).commanded !== piece.commanded);
  return { state: after, removed, changed, supplyChanges, commandChanges, continuation: after.continuation };
};

export const actionPreviewKey = (state, action, authority = "") => JSON.stringify([authority, state, action]);

export const describeImmediatePreview = (preview) => {
  const parts = ["Preview. Activate this destination again to play."];
  if (preview.removed.length) parts.push(`${preview.removed.length} piece${preview.removed.length === 1 ? "" : "s"} removed.`);
  for (const piece of preview.supplyChanges) parts.push(`Piece at ${piece.position.row},${piece.position.col} ${piece.supplied ? "gains" : "loses"} supply.`);
  for (const piece of preview.commandChanges) parts.push(`Piece at ${piece.position.row},${piece.position.col} ${piece.commanded ? "gains" : "loses"} command.`);
  if (preview.continuation) parts.push(`A ${preview.continuation.phase ?? preview.continuation.type} decision follows.`);
  return parts.join(" ");
};
