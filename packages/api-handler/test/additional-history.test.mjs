import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readAdditionalDecisionPage} from '../src/decision-archive.ts';

function fixture(count=205){
 const db=new DatabaseSync(':memory:');
 db.exec('CREATE TABLE live_decision_archive(game_id TEXT,decision_id TEXT,event_seq INTEGER,event_ordinal INTEGER,gameplay_revision INTEGER,payload_json TEXT,PRIMARY KEY(game_id,decision_id))');
 const reads=[];
 const env={DB:{prepare(sql){return{bind(...params){return{async all(){reads.push({sql,params});return{results:db.prepare(sql).all(Object.fromEntries(params.map((value,index)=>[`?${index+1}`,value])))};}};}};}}};
 const append=(entry)=>db.prepare('INSERT INTO live_decision_archive VALUES(?,?,?,?,?,?)').run('g',entry.id,entry.eventSeq,entry.ordinal??0,entry.revision??entry.eventSeq,JSON.stringify({ordinal:0,...entry}));
 const moves=Array.from({length:count},(_,index)=>({moveId:`move-${index+1}`,notation:`MOVE ${index+1}`,snapshot:{pieces:[]}}));
 append({id:'initial',kind:'initial',eventSeq:0,state:{pieces:[]}});
 moves.forEach((move,index)=>append({id:move.moveId,kind:'decision',eventSeq:index+1,at:'2026-01-01',move}));
 return{db,env,reads,append,moves,game:{id:'g',moves:moves.slice(-200)}};
}

test('availability is an authoritative bounded read and excludes retained and non-decision records',async t=>{
 const f=fixture();t.after(()=>f.db.close());
 f.append({id:'turn-only',kind:'turn',eventSeq:206,state:{pieces:[]}});
 const meta=await readAdditionalDecisionPage(f.env,f.game,null,true);
 assert.equal(meta.available,true);assert.deepEqual(meta.items,[]);assert.equal(f.reads[0].params[3],1);assert.equal(f.reads[0].params.length,5,'retained IDs use one JSON binding, below D1 parameter limits');
 const page=await readAdditionalDecisionPage(f.env,f.game,null);
 assert.deepEqual(page.items.map(entry=>entry.id),['move-1','move-2','move-3','move-4','move-5']);assert.equal(page.nextCursor,null);
 const complete=await readAdditionalDecisionPage(f.env,{...f.game,moves:f.moves},null,true);
 assert.equal(complete.available,false);assert.deepEqual(complete.items,[]);
});

test('100/101 extra moves paginate forward without losing accumulated identity',async t=>{
 const f=fixture(301);t.after(()=>f.db.close());
 const first=await readAdditionalDecisionPage(f.env,f.game,null);assert.equal(first.items.length,100);assert.equal(first.items[0].id,'move-1');
 const second=await readAdditionalDecisionPage(f.env,f.game,first.nextCursor);assert.deepEqual(second.items.map(entry=>entry.id),['move-101']);assert.equal(second.nextCursor,null);
 assert.equal(new Set([...first.items,...second.items].map(entry=>entry.id)).size,101);
 await assert.rejects(readAdditionalDecisionPage(f.env,f.game,{eventSeq:-1,ordinal:0}),/invalid_history_cursor/);
});

test('restoration ranges mark evicted decisions undone while finalization and later branch snapshots stay intact',async t=>{
 const f=fixture();t.after(()=>f.db.close());
 f.append({id:'restore',kind:'restoration',eventSeq:206,targetDecisionId:'move-2',restoredIds:['move-6','move-7']});
 f.append({id:'finalize',kind:'finalization',eventSeq:207,targetDecisionId:'move-1',finalizedMove:{...f.moves[0],snapshot:{pieces:[{id:'survivor'}]},destroyedPieces:[{eventId:'end:piece'}]}});
 f.append({id:'new-branch',kind:'decision',eventSeq:208,move:{moveId:'new-branch',notation:'PASS',snapshot:{pieces:[]}}});
 const page=await readAdditionalDecisionPage(f.env,f.game,null);
 assert.equal(page.items[0].move.undone,false);assert.deepEqual(page.items[0].move.snapshot,{pieces:[{id:'survivor'}]});assert.equal(page.items[0].move.destroyedPieces[0].eventId,'end:piece');
 assert.ok(page.items.slice(1,5).every(entry=>entry.move.undone),'evicted target and following decisions are restored even outside restoredIds');
 assert.equal(page.items.at(-1).id,'new-branch');assert.equal(page.items.at(-1).move.undone,false);
 const original=JSON.parse(f.db.prepare('SELECT payload_json FROM live_decision_archive WHERE decision_id=?').get('move-2').payload_json);
 assert.equal(original.move.undone,undefined,'read annotations never overwrite stored decisions');
});

test('a partial legacy restoration uses known restored IDs without inventing an active ancestry',async t=>{
 const f=fixture();t.after(()=>f.db.close());
 f.append({id:'partial-restore',kind:'restoration',eventSeq:206,targetDecisionId:'unavailable-legacy-target',restoredIds:['move-3','move-5']});
 const page=await readAdditionalDecisionPage(f.env,f.game,null);
 assert.equal(page.items[0].historyStatus,'unknown');assert.equal(page.items[0].move.undone,undefined);
 assert.equal(page.items[1].historyStatus,'unknown');assert.deepEqual(page.items.slice(2).map(entry=>entry.historyStatus),['undone','undone','undone']);
 const meta=await readAdditionalDecisionPage(f.env,f.game,null,true);
 assert.equal(meta.available,true);assert.match(f.reads.at(-1).sql,/SELECT 1 AS available/);assert.doesNotMatch(f.reads.at(-1).sql,/restoration|finalization|SELECT original\.payload_json/);
});
