import test from "node:test";
import assert from "node:assert/strict";
import { IDBFactory } from "fake-indexeddb";
import { createSyncStore } from "../shell/sync-store.js";
import { createCommandJournal } from "../shell/command-journal.js";
import { SYNC_TIMING } from "../generated/packages/shared-types/src/sync-protocol.js";
import { issueDiagnostics } from "../shell/issue-diagnostics.js";
import apiWorker from "../../api/index.js";
import { createFakeD1 } from "../../../packages/api-handler/test/support/fake-d1.mjs";
import { createFakeGameRooms } from "../../../packages/api-handler/test/support/fake-game-rooms.mjs";
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const until = async (predicate) => { for (let i = 0; i < 300; i++) { if (await predicate()) return; await sleep(5); } assert.fail("condition did not converge"); };
const memoryStorage = () => { const values = new Map(); return { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: (key) => values.delete(key) }; };
const loadIncidentBoard = async (f) => {
  const pieces = [["C1","P1",3,6],["U1-1","P1",5,5],["U1-2","P1",3,4],["U1-3","P1",6,4],["U1-4","P1",8,4],["U1-5","P1",5,6],["U1-6","P1",5,4],
    ["C2","P2",7,3],["U2-1","P2",6,5],["U2-2","P2",6,6],["U2-3","P2",5,7],["U2-4","P2",7,4]]
    .map(([id,owner,row,col]) => ({id,owner,kind:id.startsWith("C")?"commander":"unit",position:{row,col},supplied:true,commanded:id!=="U1-4"}));
  const state = {boardSize:10,sideToMove:"P2",turnIndex:13,pieces,continuation:null,outcome:{status:"ongoing"}};
  const response = await f.actual("/api/shell/scenarios/import", {method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({
    protocolVersion:2,identityId:f.store.getIdentityId(),targetGameId:f.gameId,
    scenario:{formatVersion:2,id:"f8cfe2d0-f8b8-4a2d-a019-b0675a1ad480",title:"Production recovery rush",description:"Incident fe01419a board",incorrect:false,initialState:state,resultingState:state,moves:[],expectedFinalStateHash:"hash-placeholder",expectedOutcome:"ongoing",savedSelection:null},
  })});
  assert.equal(response.status,200);
  await f.store.loadGame(f.gameId);
};
const setup = async ({ journal: override, timing = {}, fault = (url, init, call) => call() } = {}) => {
  const env = { DB: createFakeD1() }; env.GAME_ROOMS = createFakeGameRooms(() => env);
  const storage = memoryStorage(), indexedDB = new IDBFactory();
  const journal = override ?? createCommandJournal({ indexedDB });
  const requests = [];
  const actual = (url, init = {}) => apiWorker.fetch(new Request(`https://test${url}`, init), env);
  const create = () => createSyncStore({ storage, commandJournal: journal, timing: { ...SYNC_TIMING, requestTimeoutMs: 30, confirmationBudgetMs: 65, retryDelaysMs: [10], retryJitter: 0, ...timing },
    fetcher: (url, init) => { if (init?.body) requests.push(JSON.parse(init.body)); return fault(url, init, () => actual(url, init)); },
    createSyncClient: () => ({ connectGame() {}, disconnectGame() {}, disconnectAll() {}, getDesiredGameIds: () => [] }),
  });
  const store = create(); const created = store.createGame({ selfPlayMode: true }); await created.committed;
  const gameId = created.gameId;
  const move = async (target = store) => { const game = target.getGameViewModel(gameId); const action = game.legalActions.find((entry) => entry.type === "move") ?? game.legalActions[0]; return target.applyGameAction({ gameId, state: game.currentSnapshot, action }); };
  return { store, create, gameId, move, journal, requests, env, actual };
};

