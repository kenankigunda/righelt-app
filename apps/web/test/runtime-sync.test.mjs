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
