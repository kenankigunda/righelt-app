import test from "node:test";
import assert from "node:assert/strict";
import { createIssueDiagnostics, sanitizeDiagnostic } from "../shell/issue-diagnostics.js";
import { recoveryMessage } from "../shell/recovery-view.js";
const memory = () => { const map = new Map(); return { getItem: k => map.get(k), setItem: (k,v) => map.set(k,v), removeItem: k => map.delete(k) }; };
test("diagnostic capture removes secrets and preserves reproducible board coordinates", () => {
 const value=sanitizeDiagnostic({gameId:"g",token:"secret",identityId:"private",headers:{authorization:"secret"},authoritativeState:{pieces:[{id:"piece",owner:"P1",kind:"unit",position:{row:2,col:3},identityId:"secret"}],sideToMove:"P1",turnIndex:4}});
 assert.equal(JSON.stringify(value).includes("secret"),false); assert.deepEqual(value.authoritativeState.pieces[0].position,{row:2,col:3});
});
test("episodes keep initial evidence, append attempts, survive refresh, resolve and expire", () => {
 let at=1000; const storage=memory(); const jobs=[];const options={storage,now:()=>at,schedule:f=>{jobs.push(f);return 1;}};
 const d=createIssueDiagnostics(options);const id=d.capture("recovery:g",{gameId:"g",stage:"initial"});
 d.capture("recovery:g",{stage:"retry"});assert.equal(d.get(id).initial.stage,"initial");assert.equal(d.get(id).events.length,2);jobs.shift()();
 const restored=createIssueDiagnostics(options);assert.equal(restored.get(id).id,id);restored.resolve("recovery:g");assert.ok(restored.get(id).resolvedAt);
 at+=86400001;assert.equal(restored.list().length,0);
});
test("failed diagnostic persistence never escapes and report/event limits hold", () => {
 const d=createIssueDiagnostics({storage:{getItem(){throw Error()},setItem(){throw Error()}},schedule:f=>{queueMicrotask(f);return 1;}});
 for(let i=0;i<25;i++)d.capture(`issue:${i}`,{stage:"failed"});assert.equal(d.list().length,20);
 for(let i=0;i<210;i++)d.capture("repeated",{retry:i});assert.equal(d.list().at(-1).events.length,200);
});
test("reconnect presentation waits four seconds, but actionable failures bypass it", () => {
 const g={recovering:true,pendingCommandCount:0,recoveryStartedAt:1000};
 assert.equal(recoveryMessage(g,4999),"");assert.equal(recoveryMessage(g,5000),"Reconnecting. We’ll be right back!");
 assert.equal(recoveryMessage({...g,recoveryIssue:"unavailable"},1001),"We couldn’t record your move. Please reconnect.");
 assert.match(recoveryMessage({...g,pendingCommandCount:1,confirmationOverdue:true},1001),/Hang tight!/);
});

test("push continuation diagnostics retain frozen flags and action intent without identities", () => {
 const state={boardSize:10,sideToMove:"P2",turnIndex:3,pieces:[{id:"D1",owner:"P2",kind:"unit",position:{row:4,col:2},supplied:true,commanded:false,pushed:true}],outcome:{status:"ongoing"},continuation:{type:"push",owner:"P2",attackerOwner:"P1",phase:"retreat",followPoint:{row:4,col:1},pushedPieceId:"D1",followGroupPieceIds:["A1","A2"],frozenOwner:"P2",frozenPieceStatesById:{D1:{supplied:true,commanded:false}},chainLength:1}};
 const action={type:"retreat",actorId:"D1",from:{row:4,col:2},to:{row:5,col:2}};
 const clean=sanitizeDiagnostic({authoritativeState:state,tentativeState:state,action,identityId:"secret"});
 assert.deepEqual(clean.authoritativeState,state);assert.deepEqual(clean.action,action);assert.equal(clean.identityId,undefined);
});

test("request evidence preserves the actual attempt ID through nested account transport", async () => {
 const {withRequestEvidence,latestRequestEvidence}=await import("../shell/request-evidence.js");
 const id=crypto.randomUUID();let sent;
 const fetcher=withRequestEvidence(async(_url,init)=>{sent=new Headers(init.headers).get("X-Righelt-Request-Id");return Response.json({ok:true},{headers:{"X-Righelt-Server-Build":"build"}});},"account");
 const response=await fetcher("/api/auth/login",{headers:{"X-Righelt-Request-Id":id}});
 assert.equal(sent,id);assert.equal(response.righeltDiagnosticEvidence.requestId,id);
 await fetcher("/api/shell/games/disposable");assert.equal(latestRequestEvidence("account").requestId,id);
});

test("diagnostic total event and byte budgets retain initial evidence and mark truncation", () => {
 const d=createIssueDiagnostics();let last;
 for(let i=0;i<20;i++){last=d.capture(`budget:${i}`,{operation:"initial",stage:"failed"});for(let j=0;j<20;j++)d.capture(`budget:${i}`,{stage:"retry",retry:j});}
 assert.ok(d.list().reduce((sum,r)=>sum+r.events.length,0)<=200);assert.equal(d.get(last).initial.operation,"initial");assert.ok(d.list().some(r=>r.truncated));
 for(let i=0;i<200;i++)d.capture("large",{browser:"x".repeat(2048),authoritativeState:{pieces:Array.from({length:100},(_,id)=>({id:String(id),owner:"P1",position:{row:0,col:0},kind:"unit"}))}});
 assert.ok(new TextEncoder().encode(JSON.stringify(d.list())).length<=1048576);assert.ok(d.list().at(-1).initial);assert.equal(d.list().at(-1).truncated,true);
});
