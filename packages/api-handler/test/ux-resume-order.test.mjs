import {readFileSync,readdirSync} from "node:fs";
import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createInitialGame} from '../src/shell-live-core.ts';
import {countHomeSectionGames,listHomeSectionGameProjectionPage,listHomeSectionStaticGameCardPage} from '../src/shell-live-db.ts';
test('unfinished own decisions precede opponent decisions before pagination; finished owned games move to Your completed games',async()=>{
 const sql=makeDb();
 const add=(id,at,side='P1',retreat=false,done=false)=>{const game=createInitialGame({gameId:id,identityId:'me',selfPlayMode:false});game.createdAt=game.updatedAt=at;game.board.state.sideToMove=side;game.turns[0].playerSeat=side==='P1'?'Player 1':'Player 2';if(retreat)game.board.state.continuation={type:'push',phase:'retreat'};if(done)game.board.state.outcome={status:'p1_win',reason:'commander_unsupplied'};sql.prepare('INSERT INTO live_games(game_id,created_at,updated_at,latest_activity_at,player1_identity_id,player2_identity_id,has_smoke_identity,state_json,event_seq,gameplay_revision,outcome_status,next_actor_identity_id) VALUES (?,?,?,?,?,?,0,?,0,0,?,?)').run(id,at,at,at,'me','them',JSON.stringify(game),done?'p1_win':'ongoing',side==='P2'&&!retreat?'them':'me');};
 add('waiting','2026-05-01','P2');add('b','2026-01-01');add('a','2026-01-01');add('retreat','2026-02-01','P2',true);add('finished','2026-06-01','P1',false,true);
 const env={DB:{prepare:q=>({bind:(...args)=>({all:async()=>({results:sql.prepare(q).all(...args)}),first:async()=>sql.prepare(q).get(...args)})})}};
 try{const params={identityId:'me',section:'my',debug:false,page:0,pageSize:1};assert.equal(await countHomeSectionGames(env,params),4);const ids=[];for(let page=0;page<4;page++)ids.push((await listHomeSectionGameProjectionPage(env,{...params,page}))[0].id);assert.deepEqual(ids,['retreat','a','b','waiting']);assert.equal(await countHomeSectionGames(env,{...params,section:'other'}),0);assert.equal(await countHomeSectionGames(env,{...params,section:'completed'}),1);}finally{sql.close();}
});

test('account home separates legacy and completed games without losing them',async()=>{
 const sql=makeDb();
 for(const [id,mode,done] of [['active','account_v1',false],['finished','account_v1',true],['legacy','legacy_guest',false]]){
  const game=createInitialGame({gameId:id,identityId:'me',selfPlayMode:false});if(done)game.board.state.outcome={status:'p1_win',reason:'commander_unsupplied'};
  sql.prepare('INSERT INTO live_games(game_id,created_at,updated_at,latest_activity_at,player1_identity_id,player2_identity_id,has_smoke_identity,state_json,event_seq,gameplay_revision,ownership_mode,outcome_status,next_actor_identity_id) VALUES (?,?,?,?,?,?,0,?,0,0,?,?,?)').run(id,'2026-10-04','2026-10-04','2026-10-04','me','them',JSON.stringify(game),mode,done?'p1_win':'ongoing','me');
 }
 const env={AUTH_ENABLED:'true',DB:{prepare:q=>({bind:(...args)=>({all:async()=>({results:sql.prepare(q).all(...args)}),first:async()=>sql.prepare(q).get(...args)})})}};
 try{const params={identityId:'me',section:'my',debug:false,page:0,pageSize:10};assert.equal(await countHomeSectionGames(env,params),1);assert.deepEqual((await listHomeSectionGameProjectionPage(env,params)).map(g=>g.id),['active']);assert.equal(await countHomeSectionGames(env,{...params,section:'other'}),1);assert.deepEqual((await listHomeSectionGameProjectionPage(env,{...params,section:'other'})).map(g=>g.id),['legacy']);assert.deepEqual((await listHomeSectionGameProjectionPage(env,{...params,section:'completed'})).map(g=>g.id),['finished']);}finally{sql.close();}
});

function makeDb(){const sql=new DatabaseSync(':memory:');const dir=new URL('../../../db/migrations/',import.meta.url);for(const file of readdirSync(dir).filter(n=>n.endsWith('.sql')).sort())sql.exec(readFileSync(new URL(file,dir),'utf8'));return sql;}


test('SQLite classifies only recognized owned outcomes before completed counts and page slices',async()=>{
 const sql=makeDb();
 const entries=[['red','me','p1_win'],['blue','me','p2_win'],['draw','me','draw'],['unknown','me','future_result'],['live','me','ongoing'],['watched','elsewhere','p1_win']];
 for(const [index,[id,owner,status]] of entries.entries()){
  const game=createInitialGame({gameId:id,identityId:owner,selfPlayMode:false});game.board.state.outcome={status};
  const at=`2026-10-30T12:00:0${index}.000Z`;
  sql.prepare('INSERT INTO live_games(game_id,created_at,updated_at,latest_activity_at,player1_identity_id,has_smoke_identity,state_json,event_seq,gameplay_revision,outcome_status) VALUES (?,?,?,?,?,0,?,8,3,?)').run(id,at,at,at,owner,JSON.stringify({...game,moveCount:74,moves:[]}),status);
 }
 const env={DB:{prepare:q=>({bind:(...args)=>({all:async()=>({results:sql.prepare(q).all(...args)}),first:async()=>sql.prepare(q).get(...args)})})}};
 try{
  const params={identityId:'me',section:'completed',debug:false,page:0,pageSize:2};
  assert.equal(await countHomeSectionGames(env,params),3);
  const first=(await listHomeSectionStaticGameCardPage(env,params)).games;
  assert.deepEqual(first.map(card=>card.id),['draw','blue']);
  assert.deepEqual(first.map(card=>[card.moveCount,card.eventSeq,card.gameplayRevision]),[[74,8,3],[74,8,3]]);
  assert.deepEqual((await listHomeSectionGameProjectionPage(env,{...params,page:1})).map(card=>card.id),['red']);
  assert.deepEqual((await listHomeSectionGameProjectionPage(env,{...params,section:'other'})).map(card=>card.id),['watched','unknown']);
  assert.deepEqual((await listHomeSectionGameProjectionPage(env,{...params,section:'my'})).map(card=>card.id),['live']);
 }finally{sql.close();}
});
