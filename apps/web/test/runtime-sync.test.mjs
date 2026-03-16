import test from "node:test";
import assert from "node:assert/strict";

import { shouldSkipBoardRuntimeReload } from "../shell/runtime-sync.js";

test("shell board mount skips reload when runtime already matches current snapshot", () => {
  assert.equal(
    shouldSkipBoardRuntimeReload({
      runtimeSnapshotKey: "{\"turnIndex\":0}",
      runtimeLegalActionsKey: "[{\"type\":\"move\"}]",
      snapshotKey: "{\"turnIndex\":0}",
      legalActionsKey: "[{\"type\":\"move\"}]",
      mountedSelectionActionKey: "null",
      selectionActionKey: "null",
      resetSelection: false,
    }),
    true,
  );
});

test("shell board mount reloads when selection reset or snapshot inputs differ", () => {
  assert.equal(
    shouldSkipBoardRuntimeReload({
      runtimeSnapshotKey: "{\"turnIndex\":0}",
      runtimeLegalActionsKey: "[{\"type\":\"move\"}]",
      snapshotKey: "{\"turnIndex\":1}",
      legalActionsKey: "[{\"type\":\"move\"}]",
      mountedSelectionActionKey: "null",
      selectionActionKey: "null",
      resetSelection: false,
    }),
    false,
  );

  assert.equal(
    shouldSkipBoardRuntimeReload({
      runtimeSnapshotKey: "{\"turnIndex\":0}",
      runtimeLegalActionsKey: "[{\"type\":\"move\"}]",
      snapshotKey: "{\"turnIndex\":0}",
      legalActionsKey: "[{\"type\":\"move\"}]",
      mountedSelectionActionKey: "null",
      selectionActionKey: "null",
      resetSelection: true,
    }),
    false,
  );
});

test("shell board mount skips reload for matching authoritative ack after an optimistic move", () => {
  assert.equal(
    shouldSkipBoardRuntimeReload({
      runtimeSnapshotKey: "{\"turnIndex\":0,\"sideToMove\":\"P1\",\"pieces\":[{\"id\":\"A1\"}]}",
      runtimeLegalActionsKey: "[{\"type\":\"rush\",\"actorId\":\"A1\"}]",
      snapshotKey: "{\"turnIndex\":0,\"sideToMove\":\"P1\",\"pieces\":[{\"id\":\"A1\"}]}",
      legalActionsKey: "[{\"type\":\"rush\",\"actorId\":\"A1\"}]",
      mountedSelectionActionKey: "null",
      selectionActionKey: "null",
      resetSelection: false,
    }),
    true,
  );
});

test("shell board mount does not reset selection when a selected history entry keeps the same key across pending-to-validated upgrade", () => {
  assert.equal(
    shouldSkipBoardRuntimeReload({
      runtimeSnapshotKey: "{\"turnIndex\":0,\"sideToMove\":\"P1\",\"pieces\":[{\"id\":\"A1\"}]}",
      runtimeLegalActionsKey: "[{\"type\":\"move\",\"from\":{\"row\":1,\"col\":1},\"to\":{\"row\":1,\"col\":2}}]",
      snapshotKey: "{\"turnIndex\":0,\"sideToMove\":\"P1\",\"pieces\":[{\"id\":\"A1\"}]}",
      legalActionsKey: "[{\"type\":\"move\",\"from\":{\"row\":1,\"col\":1},\"to\":{\"row\":1,\"col\":2}}]",
      mountedSelectionActionKey: "{\"type\":\"move\",\"from\":{\"row\":1,\"col\":1},\"to\":{\"row\":1,\"col\":2}}",
      selectionActionKey: "{\"type\":\"move\",\"from\":{\"row\":1,\"col\":1},\"to\":{\"row\":1,\"col\":2}}",
      resetSelection: false,
    }),
    true,
  );
});
