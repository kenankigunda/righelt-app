import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createInitialGame} from '../src/shell-live-core.ts';
import {countHomeSectionGames,listHomeSectionGameProjectionPage} from '../src/shell-live-db.ts';
test('unfinished own decisions precede opponent decisions before pagination; finished games remain in Other games',async()=>{
 const sql=new DatabaseSync(':memory:');sql.exec(`CREATE TABLE live_games(game_id TEXT,created_at TEXT,updated_at TEXT,latest_activity_at TEXT,player1_identity_id TEXT,player2_identity_id TEXT,has_smoke_identity INTEGER,state_json TEXT,event_seq INTEGER,gameplay_revision INTEGER)`);
 const add=(id,at,side='P1',retreat=false,done=false)=>{const game=createInitialGame({gameId:id,identityId:'me',selfPlayMode:false});game.createdAt=game.updatedAt=at;game.board.state.sideToMove=side;game.turns[0].playerSeat=side==='P1'?'Player 1':'Player 2';if(retreat)game.board.state.continuation={type:'push',phase:'retreat'};if(done)game.board.state.outcome={status:'p1_win',reason:'commander_unsupplied'};sql.prepare('INSERT INTO live_games VALUES (?,?,?,?,?,?,0,?,0,0)').run(id,at,at,at,'me','them',JSON.stringify(game));};
 add('waiting','2026-05-01','P2');add('b','2026-01-01');add('a','2026-01-01');add('retreat','2026-02-01','P2',true);add('finished','2026-06-01','P1',false,true);
 const env={DB:{prepare:q=>({bind:(...args)=>({all:async()=>({results:sql.prepare(q).all(...args)}),first:async()=>sql.prepare(q).get(...args)})})}};
 try{const params={identityId:'me',section:'my',debug:false,page:0,pageSize:1};assert.equal(await countHomeSectionGames(env,params),4);const ids=[];for(let page=0;page<4;page++)ids.push((await listHomeSectionGameProjectionPage(env,{...params,page}))[0].id);assert.deepEqual(ids,['retreat','a','b','waiting']);assert.equal(await countHomeSectionGames(env,{...params,section:'other'}),1);}finally{sql.close();}
});

test('account home separates legacy and completed games without losing them',async()=>{
 const sql=new DatabaseSync(':memory:');sql.exec(`CREATE TABLE live_games(game_id TEXT,created_at TEXT,updated_at TEXT,latest_activity_at TEXT,player1_identity_id TEXT,player2_identity_id TEXT,has_smoke_identity INTEGER,state_json TEXT,event_seq INTEGER,gameplay_revision INTEGER,ownership_mode TEXT)`);
 for(const [id,mode,done] of [['active','account_v1',false],['finished','account_v1',true],['legacy','legacy_guest',false]]){
  const game=createInitialGame({gameId:id,identityId:'me',selfPlayMode:false});if(done)game.board.state.outcome={status:'p1_win',reason:'commander_unsupplied'};
  sql.prepare('INSERT INTO live_games VALUES (?,?,?,?,?,?,0,?,0,0,?)').run(id,'2026-10-04','2026-10-04','2026-10-04','me','them',JSON.stringify(game),mode);
 }
 const env={AUTH_ENABLED:'true',DB:{prepare:q=>({bind:(...args)=>({all:async()=>({results:sql.prepare(q).all(...args)}),first:async()=>sql.prepare(q).get(...args)})})}};
 try{const params={identityId:'me',section:'my',debug:false,page:0,pageSize:10};assert.equal(await countHomeSectionGames(env,params),1);assert.deepEqual((await listHomeSectionGameProjectionPage(env,params)).map(g=>g.id),['active']);assert.equal(await countHomeSectionGames(env,{...params,section:'other'}),2);}finally{sql.close();}
});
