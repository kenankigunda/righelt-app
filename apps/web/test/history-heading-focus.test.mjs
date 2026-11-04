import test from 'node:test';
import assert from 'node:assert/strict';
import {createHistoryHeadingFocus} from '../shell/history-heading-focus.js';
function fixture(){
 const listeners=()=>{const events=new Map();return {events,addEventListener(type,fn){if(!events.has(type))events.set(type,new Set());events.get(type).add(fn);},removeEventListener(type,fn){events.get(type)?.delete(fn);},emit(type,event={}){for(const fn of events.get(type)??[])fn(event);}};};
 const doc={...listeners(),body:{},hidden:false,focused:true,hasFocus(){return this.focused;}},win=listeners();doc.defaultView=win;doc.activeElement=doc.body;
 let scope='account1/visit1/game1/history';
 const owner=createHistoryHeadingFocus({doc,getScope:()=>scope});
 const node=({valid=true,inert=false,connected=true,refuse=false}={})=>({isConnected:connected,focusCalls:[],matches:()=>valid,contains(target){return target===this;},closest(){return inert?{}:null;},focus(options){this.focusCalls.push(options);if(!refuse){doc.activeElement=this;doc.emit('focusin',{target:this});}}});
 const old=node();old.focus({preventScroll:true});old.focusCalls=[];
 return {owner,doc,win,old,node,setScope:value=>{scope=value;},detach(){old.isConnected=false;doc.activeElement=doc.body;},finish(){owner.destroy();}};
}
test('only an already focused connected History heading can grant preservation',()=>{const f=fixture();assert(f.owner.capture());f.doc.activeElement=f.doc.body;assert.equal(f.owner.capture(),null);f.finish();});
test('same connected heading receives no extra focus call',()=>{const f=fixture(),token=f.owner.capture();assert.equal(f.owner.restore(token,()=>f.node()),false);assert.equal(f.old.focusCalls.length,0);f.finish();});
test('one synchronous replacement transfers focus and owns the replacement for the next commit',()=>{const f=fixture(),token=f.owner.capture(),next=f.node();f.detach();assert.equal(f.owner.restore(token,()=>next),true);assert.equal(f.doc.activeElement,next);assert.deepEqual(next.focusCalls,[{preventScroll:true}]);assert.equal(f.owner.capture().node,next);f.finish();});
test('refused native focus cannot become a later arrival retry',()=>{const f=fixture(),token=f.owner.capture(),next=f.node({refuse:true});f.detach();assert.equal(f.owner.restore(token,()=>next),false);assert.equal(f.owner.capture(),null);assert.equal(f.owner.restore(token,()=>f.node()),false);f.finish();});
for(const options of [{valid:false},{inert:true},{connected:false}])test(`invalid replacement ${JSON.stringify(options)} cannot receive focus`,()=>{const f=fixture(),token=f.owner.capture(),next=f.node(options);f.detach();assert.equal(f.owner.restore(token,()=>next),false);assert.equal(next.focusCalls.length,0);assert.equal(f.owner.capture(),null);f.finish();});
for(const kind of ['focusin','pointerdown','mousedown','tab','outside-key','blur','hidden'])test(`later ${kind} intent retires preservation even when replacement leaves body focus`,()=>{
 const f=fixture(),token=f.owner.capture(),foreign=f.node({valid:false}),next=f.node();
 if(kind==='focusin')foreign.focus({});
 if(kind==='pointerdown'||kind==='mousedown')f.doc.emit(kind,{target:foreign});
 if(kind==='tab')f.doc.emit('keydown',{target:f.old,key:'Tab'});
 if(kind==='outside-key')f.doc.emit('keydown',{target:foreign,key:'Enter'});
 if(kind==='blur')f.win.emit('blur');
 if(kind==='hidden'){f.doc.hidden=true;f.doc.emit('visibilitychange');f.doc.hidden=false;}
 f.detach();assert.equal(f.owner.restore(token,()=>next),false);assert.equal(next.focusCalls.length,0);f.finish();
});
test('heading-owned pointer, mouse and non-navigation keys retain its native focus ownership',()=>{const f=fixture(),token=f.owner.capture(),next=f.node();f.doc.emit('pointerdown',{target:f.old});f.doc.emit('mousedown',{target:f.old});f.doc.emit('keydown',{target:f.old,key:'ArrowDown'});f.detach();assert.equal(f.owner.restore(token,()=>next),true);f.finish();});
for(const scope of ['account2/visit1/game1/history','account1/visit2/game1/history','account1/visit1/game2/history','account1/visit1/game1/board'])test(`changed scope ${scope} cannot restore old focus`,()=>{const f=fixture(),token=f.owner.capture(),next=f.node();f.setScope(scope);f.detach();assert.equal(f.owner.restore(token,()=>next),false);assert.equal(next.focusCalls.length,0);f.finish();});
test('an unfocused document cannot grant preservation',()=>{const f=fixture();f.doc.focused=false;assert.equal(f.owner.capture(),null);f.finish();});
test('destruction removes owned listeners and prevents later grants',()=>{const f=fixture();f.owner.destroy();f.owner.destroy();f.node().focus({});assert.equal(f.owner.capture(),null);assert([...f.doc.events.values()].every(set=>set.size===0));assert([...f.win.events.values()].every(set=>set.size===0));});
