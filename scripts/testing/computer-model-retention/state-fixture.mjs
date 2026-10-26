import assert from 'node:assert/strict';
import {readFile,readdir,lstat,mkdir,cp,open} from 'node:fs/promises';
import path from 'node:path';
import {sha} from './manifest.mjs';
export async function writePrivate(file,value) {
 const stream=await open(file,'wx',0o600);try{await stream.writeFile(JSON.stringify(value,null,2)+'\n');await stream.sync();}finally{await stream.close();}
 const dir=await open(path.dirname(file),'r');try{await dir.sync();}finally{await dir.close();}
}
export async function inventory(root) {
 const files={};async function walk(dir,relative=''){
  assert.equal((await lstat(dir)).isSymbolicLink(),false);
  for(const item of await readdir(dir,{withFileTypes:true})){
   const rel=path.join(relative,item.name),file=path.join(dir,item.name);assert.equal(item.isSymbolicLink(),false,'No linked private state');
   if(item.isDirectory())await walk(file,rel);else{assert.equal(item.isFile(),true);const bytes=await readFile(file);files[rel]={sha256:sha(bytes),bytes:bytes.length};}
  }
 }await walk(root);assert.ok(Object.keys(files).length);return Object.fromEntries(Object.entries(files).sort(([a],[b])=>a.localeCompare(b)));
}
export function validateSnapshot(s) {
 assert.equal(s.kind,'actual-old026-computer-retention-v1');assert.ok(s.account?.id&&s.sessionContextId&&s.gameId);
 assert.equal(s.gameId,s.history.gameId);assert.equal(s.modelId,'initial-1554');assert.ok(s.ownerId&&s.ownerId===s.computer?.ownerId&&s.ownerId===s.account.id);
 assert.ok(Array.isArray(s.storage.cookies)&&s.storage.cookies.length&&Array.isArray(s.storage.origins));assert.ok(s.sessionStorage&&typeof s.sessionStorage==='object');
 assert.ok(s.history.moves.length&&s.history.turns.length);const ids=s.history.moves.map(move=>move.moveId);assert.ok(ids.every(id=>typeof id==='string'&&id));assert.equal(new Set(ids).size,ids.length);
 assert.ok(s.acceptedDecision?.moveId&&s.acceptedDecision.computerProof?.modelId===s.modelId);assert.ok(ids.includes(s.acceptedDecision.moveId));
 assert.equal(s.attempt.result.status,'ready');assert.deepEqual(s.attempt.result.action,s.acceptedDecision.action);assert.ok(s.archive.items.some(item=>item.id===s.acceptedDecision.moveId));
 assert.deepEqual(s.pendingCommands,[],'Never omit/reconstruct original pending intent');return s;
}
export function assertHistoryPrefix(game,snapshot) {
 assert.equal(game.id,snapshot.gameId);assert.equal(game.computer.modelId,snapshot.modelId);assert.equal(game.computer.ownerId,snapshot.ownerId);
 assert.deepEqual(game.moves.slice(0,snapshot.history.moves.length),snapshot.history.moves);
 // Turns may append to a previously open turn. Original completed turns must remain byte-identical.
 for(const old of snapshot.history.turns.filter(turn=>turn.completedAt||turn.endedAt))assert.deepEqual(game.turns.find(turn=>turn.index===old.index),old);
}
export async function copyStoppedState({source,destination,assertStopped}) {
 assert.ok(path.isAbsolute(source)&&path.isAbsolute(destination)&&source!==destination);assert.ok(!destination.startsWith(source+path.sep)&&!source.startsWith(destination+path.sep));
 await assertStopped();const before=await inventory(source);assert.ok(before['hmac-v1.key'],'Retain the exact auth HMAC');assert.ok(Object.keys(before).some(key=>/^state\/v3\/d1\/.+\.sqlite$/.test(key)),'Real local account DB required');
 await mkdir(destination,{mode:0o700});await cp(source,destination,{recursive:true,errorOnExist:true,force:false});
 assert.deepEqual(await inventory(source),before,'Source changed during stopped copy');assert.deepEqual(await inventory(destination),before,'Private state copy differs');await assertStopped();return before;
}
