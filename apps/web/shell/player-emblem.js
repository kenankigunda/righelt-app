import {gameInlayModel} from './game-inlay.js';

// Decorative identity, not authentication. Stable account, guest, and computer
// keys retain one fitted mineral mark across games, seats, and display names.
export const playerEmblemSeed = username => {
  let seed = 2166136261;
  for (const char of String(username || "guest").trim().toLowerCase()) {
    seed ^= char.codePointAt(0);
    seed = Math.imul(seed, 16777619) >>> 0;
  }
  return seed;
};
export const renderPlayerEmblem = username => {
  const key=String(username||'guest').trim().toLowerCase(),model=gameInlayModel(`player:${key}`),points=value=>value.map(pair=>pair.join(',')).join(' ');
  return `<svg class="player-emblem" viewBox="0 0 36 36" aria-hidden="true" focusable="false"><polygon class="player-emblem-face" points="${points(model.outline)}"/>${model.tiles.map(tile=>`<polygon class="player-emblem-tile" fill="${tile.fill}" points="${points(tile.points)}"/><polygon class="player-emblem-grain" points="${points(tile.grain)}"/>`).join('')}<polygon class="player-emblem-edge" points="${points(model.outline)}"/></svg>`;
};
