import assert from "node:assert/strict";
import test from "node:test";
import { readSyncBody } from "../src/sync-body.ts";
test("bounded body deadline expires even when a chunk never arrives", async (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  let cancelled = false;
  const request = new Request("https://test", { method: "POST", body: new ReadableStream({ cancel() { cancelled = true; } }), duplex: "half" });
  const result = assert.rejects(readSyncBody(request), (error) => error.status === 408);
  context.mock.timers.tick(5000);
  await result; assert.equal(cancelled, true);
});