for (const committed of [false, true]) test(`reconcile timeout replays the exact durable command after ${committed ? "lost acceptance" : "lost delivery"}`, async (t) => {
  let applies = 0;
  const sent = [];
  const f = await setup({ fault: async (url, init, call) => {
    if (url.endsWith("/reconcile")) return new Promise(() => {});
    if (url.endsWith("/apply")) {
      sent.push(JSON.parse(init.body));
      if (++applies === 1) {
        if (committed) await call();
        return new Promise(() => {});
      }
    }
    return call();
  } });
  t.after(() => f.store.retire());
  const handle = await f.move();
  await until(() => handle.status === "committed");
  assert.equal(sent.length, 2);
  assert.deepEqual(sent[1], sent[0]);
  assert.equal(f.env.DB.getGameState(f.gameId).moves.length, 1);
  assert.equal((await f.journal.list(f.store.getIdentityId(), f.gameId)).length, 0);
});

test("idempotent replay keeps shared changes locked before its receipt arrives", async (t) => {
  let applies = 0, release;
  const f = await setup({timing:{confirmationBudgetMs:1000},fault:(url,init,call)=>{
    if (url.endsWith("/reconcile")) return new Promise(()=>{});
    if (url.endsWith("/apply")) {
      if (++applies === 1) return new Promise(()=>{});
      return new Promise(resolve=>{release=()=>resolve(call());});
    }
    return call();
  }});
  t.after(()=>f.store.retire());
  const handle = await f.move();
  await until(()=>Boolean(release));
  assert.equal(handle.status,"pending");
  assert.equal(f.store.getGameViewModel(f.gameId).confirmationOverdue,false);
  assert.equal(f.store.getGameViewModel(f.gameId).sharedMutationsBlocked,true);
  await assert.rejects(f.move(),/sync_recovering/);
  release();
  await until(()=>handle.status === "committed");
  assert.equal(f.store.getGameViewModel(f.gameId).sharedMutationsBlocked,false);
});

for (const hungBody of [false, true]) test(`timeout diagnostics retain their own ${hungBody ? "body" : "headers"} request rather than a concurrent successful read`, async (t) => {
  let hangingRequestId;
  const f = await setup({ timing: { requestTimeoutMs: 100 }, fault: (url, init, call) => {
    if (url.endsWith("/apply")) {
      hangingRequestId = init.headers["X-Righelt-Request-Id"];
      return hungBody ? { ok: true, status: 200, headers: new Headers({"X-Righelt-Server-Build":"apply-build"}), json: () => new Promise(() => {}) } : new Promise(() => {});
    }
    return call();
  } });
  t.after(() => f.store.retire());
  await f.move();
  await until(() => Boolean(hangingRequestId));
  await f.store.loadGame(f.gameId);
  await until(() => issueDiagnostics.list().some(report => report.key === `recovery:${f.gameId}` && report.events.some(event => event.stage === "command_confirmation")));
  const event = issueDiagnostics.list().find(report => report.key === `recovery:${f.gameId}`).events.find(event => event.stage === "command_confirmation");
  assert.equal(event.requestId, hangingRequestId);
  assert.equal(event.status, hungBody ? 200 : null);
  assert.equal(event.serverBuild, hungBody ? "apply-build" : "unavailable");
  assert.equal(event.requestKind, "apply");
  assert.equal(event.requestPhase, hungBody ? "body" : "headers");
  assert.equal(event.deadlineMs, 100);
});

