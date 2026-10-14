import test from "node:test";
import assert from "node:assert/strict";
import { createAccountController } from "../shell/account-controller.js";
import { createLiveTransportStore } from "../shell/live-transport.js";
import { STORAGE_GENERATION_HEADER } from "../generated/packages/shared-types/src/storage-policy.js";

test("bootstrap fences guest requests and retires delayed previous-generation responses",async()=>{
  let observed;
  let serverGeneration="reset-one";
  const client=createAccountController({storage:null,eventTarget:null,document:null,channelFactory:null,fetcher:async(path,init)=>{
    observed=init;
    return Response.json(path==="/api/shell/bootstrap"?{ok:true,authProtocolVersion:2,accountsRequired:false,accountsAvailable:false,storageGeneration:serverGeneration}:{ok:true},{headers:{[STORAGE_GENERATION_HEADER]:serverGeneration}});
  }});
  try {
    await client.start();
    assert.equal(client.snapshot().storageGeneration,"reset-one");
    await client.fetch("/api/shell/games",{method:"POST"});
    assert.equal(observed.headers[STORAGE_GENERATION_HEADER],"reset-one");
    const before=client.snapshot().generation;
    serverGeneration="reset-two";
    await assert.rejects(client.fetch("/api/shell/games"),/storage_reset/);
    assert.ok(client.snapshot().generation>before);
    assert.equal(client.snapshot().storageGeneration,"reset-two");
  } finally { client.destroy(); }
});

test("transport rejects an old response without applying a game",async()=>{
  const journal={list:async()=>[],close:async()=>{}};
  const transport=createLiveTransportStore({storage:{getItem:()=>"actor",setItem(){}},auth:{enabled:false,storageGeneration:"new"},commandJournal:journal,fetcher:async()=>Response.json({ok:true,game:{id:"g"}},{headers:{[STORAGE_GENERATION_HEADER]:"old"}})});
  await assert.rejects(transport.loadGame("g"),/storage_reset/);
  assert.equal(transport.getGameViewModel("g"),null);
});
