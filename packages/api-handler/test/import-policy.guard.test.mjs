import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const API_HANDLER_ENTRYPOINT = "packages/api-handler/src/index.ts";
const BANNED_IMPORT_PATTERNS = [
  /from\s+["']\.\.\/\.\.\/game-engine\/src["']/,
  /from\s+["']\.\.\/\.\.\/game-engine\/src\/index["']/,
];

test("startup API handler avoids game-engine barrel imports", async () => {
  const source = await readFile(API_HANDLER_ENTRYPOINT, "utf8");

  for (const pattern of BANNED_IMPORT_PATTERNS) {
    assert.equal(
      pattern.test(source),
      false,
      `${API_HANDLER_ENTRYPOINT} matches banned import pattern ${pattern}`,
    );
  }
});

test("API handler no longer exposes deprecated engine playground routes", async () => {
  const source = await readFile(API_HANDLER_ENTRYPOINT, "utf8");
  assert.equal(
    source.includes("/api/engine/playground/"),
    false,
  );
  assert.equal(
    source.includes("INITIAL_PLAYGROUND_STATE"),
    false,
  );
});
