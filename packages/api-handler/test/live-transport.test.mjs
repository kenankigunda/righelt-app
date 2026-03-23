import test from "node:test";
import assert from "node:assert/strict";
import { listLegalActions } from "../../game-engine/src/legal";
import { handleApiRequest } from "../src/index.ts";
import { __resetLiveGameStateForTests } from "../src/shell-live.ts";
import { applyServerAction, createInitialGame } from "../src/shell-live-core.ts";
import { createFakeD1 } from "./support/fake-d1.mjs";
import { createFakeGameRooms } from "./support/fake-game-rooms.mjs";

const SCENARIO_UUIDS = {
  importedScenario: "e5e48740-f8e2-4b32-bfbf-c46ec98b5962",
  projectEndsTurn: "7cf5de75-0500-4f33-ac8d-8036935ab445",
  savedSelection: "c01a536c-4eff-47f4-b4ad-2c6fd2ecc40e",
  importerBecomesPlayer2: "9eb170a3-0372-4f17-a651-43d0262a51f7",
};

const env = {
  DB: createFakeD1(),
  GAME_ROOMS: null,
};
env.GAME_ROOMS = createFakeGameRooms(() => env);

const req = (path, method = "GET", body = null) =>
  new Request(`https://example.test${path}`, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });

const captureConsoleEvents = () => {
  const warnings = [];
  const errors = [];
  const originalWarn = console.warn;
  const originalError = console.error;
  console.warn = (message, ...rest) => {
    warnings.push([message, ...rest].join(" "));
  };
  console.error = (message, ...rest) => {
    errors.push([message, ...rest].join(" "));
  };
  return {
    warnings,
    errors,
    restore() {
      console.warn = originalWarn;
      console.error = originalError;
    },
  };
};

test.beforeEach(() => {
  __resetLiveGameStateForTests();
  env.DB.reset();
  env.GAME_ROOMS.reset();
});

test("live transport: create/list/get game lifecycle is server-backed", async () => {
  const create = await handleApiRequest(
    req("/api/shell/games", "POST", { identityId: "id-a", playgroundMode: false, offlineLocal: false }),
    env,
  );
  assert.equal(create.status, 200);
  const createBody = await create.json();
  const gameId = createBody.game.id;

  const list = await handleApiRequest(req("/api/shell/games?identityId=id-a"), env);
  const listBody = await list.json();
  assert.equal(listBody.games.length >= 1, true);
  assert.equal(listBody.games.some((entry) => entry.id === gameId), true);

  const open = await handleApiRequest(req(`/api/shell/games/${gameId}?identityId=id-b&openAsViewer=1`), env);
  const openBody = await open.json();
  assert.equal(openBody.game.viewers.some((viewer) => viewer.identityId === "id-b"), false);

  const inviteToken = createBody.game.inviteToken;
  assert.equal(typeof inviteToken, "string");
  assert.equal(inviteToken.length > 20, true);

  const inviteResolve = await handleApiRequest(req(`/api/shell/invites/${inviteToken}`), env);
  const inviteBody = await inviteResolve.json();
  assert.equal(inviteBody.gameId, gameId);
  assert.equal(inviteBody.inviteFromRole, "Player 1");

  const directOpen = await handleApiRequest(req(`/api/shell/games/${gameId}?identityId=id-direct`), env);
  const directBody = await directOpen.json();
  assert.equal(directBody.game.myRole, "Guest");
  assert.equal(directBody.game.viewers.some((viewer) => viewer.identityId === "id-direct"), false);
  assert.equal(directBody.game.canJoinAsViewer, true);
  assert.equal(directBody.game.canJoinAsPlayer, true);
});

test("live transport: paged home sections return latest-activity slices", async () => {
  const createdGameIds = [];
  for (let index = 0; index < 6; index += 1) {
    const create = await handleApiRequest(
      req("/api/shell/games", "POST", { identityId: "id-owner", playgroundMode: false, offlineLocal: false }),
      env,
    );
    const body = await create.json();
    createdGameIds.push(body.game.id);
    env.DB.overwriteGameState(body.game.id, (game) => ({
      ...game,
      lastMoveAt: `2026-02-26T00:00:0${index}.000Z`,
      updatedAt: `2026-02-26T00:00:0${index}.000Z`,
    }));
  }

  const firstPage = await handleApiRequest(req("/api/shell/games?identityId=id-owner&section=my&page=0&pageSize=6&debug=0"), env);
  const firstBody = await firstPage.json();
  assert.equal(firstBody.totalGames, 6);
  assert.equal(firstBody.totalPages, 1);
  assert.equal(firstBody.page, 0);
  assert.equal(firstBody.games.length, 6);
  assert.deepEqual(
    firstBody.games.map((game) => game.id),
    [...createdGameIds].reverse().slice(0, 6),
  );
});

test("live transport: paged home sections isolate smoke games only in debug mode", async () => {
  const mine = await handleApiRequest(
    req("/api/shell/games", "POST", { identityId: "id-a", playgroundMode: false, offlineLocal: false }),
    env,
  );
  const mineBody = await mine.json();
  const other = await handleApiRequest(
    req("/api/shell/games", "POST", { identityId: "id-b", playgroundMode: false, offlineLocal: false }),
    env,
  );
  const otherBody = await other.json();
  const smoke = await handleApiRequest(
    req("/api/shell/games", "POST", { identityId: "smoke-player", playgroundMode: false, offlineLocal: false }),
    env,
  );
  const smokeBody = await smoke.json();

  const myPage = await handleApiRequest(req("/api/shell/games?identityId=id-a&section=my&page=0&pageSize=6&debug=1"), env);
  const myBody = await myPage.json();
  assert.deepEqual(myBody.games.map((game) => game.id), [mineBody.game.id]);

  const otherPage = await handleApiRequest(req("/api/shell/games?identityId=id-a&section=other&page=0&pageSize=6&debug=1"), env);
  const otherPageBody = await otherPage.json();
  assert.deepEqual(otherPageBody.games.map((game) => game.id), [otherBody.game.id]);

  const smokePage = await handleApiRequest(req("/api/shell/games?identityId=id-a&section=smoke&page=0&pageSize=6&debug=1"), env);
  const smokePageBody = await smokePage.json();
  assert.deepEqual(smokePageBody.games.map((game) => game.id), [smokeBody.game.id]);
});

