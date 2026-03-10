import test from "node:test";
import assert from "node:assert/strict";
import { createShellBoardHost } from "../board/hosts/shell-host.js";

test("shell host endTurn calls transport even when cached canEndTurn is false", async () => {
  const transport = {
    getGameViewModel() {
      return { canEndTurn: false, legalActions: [{ type: "pass" }] };
    },
    async endTurn() {
      return {
        ok: true,
        game: {
          currentSnapshot: { sideToMove: "P2", turnIndex: 1, continuation: null, pieces: [] },
          legalActions: [{ type: "move" }],
        },
      };
    },
  };

  const host = createShellBoardHost({ transport, gameId: "g-1", canInteract: () => true });
  const result = await host.endTurn({ sideToMove: "P1", turnIndex: 0, continuation: null, pieces: [] });

  assert.equal(result.accepted, true);
  assert.equal(result.state.sideToMove, "P2");
  assert.equal(result.boardMessage?.type, "turn_ended");
});

test("shell host endTurn maps transport rejection to accepted false validation", async () => {
  const transport = {
    getGameViewModel() {
      return {
        currentSnapshot: { sideToMove: "P1", turnIndex: 0, continuation: null, pieces: [] },
        legalActions: [{ type: "rush" }],
      };
    },
    async endTurn() {
      const error = new Error("turn_has_no_moves");
      error.code = "turn_has_no_moves";
      throw error;
    },
  };

  const host = createShellBoardHost({ transport, gameId: "g-2", canInteract: () => true });
  const result = await host.endTurn({ sideToMove: "P1", turnIndex: 0, continuation: null, pieces: [] });

  assert.equal(result.accepted, false);
  assert.equal(result.validation?.code, "turn_has_no_moves");
  assert.equal(result.state.sideToMove, "P1");
});

test("shell host applyAction preserves removedPieces from the transport response", async () => {
  const removedPieces = [
    {
      pieceId: "A1",
      position: { row: 4, col: 2 },
      reason: "no_retreat",
      message: "Piece at (4, 2) destroyed because it could not retreat",
    },
  ];
  const transport = {
    getGameViewModel() {
      return {
        currentTurn: { playerSeat: "Player 1" },
      };
    },
    async applyGameAction() {
      return {
        accepted: true,
        state: { sideToMove: "P1", turnIndex: 0, continuation: null, pieces: [] },
        legalActions: [],
        removedPieces,
      };
    },
  };

  const host = createShellBoardHost({ transport, gameId: "g-3", canInteract: () => true });
  const result = await host.applyAction(
    { sideToMove: "P1", turnIndex: 0, continuation: null, pieces: [] },
    { type: "pass" },
  );

  assert.equal(result.accepted, true);
  assert.deepEqual(result.removedPieces, removedPieces);
});