for (const competingMove of [false, true]) test(`reconcile outage drains three dependent commands with ${competingMove ? "stale-state rejection" : "ordered acceptance"}`, async (t) => {
  let applies = 0;
  const f = await setup({ timing: { requestTimeoutMs: 100, confirmationBudgetMs: 500 }, fault: (url, init, call) => {
    if (url.endsWith("/reconcile") || (url.endsWith("/apply") && ++applies === 1)) return new Promise(() => {});
    return call();
  } });
  t.after(() => f.store.retire());
  await loadIncidentBoard(f);
  const handles = [];
  for (const actorId of ["U2-1","U2-2","U2-3"]) {
    const game = f.store.getGameViewModel(f.gameId);
    const action = game.legalActions.find(action => action.type === "rush" && action.actorId === actorId);
    assert.ok(action, `${actorId} has a legal rush in the incident chain`);
    handles.push(await f.store.applyGameAction({gameId:f.gameId,state:game.currentSnapshot,action}));
  }
  assert.equal(f.store.getGameViewModel(f.gameId).pendingCommandCount, 3);
  if (competingMove) {
    const saved = await f.journal.list(f.store.getIdentityId(), f.gameId);
    const other = { ...saved.find(entry => entry.clientCommandId === handles[0].id), clientCommandId: "v2:other-tab" };
    const { commandFingerprint } = await import("../generated/packages/shared-types/src/sync-protocol.js");
    other.fingerprint = await commandFingerprint(other);
    await f.actual(`/api/shell/games/${f.gameId}/apply`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(other) });
  }
  await until(() => handles.every(handle => handle.status === (competingMove ? "failed" : "committed")));
  const moves = f.env.DB.getGameState(f.gameId).moves;
  assert.equal(moves.length, competingMove ? 1 : 3);
  if (!competingMove) assert.deepEqual(moves.map(move => move.clientCommandId), handles.map(handle => handle.id));
  assert.equal(f.store.getGameViewModel(f.gameId).pendingCommandCount, 0);
  await until(async () => (await f.journal.list(f.store.getIdentityId(), f.gameId)).length === 0);
});

for (const failure of ["invalid_response", "invalid_credentials", "upgrade_required"]) test(`reconciliation ${failure} cannot trigger blind replay`, async (t) => {
  let applies = 0, reconciles = 0;
  const f = await setup({ fault: (url, init, call) => {
    if (url.endsWith("/apply")) { applies++; return new Promise(() => {}); }
    if (url.endsWith("/reconcile")) {
      reconciles++;
      return failure === "invalid_response" ? Response.json({}) : Response.json({ ok: false, error: failure }, { status: failure === "invalid_credentials" ? 401 : 426 });
    }
    return call();
  } });
  t.after(() => f.store.retire());
  const handle = await f.move();
  await until(() => reconciles > 0);
  await sleep(80);
  assert.equal(applies, 1);
  assert.equal(handle.status, "pending");
  assert.equal((await f.journal.list(f.store.getIdentityId(), f.gameId)).length, 1);
});

test("lost end-turn acceptance recovers through its unchanged durable envelope", async (t) => {
  const sent = [];
  const f = await setup({ fault: async (url, init, call) => {
    if (url.endsWith("/reconcile")) return new Promise(() => {});
    if (url.endsWith("/end-turn")) {
      sent.push(JSON.parse(init.body));
      if (sent.length === 1) { await call(); return new Promise(() => {}); }
    }
    return call();
  } });
  t.after(() => f.store.retire());
  await loadIncidentBoard(f);
  const game = f.store.getGameViewModel(f.gameId);
  const rush = game.legalActions.find(action => action.type === "rush");
  assert.ok(rush, "rush leaves the current turn open for an explicit end-turn");
  const move = await f.store.applyGameAction({gameId:f.gameId,state:game.currentSnapshot,action:rush});
  await move.committed;
  const handle = await f.store.endTurn({gameId:f.gameId});
  await until(() => handle.status === "committed");
  assert.equal(sent.length, 2);
  assert.deepEqual(sent[1], sent[0]);
  assert.equal(f.env.DB.getGameState(f.gameId).board.state.turnIndex, game.board.state.turnIndex + 1);
  assert.equal(f.env.DB.getGameState(f.gameId).moves.length, 1);
});

