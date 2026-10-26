import test from 'node:test';
import assert from 'node:assert/strict';
import {createAccountDialog} from '../shell/account-dialog.js';

// Execute the real dialog lifecycle with a held exit timer. Native focus proof
// remains the strict owner/observer account E2E, not this DOM boundary.
function fixture(){
 const timersHeld=new Map();let timerId=0,closeCalls=0,disconnectOnClose=null;
 const document=new EventTarget();document.body={append(){}};document.documentElement={style:{},dataset:{}};
 document.activeElement=document.body;document.defaultView={scrollX:0,scrollY:0,scrollTo(){}};
 const focusable=()=>{const node={isConnected:true,disabled:false,closest:()=>null,focus(){document.activeElement=node;}};return node;};
 const trigger=focusable(),profile=focusable(),inside=focusable();
 const dialog={dataset:{},open:false,innerHTML:'',classList:{add(){},remove(){}},setAttribute(){},querySelector:()=>null,
  addEventListener(){},matches:()=>false,contains:node=>node===inside,show(){this.open=true;},showModal(){this.open=true;},
  close(){this.open=false;closeCalls++;if(disconnectOnClose)disconnectOnClose.isConnected=false;trigger.focus();},replaceChildren(){this.innerHTML='';}};
 document.createElement=()=>dialog;document.querySelector=()=>null;
 const controller={snapshot:()=>({generation:1,session:{authenticated:true,account:{username:'owner',displayName:'Owner',preferences:{}}}})};
 const timers={setTimeout:(fn,ms)=>{const id=++timerId;timersHeld.set(id,{fn,ms});return id;},clearTimeout:id=>timersHeld.delete(id)};
 const account=createAccountDialog({document,controller,timers});
 account.open('account',null,trigger);inside.focus();
 const release=()=>{const pending=[...timersHeld.entries()].find(([,timer])=>timer.ms===180);assert(pending,'Settings exit must be held at its existing180ms boundary');timersHeld.delete(pending[0]);pending[1].fn();};
 return {account,document,dialog,trigger,profile,inside,release,timersHeld,focusable,get closeCalls(){return closeCalls;},disconnectOnClose:node=>{disconnectOnClose=node;}};
}

test('finishing a settings exit preserves a newer outside profile focus',async()=>{
 const f=fixture(),closing=f.account.close();
 f.profile.focus();f.release();assert.equal(await closing,true);
 assert.equal(f.document.activeElement,f.profile);assert.equal(f.dialog.open,false);assert.equal(f.closeCalls,1);
});
test('ordinary settings close still restores its original trigger',async()=>{
 const f=fixture(),closing=f.account.close();f.release();assert.equal(await closing,true);
 assert.equal(f.document.activeElement,f.trigger);assert.equal(f.dialog.open,false);
});
test('an outside target removed by native close safely falls back to the trigger',async()=>{
 const f=fixture(),closing=f.account.close();f.profile.focus();f.disconnectOnClose(f.profile);f.release();await closing;
 assert.equal(f.document.activeElement,f.trigger);assert.equal(f.profile.isConnected,false);
});
test('a superseded settings exit cannot close or refocus the newer account flow',async()=>{
 const f=fixture(),closing=f.account.close(),newTrigger=f.focusable();
 f.account.open('account',null,newTrigger);f.profile.focus();f.release();assert.equal(await closing,false);
 assert.equal(f.dialog.open,true);assert.equal(f.document.activeElement,f.profile);assert.equal(f.closeCalls,0);
});
