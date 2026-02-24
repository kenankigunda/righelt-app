function stableSortObject(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(stableSortObject);
  }

  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
      a.localeCompare(b),
    );
    return Object.fromEntries(entries.map(([k, v]) => [k, stableSortObject(v)]));
  }

  return value;
}

export function deterministicStateHash(value: unknown): string {
  const normalized = stableSortObject(value);
  const serialized = JSON.stringify(normalized);

  const seeds = [
    0x811c9dc5, 0x9e3779b1, 0x85ebca6b, 0xc2b2ae35, 0x27d4eb2f, 0x165667b1, 0xd3a2646c,
    0xfd7046c5,
  ];

  let hash = "";
  for (const seed of seeds) {
    let h = seed >>> 0;
    for (let i = 0; i < serialized.length; i += 1) {
      h ^= serialized.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    hash += h.toString(16).padStart(8, "0");
  }

  return hash;
}
