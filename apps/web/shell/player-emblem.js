// Decorative identity, not authentication. Canonical usernames produce stable
// angular motifs; color is inherited so a seat can supply its player accent.
export const playerEmblemSeed = username => {
  let seed = 2166136261;
  for (const char of String(username || "guest").trim().toLowerCase()) {
    seed ^= char.codePointAt(0);
    seed = Math.imul(seed, 16777619) >>> 0;
  }
  return seed;
};
export const renderPlayerEmblem = username => {
  let state = playerEmblemSeed(username);
  const cells = [];
  for (let row = 0; row < 5; row++) {
    for (let col = 0; col < 3; col++) {
      state ^= state << 13; state ^= state >>> 17; state ^= state << 5;
      if (!(state & 1) && !(row === 2 && col === 2)) continue;
      for (const x of col === 2 ? [col] : [col, 4 - col]) {
        const left = 7 + x * 4, top = 7 + row * 4;
        cells.push(`<path d="M${left+1} ${top}h2l1 1v2l-1 1h-2l-1-1v-2Z"/>`);
      }
    }
  }
  return `<svg class="player-emblem" viewBox="0 0 34 34" aria-hidden="true" focusable="false"><path class="player-emblem-face" d="M7 1h21l5 5v21l-6 6H6l-5-5V7Z"/><g fill="currentColor">${cells.join("")}</g><path class="player-emblem-edge" d="M1 27l5 6h21l6-6"/></svg>`;
};
