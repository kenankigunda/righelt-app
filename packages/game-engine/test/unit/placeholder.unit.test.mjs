import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("fixture schema is versioned and committed", async () => {
  const schema = JSON.parse(
    await readFile("packages/game-engine/test/fixtures/fixture.schema.json", "utf8"),
  );

  assert.equal(schema.$id, "righelt.engine.fixture.schema.v1");
  assert.equal(schema.type, "object");
});
