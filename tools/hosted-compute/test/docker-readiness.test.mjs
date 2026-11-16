import test from 'node:test';
import assert from 'node:assert/strict';
import {waitForDocker} from './docker-readiness.mjs';

test('a cold Docker daemon must answer a real successful query before proof can continue',async()=>{
 let now=0;const calls=[];
 const answer=await waitForDocker(async(command,args,options)=>{
  calls.push({command,args,timeout:options.timeout});now+=4000;
  if(calls.length<3)throw Error('daemon still starting');return {stdout:'28.1.1\n'};
 },{clock:()=>now,sleep:async ms=>{now+=ms;}});
 assert.equal(answer.stdout,'28.1.1\n');assert.equal(calls.length,3);assert(calls.every(c=>c.command==='docker'&&c.args.join(' ')==='info --format {{.ServerVersion}}'&&c.timeout>0&&c.timeout<=5000));
});
test('a permanently unavailable Docker daemon exhausts the finite bound and never becomes success',async()=>{
 let now=0,calls=0;const unavailable=Error('daemon unavailable');
 await assert.rejects(waitForDocker(async(_command,_args,{timeout})=>{calls++;now+=timeout;throw unavailable;},{clock:()=>now,sleep:async ms=>{now+=ms;},milliseconds:12000}),error=>error.message==='Docker daemon readiness deadline reached'&&error.cause===unavailable);
 assert.equal(now,12000);assert.equal(calls,2);
});
