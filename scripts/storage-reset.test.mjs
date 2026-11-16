import test from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync,rmSync,readFileSync,writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import path from "node:path";
import {parseResetArgs,runStorageReset,bindingConfig,recoverySocketSnapshot,verifyRecoveryHistory} from "./storage-reset.mjs";

test("reset mutations require explicit targets, private receipt and apply mode",()=>{
  assert.throws(()=>parseResetArgs(["prepare","--old","a","--new","a","--receipt","/tmp/r"]),/distinct/);
  assert.throws(()=>parseResetArgs(["retire","--old","a","--new","b","--receipt","/tmp/r"]),/apply/);
  assert.throws(()=>parseResetArgs(["report","--old","a","--new","b"]),/receipt/);
  assert.throws(()=>parseResetArgs(["verify","--old","a","--new","b","--receipt","/tmp/r","--origin","https://test/path"]),/origin/);
  assert.equal(parseResetArgs(["report","--old","a","--new","b","--receipt","/tmp/r"]).apply,false);
  assert.throws(()=>bindingConfig('',"safe","bad"),/ID/);
});

test("preparation resumes after migration failure without creating another database",async()=>{
  const dir=mkdtempSync(path.join(tmpdir(),"righelt-reset-test-"));
  const options=parseResetArgs(["prepare","--old","old-db","--new","new-db","--receipt",path.join(dir,"receipt.json"),"--apply"]);
  let creates=0,fail=true;
  const run=args=>{
    if(args[1]==="list")return JSON.stringify([{name:"old-db",uuid:"11111111-1111-1111-1111-111111111111"}]);
    if(args[1]==="create"){creates++;return 'database_id = "22222222-2222-2222-2222-222222222222"';}
    if(args[1]==="migrations"&&fail){fail=false;throw Error("migration_failure");}
    if(args[1]==="execute")return JSON.stringify([{results:[],success:true}]);
    return "";
  };
  try{
    await assert.rejects(runStorageReset(options,{run}),/migration_failure/);
    assert.equal(JSON.parse(readFileSync(options.receipt,"utf8")).prepared,undefined);
    const result=await runStorageReset(options,{run});
    assert.equal(result.prepared,true);assert.equal(creates,1);
    assert.equal((await runStorageReset(options,{run})).newId,result.newId);assert.equal(creates,1);
  }finally{rmSync(dir,{recursive:true,force:true});}
});

test("read-only verification cannot authorize retirement",async()=>{
  const dir=mkdtempSync(path.join(tmpdir(),"righelt-reset-verify-")),receipt=path.join(dir,"receipt.json");
  const metadata={version:1,oldName:"old",newName:"new",newId:"22222222-2222-2222-2222-222222222222",prepared:true,generation:"generation",fenced:true,verified:false};
  writeFileSync(receipt,JSON.stringify(metadata));
  const options=parseResetArgs(["verify","--old","old","--new","new","--receipt",receipt,"--origin","https://test"]);
  const fetcher=async()=>Response.json({ok:true,storageGeneration:"generation",maintenance:false});
  const run=args=>{if(args[1]==="delete")throw Error("deletion_must_not_happen");return JSON.stringify([{results:[{activated_at:null,maintenance:1}]}]);};
  try{
    assert.equal((await runStorageReset(options,{fetcher,run})).verified,false);
    assert.equal(JSON.parse(readFileSync(receipt,"utf8")).verified,false);
    await assert.rejects(runStorageReset({...options,action:"retire",apply:true},{fetcher,run}),/Verify new production/);
  }finally{rmSync(dir,{recursive:true,force:true});}
});

test("production reconnect canary validates snapshot generation and closes its sockets",async()=>{
 let closed=0,requested;
 const socketFactory=url=>{
  requested=new URL(url);const socket=new EventTarget();socket.close=()=>closed++;
  queueMicrotask(()=>socket.dispatchEvent(new MessageEvent("message",{data:JSON.stringify({storageGeneration:"new",gameId:"g",eventSeq:3,game:{moves:[{}]}})})));
  return socket;
 };
 assert.equal((await recoverySocketSnapshot({origin:"https://test",gameId:"g",identityId:"actor",generation:"new",socketFactory})).eventSeq,3);
 assert.equal(requested.protocol,"wss:");assert.equal(requested.searchParams.get("storageGeneration"),"new");assert.equal(closed,1);
 await assert.rejects(recoverySocketSnapshot({origin:"https://test",gameId:"g",identityId:"actor",generation:"old",socketFactory}),/generation/);assert.equal(closed,2);
});

test("binding preparation fences direct deployment paths as well as the workflow",()=>{
 const source='[vars]\ndatabase_name = "old"\ndatabase_id = "11111111-1111-1111-1111-111111111111"';
 const bound=bindingConfig(source,"new","22222222-2222-2222-2222-222222222222","reset-test");
 assert.match(bound,/STORAGE_GENERATION = "reset-test"/);
 assert.match(bound,/database_name = "new"/);
 const rebound=bindingConfig(bound,"new","22222222-2222-2222-2222-222222222222","reset-other");
 assert.match(rebound,/STORAGE_GENERATION = "reset-other"/);assert.equal((rebound.match(/STORAGE_GENERATION/g)||[]).length,1);
});


test("recovery history reads durable decisions without writing a viewing preference",async()=>{
 const board={pieces:[{id:"red-1",x:2,y:3}],sideToMove:"P2",turnIndex:1};
 const loaded={eventSeq:2,game:{gameplayRevision:1,board:{state:board},moves:[{moveId:"move-1",clientCommandId:"v2:accepted"}]}};
 const initialState={pieces:[],sideToMove:"P1"};
 const history={items:[{id:"initial",kind:"initial",state:{pieces:[],sideToMove:"P1"}},{id:"move-1",kind:"decision",move:{moveId:"move-1",clientCommandId:"v2:accepted",snapshot:structuredClone(board)}}]};
 const calls=[];
 await verifyRecoveryHistory({gameId:"owned-game",identityId:"owned actor",loaded,initialState,request:async(route,body)=>{calls.push({route,body});return route.endsWith("/decision-history")?history:structuredClone(loaded);}});
 assert.deepEqual(calls,[{route:"/api/shell/games/owned-game/decision-history",body:{identityId:"owned actor",protocolVersion:2}},{route:"/api/shell/games/owned-game?identityId=owned%20actor",body:undefined}]);
 for(const defect of ["missing-initial","corrupt-initial","missing-decision","wrong-command","changed-snapshot","changed-event","changed-revision","changed-live-board"]){
  const archived=structuredClone(history),live=structuredClone(loaded);
  if(defect==="missing-initial")archived.items.shift();
  if(defect==="corrupt-initial")archived.items[0].state={corrupt:true};
  if(defect==="missing-decision")archived.items.pop();
  if(defect==="wrong-command")archived.items[1].move.clientCommandId="v2:other";
  if(defect==="changed-snapshot")archived.items[1].move.snapshot.pieces[0].x=9;
  if(defect==="changed-event")live.eventSeq=3;
  if(defect==="changed-revision")live.game.gameplayRevision=2;
  if(defect==="changed-live-board")live.game.board.state.pieces[0].x=9;
  await assert.rejects(verifyRecoveryHistory({gameId:"owned-game",identityId:"owned actor",loaded,initialState,request:async route=>route.endsWith("/decision-history")?archived:live}),/Recovery canary/,defect);
 }
});