test("live transport: scenario import creates a canonical new game", async () => {
  const scenarioImport = await handleApiRequest(
    req("/api/shell/scenarios/import", "POST", {
      identityId: "id-a",
      scenario: {
        formatVersion: 2,
        id: SCENARIO_UUIDS.importedScenario,
        title: "Imported Scenario",
        description: "Minimal scenario",
        incorrect: false,
        initialState: {
          boardSize: 10,
          sideToMove: "P1",
          turnIndex: 0,
          pieces: [
            { id: "P1-C", owner: "P1", kind: "commander", position: { row: 3, col: 6 }, supplied: true, commanded: true },
            { id: "P2-C", owner: "P2", kind: "commander", position: { row: 6, col: 3 }, supplied: true, commanded: true },
            { id: "U1-1", owner: "P1", kind: "unit", position: { row: 5, col: 6 }, supplied: true, commanded: true },
          ],
          continuation: null,
          outcome: { status: "ongoing" },
        },
        moves: [],
        resultingState: {
          boardSize: 10,
          sideToMove: "P1",
          turnIndex: 0,
          pieces: [
            { id: "P1-C", owner: "P1", kind: "commander", position: { row: 3, col: 6 }, supplied: true, commanded: true },
            { id: "P2-C", owner: "P2", kind: "commander", position: { row: 6, col: 3 }, supplied: true, commanded: true },
            { id: "U1-1", owner: "P1", kind: "unit", position: { row: 5, col: 6 }, supplied: true, commanded: true },
          ],
          continuation: null,
          outcome: { status: "ongoing" },
        },
        expectedFinalStateHash: "hash-placeholder",
        expectedOutcome: "ongoing",
      },
    }),
    env,
  );
  const body = await scenarioImport.json();
  assert.equal(scenarioImport.status, 200);
  assert.equal(body.game.player1.identityId, "id-a");
  assert.equal(body.game.moves.length, 0);
  assert.equal(body.game.notifications[0], "Scenario loaded: Imported Scenario");
});

test("live transport: scenario import auto-advances the turn after a project-ended history", async () => {
  const scenarioImport = await handleApiRequest(
    req("/api/shell/scenarios/import", "POST", {
      identityId: "id-a",
      scenario: {
        formatVersion: 2,
        id: SCENARIO_UUIDS.projectEndsTurn,
        title: "Project ends turn",
        description: "Regression for imported pre-end-turn snapshots",
        incorrect: false,
        initialState: {
          boardSize: 10,
          sideToMove: "P1",
          turnIndex: 0,
          pieces: [
            { id: "C1", owner: "P1", kind: "commander", position: { row: 3, col: 6 }, supplied: true, commanded: true },
            { id: "C2", owner: "P2", kind: "commander", position: { row: 6, col: 3 }, supplied: true, commanded: true },
          ],
          continuation: null,
          outcome: { status: "ongoing" },
        },
        moves: [
          {
            turnIndex: 0,
            turnMoveIndex: 0,
            actorSide: "P1",
            notation: "PROJECT (3,6) -> (5,6)",
            action: {
              type: "project",
              actorId: "C1",
              from: { row: 3, col: 6 },
              to: { row: 5, col: 6 },
            },
          },
        ],
        resultingState: {
          boardSize: 10,
          sideToMove: "P1",
          turnIndex: 0,
          pieces: [
            { id: "C1", owner: "P1", kind: "commander", position: { row: 3, col: 6 }, supplied: true, commanded: true },
            { id: "C2", owner: "P2", kind: "commander", position: { row: 6, col: 3 }, supplied: true, commanded: true },
            { id: "U1-1", owner: "P1", kind: "unit", position: { row: 5, col: 6 }, supplied: true, commanded: true },
          ],
          continuation: null,
          outcome: { status: "ongoing" },
        },
        expectedFinalStateHash: "hash-placeholder",
        expectedOutcome: "ongoing",
      },
    }),
    env,
  );

  const body = await scenarioImport.json();
  assert.equal(scenarioImport.status, 200);
  assert.equal(body.game.currentTurn.index, 1);
  assert.equal(body.game.currentTurn.playerSeat, "Player 2");
  assert.equal(body.game.currentSnapshot.turnIndex, 1);
  assert.equal(body.game.currentSnapshot.sideToMove, "P2");
  assert.equal(body.game.moves.length, 1);
  assert.equal(body.game.moves[0].turnIndex, 0);
});

test("live transport: scenario import exposes pending saved selection and accepted moves clear it", async () => {
  const scenarioImport = await handleApiRequest(
    req("/api/shell/scenarios/import", "POST", {
      identityId: "id-a",
      scenario: {
        formatVersion: 2,
        id: SCENARIO_UUIDS.savedSelection,
        title: "Saved selection",
        description: "Includes a pending selected move",
        incorrect: false,
        initialState: {
          boardSize: 10,
          sideToMove: "P1",
          turnIndex: 0,
          pieces: [
            { id: "P1-C", owner: "P1", kind: "commander", position: { row: 0, col: 0 }, supplied: true, commanded: true },
            { id: "P2-C", owner: "P2", kind: "commander", position: { row: 9, col: 9 }, supplied: true, commanded: true },
          ],
          continuation: null,
          outcome: { status: "ongoing" },
        },
        moves: [],
        resultingState: {
          boardSize: 10,
          sideToMove: "P1",
          turnIndex: 0,
          pieces: [
            { id: "P1-C", owner: "P1", kind: "commander", position: { row: 0, col: 0 }, supplied: true, commanded: true },
            { id: "P2-C", owner: "P2", kind: "commander", position: { row: 9, col: 9 }, supplied: true, commanded: true },
          ],
          continuation: null,
          outcome: { status: "ongoing" },
        },
        expectedFinalStateHash: "hash-placeholder",
        expectedOutcome: "ongoing",
        savedSelection: {
          source: { row: 3, col: 6 },
          target: { row: 3, col: 7 },
          actorSide: "P1",
          turnIndex: 0,
        },
      },
    }),
    env,
  );
  const imported = await scenarioImport.json();
  assert.equal(scenarioImport.status, 200);
  assert.deepEqual(imported.game.pendingScenarioSelection, {
    source: { row: 3, col: 6 },
    target: { row: 3, col: 7 },
    actorSide: "P1",
    turnIndex: 0,
  });

  const localGame = createInitialGame({
    gameId: "game-local-scenario-selection",
    identityId: "id-a",
    playgroundMode: false,
    offlineLocal: false,
  });
  localGame.pendingScenarioSelection = {
    source: { row: 3, col: 6 },
    target: { row: 3, col: 7 },
    actorSide: "P1",
    turnIndex: 0,
  };
  const acceptedAction = listLegalActions(localGame.board.state).find((action) => action.type !== "pass");
  assert.equal(Boolean(acceptedAction), true);
  const applied = applyServerAction(localGame, acceptedAction, undefined, null);
  assert.equal(applied.ok, true);
  assert.equal(localGame.pendingScenarioSelection, null);
});

