import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile,readdir} from 'node:fs/promises';
import path from 'node:path';
import {fixture} from './fixture.mjs';

const require=createRequire(import.meta.url),wranglerRequire=createRequire(require.resolve('wrangler/package.json'));
const {Miniflare}=wranglerRequire('miniflare'),{build}=wranglerRequire('esbuild');
const root=path.resolve(import.meta.dirname,'../../..');

test('actual additional-history HTTP paginates seeded archive records without mutating gameplay or leaking notes',{timeout:30000},async()=>{
 // Test-only header removes legacy metadata in the in-memory DO; production source is untouched.
 const legacyFixture=fixture.replace('async fetch(request) {', 'async fetch(request) { if(request.headers.has("x-legacy-history-fixture"))delete this.game.archiveStartRevision;');
 const bundle=await build({stdin:{contents:legacyFixture,resolveDir:root,sourcefile:'history-runtime.ts'},bundle:true,format:'esm',platform:'browser',write:false});
 const runtime=new Miniflare({modules:true,script:bundle.outputFiles[0].text,compatibilityDate:'2026-03-12',d1Databases:['DB'],durableObjects:{GAME_ROOMS:{className:'GameRoomDO',useSQLite:true}}});
 try{
  const db=await runtime.getD1Database('DB');
  for(const name of (await readdir(path.join(root,'db/migrations'))).filter(n=>n.endsWith('.sql')).sort())await db.exec((await readFile(path.join(root,'db/migrations',name),'utf8')).replace(/--[^\n]*/g,'').replace(/\s+/g,' '));
  const call=async(route,body={},headers={})=>{const response=await runtime.dispatchFetch(`https://test/${route}`,{method:'POST',headers:{'content-type':'application/json','x-game-id':'g',...headers},body:JSON.stringify({identityId:'actor',protocolVersion:2,...body})});return {status:response.status,body:await response.json()};};
  const created=await call('create',{gameId:'g',selfPlayMode:true});assert.equal(created.status,200);
  const revision=created.body.game.gameplayRevision;
  const read=values=>call('decision-history',{mode:'additional',historyRevision:revision,...values});
  assert.equal((await read({metadataOnly:true})).body.available,false);
  const snapshot=created.body.game.board.state;
  const records=Array.from({length:101},(_,index)=>({id:`seed-${index}`,kind:'decision',eventSeq:100+index,ordinal:0,move:{moveId:`seed-${index}`,notation:'PASS',snapshot,selectionSnapshot:snapshot,at:'2026-01-01'}}));
  const append=entry=>db.prepare('INSERT INTO live_decision_archive(game_id,decision_id,event_seq,event_ordinal,gameplay_revision,payload_json) VALUES(?,?,?,?,?,?)').bind('g',entry.id,entry.eventSeq,0,revision,JSON.stringify(entry));
  await db.batch(records.map(append));
  await append({id:'restore-seeded',kind:'restoration',eventSeq:202,ordinal:0,targetDecisionId:'seed-100',restoredIds:['seed-100']}).run();
  await db.prepare('INSERT INTO live_decision_notes VALUES(?,?,?,?)').bind('g','private-owner','seed-0',JSON.stringify({secret:'not public history'})).run();
  const before=await db.prepare('SELECT * FROM live_games WHERE game_id=?').bind('g').first();
  const original=await db.prepare('SELECT payload_json FROM live_decision_archive WHERE decision_id=?').bind('seed-100').first();
  assert.equal((await read({metadataOnly:true})).body.available,true);
  const first=await read({});assert.equal(first.status,200);assert.equal(first.body.items.length,100);assert.equal(first.body.items[0].id,'seed-0');assert.ok(first.body.nextCursor);
  const last=await read({cursor:first.body.nextCursor});assert.equal(last.status,200);assert.deepEqual(last.body.items.map(item=>item.id),['seed-100']);assert.equal(last.body.items[0].move.undone,true);assert.equal(last.body.nextCursor,null);
  assert.equal(JSON.stringify(first.body).includes('not public history'),false);assert.equal(JSON.stringify(last.body).includes('not public history'),false);
  assert.deepEqual(await db.prepare('SELECT * FROM live_games WHERE game_id=?').bind('g').first(),before);
  assert.deepEqual(await db.prepare('SELECT payload_json FROM live_decision_archive WHERE decision_id=?').bind('seed-100').first(),original);
  assert.equal((await read({historyRevision:revision-1})).status,409);assert.equal((await read({cursor:{eventSeq:'bad',ordinal:0}})).status,400);
  const legacy=await call('decision-history',{mode:'additional',historyRevision:revision,metadataOnly:true},{'x-legacy-history-fixture':'1'});assert.equal(legacy.status,200);assert.equal(legacy.body.partial,true);assert.equal(legacy.body.available,false);
  const invalidLegacy=await read({cursor:{eventSeq:'bad',ordinal:0}});assert.equal(invalidLegacy.status,400);assert.equal(invalidLegacy.body.error,'invalid_history_cursor');
 }finally{await runtime.dispose();}
});
