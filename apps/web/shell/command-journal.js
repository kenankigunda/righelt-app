import { SYNC_LIMITS, isSyncCommand } from "../generated/packages/shared-types/src/sync-protocol.js";

const journalError = (code, cause) => Object.assign(new Error(code, { cause }), { code });
const keyOf = (command) => [command.identityId, command.gameId, command.clientCommandId];

/** All admission and cleanup operations serialize through one IndexedDB store across tabs. */
export const createCommandJournal = ({ indexedDB = globalThis.indexedDB, databaseName = "righelt.online-commands.v2" } = {}) => {
  let connection;
  const open = () => {
    if (connection) return connection;
    connection = new Promise((resolve, reject) => {
      if (!indexedDB) { reject(journalError("journal_unavailable")); return; }
      const request = indexedDB.open(databaseName, 1);
      let failed = false;
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains("commands")) request.result.createObjectStore("commands", { keyPath: ["identityId", "gameId", "clientCommandId"] });
      };
      request.onblocked = () => { failed = true; reject(journalError("journal_blocked")); };
      request.onerror = () => reject(journalError("journal_open_failed", request.error));
      request.onsuccess = () => {
        if (failed) { request.result.close(); return; }
        const db = request.result;
        db.onversionchange = () => { db.close(); connection = null; };
        resolve(db);
      };
    }).catch((error) => { connection = null; throw error; });
    return connection;
  };
  const transaction = async (mode, work) => {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction("commands", mode);
      let value, failure;
      tx.oncomplete = () => resolve(value);
      tx.onabort = () => reject(failure || journalError("journal_transaction_failed", tx.error));
      tx.onerror = () => {}; // abort is the terminal event; a successful request is not a commit.
      try { work(tx.objectStore("commands"), (result) => { value = result; }, (error) => { failure = error; tx.abort(); }); }
      catch (error) { failure = error; tx.abort(); }
    });
  };
  return {
    admit: (input) => {
      const command = structuredClone(input);
      if (!isSyncCommand(command)) return Promise.reject(journalError("invalid_command"));
      return transaction("readwrite", (store, done, abort) => {
        const read = store.getAll();
        read.onsuccess = () => {
          const records = read.result.filter((entry) => entry.identityId === command.identityId);
          const existing = records.find((entry) => entry.gameId === command.gameId && entry.clientCommandId === command.clientCommandId);
          if (existing) {
            if (existing.fingerprint !== command.fingerprint) abort(journalError("command_id_conflict"));
            else done(existing);
            return;
          }
          if (records.length >= SYNC_LIMITS.outstandingPerIdentity || records.filter((entry) => entry.gameId === command.gameId).length >= SYNC_LIMITS.outstandingPerGame) { abort(journalError("journal_limit")); return; }
          store.add(structuredClone(command));
          done(command);
        };
      });
    },
    list: (identityId, gameId) => transaction("readonly", (store, done) => {
      const read = store.getAll();
      read.onsuccess = () => done(read.result.filter((entry) => entry.identityId === identityId && (gameId == null || entry.gameId === gameId)));
    }),
    remove: (command) => transaction("readwrite", (store, done, abort) => {
      const key = keyOf(command);
      const read = store.get(key);
      read.onsuccess = () => {
        // A stale tab cannot remove another identity's record or a conflicting replacement.
        if (read.result && read.result.fingerprint !== command.fingerprint) { abort(journalError("command_id_conflict")); return; }
        store.delete(key);
        done();
      };
    }),
    close: async () => { const db = await connection; db?.close(); connection = null; },
  };
};
