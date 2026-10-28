import test from 'node:test';
import assert from 'node:assert/strict';
import {GameRoomDO} from '../src/game-room-do.ts';
import {createFakeD1} from './support/fake-d1.mjs';

test('peer close is acknowledged before queued presence cleanup can run',async()=>{
 const room=new GameRoomDO({id:{name:'g'}},{DB:createFakeD1()});let release;
 const blocked=room.enqueue(()=>new Promise(resolve=>{release=resolve;}));await new Promise(resolve=>setTimeout(resolve,0));
 let closes=0;const closing=room.webSocketClose({close(){closes++;}});
 try{assert.equal(closes,1,'Reciprocal close must not wait behind database work');}
 finally{release();await Promise.all([blocked,closing]);}
});

test('peer close is acknowledged even when later presence cleanup fails',async()=>{
 const room=new GameRoomDO({id:{name:'g'}},{DB:createFakeD1()});room.webSocketCloseQueued=async()=>{throw Error('presence database unavailable');};let closes=0;
 await assert.rejects(room.webSocketClose({close(){closes++;}}),/presence database unavailable/);
 assert.equal(closes,1);
});

for(const [received,reply] of [[1000,1000],[4001,4001],[1005,1000],[1006,1000],[1015,1000]])test(`peer close code ${received} receives a valid ${reply} reply`,async()=>{
 const room=new GameRoomDO({id:{name:'g'}},{DB:createFakeD1()});let sent;
 await room.webSocketClose({close(code){sent=code;}},received);
 assert.equal(sent,reply);
});