test("elapsed confirmation deadline blocks play before suspended timers execute", async () => {
  const f = await setup({ timing: { requestTimeoutMs: 500, confirmationBudgetMs: 100 }, fault: (url, init, call) => url.endsWith("/apply") ? new Promise(() => {}) : call() });
  const handle = await f.move();
  await until(() => f.requests.some(request => request.kind === "action"));
  const realNow = Date.now, resumedAt = realNow() + 1000;
  try {
    Date.now = () => resumedAt;
    const game = f.store.getGameViewModel(f.gameId);
    assert.equal(game.confirmationOverdue, true);
    assert.equal(game.sharedMutationsBlocked, true);
    assert.equal(game.canRecordMove, false);
    assert.equal(handle.status, "pending", "elapsed time cannot reject an unknown command");
  } finally { Date.now = realNow; f.store.retire(); }
});

test("hung request and hung body independently cross the confirmation budget without failing unknown handles", async () => {
  for (const hungBody of [false, true]) {
    let broken = true;
    const f = await setup({ fault: (url, init, call) => {
      if (broken && (url.endsWith("/apply") || url.endsWith("/reconcile"))) return hungBody ? Promise.resolve({ ok: true, json: () => new Promise(() => {}) }) : new Promise(() => {});
      return call();
    } });
    const handle = await f.move();
    await until(() => f.store.getGameViewModel(f.gameId).confirmationOverdue);
    assert.equal(handle.status, "pending"); assert.equal(f.store.getGameViewModel(f.gameId).pendingCommandCount, 1);
    await assert.rejects(f.move(), /sync_recovering/);
    broken = false;
    await until(() => handle.status === "committed");
    assert.equal(f.env.DB.getGameState(f.gameId).moves.length, 1);
  }
});

test("empty, corrupt, unrelated and invalid-revision HTTP 200 never falsely confirm; lost commit is recovered by receipt", async () => {
  for (const corrupt of [() => ({}), () => ({ protocolVersion: 2 }), (body) => ({ ...body, commandOutcomes: body.commandOutcomes.map((outcome) => ({ ...outcome, clientCommandId: "v2:unrelated" })) }), (body) => ({ ...body, eventSeq: -1 })]) {
    let holdReconcile = true;
    const f = await setup({ fault: async (url, init, call) => {
      if (url.endsWith("/apply")) { const body = await (await call()).json(); return Response.json(corrupt(body)); }
      if (url.endsWith("/reconcile") && holdReconcile) return new Promise(() => {});
      return call();
    } });
    const handle = await f.move(); await until(() => f.store.getGameViewModel(f.gameId).recovering);
    assert.equal(handle.status, "pending"); assert.equal(f.env.DB.getGameState(f.gameId).moves.length, 1);
    holdReconcile = false; await until(() => handle.status === "committed");
    assert.equal(f.env.DB.getGameState(f.gameId).moves.length, 1);
  }
});

test("late HTTP failure cannot reverse WebSocket acceptance or clear a newer queued command", async () => {
  let completeFirst, firstBody, secondBody, completeSecond;
  const f = await setup({ fault: async (url, init, call) => {
    if (!url.endsWith("/apply")) return call();
    const response = await call(); const body = await response.json();
    if (!firstBody) { firstBody = body; return new Promise((resolve) => { completeFirst = resolve; }); }
    secondBody = body; return new Promise((resolve) => { completeSecond = resolve; });
  } });
  const first = await f.move(); await until(() => firstBody);
  f.store.applyLiveGameUpdate({ game: firstBody.game, eventSeq: firstBody.eventSeq, commandOutcome: firstBody.commandOutcomes[0] });
  assert.equal(first.status, "committed");
  const second = await f.move(); await until(() => secondBody);
  completeFirst(Response.json({ ok: false, error: "late_failure" }, { status: 500 })); await sleep(5);
  assert.equal(first.status, "committed"); assert.equal(second.status, "pending");
  completeSecond(Response.json(secondBody)); await until(() => second.status === "committed");
  assert.equal(f.env.DB.getGameState(f.gameId).moves.length, 2);
});

