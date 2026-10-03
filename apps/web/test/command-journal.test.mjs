import test from "node:test";
import assert from "node:assert/strict";
import { IDBFactory } from "fake-indexeddb";
import { createCommandJournal } from "../shell/command-journal.js";
import { commandFingerprint } from "../generated/packages/shared-types/src/sync-protocol.js";
const command = async (id, gameId = "g") => {
  const value = { protocolVersion: 2, identityId: "actor", gameId, clientCommandId: `v2:${id}`, kind: "action", payload: { action: {} }, expectedState: {}, expectedGameplayRevision: 0 };
  value.fingerprint = await commandFingerprint(value); return value;
};
test("journal cross-tab admission atomically enforces both caps without evicting commands", async () => {
  const indexedDB = new IDBFactory();
  const a = createCommandJournal({ indexedDB }), b = createCommandJournal({ indexedDB });
  const values = await Promise.all(Array.from({ length: 20 }, (_, i) => command(i)));
  const outcomes = await Promise.allSettled(values.map((value, i) => (i % 2 ? a : b).admit(value)));
  assert.equal(outcomes.filter((result) => result.status === "fulfilled").length, 16);
  assert.equal((await a.list("actor", "g")).length, 16);
  const more = await Promise.all(Array.from({ length: 120 }, (_, i) => command(`extra${i}`, `other${i}`)));
  const next = await Promise.allSettled(more.map((value, i) => (i % 2 ? a : b).admit(value)));
  assert.equal(next.filter((result) => result.status === "fulfilled").length, 112);
  assert.equal((await b.list("actor")).length, 128);
  await a.close(); await b.close();
});
test("journal snapshots input and stale cleanup cannot delete a conflicting or unrelated record", async () => {
  const journal = createCommandJournal({ indexedDB: new IDBFactory() });
  const value = await command("immutable"); const original = structuredClone(value);
  const admission = journal.admit(value); value.expectedGameplayRevision = 90;
  await admission;
  assert.deepEqual(await journal.list("actor"), [original]);
  await assert.rejects(journal.remove({ ...original, fingerprint: "a".repeat(64) }), /command_id_conflict/);
  await journal.remove({ ...original, identityId: "other" });
  assert.equal((await journal.list("actor")).length, 1);
  await journal.remove(original); await journal.remove(original);
  assert.deepEqual(await journal.list("actor"), []);
});
test("successful add followed by transaction abort is not admitted", async () => {
  const factory = new IDBFactory();
  const indexedDB = { open(...args) {
    const request = factory.open(...args);
    request.addEventListener("success", () => {
      const db = request.result, transaction = db.transaction.bind(db);
      db.transaction = (...args) => {
        const tx = transaction(...args), objectStore = tx.objectStore.bind(tx);
        tx.objectStore = (name) => {
          const store = objectStore(name), add = store.add.bind(store);
          store.add = (...args) => { const write = add(...args); write.addEventListener("success", () => tx.abort()); return write; };
          return store;
        }; return tx;
      };
    }); return request;
  } };
  const journal = createCommandJournal({ indexedDB });
  await assert.rejects(journal.admit(await command("aborted")), /journal_transaction_failed/);
  assert.deepEqual(await journal.list("actor"), []);
});
test("unavailable, open error, and blocked journal openings fail closed and can be retried", async () => {
  await assert.rejects(createCommandJournal({ indexedDB: null }).list("actor"), /journal_unavailable/);
  for (const event of ["onerror", "onblocked"]) {
    const journal = createCommandJournal({ indexedDB: { open() { const request = {}; queueMicrotask(() => request[event]()); return request; } } });
    await assert.rejects(journal.list("actor"), /journal_(open_failed|blocked)/);
    await assert.rejects(journal.list("actor"), /journal_(open_failed|blocked)/);
  }
});
