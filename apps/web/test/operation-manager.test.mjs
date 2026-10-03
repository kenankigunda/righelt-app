import test from "node:test";
import assert from "node:assert/strict";
import { createOperationManager } from "../shell/operation-manager.js";

test("operation manager enqueue/confirm resolves committed promise", async () => {
  const manager = createOperationManager();
  const handle = manager.enqueue({
    id: "cmd-1",
    gameId: "game-1",
    result: { accepted: true, state: { sideToMove: "P1" } },
  });

  assert.equal(handle.status, "pending");
  assert.equal(manager.getPendingOperations("game-1").length, 1);

  const finalResult = { accepted: true, state: { sideToMove: "P2" } };
  manager.confirm("cmd-1", finalResult);

  assert.equal(handle.status, "committed");
  assert.deepEqual(await handle.committed, finalResult);
});

test("operation manager fail tracks failed operations by game", async () => {
  const manager = createOperationManager();
  const handle = manager.enqueue({
    id: "cmd-2",
    gameId: "game-2",
    result: { accepted: true },
  });

  manager.fail("cmd-2", Object.assign(new Error("desynced"), { code: "optimistic_desynced" }));

  assert.equal(handle.status, "failed");
  assert.equal(handle.error?.code, "optimistic_desynced");
  await assert.rejects(handle.committed, /desynced/);
  assert.deepEqual(manager.getFailedOperations("game-2"), [handle]);
});

test("operation manager can create already committed local handles", async () => {
  const manager = createOperationManager();
  const handle = manager.createCommitted({
    id: "local-1",
    gameId: "game-3",
    result: { accepted: true, local: true },
  });

  assert.equal(handle.status, "committed");
  assert.deepEqual(await handle.committed, { accepted: true, local: true });
  assert.equal(manager.getPendingOperations("game-3").length, 0);
  manager.dismiss("local-1");
  assert.equal(manager.getHandle("local-1"), null);
});

test("a late failure cannot change a committed operation", async () => {
  const manager = createOperationManager();
  const handle = manager.enqueue({ id: "final", gameId: "g", result: 1 });
  manager.confirm(handle.id, 2);
  manager.fail(handle.id, new Error("obsolete response"));
  assert.equal(handle.status, "committed");
  assert.equal(handle.error, null);
  assert.equal(await handle.committed, 2);
});