test("reload reconciles immutable original IDs after a committed response is lost", async () => {
  let lose = true;
  const f = await setup({ fault: async (url, init, call) => {
    if (lose && url.endsWith("/apply")) { await call(); return new Promise(() => {}); }
    if (lose && url.endsWith("/reconcile")) return new Promise(() => {});
    return call();
  } });
  const original = await f.move(); await until(() => f.env.DB.getGameState(f.gameId).moves.length === 1);
  const saved = await f.journal.list(f.store.getIdentityId(), f.gameId);
  assert.equal(saved[0].clientCommandId, original.id);
  lose = false; const reloaded = f.create(); await reloaded.loadGame(f.gameId);
  await until(() => reloaded.getPendingOperations(f.gameId).length === 0);
  await until(() => original.status === "committed");
  assert.equal(f.env.DB.getGameState(f.gameId).moves.length, 1);
  assert.equal((await f.journal.list(f.store.getIdentityId(), f.gameId)).length, 0);
});

test("journal failure publishes and sends nothing; recovery gate survives dismissal", async () => {
  let fail = true;
  const actualJournal = createCommandJournal({ indexedDB: new IDBFactory() });
  const journal = { ...actualJournal, admit: (command) => fail ? Promise.reject(new Error("quota")) : actualJournal.admit(command) };
  const f = await setup({ journal }); const before = f.store.getGameViewModel(f.gameId).currentSnapshot;
  await assert.rejects(f.move(), /quota/);
  assert.deepEqual(f.store.getGameViewModel(f.gameId).currentSnapshot, before);
  assert.equal(f.requests.filter((body) => body.kind === "action").length, 0);
  f.store.dismissOperation("missing"); await assert.rejects(f.move(), /sync_recovering/);
  fail = false; await f.store.retrySaving(f.gameId);
  await until(() => f.env.DB.getGameState(f.gameId).moves.length === 1);
});

test("an out-of-order descendant receipt cannot reset the predecessor confirmation budget", async () => {
  let firstBody, releaseFirst;
  const f = await setup({ fault: async (url, init, call) => {
    if (url.endsWith("/reconcile")) return new Promise(() => {});
    if (url.endsWith("/apply")) { firstBody = await (await call()).json(); return new Promise((resolve) => { releaseFirst = resolve; }); }
    return call();
  } });
  const first = await f.move(); const second = await f.move(); await until(() => firstBody);
  const saved = await f.journal.list(f.store.getIdentityId(), f.gameId);
  const descendant = saved.find((entry) => entry.clientCommandId === second.id);
  assert.equal(descendant.predecessor.clientCommandId, first.id);
  const body = await (await f.actual(`/api/shell/games/${f.gameId}/apply`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(descendant) })).json();
  assert.equal(body.commandOutcomes[0].outcome, "accepted");
  f.store.applyLiveGameUpdate({ game: body.game, eventSeq: body.eventSeq, commandOutcome: body.commandOutcomes[0] });
  assert.equal(second.status, "committed"); assert.equal(first.status, "pending");
  await until(() => f.store.getGameViewModel(f.gameId).confirmationOverdue);
  f.store.applyLiveGameUpdate({ game: firstBody.game, eventSeq: firstBody.eventSeq, commandOutcome: firstBody.commandOutcomes[0] });
  assert.equal(first.status, "committed"); assert.equal(f.store.getGameViewModel(f.gameId).moves.length, 2);
  const lateResult = await first.committed;
  assert.equal(lateResult.game.moves.length, 2);
  assert.deepEqual(lateResult.state, body.game.board.state);
  releaseFirst(Response.json({}));
});

