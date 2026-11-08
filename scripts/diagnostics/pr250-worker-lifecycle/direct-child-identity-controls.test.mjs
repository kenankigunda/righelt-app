import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {requireDirectIdentity,signalDirectChild,captureInitialChildIdentity} from './direct-child-identity.mjs';
const saved={pid:123,startTicks:'456'};
test('signals only the exact direct creation handle after fresh identity confirmation',()=>{
 const calls=[],child={pid:123,kill:signal=>calls.push(signal)};let inspected;
 signalDirectChild(child,saved,'SIGTERM',pid=>{inspected=pid;return{...saved};});assert.equal(inspected,123);assert.deepEqual(calls,['SIGTERM']);
});
test('reused PID is never signaled or accepted as a sample root',()=>{
 let calls=0;const child={pid:123,kill:()=>calls++},inspect=()=>({pid:123,startTicks:'999'});
 assert.throws(()=>signalDirectChild(child,saved,'SIGKILL',inspect),/identity changed/);assert.throws(()=>requireDirectIdentity(saved,inspect),/identity changed/);assert.equal(calls,0);
});
test('absent or denied identity never signals the creation handle',()=>{
 let calls=0;const child={pid:123,kill:()=>calls++};for(const code of['ENOENT','EACCES'])assert.throws(()=>signalDirectChild(child,saved,'SIGTERM',()=>{throw Object.assign(Error(code),{code});}),error=>error.code===code);assert.equal(calls,0);
});
test('missing saved identity and wrong child handle refuse before inspection or signaling',()=>{
 let touched=0;const child={pid:321,kill:()=>touched++};assert.throws(()=>signalDirectChild(child,saved,'SIGTERM',()=>touched++),/creation handle mismatch/);assert.throws(()=>requireDirectIdentity(null,()=>touched++),/unavailable/);assert.equal(touched,0);
});
test('actual just-created child is stopped and reaped when initial identity capture fails, preserving primary',async()=>{
 const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'}),closed=new Promise(resolve=>child.once('close',(code,signal)=>resolve({code,signal}))),primary=Error('injected initial stat failure');let cleanup;
 child.once('error',()=>{});
 await assert.rejects(captureInitialChildIdentity(child,closed,()=>{throw primary;},value=>cleanup=value,{termMs:2000,killMs:2000}),error=>error===primary);
 assert.equal(cleanup.reaped,true);assert(cleanup.signals.some(row=>row.signal==='SIGTERM'));assert(child.exitCode!==null||child.signalCode!==null);
 console.log(JSON.stringify({control:'preidentity capture failure',pid:child.pid,cleanup}));
});
test('actual unresponsive creation child is killed then reaped with primary and timeout evidence retained',async()=>{
 const child=spawn(process.execPath,['-e',"process.on('SIGTERM',()=>{});process.send('ready');setInterval(()=>{},1000)"],{stdio:['ignore','ignore','ignore','ipc']}),closed=new Promise(resolve=>child.once('close',(code,signal)=>resolve({code,signal}))),primary=Error('injected initial capture failure');let cleanup;
 child.once('error',()=>{});
 try{
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Owned Node child readiness deadline')),2000);child.once('message',value=>{clearTimeout(timer);value==='ready'?resolve():reject(Error('Unexpected child message'));});child.once('error',error=>{clearTimeout(timer);reject(error);});});
  await assert.rejects(captureInitialChildIdentity(child,closed,()=>{throw primary;},value=>cleanup=value,{termMs:50,killMs:2000}),error=>error instanceof AggregateError&&error.errors[0]===primary);
  assert.equal(cleanup.reaped,true);assert(cleanup.signals.some(row=>row.signal==='SIGKILL'));assert(cleanup.errors.some(row=>row.phase==='term-close'));assert.equal(child.connected,false);
  console.log(JSON.stringify({control:'preidentity forced close',pid:child.pid,cleanup}));
 }finally{
  if(child.exitCode===null&&child.signalCode===null)await captureInitialChildIdentity(child,closed,()=>{throw primary;},()=>{},{termMs:50,killMs:2000}).catch(()=>{});
 }
});
