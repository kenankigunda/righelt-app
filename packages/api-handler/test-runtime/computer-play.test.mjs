import {CURRENT_COMPUTER_MODEL} from '../../shared-types/src/computer-play.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { readDecision, readDecisionPage } from '../src/decision-archive.ts';
import { commandFingerprint } from '../../../apps/web/generated/packages/shared-types/src/sync-protocol.js';
import { deterministicStateHash } from '../../../apps/web/generated/packages/game-engine/src/hash.js';
const require = createRequire(import.meta.url), wrangler = createRequire(require.resolve('wrangler/package.json'));
const { Miniflare } = wrangler('miniflare'), { build } = wrangler('esbuild');
const root = path.resolve(import.meta.dirname, '../../..');
for (const accounts of [true, false]) test(`native ${accounts ? 'account' : 'guest'} rooms fence computer devices and atomically retain accepted decisions and safe branches`, { timeout: 120000 }, async () => {
  const bundle = await build({ stdin: { contents: `export { GameRoomDO } from './packages/api-handler/src/game-room-do.ts'; import { handleApiRequest } from './packages/api-handler/src/index.ts'; export default { fetch: handleApiRequest };`, resolveDir: root }, bundle: true, format: 'esm', platform: 'browser', write: false });
  const runtime = new Miniflare({ modules: true, script: bundle.outputFiles[0].text, compatibilityDate: '2026-03-12', d1Databases: ['DB'], durableObjects: { GAME_ROOMS: { className: 'GameRoomDO', useSQLite: true } }, bindings: { AUTH_ENABLED: String(accounts), AUTH_ALLOWED_ORIGINS: 'https://test' } });
  try {
    const db = await runtime.getD1Database('DB');
    for (const file of (await readdir(path.join(root, 'db/migrations'))).filter(file => file.endsWith('.sql')).sort()) await db.exec((await readFile(path.join(root, 'db/migrations', file), 'utf8')).replace(/--[^\n]*/g, '').replace(/\s+/g, ' '));
    const seed = async (id, n) => {
      if (!accounts) return { id, token: '', context: undefined };
      const token = String(n).repeat(64), context = String(n + 4).repeat(64), now = Date.now();
      await db.prepare('INSERT OR IGNORE INTO accounts(account_id,username,username_canonical,display_name,created_at,password_hash) VALUES(?,?,?,?,?,?)').bind(id,id,id,id,now,'synthetic').run();
      await db.prepare('INSERT INTO account_sessions VALUES(?,?,1,?,?,?,?,NULL)').bind(createHash('sha256').update(token).digest('hex'),id,context,now,now,now+86400000).run();
      return { id, token, context };
    };
    const a = await seed('owner',1), a2 = await seed('owner',2), b = await seed('viewer',3);
    const call = async (route, actor, body) => {
      const query = !accounts && body === undefined ? `?identityId=${encodeURIComponent(actor.id)}` : '';
      const response = await runtime.dispatchFetch(`https://test/api/shell/${route}${query}`, { method: body === undefined ? 'GET' : 'POST', headers: { Origin: 'https://test', 'Content-Type': 'application/json', 'X-Righelt-Auth': '1', 'X-Righelt-Auth-Version': '2', Cookie: `__Host-righelt_session=${actor.token}`, 'X-Righelt-Session': actor.context }, ...(body === undefined ? {} : { body: JSON.stringify({ protocolVersion: 2, identityId: actor.id, ...body }) }) });
      return { status: response.status, body: await response.json() };
    };
    for(const [name,modelId]of [['cached',undefined],['explicit-retained','initial-1554'],['explicit-published',CURRENT_COMPUTER_MODEL.id]]){
      const value=await call('games',a,{gameId:'pin-'+name,computer:{p1:'babs',p2:null},...(modelId===undefined?{}:{computerModelId:modelId})});
      assert.equal(value.status,200,JSON.stringify(value.body));assert.equal(value.body.game.computer.modelId,modelId??'initial-1554');
      const reloaded = await call('games/pin-'+name,a);assert.equal(reloaded.status,200,JSON.stringify(reloaded.body));assert.equal(reloaded.body.game.computer.modelId,modelId??'initial-1554');
      const otherModel=reloaded.body.game.computer.modelId==='initial-1554'?CURRENT_COMPUTER_MODEL.id:'initial-1554';
      assert.notEqual(otherModel,reloaded.body.game.computer.modelId,'Promotion needs two published model identities');
      const conflict=await call('games',a,{gameId:'pin-'+name,computer:{p1:'babs',p2:null},computerModelId:otherModel});
      assert.equal(conflict.status,409);assert.equal(conflict.body.error,'game_already_exists');
      assert.deepEqual((await call('games/pin-'+name,a)).body.game.computer,reloaded.body.game.computer);
    }
    for(const modelId of ['',null,{},'unknown'])assert.equal((await call('games',a,{gameId:'invalid-'+String(modelId),computer:{p1:'babs',p2:null},computerModelId:modelId})).status,400);
    const created = await call('games',a,{ gameId:'computer-game',computer:{p1:'babs',p2:null} });
    assert.equal(created.status,200,JSON.stringify(created.body)); let game = created.body.game;
    // Exercise the SQLite expression lookup and append-only finalization schema.
    const probeDecision = { id: 'native-finalization-probe', kind: 'decision', eventSeq: 900, ordinal: 0, revision: 0, at: game.createdAt, move: { moveId: 'native-finalization-probe', snapshot: game.board.state } };
    const finalizedMove = { ...probeDecision.move, destroyedPieces: [{ eventId: 'turn-end:probe' }] };
    for (const entry of [probeDecision, { id: 'native-finalization-amendment', kind: 'finalization', targetDecisionId: probeDecision.id, finalizedMove, eventSeq: 901, ordinal: 0, revision: 1, at: game.createdAt }]) {
      await db.prepare('INSERT INTO live_decision_archive VALUES (?, ?, ?, ?, ?, ?)').bind(game.id, entry.id, entry.eventSeq, entry.ordinal, entry.revision, JSON.stringify(entry)).run();
    }
    assert.deepEqual((await readDecision({ DB: db }, game.id, probeDecision.id)).move, finalizedMove);
    assert.deepEqual((await readDecisionPage({ DB: db }, game.id, { eventSeq: 899, ordinal: -1 })).items.find(entry => entry.id === probeDecision.id).move, finalizedMove);
    const originalRow = await db.prepare('SELECT payload_json FROM live_decision_archive WHERE game_id = ? AND decision_id = ?').bind(game.id, probeDecision.id).first();
    assert.deepEqual(JSON.parse(originalRow.payload_json), probeDecision);
    await db.prepare('DELETE FROM live_decision_archive WHERE game_id = ? AND event_seq >= 900').bind(game.id).run();
    const route = endpoint => `games/${game.id}/${endpoint}`;
    const acquired = await call(route('computer-control'),a,{action:'acquire',deviceId:'device-a',generation:0});
    assert.equal(acquired.status,200,JSON.stringify(acquired.body)); game=acquired.body.game;
    if (accounts) assert.equal(game.computer.lease.authContextId,undefined); assert.equal(game.canRecordMove,false);
    assert.equal((await call(route('computer-control'),a2,{action:'acquire',deviceId:'device-b',generation:game.computer.generation})).status,409);
    assert.equal((await call(route('computer-control'),b,{action:'switch',deviceId:'device-b',generation:game.computer.generation})).status,409);
    const action = game.legalActions.find(action => action.from && action.to);
    const proof = (g, device, id) => ({deviceId:device,generation:g.computer.generation,modelId:g.computer.modelId,profile:'babs',profileVersion:'experimental-v1',seed:107,attemptId:id});
    const command = async (actor,g,id,p) => {
      const value = { protocolVersion:2,gameId:g.id,identityId:actor.id,authContextId:actor.context,clientCommandId:id,kind:'action',payload:{action,...(p ? {computer:p}: {})},expectedState:g.board.state,expectedGameplayRevision:g.gameplayRevision };
      return {...value,fingerprint:await commandFingerprint(value)};
    };
    const oldProof = proof(game,'device-a','old-attempt');
    const noEvidence = await call(route('apply'),a,await command(a,game,'v2:no-evidence',oldProof));
    assert.equal(noEvidence.body.commandOutcomes[0].reason,'invalid_computer_evidence');
    const switched = await call(route('computer-control'),a2,{action:'switch',deviceId:'device-b',generation:game.computer.generation}); game=switched.body.game;
    const late = await call(route('apply'),a,await command(a,game,'v2:late',oldProof));
    assert.equal(late.body.commandOutcomes[0].reason,'computer_control_changed');
    const p = proof(game,'device-b','accepted-attempt');
    const attempt = { proof:p,gameplayRevision:game.gameplayRevision,fingerprint:deterministicStateHash(game.board.state),outcome:'ready',result:{action} };
    assert.equal((await call(route('decision-attempt'),a2,{operation:'write',kind:'computer',attemptId:p.attemptId,attempt})).status,200);
    assert.equal((await call(route('decision-attempt'),a2,{operation:'write',kind:'computer',attemptId:p.attemptId,attempt:{...attempt,outcome:'changed'}})).status,409);
    const sent = await command(a2,game,'v2:accepted',p);
    const changedModelCommand = await command(a2,game,'v2:accepted',{...p,modelId:'test-unpublished-model'});
    assert.notEqual(changedModelCommand.fingerprint,sent.fingerprint,'Model choice is part of immutable command identity');
    const accepted = await call(route('apply'),a2,sent);
    assert.equal(accepted.body.commandOutcomes[0].outcome,'accepted',JSON.stringify(accepted.body));
    assert.equal((await call(route('apply'),a2,sent)).body.commandOutcomes[0].outcome,'accepted');
    const history = await call(route('decision-history'),a,{cursor:null});
    assert.equal(history.body.items.filter(entry=>entry.move).length,1);
    const decision = history.body.items.find(entry=>entry.move);
    assert.deepEqual(decision.move.computerProof,p);
    if (accounts) {
    assert.equal((await call(route('decision-notes'),a,{operation:'write',decisionId:decision.id,note:{text:'Private observation',flagged:true}})).status,200);
    assert.deepEqual((await call(route('decision-notes'),b,{})).body.notes,[]);
    assert.equal((await call(route('decision-attempt'),a,{operation:'write',kind:'analysis',attemptId:'private-analysis',attempt:{private:'only owner'}})).status,200);
    for (const kind of ['analysis','computer']) assert.equal((await call(route('decision-attempt'),b,{kind,attemptId:'private-analysis'})).body.attempt,null);
    assert.equal((await call(route('decision-attempt'),a2,{kind:'analysis',attemptId:'private-analysis'})).body.attempt.private,'only owner');
    assert.equal((await call(route('decision-notes'),a2,{})).body.notes[0].text,'Private observation');
    for (let i = 0; i < 21; i++) assert.equal((await call(route('decision-attempt'),a,{operation:'write',kind:'analysis',attemptId:`analysis-${i}`,attempt:{outcome:'unfinished',decisionId:decision.id}})).status,200);
    const privatePage = (await call(route('decision-attempts'),a2,{kind:'analysis'})).body;
    assert.equal(privatePage.items.length,20); assert.ok(privatePage.nextCursor);
    const privateTail = (await call(route('decision-attempts'),a2,{kind:'analysis',cursor:privatePage.nextCursor})).body;
    assert.equal(privateTail.items.length,2); assert.equal(privateTail.nextCursor,null);
    assert.deepEqual((await call(route('decision-attempts'),b,{kind:'analysis'})).body.items,[]);
    const publicAttempts = (await call(route('decision-attempts'),b,{kind:'computer'})).body.items;
    assert.equal(publicAttempts.length,1); assert.equal(publicAttempts[0].attemptId,p.attemptId);
    const oversized = await call(route('decision-attempt'),a,{operation:'write',kind:'analysis',attemptId:'too-large',attempt:{data:'x'.repeat(256*1024)}});
    assert.equal(oversized.status,413);

    // A retained account game can be annotated before its next gameplay mutation.
    // The first write backfills only its surviving history in the same transaction.
    const oldRow = await db.prepare('SELECT state_json, gameplay_revision FROM live_games WHERE game_id=?').bind(game.id).first();
    const oldGame = JSON.parse(oldRow.state_json);
    oldGame.id = 'retained-account-game'; delete oldGame.archiveStartRevision;
    await db.prepare("INSERT INTO live_games(game_id,created_at,updated_at,latest_activity_at,state_json,event_seq,gameplay_revision,ownership_mode) VALUES(?1,?2,?3,?3,?4,0,?5,'account_v1')")
      .bind(oldGame.id,oldGame.createdAt,oldGame.updatedAt,JSON.stringify(oldGame),oldRow.gameplay_revision).run();
    const oldRoute = endpoint => `games/${oldGame.id}/${endpoint}`;
    const oldHistory = await call(oldRoute('decision-history'),a,{});
    assert.equal(oldHistory.body.partial,true);
    assert.equal((await call(oldRoute('decision-notes'),a,{operation:'write',decisionId:'missing-decision',note:{text:'Invalid target',flagged:false}})).status,404);
    const oldNote = await call(oldRoute('decision-notes'),a,{operation:'write',decisionId:decision.id,note:{text:'Retained history note',flagged:true}});
    assert.equal(oldNote.status,200,JSON.stringify(oldNote.body));
    assert.equal((await call(oldRoute('decision-notes'),a2,{})).body.notes[0].text,'Retained history note');
    assert.deepEqual((await call(oldRoute('decision-notes'),b,{})).body.notes,[]);
    const backfilled = await call(oldRoute('decision-history'),a,{});
    assert.equal(backfilled.body.partial,true);
    assert.deepEqual(backfilled.body.items.find(entry=>entry.id===decision.id).move,decision.move);
    const afterNote = await db.prepare('SELECT state_json, gameplay_revision FROM live_games WHERE game_id=?').bind(oldGame.id).first();
    assert.equal(afterNote.gameplay_revision,oldRow.gameplay_revision);
    assert.deepEqual(JSON.parse(afterNote.state_json).board,oldGame.board);
    const firstCheckpoint = await db.prepare('SELECT state_json FROM live_position_checkpoints WHERE game_id=? AND gameplay_revision=?').bind(oldGame.id,oldRow.gameplay_revision).first();
    assert.ok(firstCheckpoint, 'First retained annotation must also persist its initial checkpoint');
    assert.deepEqual(JSON.parse(firstCheckpoint.state_json),oldGame.board.state);

    } else {
      assert.equal((await call(route('decision-notes'),a,{})).status,401);
      assert.equal((await call(route('decision-attempt'),a,{operation:'write',kind:'analysis',attemptId:'private-analysis',attempt:{private:true}})).status,401);
      assert.equal((await call(route('decision-attempt'),b,{operation:'write',kind:'computer',attemptId:'forged',attempt})).status,403);
      assert.equal((await call(route('decision-attempt'),b,{kind:'computer',attemptId:p.attemptId})).body.attempt.proof.attemptId,p.attemptId);
    }

    const undo = await call(route('revert-request'),a2,{targetMoveId:decision.id});
    assert.equal(undo.status,200,JSON.stringify(undo.body));
    const after = (await call(route('decision-history'),a,{cursor:null})).body.items;
    assert.deepEqual(after.find(entry=>entry.id===decision.id),decision);
    assert.equal(after.at(-1).kind,'restoration');
    const branch = await call('history/branch',b,{gameId:'safe-branch',sourceGameId:game.id,sourceDecisionId:decision.id,creatorSide:'p2',scenario:{resultingState:{forged:true}}});
    assert.equal(branch.status,200,JSON.stringify(branch.body));
    assert.deepEqual(branch.body.game.board.state,decision.move.selectionSnapshot);
    assert.equal(branch.body.game.player1,null);assert.equal(branch.body.game.player2.identityId,'viewer');
    assert.equal(branch.body.game.computer,undefined);
    for(const [name,modelId]of [['cached',undefined],['explicit-retained','initial-1554'],['explicit-published',CURRENT_COMPUTER_MODEL.id]]){
      const value=await call('history/branch',a,{gameId:'branch-pin-'+name,sourceGameId:game.id,sourceDecisionId:decision.id,computer:{p1:'babs',p2:null},...(modelId===undefined?{}:{computerModelId:modelId})});
      assert.equal(value.status,200,JSON.stringify(value.body));assert.equal(value.body.game.computer.modelId,modelId??'initial-1554');
    }

  } finally { await runtime.dispose(); }
});