test("reload never resends a saved command whose original prerequisites changed", async () => {
  let stop = true;
  const f = await setup({ fault: (url, init, call) => stop && (url.endsWith("/apply") || url.endsWith("/reconcile")) ? new Promise(() => {}) : call() });
  const handle = await f.move();
  const [saved] = await f.journal.list(f.store.getIdentityId(), f.gameId);
  const competing = { ...saved, clientCommandId: "v2:competing" };
  const { commandFingerprint } = await import("../generated/packages/shared-types/src/sync-protocol.js");
  competing.fingerprint = await commandFingerprint(competing);
  await f.actual(`/api/shell/games/${f.gameId}/apply`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(competing) });
  const sentBefore = f.requests.filter((entry) => entry.clientCommandId === handle.id).length;
  stop = false; const reloaded = f.create(); await reloaded.loadGame(f.gameId);
  await until(() => reloaded.getPendingOperations(f.gameId).length === 0);
  await until(() => handle.status === "failed");
  assert.equal(f.requests.filter((entry) => entry.clientCommandId === handle.id).length, sentBefore);
  assert.equal(f.env.DB.getGameState(f.gameId).moves.length, 1);
});

test("older servers and malformed authoritative snapshots are rejected before saved commands replay", async () => {
  for (const corrupt of [(body) => ({ ...body, protocolVersion: undefined }), (body) => ({ ...body, game: { ...body.game, board: { state: true } } }), (body) => ({ ...body, game: { ...body.game, gameplayRevision: -1 } })]) {
    const f = await setup({ fault: async (url, init, call) => {
      const response = await call();
      return init.method === "GET" ? Response.json(corrupt(await response.json())) : response;
    } });
    await assert.rejects(f.create().loadGame(f.gameId), /upgrade_required|invalid_snapshot/);
  }
});

test("malformed socket snapshots cannot confirm a command before recovery", async () => {
  let committed, release;
  const f = await setup({ fault: async (url, init, call) => {
    if (url.endsWith("/apply")) { committed = await (await call()).json(); return new Promise((resolve) => { release = resolve; }); }
    if (url.endsWith("/reconcile")) return new Promise(() => {});
    return call();
  } });
  const handle = await f.move(); await until(() => committed);
  for (const update of [
    { game: { ...committed.game, board: { state: true } }, eventSeq: committed.eventSeq, commandOutcome: committed.commandOutcomes[0] },
    { game: committed.game, eventSeq: committed.eventSeq, commandOutcome: { ...committed.commandOutcomes[0], eventSeq: committed.eventSeq + 1 } },
  ]) {
    f.store.applyLiveGameUpdate(update); assert.equal(handle.status, "pending");
  }
  f.store.applyLiveGameUpdate({ game: committed.game, eventSeq: committed.eventSeq, commandOutcome: committed.commandOutcomes[0] });
  assert.equal(handle.status, "committed"); release(Response.json({}));
});

test("rejected predecessors settle all queued descendants through durable server outcomes", async () => {
  let release, waiting = true;
  const f = await setup({ fault: (url, init, call) => {
    if (waiting && url.endsWith("/apply")) return new Promise((resolve) => { release = () => { waiting = false; resolve(call()); }; });
    return call();
  } });
  const first = await f.move(); const second = await f.move();
  const saved = await f.journal.list(f.store.getIdentityId(), f.gameId);
  const root = saved.find((entry) => entry.clientCommandId === first.id);
  const competitor = { ...root, clientCommandId: "v2:other-tab" };
  const { commandFingerprint } = await import("../generated/packages/shared-types/src/sync-protocol.js");
  competitor.fingerprint = await commandFingerprint(competitor);
  await f.actual(`/api/shell/games/${f.gameId}/apply`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(competitor) });
  release();
  await until(() => first.status === "failed" && second.status === "failed");
  assert.equal(f.store.getPendingOperations(f.gameId).length, 0);
  assert.equal(f.env.DB.getGameState(f.gameId).moves.length, 1);
  await until(() => f.store.getGameViewModel(f.gameId).pendingCommandCount === 0);
});

