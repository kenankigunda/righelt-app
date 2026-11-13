import test from 'node:test';
import assert from 'node:assert/strict';
import {createRecoveryEpisodeClock,RECOVERY_ACTIVE_BOUNDARIES_MS} from '../shell/recovery-episode-clock.js';

const fixture = () => {
  let now = 0, nextId = 0;
  const timers = new Map(), boundaries = [], failures = [];
  const clock = createRecoveryEpisodeClock({
    clock: () => now,
    setTimer: (callback, delay) => {const id=++nextId;timers.set(id,{callback,at:now+delay});return id;},
    clearTimer: id => timers.delete(id),
    onBoundary: event => boundaries.push(event),
    onFailure: event => failures.push(event),
  });
  const advance = milliseconds => {
    const target = now + milliseconds;
    while (true) {
      const due = [...timers].filter(([,value]) => value.at <= target).sort((a,b) => a[1].at-b[1].at || a[0]-b[0])[0];
      if (!due) break;
      const [id,value] = due;timers.delete(id);now=value.at;value.callback();
    }
    now=target;
  };
  return {clock,timers,boundaries,failures,advance};
};

test('same episode counts only active visible non-History time and fails once at exactly 60 seconds',()=>{
 const f=fixture(),scope={gameId:'g',episodeId:'episode-1'};
 f.clock.update({...scope,active:true,visible:true});f.advance(4_000);
 assert.deepEqual(f.boundaries.map(event=>event.boundaryMs),[4_000]);
 f.advance(1_000);f.clock.update({...scope,active:true,visible:true,history:true});f.advance(90_000);
 assert.equal(f.clock.snapshot().activeMs,5_000);assert.equal(f.timers.size,0);
 f.clock.update({...scope,active:true,visible:true});f.advance(9_999);assert.deepEqual(f.boundaries.map(event=>event.boundaryMs),[4_000]);
 f.clock.update({...scope,active:false,visible:true});f.advance(5_000);assert.equal(f.clock.snapshot().activeMs,14_999);
 f.clock.update({...scope,active:true,visible:true});f.advance(1);
 assert.deepEqual(f.boundaries.map(event=>event.boundaryMs),[4_000,15_000]);
 f.advance(20_000);f.clock.update({...scope,active:true,visible:false});f.advance(20_000);
 assert.equal(f.clock.snapshot().activeMs,35_000);assert.equal(f.failures.length,0);
 f.clock.update({...scope,active:true,visible:true});f.advance(24_999);assert.equal(f.failures.length,0);
 f.advance(1);
 assert.deepEqual(f.boundaries.map(event=>event.boundaryMs),RECOVERY_ACTIVE_BOUNDARIES_MS);
 assert.deepEqual(f.failures,[{...scope,activeMs:60_000,boundaryMs:60_000}]);
 assert.deepEqual(f.clock.snapshot(),{...scope,activeMs:60_000,running:false,terminal:true});
 f.advance(120_000);f.clock.update({...scope,active:true,visible:true});assert.equal(f.failures.length,1);assert.equal(f.timers.size,0);
});

test('episode replacement, matching resolution and manual reset discard accumulated time and stale timers',()=>{
 const f=fixture(),first={gameId:'g',episodeId:'first'},second={gameId:'g',episodeId:'second'};
 f.clock.update({...first,active:true,visible:true});f.advance(10_000);
 assert.deepEqual(f.boundaries,[{...first,activeMs:4_000,boundaryMs:4_000}]);
 assert.deepEqual(f.clock.update({...second,active:true,visible:true}),{...second,activeMs:0,running:true,terminal:false});
 f.clock.resolve(first);f.advance(4_000);assert.deepEqual(f.boundaries.at(-1),{...second,activeMs:4_000,boundaryMs:4_000});
 assert.deepEqual(f.clock.resolve(second),{gameId:null,episodeId:null,activeMs:0,running:false,terminal:false});
 f.advance(60_000);assert.equal(f.failures.length,0);assert.equal(f.timers.size,0);
 f.clock.update({gameId:'other',episodeId:'third',active:true,visible:true});f.advance(3_000);f.clock.reset();f.advance(60_000);
 assert.deepEqual(f.clock.snapshot(),{gameId:null,episodeId:null,activeMs:0,running:false,terminal:false});assert.equal(f.failures.length,0);
});

test('inactive, hidden and History-only episodes never start the active-visible clock',()=>{
 const f=fixture(),scope={gameId:'g',episodeId:'quiet'};
 for(const state of [{active:false,visible:true},{active:true,visible:false},{active:true,visible:true,history:true}]){
  f.clock.update({...scope,...state});f.advance(60_000);
 }
 assert.equal(f.clock.snapshot().activeMs,0);assert.equal(f.timers.size,0);assert.deepEqual(f.boundaries,[]);assert.deepEqual(f.failures,[]);
});