test("live transport: create-from-scenario seats the importer as the scenario side to move and swaps copied seats", async () => {
  const create = await handleApiRequest(
    req("/api/shell/games", "POST", { identityId: "id-a", playgroundMode: false, offlineLocal: false }),
    env,
  );
  const createBody = await create.json();
  const sourceGameId = createBody.game.id;

  const join = await handleApiRequest(
    req(`/api/shell/games/${sourceGameId}/join`, "POST", {
      identityId: "id-b",
      mode: "player",
      inviteFromRole: "Player 1",
    }),
    env,
  );
  assert.equal(join.status, 200);

  const scenarioImport = await handleApiRequest(
    req("/api/shell/scenarios/import", "POST", {
      identityId: "id-a",
      sourceGameId,
      scenario: {
        formatVersion: 2,
        id: SCENARIO_UUIDS.importerBecomesPlayer2,
        title: "Importer becomes player 2",
        description: "Import should swap copied seats",
        incorrect: false,
        initialState: {
          boardSize: 10,
          sideToMove: "P2",
          turnIndex: 3,
          pieces: [
            { id: "P1-C", owner: "P1", kind: "commander", position: { row: 0, col: 0 }, supplied: true, commanded: true },
            { id: "P2-C", owner: "P2", kind: "commander", position: { row: 9, col: 9 }, supplied: true, commanded: true },
          ],
          continuation: null,
          outcome: { status: "ongoing" },
        },
        moves: [],
        resultingState: {
          boardSize: 10,
          sideToMove: "P2",
          turnIndex: 3,
          pieces: [
            { id: "P1-C", owner: "P1", kind: "commander", position: { row: 0, col: 0 }, supplied: true, commanded: true },
            { id: "P2-C", owner: "P2", kind: "commander", position: { row: 9, col: 9 }, supplied: true, commanded: true },
          ],
          continuation: null,
          outcome: { status: "ongoing" },
        },
        expectedFinalStateHash: "hash-placeholder",
        expectedOutcome: "ongoing",
      },
    }),
    env,
  );
  const imported = await scenarioImport.json();
  assert.equal(scenarioImport.status, 200);
  assert.equal(imported.game.player1?.identityId, "id-b");
  assert.equal(imported.game.player2?.identityId, "id-a");
  assert.equal(imported.game.myRole, "Player 2");
});

test("live transport: scenario launch from an existing game applies shared participant copy policy", async () => {
  const created = await handleApiRequest(
    req("/api/shell/games", "POST", { identityId: "id-owner", playgroundMode: false, offlineLocal: false }),
    env,
  );
  const createdBody = await created.json();
  const gameId = createdBody.game.id;

  const playerJoin = await handleApiRequest(
    req(`/api/shell/games/${gameId}/join`, "POST", {
      identityId: "id-player2",
      mode: "player",
      inviteFromRole: "Player 1",
    }),
    env,
  );
  assert.equal((await playerJoin.json()).game.player2.identityId, "id-player2");

  await handleApiRequest(
    req(`/api/shell/games/${gameId}/join`, "POST", {
      identityId: "id-viewer",
      mode: "viewer",
    }),
    env,
  );

  const scenario = {
    formatVersion: 2,
    id: "537db3b4-a2c5-44b2-8d5a-82065e54c0fd",
    title: "Source launch scenario",
    description: "Participant copy policy regression",
    incorrect: false,
    initialState: {
      boardSize: 10,
      sideToMove: "P1",
      turnIndex: 0,
      pieces: [
        { id: "P1-C", owner: "P1", kind: "commander", position: { row: 0, col: 0 }, supplied: true, commanded: true },
        { id: "P2-C", owner: "P2", kind: "commander", position: { row: 9, col: 9 }, supplied: true, commanded: true },
      ],
      continuation: null,
      outcome: { status: "ongoing" },
    },
    moves: [],
    resultingState: {
      boardSize: 10,
      sideToMove: "P1",
      turnIndex: 0,
      pieces: [
        { id: "P1-C", owner: "P1", kind: "commander", position: { row: 0, col: 0 }, supplied: true, commanded: true },
        { id: "P2-C", owner: "P2", kind: "commander", position: { row: 9, col: 9 }, supplied: true, commanded: true },
      ],
      continuation: null,
      outcome: { status: "ongoing" },
    },
    expectedFinalStateHash: "hash-placeholder",
    expectedOutcome: "ongoing",
  };

  const playerLaunch = await handleApiRequest(
    req("/api/shell/scenarios/import", "POST", {
      identityId: "id-owner",
      sourceGameId: gameId,
      scenario,
    }),
    env,
  );
  const playerLaunchBody = await playerLaunch.json();
  assert.equal(playerLaunch.status, 200);
  assert.equal(playerLaunchBody.game.player1.identityId, "id-owner");
  assert.equal(playerLaunchBody.game.player2.identityId, "id-player2");
  assert.equal(playerLaunchBody.game.viewers.some((viewer) => viewer.identityId === "id-viewer"), true);

  const viewerLaunch = await handleApiRequest(
    req("/api/shell/scenarios/import", "POST", {
      identityId: "id-viewer",
      sourceGameId: gameId,
      scenario,
    }),
    env,
  );
  const viewerLaunchBody = await viewerLaunch.json();
  assert.equal(viewerLaunch.status, 200);
  assert.equal(viewerLaunchBody.game.player1.identityId, "id-viewer");
  assert.equal(viewerLaunchBody.game.player2, null);
  assert.deepEqual(viewerLaunchBody.game.viewers, []);
});

