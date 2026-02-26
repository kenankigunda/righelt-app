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

test("startup bootstrap payload is precomputed at module scope", async () => {
  const source = await readFile(API_HANDLER_ENTRYPOINT, "utf8");
  assert.equal(
    source.includes("const INITIAL_PLAYGROUND_STATE = resolveToStability(createInitialState(), { artifactMode: \"full\" });"),
    true,
  );
  assert.equal(
    source.includes("const INITIAL_PLAYGROUND_LEGAL_ACTIONS = listLegalActions(INITIAL_PLAYGROUND_STATE);"),
    true,
  );
});
