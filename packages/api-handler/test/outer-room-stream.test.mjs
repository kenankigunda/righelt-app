import test from "node:test";
import assert from "node:assert/strict";
import { handleApiRequest } from "../src/index.ts";
import { createFakeD1 } from "./support/fake-d1.mjs";

// The outer Worker has a much smaller CPU budget than a game room. Reading or
// reserializing the room's large JSON here used to exhaust it on ordinary reads.
for (const operation of [null, "computer-control", "decision-attempts", "apply", "shared", "reconcile", "legal", "piece-moves", "join"]) {
  test(`outer API streams ${operation ?? "game read"} without decoding history`, async () => {
    const DB = createFakeD1();
    const originalPrepare = DB.prepare.bind(DB);
    DB.prepare = sql => {
      assert.ok(!/FROM (live_games|game_payloads)/i.test(sql), "outer API must not load a game projection");
      return originalPrepare(sql);
    };
    const text = JSON.stringify({ok:true,game:{id:"large",moves:[{payload:"x".repeat(1_600_000)}]}});
    let forwarded;
    const env = {DB, GAME_ROOMS:{idFromName:name=>name,get:()=>({fetch:async request=>{
      forwarded=request;
      const response=new Response(text,{headers:{"content-type":"application/json","cache-control":"no-store"}});
      response.json=async()=>{throw Error("outer JSON decoding is forbidden");};
      return response;
    }})}};
    const response=await handleApiRequest(new Request(`https://example.test/api/shell/games/large${operation?`/${operation}`:"?identityId=me"}`,operation?{
      method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({identityId:"me",protocolVersion:2})
    }:{}),env);
    assert.equal(response.status,200);
    assert.equal(await response.text(),text);
    assert.equal(response.headers.get("cache-control"),"no-store");
    assert.ok(response.headers.get("X-Righelt-Request-Id"));
    assert.equal(new URL(forwarded.url).pathname,operation?`/${operation}`:"/snapshot");
    assert.equal(forwarded.method,operation?"POST":"GET");
  });
}

test("outer API discards a room reply when cutover policy changes while awaiting it",async()=>{
  const DB=createFakeD1(); const prepare=DB.prepare.bind(DB);let maintenance=0,cancelled=false;
  DB.prepare=sql=> sql.includes("FROM account_cutover")?{first:async()=>({activated_at:null,maintenance,canary_account_id:null})}:prepare(sql);
  const env={DB,GAME_ROOMS:{idFromName:name=>name,get:()=>({fetch:async()=>{
    maintenance=1;
    return new Response(new ReadableStream({cancel(){cancelled=true;}}),{headers:{"content-type":"application/json"}});
  }})}};
  const response=await handleApiRequest(new Request("https://example.test/api/shell/games/large?identityId=me"),env);
  assert.equal(response.status,503);
  assert.equal((await response.json()).error,"temporarily_unavailable");
  assert.equal(cancelled,true,"unusable large replies must release their stream");
});