test("live transport: history branch launch replays prior history and preserves next-action preselection with viewer-only participant override", async () => {
  const created = await handleApiRequest(
    req("/api/shell/games", "POST", { identityId: "id-owner", playgroundMode: false, offlineLocal: false }),
    env,
  );
  const createdBody = await created.json();
  const gameId = createdBody.game.id;

  await handleApiRequest(
    req(`/api/shell/games/${gameId}/join`, "POST", {
      identityId: "id-viewer",
      mode: "viewer",
    }),
    env,
  );

  const move = await handleApiRequest(
    req(`/api/shell/games/${gameId}/moves`, "POST", { identityId: "id-owner" }),
    env,
  );
  const moveBody = await move.json();
  const moveEntry = moveBody.game.moves[0];

  const secondMove = await handleApiRequest(
    req(`/api/shell/games/${gameId}/moves`, "POST", { identityId: "id-owner" }),
    env,
  );
  const secondMoveBody = await secondMove.json();
  const secondMoveEntry = secondMoveBody.game.moves[1];

  const branch = await handleApiRequest(
    req("/api/shell/history/branch", "POST", {
      identityId: "id-viewer",
      sourceGameId: gameId,
      sourceMoveIndex: 1,
      scenario: {
        formatVersion: 2,
        id: "7c7140bf-ec49-485e-a272-560e46cb19dc",
        title: "Branch from history",
        description: "Replay through prior history",
        incorrect: false,
        initialState: moveEntry.selectionSnapshot,
        moves: [
          {
            turnIndex: moveEntry.turnIndex,
            turnMoveIndex: moveEntry.turnMoveIndex,
            actorSide: moveEntry.actorSide,
            notation: moveEntry.notation,
            action: moveEntry.action,
          },
        ],
        resultingState: secondMoveEntry.selectionSnapshot,
        expectedFinalStateHash: "",
        expectedOutcome: secondMoveEntry.selectionSnapshot.outcome?.status ?? "ongoing",
      },
      initialSelectionAction: secondMoveEntry.action,
      participantCopyMode: "viewer_as_player1",
    }),
    env,
  );
  const branchBody = await branch.json();
  assert.equal(branch.status, 200);
  assert.equal(branchBody.game.player1.identityId, "id-viewer");
  assert.equal(branchBody.game.player2, null);
  assert.deepEqual(branchBody.game.viewers, []);
  assert.equal(branchBody.game.inHistoryMode, false);
  assert.deepEqual(branchBody.game.initialSelectionAction, secondMoveEntry.action);
  assert.deepEqual(branchBody.game.currentSnapshot, secondMoveEntry.selectionSnapshot);
  assert.equal(branchBody.game.moves.length, 1);
  assert.equal(branchBody.game.moves[0].notation, moveEntry.notation);
  assert.equal(branchBody.game.moves[0].turnIndex, moveEntry.turnIndex);
});

test("live transport: scenario import rejects non-UUID scenario ids", async () => {
  const scenarioImport = await handleApiRequest(
    req("/api/shell/scenarios/import", "POST", {
      identityId: "id-a",
      scenario: {
        formatVersion: 2,
        id: "S-001",
        title: "Invalid Scenario Id",
        description: "Should be rejected",
        incorrect: false,
        initialState: {
          boardSize: 10,
          sideToMove: "P1",
          turnIndex: 0,
          pieces: [],
          continuation: null,
          outcome: { status: "ongoing" },
        },
        moves: [],
        resultingState: {
          boardSize: 10,
          sideToMove: "P1",
          turnIndex: 0,
          pieces: [],
          continuation: null,
          outcome: { status: "ongoing" },
        },
        expectedFinalStateHash: "hash-placeholder",
        expectedOutcome: "ongoing",
      },
    }),
    env,
  );

  assert.equal(scenarioImport.status, 400);
  await assert.deepEqual(await scenarioImport.json(), { ok: false, error: "invalid_scenario_payload" });
});
test("live transport: game reads query persistent storage even when process cache is warm", async () => {
  const create = await handleApiRequest(
    req("/api/shell/games", "POST", { identityId: "id-a", playgroundMode: false, offlineLocal: false }),
    env,
  );
  const createBody = await create.json();
  const gameId = createBody.game.id;

  const beforeReads = env.DB.getStats().selectGameByIdCount;
  const open = await handleApiRequest(req(`/api/shell/games/${gameId}?identityId=id-a`), env);
  const openBody = await open.json();
  const afterReads = env.DB.getStats().selectGameByIdCount;

  assert.equal(open.status, 200);
  assert.equal(openBody.game.id, gameId);
  assert.equal(afterReads > beforeReads, true);
  assert.equal(typeof openBody.eventSeq, "number");
});

test("live transport: game reads do not stay stale when persistent state changes outside process cache", async () => {
  const create = await handleApiRequest(
    req("/api/shell/games", "POST", { identityId: "id-owner", playgroundMode: false, offlineLocal: false }),
    env,
  );
  const createBody = await create.json();
  const gameId = createBody.game.id;

  const warm = await handleApiRequest(req(`/api/shell/games/${gameId}?identityId=id-owner`), env);
  assert.equal(warm.status, 200);
  const warmBody = await warm.json();
  assert.equal(warmBody.game.player2, null);
  assert.equal(warmBody.game.notifications[0], "Game created");

  const overwritten = env.DB.overwriteGameState(gameId, (state) => ({
    ...state,
    updatedAt: "2026-03-10T01:31:00.000Z",
    lastMoveAt: "2026-03-10T01:31:00.000Z",
    player2: {
      identityId: "id-player2",
      connected: true,
      joinedAt: "2026-03-10T01:31:00.000Z",
      lastSeenAt: "2026-03-10T01:31:00.000Z",
    },
    notifications: ["Player joined", ...(Array.isArray(state.notifications) ? state.notifications : [])],
  }));
  assert.equal(overwritten, true);

  const refreshed = await handleApiRequest(req(`/api/shell/games/${gameId}?identityId=id-owner`), env);
  const refreshedBody = await refreshed.json();
  assert.equal(refreshed.status, 200);
  assert.equal(refreshedBody.game.player2?.identityId, "id-player2");
  assert.equal(refreshedBody.game.notifications[0], "Player joined");
});

test("live transport: stale read during GET must not overwrite newer persisted game state", async () => {
  const create = await handleApiRequest(
    req("/api/shell/games", "POST", { identityId: "id-owner", playgroundMode: false, offlineLocal: false }),
    env,
  );
  const createBody = await create.json();
  const gameId = createBody.game.id;

  const staleState = env.DB.getGameState(gameId);
  assert.equal(Boolean(staleState), true);

  const overwritten = env.DB.overwriteGameState(gameId, (state) => ({
    ...state,
    updatedAt: "2026-03-10T02:00:00.000Z",
    lastMoveAt: "2026-03-10T02:00:00.000Z",
    player2: {
      identityId: "id-player2",
      connected: true,
      joinedAt: "2026-03-10T02:00:00.000Z",
      lastSeenAt: "2026-03-10T02:00:00.000Z",
    },
    notifications: ["Player joined", ...(Array.isArray(state.notifications) ? state.notifications : [])],
  }));
  assert.equal(overwritten, true);

  env.DB.setNextGameReadOverride(gameId, staleState);
  const staleRead = await handleApiRequest(req(`/api/shell/games/${gameId}?identityId=id-owner`), env);
  assert.equal(staleRead.status, 200);

  const persistedAfterRead = env.DB.getGameState(gameId);
  assert.equal(persistedAfterRead?.player2?.identityId, "id-player2");
  assert.equal(persistedAfterRead?.notifications?.[0], "Player joined");
});

