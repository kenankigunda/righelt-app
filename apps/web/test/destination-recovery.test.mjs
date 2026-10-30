import test from 'node:test';
import assert from 'node:assert/strict';
import {createDestinationRecovery,destinationFailureKind,destinationRecoveryMessage} from '../shell/destination-recovery.js';
const harness=()=>{
 let now=0,id=0,retries=0,changes=0;
 const timers=new Map(),context={scope:'account1:route1',visible:true};
 const recovery=createDestinationRecovery({clock:()=>now,setTimer:(fn,ms)=>{timers.set(++id,{fn,at:now+ms});return id;},clearTimer:key=>timers.delete(key),onRetry:()=>{retries++;recovery.begin(context.scope);},onChange:()=>{changes++;recovery.update(context);}});
 const advance=ms=>{const end=now+ms;while(true){const next=[...timers].sort((a,b)=>a[1].at-b[1].at)[0];if(!next || next[1].at>end)break;now=next[1].at;timers.delete(next[0]);next[1].fn();}now=end;};
 return {recovery,context,advance,state:()=>recovery.update(context),retries:()=>retries,changes:()=>changes,timers};
};
test('slow destination uses shared foreground4/15boundaries without restarting across read retries',()=>{
 const h=harness();h.recovery.begin(h.context.scope);assert.equal(h.state().show,false);
 h.advance(3999);assert.equal(h.state().show,false);h.advance(1);assert.equal(h.state().show,true);assert.equal(h.state().actions,false);
 h.recovery.fail(h.context.scope,{status:503});h.advance(500);assert.equal(h.retries(),1);assert.equal(h.state().elapsed,4500);
 h.advance(10500);assert.equal(h.state().actions,true);assert.equal(destinationRecoveryMessage(h.state()).action,'retry');
 h.recovery.reset();assert.equal(h.state(),null);assert.equal(h.timers.size,0);
});
test('hidden time and changed route/account scopes cancel retry work and restart visible wait',()=>{
 const h=harness();h.recovery.begin(h.context.scope);h.state();h.advance(3000);h.recovery.fail(h.context.scope,{status:503});
 h.context.visible=false;h.state();h.advance(60000);assert.equal(h.retries(),0);assert.equal(h.state().show,false);
 h.context.visible=true;assert.equal(h.state().elapsed,0);h.advance(500);assert.equal(h.retries(),1);
 h.recovery.fail(h.context.scope,{status:503});h.context.scope='account2:route2';assert.equal(h.state(),null);h.advance(60000);assert.equal(h.retries(),1);
});
test('terminal failures have specific help and never enter automatic read retry',()=>{
 const cases=[[{status:401},'auth','signin'],[{status:403},'auth','signin'],[{status:404},'missing',null],[{code:'upgrade_required'},'upgrade','reload'],[Error('invalid_snapshot'),'integrity','reload'],[{code:'invalid_response'},'integrity','reload'],[{status:400},'unavailable','reload']];
 for(const [error,kind,action]of cases){const h=harness();h.recovery.begin(h.context.scope);h.recovery.fail(h.context.scope,error);const state=h.state();assert.equal(state.kind,kind);assert.equal(state.show,true);assert.equal(destinationRecoveryMessage(state).action,action);assert.equal(destinationRecoveryMessage(state).home,true);h.advance(60000);h.recovery.retry();assert.equal(h.retries(),0);}
 for(const error of [{status:503},{status:429},{code:'request_timeout'},new TypeError('Failed to fetch'),Object.assign(Error('aborted'),{name:'AbortError'})])assert.equal(destinationFailureKind(error),'retry');
});
test('manual retry clears the scheduled retry and stale failure owners cannot replace a new route',()=>{
 const h=harness();h.recovery.begin(h.context.scope);h.state();h.recovery.fail(h.context.scope,{status:503});h.recovery.retry();assert.equal(h.retries(),1);h.advance(500);assert.equal(h.retries(),1);
 h.recovery.begin('new');h.recovery.fail(h.context.scope,{status:503});h.context.scope='new';assert.equal(h.state().kind,null);h.advance(60000);assert.equal(h.retries(),1);
});