test("tampered restored journal records block replay without evicting unresolved data", async () => {
  const f = await setup({ journal: { list: async () => [{ clientCommandId: "v2:broken" }], admit: async () => {}, remove: async () => assert.fail("must not evict") } });
  const reloaded = f.create(); await reloaded.loadGame(f.gameId);
  assert.equal(reloaded.getGameViewModel(f.gameId).storageBlocked, true);
  assert.equal(f.requests.filter((entry) => entry.kind).length, 0);
});

test("unknown receipt recovery keeps shared changes locked after the socket itself recovers", async () => {
  let command;
  const f = await setup({ fault: (url, init, call) => {
    if (url.endsWith("/apply")) { command = JSON.parse(init.body); return new Promise(() => {}); }
    if (url.endsWith("/reconcile")) return Response.json({ protocolVersion: 2, gameId: command.gameId, eventSeq: 1, gameplayRevision: 0,
      commandOutcomes: [{ gameId: command.gameId, identityId: command.identityId, clientCommandId: command.clientCommandId, fingerprint: command.fingerprint, outcome: "unknown", reason: "dependency_pending", eventSeq: 1, gameplayRevision: 0 }] });
    return call();
  } });
  const handle = await f.move(); await until(() => command);
  f.store.setConnectionRecovering(f.gameId, true);
  await f.store.reconcileGame(f.gameId);
  f.store.setConnectionRecovering(f.gameId, false);
  assert.equal(handle.status, "pending"); assert.equal(f.store.getGameViewModel(f.gameId).sharedMutationsBlocked, true);
  await assert.rejects(f.move(), /sync_recovering/);
});


test("HTTP and socket commitment results include the accepted snapshot, retaining newer state", async () => {
  for (const channel of ["http", "socket"]) {
    let body, release;
    const f = await setup({ fault: async (url, init, call) => {
      const response = await call();
      if (!url.endsWith("/apply")) return response;
      body = await response.json();
      return new Promise(resolve => { release = () => resolve(Response.json(body)); });
    } });
    const handle = await f.move(); await until(() => body);
    if (channel === "socket") f.store.applyLiveGameUpdate({ game: body.game, eventSeq: body.eventSeq, commandOutcome: body.commandOutcomes[0] });
    else release();
    const result = await handle.committed;
    assert.equal(result.game.moves.length, 1);
    assert.equal(result.game.gameplayRevision, body.game.gameplayRevision);
    assert.deepEqual(result.state, f.store.getGameViewModel(f.gameId).currentSnapshot);
    release();
  }
});

test("admission quota failure cannot block durable command recovery", async () => {
  const actualJournal = createCommandJournal({ indexedDB: new IDBFactory() }); let calls = 0, fail = true, lost = true;
  const journal = { ...actualJournal, admit: envelope => ++calls > 1 && fail ? Promise.reject(new Error("quota")) : actualJournal.admit(envelope) };
  const f = await setup({ journal, timing: { requestTimeoutMs: 100 }, fault: async (url, init, call) => {
    if (lost && url.endsWith("/apply")) { await call(); return new Promise(() => {}); }
    if (lost && url.endsWith("/reconcile")) return new Promise(() => {});
    return call();
  } });
  const handle = await f.move(); await assert.rejects(f.move(), /quota/);
  lost = false; await f.store.reconcileGame(f.gameId); await until(() => handle.status === "committed");
  assert.equal(f.store.getGameViewModel(f.gameId).storageBlocked, true);
  assert.equal((await journal.list(f.store.getIdentityId())).length, 0);
  fail = false; await f.store.retrySaving(f.gameId);
  await until(() => f.env.DB.getGameState(f.gameId).moves.length === 2);
});