test("live transport: persisted shape repairs missing history index and logs the exact mismatch", async () => {
  const create = await handleApiRequest(
    req("/api/shell/games", "POST", { identityId: "id-owner", playgroundMode: false, offlineLocal: false }),
    env,
  );
  const createBody = await create.json();
  const gameId = createBody.game.id;
  const overwritten = env.DB.overwriteGameState(gameId, (state) => {
    const next = { ...state };
    delete next.historyIndexByIdentity;
    return next;
  });
  assert.equal(overwritten, true);

  const consoleCapture = captureConsoleEvents();
  try {
    const list = await handleApiRequest(req("/api/shell/games?identityId=id-owner"), env);
    const listBody = await list.json();
    assert.equal(list.status, 200);
    assert.equal(listBody.games.some((entry) => entry.id === gameId), true);
    const listedGame = listBody.games.find((entry) => entry.id === gameId);
    assert.equal(listedGame.historyIndex, null);

    const open = await handleApiRequest(req(`/api/shell/games/${gameId}?identityId=id-owner`), env);
    const openBody = await open.json();
    assert.equal(open.status, 200);
    assert.equal(openBody.game.historyIndex, null);

    const repairEvents = consoleCapture.warnings.map((entry) => JSON.parse(entry));
    assert.equal(repairEvents.some((entry) => entry.event === "live_game_shape_repaired"), true);
    const historyMismatch = repairEvents.flatMap((entry) => entry.mismatches).find((entry) => entry.field === "historyIndexByIdentity");
    assert.deepEqual(historyMismatch, {
      field: "historyIndexByIdentity",
      expected: "record<string, number>",
      actualType: "undefined",
      actualSummary: "undefined",
      repair: "defaulted_to_empty_object",
    });
  } finally {
    consoleCapture.restore();
  }
});

test("live transport: persisted shape repairs legacy participants and malformed arrays with structured logs", async () => {
  const create = await handleApiRequest(
    req("/api/shell/games", "POST", { identityId: "id-owner", playgroundMode: false, offlineLocal: false }),
    env,
  );
  const createBody = await create.json();
  const gameId = createBody.game.id;
  const overwritten = env.DB.overwriteGameState(gameId, (state) => ({
    ...state,
    player2: {
      identityId: "id-player2",
      connected: "sometimes",
      joinedAt: "2026-03-10T03:00:00.000Z",
      lastSeenAt: "2026-03-10T03:05:00.000Z",
    },
    viewers: "not-an-array",
    pendingJoinRequests: [{ nope: true }],
    notifications: ["Player joined", 4],
    inviteTokens: { viewer: "viewer-token" },
  }));
  assert.equal(overwritten, true);

  const consoleCapture = captureConsoleEvents();
  try {
    const open = await handleApiRequest(req(`/api/shell/games/${gameId}?identityId=id-owner`), env);
    const body = await open.json();
    assert.equal(open.status, 200);
    assert.equal(body.game.player2.identityId, "id-player2");
    assert.equal(body.game.player2.lastHeartbeatAt, "2026-03-10T03:05:00.000Z");
    assert.equal(body.game.player2.sessionCount, 0);
    assert.deepEqual(body.game.viewers, []);
    assert.deepEqual(body.game.pendingJoinRequests, []);
    assert.deepEqual(body.game.notifications, ["Player joined"]);
    assert.equal(typeof body.game.inviteToken, "string");
    assert.equal(body.game.inviteToken.length > 0, true);

    const repairEvent = consoleCapture.warnings.map((entry) => JSON.parse(entry)).find((entry) => entry.event === "live_game_shape_repaired");
    assert.equal(Boolean(repairEvent), true);
    const mismatchFields = repairEvent.mismatches.map((entry) => entry.field);
    assert.equal(mismatchFields.includes("player2.lastHeartbeatAt"), true);
    assert.equal(mismatchFields.includes("player2.sessionCount"), true);
    assert.equal(mismatchFields.includes("viewers"), true);
    assert.equal(mismatchFields.includes("pendingJoinRequests[0]"), true);
    assert.equal(mismatchFields.includes("inviteTokens.player1"), true);
    assert.equal(mismatchFields.includes("inviteTokens.player2"), true);
  } finally {
    consoleCapture.restore();
  }
});

test("live transport: invalid persisted board state returns controlled error and is skipped from list", async () => {
  const validCreate = await handleApiRequest(
    req("/api/shell/games", "POST", { identityId: "id-valid", playgroundMode: false, offlineLocal: false }),
    env,
  );
  const validBody = await validCreate.json();
  const validGameId = validBody.game.id;

  const invalidCreate = await handleApiRequest(
    req("/api/shell/games", "POST", { identityId: "id-bad", playgroundMode: false, offlineLocal: false }),
    env,
  );
  const invalidBody = await invalidCreate.json();
  const invalidGameId = invalidBody.game.id;

  const overwritten = env.DB.overwriteGameState(invalidGameId, (state) => ({
    ...state,
    board: {},
  }));
  assert.equal(overwritten, true);

  const consoleCapture = captureConsoleEvents();
  try {
    const open = await handleApiRequest(req(`/api/shell/games/${invalidGameId}?identityId=id-bad`), env);
    const openBody = await open.json();
    assert.equal(open.status, 500);
    assert.equal(openBody.error, "invalid_persisted_game");

    const list = await handleApiRequest(req("/api/shell/games?identityId=id-valid"), env);
    const listBody = await list.json();
    assert.equal(list.status, 200);
    assert.equal(listBody.games.some((entry) => entry.id === validGameId), true);
    assert.equal(listBody.games.some((entry) => entry.id === invalidGameId), false);

    const invalidEvent = consoleCapture.errors.map((entry) => JSON.parse(entry)).find((entry) => entry.event === "live_game_shape_invalid");
    assert.equal(Boolean(invalidEvent), true);
    assert.equal(invalidEvent.gameId, invalidGameId);
    assert.equal(invalidEvent.mismatches.some((entry) => entry.field === "board.state"), true);
  } finally {
    consoleCapture.restore();
  }
});

