import test from "node:test";
import assert from "node:assert/strict";
import { createAccountController } from "../shell/account-controller.js";
import { createLiveTransportStore } from "../shell/live-transport.js";
import { STORAGE_GENERATION_HEADER } from "../generated/packages/shared-types/src/storage-policy.js";

for(const status of [500,503,200])test(`headerless HTTP ${status} is not evidence of a storage reset`,async()=>{
 const transport=createLiveTransportStore({storage:{getItem:()=>"actor",setItem(){}},auth:{enabled:false,storageGeneration:"current"},commandJournal:{list:async()=>[],close:async()=>{}},fetcher:async()=>Response.json(status===200?{ok:true}:{ok:false,error:"temporarily_unavailable"},{status})});
 try{await assert.rejects(transport.loadGame("g"),error=>error.code===(status===200?"storage_generation_unverified":"temporarily_unavailable"));assert.equal(transport.getGameViewModel("g"),null);}
 finally{transport.retire();}
});

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

test("account actions observe a reset while the user is outside a game",async()=>{
 let serverGeneration="first";
 const client=createAccountController({storage:null,eventTarget:null,document:null,channelFactory:null,fetcher:async(path)=>Response.json(path==="/api/shell/bootstrap"?{ok:true,authProtocolVersion:2,accountsRequired:true,accountsAvailable:true,storageGeneration:serverGeneration}:path==="/api/auth/session"?{ok:true,authenticated:false}:{ok:false,error:"storage_reset"},{status:path==="/api/auth/login"?409:200,headers:{[STORAGE_GENERATION_HEADER]:serverGeneration}})});
 try{
  await client.start();serverGeneration="second";
  await assert.rejects(client.act("login",{username:"actor",password:"synthetic"}),/storage_reset/);
  assert.equal(client.snapshot().storageGeneration,"second");
 }finally{client.destroy();}
});

for (const authenticated of [false,true]) test(`initial account bootstrap publishes its storage basis (${authenticated ? "returning account" : "signed out"})`,async()=>{
 const transitions=[];
 const session=authenticated?{authenticated:true,account:{id:"actor",username:"actor"},contextId:"context",expiresAt:Date.now()+60000}:{authenticated:false};
 const client=createAccountController({storage:null,eventTarget:null,document:null,channelFactory:null,onTransition:next=>transitions.push(next),fetcher:async path=>Response.json(path==="/api/shell/bootstrap"?{ok:true,authProtocolVersion:2,accountsRequired:true,accountsAvailable:true,storageGeneration:"current-storage"}:{ok:true,...session},{headers:{[STORAGE_GENERATION_HEADER]:"current-storage"}})});
 try{
  await client.start();
  assert.equal(client.snapshot().ready,true);
  assert.equal(transitions.length,1,"a transport must receive the discovered storage generation exactly once");
  assert.equal(transitions[0].storageGeneration,"current-storage");
  assert.equal(transitions[0].session.authenticated,authenticated);
  await client.start();
  assert.equal(transitions.length,1,"unchanged bootstrap must not retire the current transport");
 }finally{client.destroy();}
});

test("failed session hydration still publishes the discovered storage basis on retry",async()=>{
 let failSession=true;const transitions=[];
 const client=createAccountController({storage:null,eventTarget:null,document:null,channelFactory:null,onTransition:next=>transitions.push(next),fetcher:async path=>{
  if(path==="/api/auth/session" && failSession)throw Error("offline");
  return Response.json(path==="/api/shell/bootstrap"?{ok:true,authProtocolVersion:2,accountsRequired:true,storageGeneration:"discovered"}:{ok:true,authenticated:false},{headers:{[STORAGE_GENERATION_HEADER]:"discovered"}});
 }});
 try{
  await assert.rejects(client.start(),/offline/);assert.equal(transitions.length,0);
  failSession=false;await client.start();
  assert.equal(client.snapshot().ready,true);assert.equal(transitions.length,1);assert.equal(transitions[0].storageGeneration,"discovered");
 }finally{client.destroy();}
});

test("refreshing storage within the same authenticated context preserves expiry reconciliation",async()=>{
 let basis="first",expired=false;
 const session={authenticated:true,account:{id:"actor",username:"actor"},contextId:"same-context",expiresAt:Date.now()+50};
 const transitions=[];
 const client=createAccountController({storage:null,eventTarget:null,document:null,channelFactory:null,onTransition:next=>transitions.push(next),fetcher:async path=>Response.json(path==="/api/shell/bootstrap"?{ok:true,authProtocolVersion:2,accountsRequired:true,storageGeneration:basis}:{ok:true,...(expired?{authenticated:false}:session)},{headers:{[STORAGE_GENERATION_HEADER]:basis}})});
 try{
  await client.start();basis="second";await client.start();
  assert.equal(transitions.length,2);assert.equal(transitions[1].session.contextId,"same-context");
  expired=true;await new Promise(resolve=>setTimeout(resolve,1100));
  assert.equal(client.snapshot().session.authenticated,false,"expiry must still recheck and retire the authenticated context");
 }finally{client.destroy();}
});
