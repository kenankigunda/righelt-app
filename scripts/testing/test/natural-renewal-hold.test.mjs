import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {createNaturalRenewalLeaseObserver} from '../../../e2e/support/natural-renewal-hold.mjs';
class Page extends EventEmitter {
  frame={};
  mainFrame(){return this.frame;}
  url(){return 'http://127.0.0.1:9888/#/game/owned';}
}
class Socket extends EventEmitter {
  constructor(origin='ws://127.0.0.1:9887'){super();this.origin=origin;}
  url(){return `${this.origin}/api/shell/games/owned/ws?identityId=owner&sessionId=actual-session&protocolVersion=2`;}
}
function fixture(remaining=2701){
  let now=1794145116432;const page=new Page(),socket=new Socket();
  const observer=createNaturalRenewalLeaseObserver(page,{minimumRemainingMs:5000,maximumRemainingMs:15000,clock:()=>now});
  page.emit('websocket',socket);
  const game={id:'owned',gameplayRevision:2,computer:{ownerId:'owner',generation:1,lease:{deviceId:'device',authContextId:'',expiresAt:now+remaining}}};
  observer.bind(game);
  const command={clientCommandId:'v2:one',fingerprint:'exact-fingerprint',gameId:'owned',identityId:'owner',kind:'shared',expectedGameplayRevision:2,
    payload:{operation:'computer-control',values:{identityId:'owner',action:'renew',generation:1,deviceId:'device'}}};
  const request={frame:()=>page.mainFrame(),method:()=> 'POST',url:()=> 'http://127.0.0.1:9888/api/shell/games/owned/shared'},emit=(value=game,eventSeq=10)=>socket.emit('framereceived',{payload:JSON.stringify({type:'event_appended',eventSeq,game:value})});
  return {page,socket,observer,game,command,request,emit,now:()=>now,advance:ms=>{now+=ms;}};
}
test('actual old2701ms premise is passed through; a later natural same-generation renewal has source-derived margin',()=>{
 const h=fixture();const original=structuredClone(h.command);
 assert.equal(h.observer.eligible(h.request,h.command),false);
 h.game.computer.lease.expiresAt=h.now()+15000;h.emit(); // Existing accepted server frame, no helper request.
 h.advance(5000);const next={...h.command,clientCommandId:'v2:natural-next',fingerprint:'next-exact'};
 assert.equal(h.observer.eligible(h.request,next),true);
 h.advance(2836);assert.equal(h.observer.remainingAtRelease(next),7164);
 assert.deepEqual(h.command,original);assert.equal(h.observer.snapshot().candidates[0].remainingMs,2701);
 assert.equal(h.observer.eligible(h.request,{...next,clientCommandId:'v2:duplicate'}),false,'one selected command only');
 h.observer.dispose();
});
test('same message cannot borrow another page, game, owner, device, generation, auth scope or gameplay revision',()=>{
 for(const mutation of [c=>c.gameId='other',c=>c.identityId='other',c=>c.payload.values.identityId='other',c=>c.payload.values.deviceId='other',c=>c.payload.values.generation=2,c=>c.authContextId='other',c=>c.expectedGameplayRevision=3]){
  const h=fixture(10000),c=structuredClone(h.command);mutation(c);assert.equal(h.observer.eligible(h.request,c),false);h.observer.dispose();
 }
 const h=fixture(10000);assert.equal(h.observer.eligible({...h.request,frame:()=>({})},h.command),false);
 for(const wrong of [{url:()=> 'https://foreign.invalid/api/shell/games/owned/shared'},{url:()=> 'http://127.0.0.1:9888/api/shell/games/other/shared'},{url:()=> 'http://127.0.0.1:9888/api/shell/games/owned/apply'},{method:()=> 'GET'}])assert.equal(h.observer.eligible({...h.request,...wrong},h.command),false);
 h.observer.dispose();
});
test('foreign socket cannot extend the actual lease; stale frames cannot erase newer observed authority',()=>{
 const h=fixture();const foreign=new Socket('ws://foreign.invalid');h.page.emit('websocket',foreign);
 const fresh=structuredClone(h.game);fresh.computer.lease.expiresAt=h.now()+15000;
 foreign.emit('framereceived',{payload:JSON.stringify({eventSeq:99,game:fresh})});assert.equal(h.observer.eligible(h.request,h.command),false);
 fresh.computer.generation=2;h.emit(fresh,11);h.emit(h.game,10);
 assert.equal(h.observer.eligible(h.request,h.command),false);h.observer.dispose();
});
test('capture never launders actual hold expiry or permits a different selected command',()=>{
 const h=fixture(10000);assert.equal(h.observer.eligible(h.request,h.command),true);
 h.advance(10001);assert.equal(h.observer.remainingAtRelease(h.command),-1);
 assert.throws(()=>h.observer.remainingAtRelease({...h.command,fingerprint:'foreign'}),/Exact selected/);
 h.observer.dispose();
});
test('navigation, malformed own frames and bounded observation loss refuse; disposal removes only owned listeners',()=>{
 const h=fixture(10000);h.page.emit('framenavigated',h.page.mainFrame());assert.equal(h.observer.eligible(h.request,h.command),false);h.observer.dispose();
 assert.equal(h.page.listenerCount('websocket'),0);assert.equal(h.socket.listenerCount('framereceived'),0);
 const bad=fixture(10000);bad.socket.emit('framereceived',{payload:'not-json'});assert.equal(bad.observer.eligible(bad.request,bad.command),false);bad.observer.dispose();
 const bounded=fixture();for(let i=0;i<65;i++)bounded.observer.eligible(bounded.request,bounded.command);
 assert.equal(bounded.observer.snapshot().candidates.length,64);assert.equal(bounded.observer.snapshot().incomplete,true);bounded.observer.dispose();
});