test("live transport: invite and game resolution survive process-local cache reset", async () => {
  const create = await handleApiRequest(
    req("/api/shell/games", "POST", { identityId: "id-a", playgroundMode: false, offlineLocal: false }),
    env,
  );
  const createBody = await create.json();
  const gameId = createBody.game.id;
  const inviteToken = createBody.game.inviteToken;

  __resetLiveGameStateForTests();

  const inviteResolve = await handleApiRequest(req(`/api/shell/invites/${inviteToken}`), env);
  const inviteBody = await inviteResolve.json();
  assert.equal(inviteResolve.status, 200);
  assert.equal(inviteBody.gameId, gameId);

  __resetLiveGameStateForTests();

  const open = await handleApiRequest(req(`/api/shell/games/${gameId}?identityId=id-b&openAsViewer=1`), env);
  const openBody = await open.json();
  assert.equal(open.status, 200);
  assert.equal(openBody.game.id, gameId);
});

test("live transport: join approval flow and presence/history/move transitions", async () => {
  const created = await handleApiRequest(
    req("/api/shell/games", "POST", { identityId: "id-owner", playgroundMode: false, offlineLocal: false }),
    env,
  );
  const createdBody = await created.json();
  const gameId = createdBody.game.id;

  const joinPending = await handleApiRequest(
    req(`/api/shell/games/${gameId}/join`, "POST", {
      identityId: "id-joiner",
      mode: "player",
      inviteFromRole: null,
    }),
    env,
  );
  const pendingBody = await joinPending.json();
  assert.equal(pendingBody.pendingApproval, true);

  const secondPending = await handleApiRequest(
    req(`/api/shell/games/${gameId}/join`, "POST", {
      identityId: "id-other",
      mode: "player",
      inviteFromRole: null,
    }),
    env,
  );
  const secondPendingBody = await secondPending.json();
  assert.equal(secondPendingBody.pendingApproval, true);

  const approve = await handleApiRequest(
    req(`/api/shell/games/${gameId}/approve`, "POST", {
      identityId: "id-owner",
      requesterIdentityId: "id-joiner",
    }),
    env,
  );
  const approveBody = await approve.json();
  assert.equal(Boolean(approveBody.game.player2), true);
  assert.equal(approveBody.game.player2.identityId, "id-joiner");
  assert.equal(approveBody.game.viewers.some((viewer) => viewer.identityId === "id-joiner"), false);
  assert.equal(approveBody.game.pendingJoinRequests.length, 0);

  const move = await handleApiRequest(
    req(`/api/shell/games/${gameId}/moves`, "POST", { identityId: "id-owner" }),
    env,
  );
  const moveBody = await move.json();
  assert.equal(moveBody.game.moves.length, 1);
  assert.equal(moveBody.game.currentTurn.playerSeat, "Player 1");
  assert.equal(moveBody.game.currentTurn.moveIndexes.length, 1);
  assert.equal(moveBody.game.currentSnapshot.sideToMove, "P1");
  assert.equal(typeof moveBody.eventSeq, "number");

  const secondMove = await handleApiRequest(
    req(`/api/shell/games/${gameId}/moves`, "POST", { identityId: "id-owner" }),
    env,
  );
  const secondMoveBody = await secondMove.json();
  assert.equal(secondMoveBody.game.moves.length, 2);
  assert.equal(secondMoveBody.game.currentTurn.moveIndexes.length, 2);
  assert.equal(secondMoveBody.game.currentSnapshot.sideToMove, "P1");

  const endTurn = await handleApiRequest(
    req(`/api/shell/games/${gameId}/end-turn`, "POST", { identityId: "id-owner" }),
    env,
  );
  const endTurnBody = await endTurn.json();
  assert.equal(endTurnBody.game.currentTurn.playerSeat, "Player 2");
  assert.equal(endTurnBody.game.currentTurn.moveIndexes.length, 0);
  assert.equal(endTurnBody.game.currentSnapshot.sideToMove, "P2");
  assert.equal(endTurnBody.game.currentSnapshot.continuation, null);
  assert.equal(typeof endTurnBody.eventSeq, "number");

  const history = await handleApiRequest(
    req(`/api/shell/games/${gameId}/history`, "POST", { identityId: "id-owner", moveIndex: 1 }),
    env,
  );
  const historyBody = await history.json();
  assert.equal(historyBody.game.inHistoryMode, true);
  assert.equal(historyBody.game.historyIndex, 1);

  const joinerViewDuringHistory = await handleApiRequest(
    req(`/api/shell/games/${gameId}?identityId=id-joiner`, "GET"),
    env,
  );
  const joinerHistoryBody = await joinerViewDuringHistory.json();
  assert.equal(joinerHistoryBody.game.inHistoryMode, false);
  assert.equal(joinerHistoryBody.game.historyIndex, null);

  const live = await handleApiRequest(req(`/api/shell/games/${gameId}/live`, "POST", { identityId: "id-owner" }), env);
  const liveBody = await live.json();
  assert.equal(liveBody.game.inHistoryMode, false);
  assert.equal(liveBody.game.historyIndex, null);

  const presence = await handleApiRequest(
    req(`/api/shell/games/${gameId}/presence`, "POST", {
      identityId: "id-owner",
      role: "Player 2",
      connected: false,
    }),
    env,
  );
  assert.equal(presence.status, 404);

  await handleApiRequest(
    req(`/api/shell/games/${gameId}/join`, "POST", {
      identityId: "id-viewer",
      mode: "viewer",
    }),
    env,
  );

  const viewerPresence = await handleApiRequest(
    req(`/api/shell/games/${gameId}/presence`, "POST", {
      identityId: "id-viewer",
      role: "Viewer",
      connected: false,
    }),
    env,
  );
  assert.equal(viewerPresence.status, 404);
});

