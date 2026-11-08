import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
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
function fixture(remaining=2701,{bind=true}={}){
  let now=1794145116432;const page=new Page(),socket=new Socket();
  const observer=createNaturalRenewalLeaseObserver(page,{minimumRemainingMs:5000,maximumRemainingMs:15000,clock:()=>now});
  page.emit('websocket',socket);
  const game={id:'owned',gameplayRevision:2,computer:{ownerId:'owner',generation:1,lease:{deviceId:'device',authContextId:'',expiresAt:now+remaining}}};
  if (bind) observer.bind(game);
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


test('fresh readiness requires an advanced authoritative same-page lease, not the initial projection or an equal frame',()=>{
 const h=fixture(15000);assert.equal(h.observer.freshLeaseReady(),false);
 h.emit(h.game,8);assert.equal(h.observer.freshLeaseReady(),false);
 const fresh=structuredClone(h.game);fresh.computer.lease.expiresAt+=1000;h.advance(1000);h.emit(fresh,9);
 assert.equal(h.observer.freshLeaseReady(),true);assert.equal(h.observer.snapshot().preparation.observed.observed.eventSeq,9);
 assert.equal(h.observer.snapshot().preparation.minimumRemainingMs,10000);h.observer.dispose();
});
test('fresh readiness rejects stale, foreign and changed authority even with a far future expiry',()=>{
 for(const change of [g=>g.id='foreign',g=>g.computer.ownerId='foreign',g=>g.computer.generation++,g=>g.computer.lease.deviceId='foreign',g=>g.computer.lease.authContextId='foreign',g=>g.gameplayRevision++]){
  const h=fixture(8402),fresh=structuredClone(h.game);fresh.computer.lease.expiresAt=h.now()+15000;change(fresh);h.emit(fresh,9);assert.equal(h.observer.freshLeaseReady(),false);h.observer.dispose();
 }
 const h=fixture(8402);h.emit(h.game,10);const stale=structuredClone(h.game);stale.computer.lease.expiresAt=h.now()+15000;h.emit(stale,9);assert.equal(h.observer.freshLeaseReady(),false);
 const foreign=new Socket('ws://foreign.invalid');h.page.emit('websocket',foreign);foreign.emit('framereceived',{payload:JSON.stringify({game:stale,eventSeq:11})});assert.equal(h.observer.freshLeaseReady(),false);h.observer.dispose();
});
test('authority loss cannot be undone by a stale owned snapshot; retirement and observation loss refuse readiness',()=>{
 for(const stop of [h=>h.page.emit('framenavigated',h.page.mainFrame()),h=>h.socket.emit('framereceived',{payload:'not-json'}),h=>h.socket.emit('framereceived',{payload:JSON.stringify({game:h.game,eventSeq:'invalid'})})]){
  const h=fixture(8402),fresh=structuredClone(h.game);fresh.computer.lease.expiresAt=h.now()+15000;h.emit(fresh,9);stop(h);assert.equal(h.observer.freshLeaseReady(),false);h.observer.dispose();
 }
 const h=fixture(8402),fresh=structuredClone(h.game);fresh.computer.lease.expiresAt=h.now()+15000;h.emit(fresh,9);assert.equal(h.observer.freshLeaseReady(),true);
 const lost=structuredClone(fresh);lost.computer.ownerId='foreign';h.emit(lost,10);h.emit(fresh,9);assert.equal(h.observer.freshLeaseReady(),false);assert.equal(h.observer.eligible(h.request,h.command),false);h.observer.dispose();
});
test('preparation margin is source-derived and never replaces actual capture or release guards',()=>{
 const h=fixture(8402),fresh=structuredClone(h.game);fresh.computer.lease.expiresAt=h.now()+15000;h.emit(fresh,9);h.advance(5000);assert.equal(h.observer.freshLeaseReady(),true);
 h.advance(1);assert.equal(h.observer.freshLeaseReady(),false);h.advance(5000);assert.equal(h.observer.eligible(h.request,h.command),false);
 const foreign=structuredClone(fresh);foreign.computer.generation++;foreign.computer.lease.expiresAt=h.now()+15000;h.emit(foreign,10);const command=structuredClone(h.command);command.payload.values.generation++;assert.equal(h.observer.eligible(h.request,command),false);h.observer.dispose();
});
test('the actual caller prepares a fresh lease before the original 10s hold window',async()=>{
 // This schedule comes from the original failing trace. No real timer or application clock is changed.
 const h=fixture(8402,{bind:false});h.emit(h.game,8);let elapsed=0,routeHandler;const pending=[],observed=[];
 const events=[{at:4322,request:true},{at:4436,accepted:true},{at:10436,request:true}];
 const fresh=structuredClone(h.game);fresh.computer.lease.expiresAt=h.now()+4436+15000;
 h.page.route=async(_pattern,handler)=>{routeHandler=handler;observed.push({armedAt:elapsed,prepared:h.observer.snapshot().preparation.observed});};
 const expect={poll:callback=>({toBe:async expected=>{
  const deadline=elapsed+10000;
  while(callback()!==expected){const event=events[0];assert(event&&event.at<=deadline,'No eligible renewal within the original 10s capture window');events.shift();h.advance(event.at-elapsed);elapsed=event.at;
   if(event.accepted)h.emit(fresh,9);
   if(event.request&&routeHandler){const command=structuredClone(h.command);command.clientCommandId+=':'+event.at;command.fingerprint+=':'+event.at;const request={...h.request,postDataJSON:()=>command,headers:()=>({'content-type':'application/json'})};const work=routeHandler({request:()=>request,continue:async()=>{}});work.catch(()=>{});pending.push(work);}
  }
 }})};
 const source=readFileSync(process.env.RIGHELT_NATURAL_PREPARATION_CALLER??new URL('../../../e2e/workflows/computer-tab-recovery.spec.mjs',import.meta.url),'utf8');
 const start=source.indexOf(' leasePreparation.bind(before);'),end=source.indexOf(' const journal=()=>',start);assert(start>=0&&end>start);
 const poll='await expect.poll(()=>Boolean(renewal)).toBe(true);';assert(source.includes(poll));
 const program='(async()=>{'+source.slice(start,end)+'try{'+poll+'return {renewal,preparation:leasePreparation.snapshot()};}finally{release();}})()';
 try{const result=await vm.runInNewContext(program,{leasePreparation:h.observer,before:h.game,id:'owned',page:h.page,expect,Promise,URL});
  assert.equal(observed[0].armedAt,4436);assert(observed[0].prepared);assert.equal(result.renewal.clientCommandId,h.command.clientCommandId+':10436');assert.equal(result.preparation.selected.remainingAtCaptureMs,9000);
 }finally{h.observer.dispose();await Promise.allSettled(pending);}
});

test('actual caller preparation failure preserves its primary, snapshot and cleanup before any route is armed',async()=>{
 const source=readFileSync(new URL('../../../e2e/workflows/computer-tab-recovery.spec.mjs',import.meta.url),'utf8');
 const start=source.indexOf(' leasePreparation.bind(before);'),end=source.indexOf(' let renewal,renewalHeaders,release;',start);assert(start>=0&&end>start);
 for(const failedEvidence of [false,true]){
  const h=fixture(8402,{bind:false}),primary=new Error('original freshness timeout'),annotations=[];let routeArmed=false;
  h.page.route=async()=>{routeArmed=true;};const info={annotations:failedEvidence?{push(){throw Error('annotation unavailable');}}:annotations};
  const expect={poll:()=>({toBe:async()=>{throw primary;}})};
  const program='(async()=>{'+source.slice(start,end)+'await page.route();})()';
  await assert.rejects(vm.runInNewContext(program,{leasePreparation:h.observer,before:h.game,page:h.page,info,expect}),error=>error===primary);
  assert.equal(routeArmed,false);assert.equal(h.page.listenerCount('websocket'),0);assert.equal(h.socket.listenerCount('framereceived'),0);
  if(!failedEvidence){assert.equal(annotations.length,1);const snapshot=JSON.parse(annotations[0].description);assert.equal(snapshot.selected,null);assert.equal(snapshot.preparation.observed,null);assert.equal(snapshot.retired,false);}
 }
});
