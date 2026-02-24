import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  AUTHORITATIVE_MODULES,
  BANNED_AUTHORITATIVE_IMPORTS,
} from "../engine.test.config.mjs";

for (const modulePath of AUTHORITATIVE_MODULES) {
  test(`authoritative module avoids third-party graph/pathfinding deps: ${modulePath}`, async () => {
    const source = await readFile(modulePath, "utf8");

    for (const banned of BANNED_AUTHORITATIVE_IMPORTS) {
      const importPattern = new RegExp(`from\\s+["']${banned}["']`);
      assert.equal(importPattern.test(source), false, `${modulePath} imports forbidden package ${banned}`);
    }
  });
}
