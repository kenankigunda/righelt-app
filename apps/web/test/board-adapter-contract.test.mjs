import test from "node:test";
import assert from "node:assert/strict";

import { assertGameBoardAdapter } from "../board-adapter-contract.js";

test("assertGameBoardAdapter accepts valid adapter shape", () => {
  const adapter = {
    getCapabilities() {
      return { live: true, history: false, tutorial: false, offlineLocal: false };
    },
    mount() {},
    unmount() {},
    getPieceAt() {
      return null;
    },
    getPieceById() {
      return null;
    },
    nextSelectionForCell() {
      return { selection: { selectedPieceId: null, source: null, target: null }, nextActionType: "pass" };
    },
    render() {},
    getCommanderSupplySummary() {
      return "-";
    },
    getSelectedPieceSummary() {
      return null;
    },
  };

  assert.doesNotThrow(() => assertGameBoardAdapter(adapter));
});

test("assertGameBoardAdapter throws when required method is missing", () => {
  const adapter = {
    getCapabilities() {
      return { live: true, history: false, tutorial: false, offlineLocal: false };
    },
  };

  assert.throws(() => assertGameBoardAdapter(adapter), /missing method/i);
});