test("live transport: apply and end-turn echo clientCommandId and persist it on appended events", async () => {
  const create = await handleApiRequest(
    req("/api/shell/games", "POST", { identityId: "id-owner", playgroundMode: false, offlineLocal: false }),
    env,
  );
  const createdBody = await create.json();
  const gameId = createdBody.game.id;

  const apply = await handleApiRequest(
    req(`/api/shell/games/${gameId}/apply`, "POST", {
      identityId: "id-owner",
      clientCommandId: "cmd-apply-1",
      state: createdBody.game.currentSnapshot,
      action: { type: "pass" },
    }),
    env,
  );
  const applyBody = await apply.json();
  assert.equal(applyBody.accepted, true);
  assert.equal(applyBody.clientCommandId, "cmd-apply-1");

  const endTurn = await handleApiRequest(
    req(`/api/shell/games/${gameId}/end-turn`, "POST", {
      identityId: "id-owner",
      clientCommandId: "cmd-end-1",
    }),
    env,
  );
  const endTurnBody = await endTurn.json();
  assert.equal(endTurnBody.ok, true);
  assert.equal(endTurnBody.clientCommandId, "cmd-end-1");

  const events = env.DB.getEvents(gameId).map((row) => JSON.parse(row.payload_json));
  assert.equal(events.some((event) => event.type === "event_appended" && event.clientCommandId === "cmd-apply-1"), true);
  assert.equal(events.some((event) => event.type === "event_appended" && event.clientCommandId === "cmd-end-1"), true);
});

test("live transport: player invite token enables immediate player join without guessable game role query", async () => {
  const create = await handleApiRequest(
    req("/api/shell/games", "POST", { identityId: "id-owner", playgroundMode: false, offlineLocal: false }),
    env,
  );
  const createdBody = await create.json();
  const gameId = createdBody.game.id;
  const inviteToken = createdBody.game.inviteToken;

  const join = await handleApiRequest(
    req(`/api/shell/games/${gameId}/join`, "POST", {
      identityId: "id-player2",
      mode: "player",
      inviteToken,
    }),
    env,
  );
  const joinBody = await join.json();
  assert.equal(join.status, 200);
  assert.equal(joinBody.pendingApproval, false);
  assert.equal(joinBody.game.player2.identityId, "id-player2");
  assert.equal(joinBody.game.pendingJoinRequests.length, 0);
});

test("live transport: non-player invite token requires approval for player join and joins viewer immediately", async () => {
  const create = await handleApiRequest(
    req("/api/shell/games", "POST", { identityId: "id-owner", playgroundMode: false, offlineLocal: false }),
    env,
  );
  const createdBody = await create.json();
  const gameId = createdBody.game.id;

  const viewerJoin = await handleApiRequest(
    req(`/api/shell/games/${gameId}/join`, "POST", {
      identityId: "id-viewer",
      mode: "viewer",
    }),
    env,
  );
  assert.equal(viewerJoin.status, 200);

  const viewerOpen = await handleApiRequest(req(`/api/shell/games/${gameId}?identityId=id-viewer`), env);
  const viewerBody = await viewerOpen.json();
  const viewerInviteToken = viewerBody.game.inviteToken;

  const join = await handleApiRequest(
    req(`/api/shell/games/${gameId}/join`, "POST", {
      identityId: "id-requester",
      mode: "player",
      inviteToken: viewerInviteToken,
    }),
    env,
  );
  const joinBody = await join.json();
  assert.equal(join.status, 200);
  assert.equal(joinBody.pendingApproval, true);
  assert.equal(joinBody.game.myRole, "Viewer");
  assert.equal(joinBody.game.pendingPlayerRequestSeat, "Player 2");
  assert.equal(joinBody.game.viewers.some((viewer) => viewer.identityId === "id-requester"), true);
});

test("live transport: offline-local game hidden until go-online confirmation", async () => {
  const createOffline = await handleApiRequest(
    req("/api/shell/games?offline=1", "POST", {
      identityId: "id-local",
      playgroundMode: true,
      offlineLocal: true,
    }),
    env,
  );
  const createBody = await createOffline.json();
  const gameId = createBody.game.id;

  const listBefore = await handleApiRequest(req("/api/shell/games?identityId=id-local&offline=1"), env);
  const listBeforeBody = await listBefore.json();
  assert.equal(listBeforeBody.games.some((entry) => entry.id === gameId), false);

  const denied = await handleApiRequest(
    req(`/api/shell/games/${gameId}/go-online?offline=1`, "POST", { identityId: "id-local", confirmed: false }),
    env,
  );
  assert.equal(denied.status, 409);

  const allow = await handleApiRequest(
    req(`/api/shell/games/${gameId}/go-online?offline=1`, "POST", { identityId: "id-local", confirmed: true }),
    env,
  );
  assert.equal(allow.status, 200);

  const listAfter = await handleApiRequest(req("/api/shell/games?identityId=id-local&offline=1"), env);
  const listAfterBody = await listAfter.json();
  assert.equal(listAfterBody.games.some((entry) => entry.id === gameId), true);
});

test("live transport: offline view does not reconnect participant and offline moves are local only", async () => {
  const create = await handleApiRequest(
    req("/api/shell/games", "POST", { identityId: "id-owner", playgroundMode: false, offlineLocal: false }),
    env,
  );
  const gameId = (await create.json()).game.id;

  await handleApiRequest(
    req(`/api/shell/games/${gameId}/join`, "POST", {
      identityId: "id-player2",
      mode: "player",
      inviteFromRole: "Player 1",
    }),
    env,
  );

  const offlineView = await handleApiRequest(req(`/api/shell/games/${gameId}?identityId=id-player2&offline=1`), env);
  const offlineBody = await offlineView.json();
  assert.equal(offlineBody.game.player2.connected, false);

  const offlineMove = await handleApiRequest(
    req(`/api/shell/games/${gameId}/moves?offline=1`, "POST", { identityId: "id-owner" }),
    env,
  );
  assert.equal(offlineMove.status, 409);
  assert.equal((await offlineMove.json()).error, "offline_move_local_only");
});

test("live transport: offline playground exposes end-turn when one identity controls both seats", async () => {
  const created = await handleApiRequest(
    req("/api/shell/games?offline=1", "POST", { identityId: "id-local", playgroundMode: true, offlineLocal: true }),
    env,
  );
  const createdBody = await created.json();
  const gameId = createdBody.game.id;

  const moved = await handleApiRequest(
    req(`/api/shell/games/${gameId}/moves?offline=1`, "POST", { identityId: "id-local" }),
    env,
  );
  assert.equal(moved.status, 200);

  const view = await handleApiRequest(req(`/api/shell/games/${gameId}?identityId=id-local&offline=1`), env);
  const body = await view.json();
  assert.equal(body.game.canEndTurn, true);

  const ended = await handleApiRequest(
    req(`/api/shell/games/${gameId}/end-turn?offline=1`, "POST", { identityId: "id-local" }),
    env,
  );
  assert.equal(ended.status, 200);
});