test("full game and identity journal caps drain durable receipts before retrying admission", async (t) => {
  const { commandFingerprint } = await import("../generated/packages/shared-types/src/sync-protocol.js");
  for (const cap of [16, 128]) {
    let lost = true, unavailableGame;
    const f = await setup({ timing: { requestTimeoutMs: 1000, confirmationBudgetMs: 60000 }, fault: async (url, init, call) => {
      if (unavailableGame && url.includes(unavailableGame) && url.endsWith("/reconcile")) return Response.json({ error: "not_found" }, { status: 404 });
      if (lost && url.endsWith("/apply")) { await call(); return new Promise(() => {}); }
      if (lost && url.endsWith("/reconcile")) return new Promise(() => {});
      return call();
    } });
    let first, gameIds;
    // Filling IndexedDB is fixture work, not elapsed confirmation time. Freeze
    // transport timers until the cap assertion, then use real receipt recovery.
    t.mock.timers.enable({ apis: ["setTimeout"] });
    try {
      first = await f.move(); const [original] = await f.journal.list(f.store.getIdentityId());
      gameIds = [f.gameId];
      for (let i = 1; i < cap / 16; i++) { const created = f.store.createGame({ selfPlayMode: true }); await created.committed; gameIds.push(created.gameId); }
      for (let i = 1; i < cap; i++) {
        const envelope = { ...original, gameId: gameIds[Math.floor(i / 16)], clientCommandId: `v2:cap-${cap}-${i}` };
        envelope.fingerprint = await commandFingerprint(envelope); await f.journal.admit(envelope);
      }
      assert.equal((await f.journal.list(f.store.getIdentityId())).length, cap);
      await assert.rejects(f.move(), /journal_limit/);
    } finally {
      // Release the held request before restoring timers; receipt recovery
      // must be able to await its finished attempt using real timers below.
      lost = false;
      t.mock.timers.tick(1000);
      t.mock.timers.reset();
    }
    unavailableGame = cap === 128 ? gameIds[1] : null;
    lost = false; await f.store.retrySaving(f.gameId);
    await until(() => first.status === "committed");
    await until(() => f.store.getGameViewModel(f.gameId).pendingCommandCount === 0);
    assert.equal(f.store.getGameViewModel(f.gameId).storageBlocked, false);
    assert.ok((await f.journal.list(f.store.getIdentityId())).length < cap);
    if (unavailableGame) assert.equal((await f.journal.list(f.store.getIdentityId(), unavailableGame)).length, 16);
  }
});

test("committed A excludes optimistic B and a late A receipt retains newer authoritative B", async () => {
  let firstBody, secondBody, releaseFirst, releaseSecond;
  // This case owns receipt ordering, not the separately covered overdue clock.
  const f = await setup({ timing: { requestTimeoutMs: 5000, confirmationBudgetMs: 60000 }, fault: async (url, init, call) => {
    const response = await call(); if (!url.endsWith('/apply')) return response;
    const body = await response.json();
    if (!firstBody) { firstBody = body; return new Promise(resolve => { releaseFirst = () => resolve(Response.json(body)); }); }
    secondBody = body; return new Promise(resolve => { releaseSecond = () => resolve(Response.json(body)); });
  } });
  const first = await f.move(); const second = await f.move(); await until(() => firstBody);
  releaseFirst(); const result = await first.committed;
  assert.equal(result.game.moves.length, 1);
  assert.deepEqual(result.state, firstBody.game.board.state);
  assert.equal(second.status, 'pending');
  await until(() => secondBody);
  f.store.selectHistoryMove({ gameId: f.gameId, moveIndex: 0 });
  f.store.applyLiveGameUpdate({ game: secondBody.game, eventSeq: secondBody.eventSeq, commandOutcome: secondBody.commandOutcomes[0] });
  const secondResult = await second.committed;
  assert.equal(secondResult.game.moves.length, 2);
  assert.deepEqual(secondResult.state, secondBody.game.board.state);
  assert.equal(f.store.getGameViewModel(f.gameId).inHistoryMode, true);
  f.store.applyLiveGameUpdate({ game: firstBody.game, eventSeq: firstBody.eventSeq, commandOutcome: firstBody.commandOutcomes[0] });
  assert.equal(f.store.getGameViewModel(f.gameId).moves.length, 2);
  releaseSecond();
});
