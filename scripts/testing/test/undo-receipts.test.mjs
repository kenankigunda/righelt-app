import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {observeUndoReceipts} from '../../../e2e/support/undo-receipts.mjs';
const command={gameId:'game-1',identityId:'owner-1',clientCommandId:'command-1',fingerprint:'fingerprint-1'};
const receipt={...command,outcome:'accepted',eventSeq:12,gameplayRevision:3};
function fixture(){
 const page=new EventEmitter();page.url=()=> 'https://127.0.0.1:9988/';
 const observer=observeUndoReceipts(page),socket=new EventEmitter();socket.url=()=> 'wss://127.0.0.1:9988/api/shell/games/game-1/ws';
 return{page,observer,socket,open(){page.emit('websocket',socket);},frame(outcome=receipt,extra={}){socket.emit('framereceived',{payload:JSON.stringify({game:{id:'game-1',gameplayRevision:3},eventSeq:12,commandOutcome:outcome,...extra})});}};
}
test('original accepted socket outcome is joined to the exact command, not inferred from absence',()=>{
 const f=fixture();assert.equal(f.observer.find(command),undefined);f.open();f.frame();assert.deepEqual(f.observer.find(command),receipt);assert.equal(JSON.parse(f.observer.originals()[0].raw).commandOutcome.eventSeq,12);f.observer.dispose();
});
for(const [field,value]of [['gameId','foreign-game'],['identityId','foreign-owner'],['fingerprint','foreign-fingerprint'],['outcome','rejected'],['eventSeq',0],['eventSeq',Number.MAX_SAFE_INTEGER+1],['gameplayRevision',4]])test(`original socket outcome refuses mismatched ${field} ${value}`,()=>{
 const f=fixture();f.open();f.frame({...receipt,[field]:value});assert.throws(()=>f.observer.find(command),/exact command/);f.observer.dispose();
});
test('a different command cannot satisfy an Undo receipt',()=>{const f=fixture();f.open();f.frame({...receipt,clientCommandId:'other-command'});assert.equal(f.observer.find(command),undefined);f.observer.dispose();});
test('foreign socket origin and non-game socket cannot supply receipt authority',()=>{
 for(const url of ['wss://example.com/api/shell/games/game-1/ws','wss://127.0.0.1:9988/unrelated']){const f=fixture();f.socket.url=()=>url;f.open();f.frame();assert.equal(f.observer.find(command),undefined);f.observer.dispose();}
});
test('duplicate identical packets agree, but conflicting command receipts fail',()=>{const f=fixture();f.open();f.frame();f.frame();assert.deepEqual(f.observer.find(command),receipt);f.frame({...receipt,reason:'conflict'});assert.throws(()=>f.observer.find(command),/Conflicting/);f.observer.dispose();});
test('disposing the observer removes only its own listeners and cannot observe later receipts',()=>{
 const f=fixture();const foreign=()=>{};f.page.on('websocket',foreign);f.socket.on('framereceived',foreign);f.open();f.observer.dispose();f.observer.dispose();assert.deepEqual(f.page.listeners('websocket'),[foreign]);assert.deepEqual(f.socket.listeners('framereceived'),[foreign]);f.frame();assert.equal(f.observer.find(command),undefined);
});

for(const value of [0,Number.MAX_SAFE_INTEGER+1])test(`socket envelope and receipt both refuse unsafe eventSeq ${value}`,()=>{const f=fixture();f.open();f.frame({...receipt,eventSeq:value},{eventSeq:value});assert.throws(()=>f.observer.find(command),/exact command/);f.observer.dispose();});
for(const value of [-1,1.5])test(`socket game and receipt both refuse invalid revision ${value}`,()=>{const f=fixture();f.open();f.frame({...receipt,gameplayRevision:value},{game:{id:'game-1',gameplayRevision:value}});assert.throws(()=>f.observer.find(command),/exact command/);f.observer.dispose();});

test('original accepted receipt remains valid inside a newer authoritative envelope',()=>{const f=fixture();f.open();f.frame(receipt,{eventSeq:15,game:{id:'game-1',gameplayRevision:5}});assert.deepEqual(f.observer.find(command),receipt);f.observer.dispose();});
for(const value of [11,Number.MAX_SAFE_INTEGER+1,12.5])test(`socket envelope rejects behind or unsafe event sequence ${value}`,()=>{const f=fixture();f.open();f.frame(receipt,{eventSeq:value});assert.throws(()=>f.observer.find(command),/exact command/);f.observer.dispose();});
for(const value of [2,Number.MAX_SAFE_INTEGER+1,3.5])test(`socket envelope rejects behind or unsafe gameplay revision ${value}`,()=>{const f=fixture();f.open();f.frame(receipt,{game:{id:'game-1',gameplayRevision:value}});assert.throws(()=>f.observer.find(command),/exact command/);f.observer.dispose();});

test('actual receipt attachment persists original JSON before attaching and propagates both failure boundaries',async()=>{
 const {attachUndoReceiptProof}=await import('../../../e2e/support/direct-undo.mjs');
 const {mkdtemp,readFile,rm,lstat}=await import('node:fs/promises');const {tmpdir}=await import('node:os');const {join}=await import('node:path');
 const artifact='test-results/undo-receipt-attachment-control.json';await assert.rejects(lstat(artifact),{code:'ENOENT'});
 const directory=await mkdtemp(join(tmpdir(),'righelt-undo-receipt-'));
 const proof={command,receipt,attempts:[{status:null,failure:'net::ERR_ABORTED'}],socketOriginals:[{gameId:'game-1',raw:'original frame'}]};let attached=0;
 try{
  await attachUndoReceiptProof({outputPath:name=>{assert.equal(name,'undo-original-receipts.json');return artifact;},async attach(name,{path,contentType}){assert.equal(name,'undo-original-receipts');assert.equal(path,artifact);assert.equal(contentType,'application/json');assert.deepEqual(JSON.parse(await readFile('test-results/undo-receipt-attachment-control.json','utf8')),proof);attached++;}},proof);
  assert.equal(attached,1);
  await assert.rejects(attachUndoReceiptProof({outputPath:name=>join(directory,'missing',name),async attach(){attached++;}},proof),{code:'ENOENT'});assert.equal(attached,1);
  const failure=new Error('attachment rejected');await assert.rejects(attachUndoReceiptProof({outputPath:name=>join(directory,name),async attach(){throw failure;}},proof),error=>error===failure);
 }finally{await rm(artifact,{force:true});await rm(directory,{recursive:true,force:true});}
});