test("live transport: play-as-both persists separate participant rows for the same identity", async () => {
  const created = await handleApiRequest(
    req("/api/shell/games", "POST", { identityId: "id-a", playgroundMode: false, offlineLocal: false }),
    env,
  );
  const createdBody = await created.json();
  const gameId = createdBody.game.id;

  const promoted = await handleApiRequest(
    req(`/api/shell/games/${gameId}/play-as-both`, "POST", { identityId: "id-a" }),
    env,
  );
  const promotedBody = await promoted.json();

  assert.equal(promoted.status, 200);
  assert.equal(promotedBody.game.player1.identityId, "id-a");
  assert.equal(promotedBody.game.player2.identityId, "id-a");
  assert.equal(promotedBody.game.player1.connected, promotedBody.game.player2.connected);
  assert.equal(promotedBody.game.player1.sessionCount, promotedBody.game.player2.sessionCount);
  assert.deepEqual(promotedBody.game.myRoles, ["Player 1", "Player 2"]);
  assert.equal(promotedBody.game.myConnectionConnected, true);

  const participants = env.DB.getParticipants(gameId);
  assert.deepEqual(
    participants.map((participant) => [participant.identity_id, participant.role]).sort(),
    [
      ["id-a", "Player 1"],
      ["id-a", "Player 2"],
    ],
  );
});

test("live transport: dual-seat view models expose combined role and connection metadata", async () => {
  const created = await handleApiRequest(
    req("/api/shell/games", "POST", { identityId: "id-a", playgroundMode: false, offlineLocal: false }),
    env,
  );
  const gameId = (await created.json()).game.id;

  await handleApiRequest(
    req(`/api/shell/games/${gameId}/play-as-both`, "POST", { identityId: "id-a" }),
    env,
  );

  env.DB.overwriteGameState(gameId, (game) => ({
    ...game,
    player1: { ...game.player1, connected: false, sessionCount: 0 },
    player2: { ...game.player2, connected: false, sessionCount: 0 },
  }));

  const view = await handleApiRequest(req(`/api/shell/games/${gameId}?identityId=id-a`), env);
  const body = await view.json();

  assert.deepEqual(body.game.myRoles, ["Player 1", "Player 2"]);
  assert.equal(body.game.myConnectionConnected, false);
});

test("live transport: move endpoint rejects non-player and wrong-turn players", async () => {
  const create = await handleApiRequest(
    req("/api/shell/games", "POST", { identityId: "id-owner", playgroundMode: false, offlineLocal: false }),
    env,
  );
  const createBody = await create.json();
  const gameId = createBody.game.id;

  const nonPlayerMove = await handleApiRequest(
    req(`/api/shell/games/${gameId}/moves`, "POST", { identityId: "id-viewer" }),
    env,
  );
  assert.equal(nonPlayerMove.status, 403);
  assert.equal((await nonPlayerMove.json()).error, "role_not_allowed");

  await handleApiRequest(
    req(`/api/shell/games/${gameId}/join`, "POST", {
      identityId: "id-player2",
      mode: "player",
      inviteFromRole: "Player 1",
    }),
    env,
  );

  const wrongTurnMove = await handleApiRequest(
    req(`/api/shell/games/${gameId}/moves`, "POST", { identityId: "id-player2" }),
    env,
  );
  assert.equal(wrongTurnMove.status, 409);
  assert.equal((await wrongTurnMove.json()).error, "not_your_turn");

  const endTurn = await handleApiRequest(
    req(`/api/shell/games/${gameId}/moves`, "POST", { identityId: "id-owner" }),
    env,
  );
  assert.equal(endTurn.status, 200);

  await handleApiRequest(req(`/api/shell/games/${gameId}/end-turn`, "POST", { identityId: "id-owner" }), env);

  const nowPlayer2Move = await handleApiRequest(
    req(`/api/shell/games/${gameId}/moves`, "POST", { identityId: "id-player2" }),
    env,
  );
  assert.equal(nowPlayer2Move.status, 200);
});

test("live transport: end-turn rejects empty turns", async () => {
  const create = await handleApiRequest(
    req("/api/shell/games", "POST", { identityId: "id-owner", playgroundMode: false, offlineLocal: false }),
    env,
  );
  const gameId = (await create.json()).game.id;

  const endTurn = await handleApiRequest(
    req(`/api/shell/games/${gameId}/end-turn`, "POST", { identityId: "id-owner" }),
    env,
  );
  assert.equal(endTurn.status, 409);
  assert.equal((await endTurn.json()).error, "turn_has_no_moves");
});

test("live transport: approve rejects unauthorized approver", async () => {
  const create = await handleApiRequest(
    req("/api/shell/games", "POST", { identityId: "id-owner", playgroundMode: false, offlineLocal: false }),
    env,
  );
  const gameId = (await create.json()).game.id;

  await handleApiRequest(
    req(`/api/shell/games/${gameId}/join`, "POST", {
      identityId: "id-joiner",
      mode: "player",
      inviteFromRole: null,
    }),
    env,
  );

  const unauthorizedApprove = await handleApiRequest(
    req(`/api/shell/games/${gameId}/approve`, "POST", {
      identityId: "id-random",
      requesterIdentityId: "id-joiner",
    }),
    env,
  );
  assert.equal(unauthorizedApprove.status, 403);
  assert.equal((await unauthorizedApprove.json()).error, "approval_not_allowed");
});

test("live transport: stale participants load as disconnected until they become active again", async () => {
  const realNow = Date.now;
  let fakeNow = new Date("2026-02-26T00:00:00.000Z").getTime();
  Date.now = () => fakeNow;

  try {
    const create = await handleApiRequest(
      req("/api/shell/games", "POST", { identityId: "id-owner", playgroundMode: false, offlineLocal: false }),
      env,
    );
    const gameId = (await create.json()).game.id;

    await handleApiRequest(
      req(`/api/shell/games/${gameId}/join`, "POST", {
        identityId: "id-player2",
        mode: "player",
        inviteFromRole: "Player 1",
      }),
      env,
    );

    fakeNow += 31_000;

    const ownerView = await handleApiRequest(req(`/api/shell/games/${gameId}?identityId=id-owner`), env);
    const ownerBody = await ownerView.json();
    assert.equal(ownerBody.game.player1.connected, true);
    assert.equal(ownerBody.game.player2.connected, false);

    const player2View = await handleApiRequest(req(`/api/shell/games/${gameId}?identityId=id-player2`), env);
    const player2Body = await player2View.json();
    assert.equal(player2Body.game.player2.connected, false);
  } finally {
    Date.now = realNow;
  }
});
