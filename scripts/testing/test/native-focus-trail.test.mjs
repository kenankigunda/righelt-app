import test from 'node:test';
import assert from 'node:assert/strict';
import {runInNewContext} from 'node:vm';
import {installNativeFocusTrail,nativeFocusCheckpoint,finishNativeFocusTrail} from '../../../e2e/support/native-focus-trail.mjs';
const events=()=>{const handlers=new Map();return {addEventListener(k,f){if(!handlers.has(k))handlers.set(k,new Set());handlers.get(k).add(f);},removeEventListener(k,f){handlers.get(k)?.delete(f);},fire(k,e={}){for(const f of [...handlers.get(k)??[]])f({target:this,key:'Tab',...e});},count(){return [...handlers.values()].reduce((n,s)=>n+s.size,0);}};};
function fixture(){
 let time=0,focusCalls=0,scrollCalls=0;
 class Element{constructor(action=null){this.tagName='BUTTON';this.action=action;this.isConnected=true;this.tabIndex=0;this.parentElement=null;}getAttribute(k){return k==='data-board-message-action'?this.action:null;}hasAttribute(){return false;}closest(){return null;}getBoundingClientRect(){return {toJSON:()=>({x:0,y:700,width:80,height:56})};}focus(){focusCalls++;}}
 const window=events(),document={...events(),hasFocus:()=>true,hidden:false};const original=new Element('pass');document.activeElement=new Element('other');
 const context={window,document,Element,performance:{now:()=>++time},scrollY:0,innerWidth:390,innerHeight:600,getComputedStyle:()=>({display:'inline-flex',visibility:'visible',position:'relative',overflowX:'visible',overflowY:'visible',clipPath:'none'})};
 window.scrollTo=()=>{scrollCalls++;};runInNewContext(`globalThis.install=${installNativeFocusTrail.toString()};globalThis.checkpoint=${nativeFocusCheckpoint.toString()};globalThis.finish=${finishNativeFocusTrail.toString()};`,context);
 return {window,document,context,Element,original,install(){context.install(original,{platform:'linux',browserName:'firefox',traversalKey:'Tab'});},close(){const result=context.finish();assert.equal(window.count()+document.count(),0);assert.equal(focusCalls+scrollCalls,0);return JSON.parse(JSON.stringify(result));}};
}
test('actual observer retains native profile and initial focus without focusing or scrolling',()=>{
 const f=fixture();f.install();const r=f.close();assert.equal(r.events[0].kind,'installed');assert.equal(r.profile.traversalKey,'Tab');assert.equal(r.events[0].documentFocused,true);assert.equal(r.events[0].activeIsCurrent,false);assert.equal(r.complete,true);
});
test('checkpoint preserves the exact original current-node focus predicate',()=>{
 const f=fixture();f.install();assert.equal(f.context.checkpoint(f.original),false);f.document.activeElement=f.original;assert.equal(f.context.checkpoint(f.original),true);const r=f.close();assert.equal(r.events.findLast(x=>x.kind==='checkpoint').activeIsCurrent,true);
});
test('replacement and detached nodes are observed without inventing original identity',()=>{
 const f=fixture();f.install();f.original.isConnected=false;const replacement=new f.Element('pass');f.document.activeElement=replacement;assert.equal(f.context.checkpoint(replacement),true);const r=f.close(),s=r.events.find(x=>x.kind==='checkpoint');assert.equal(s.samePrimary,false);assert.equal(s.originalPrimary.connected,false);assert.notEqual(s.originalPrimary.token,s.currentPrimary.token);
});
test('native key focus and visibility events retain trust and prevented state',()=>{
 const f=fixture();f.install();f.document.fire('keydown',{isTrusted:true});f.window.fire('keydown',{isTrusted:true,defaultPrevented:true});f.document.fire('focusin',{target:f.original,isTrusted:true});f.document.hidden=true;f.document.fire('visibilitychange');const r=f.close();assert(r.events.some(x=>x.kind==='keydown-bubble'&&x.defaultPrevented&&x.trusted));assert(r.events.some(x=>x.kind==='visibilitychange-bubble'&&x.hidden));
});
test('bounded observation reports truncation instead of silently claiming a complete trail',()=>{
 const f=fixture();f.install();for(let n=0;n<300;n++)f.document.fire('keydown',{isTrusted:true});const r=f.close();assert.equal(r.events.length,256);assert(r.dropped>0);assert.equal(r.complete,false);
});
test('collision and missing observation fail closed and cleanup allows a new installation',()=>{
 const f=fixture();assert.throws(()=>f.context.checkpoint(f.original),/missing/);f.install();assert.throws(()=>f.install(),/already installed/);f.close();assert.throws(()=>f.context.finish(),/missing/);f.install();assert.equal(f.close().events[0].kind,'installed');
});

for(const stage of ['install','finish'])test(`throwing${stage} projection fails observation closed and always removes listeners`,()=>{
 const f=fixture();if(stage==='install')f.context.getComputedStyle=()=>{throw Error('projection failed');};
 f.install();if(stage==='finish')f.original.getBoundingClientRect=()=>{throw Error('projection failed');};
 const result=f.close();assert.equal(result.complete,false);assert(result.projectionErrors>0);assert.equal(f.window.__RIGHELT_NATIVE_FOCUS_TRAIL__,undefined);
});
test('throwing event projection never changes native dispatch or focus predicate and remains incomplete',()=>{
 const f=fixture();f.install();f.context.getComputedStyle=()=>{throw Error('projection failed');};
 assert.doesNotThrow(()=>f.document.fire('keydown',{isTrusted:true}));f.document.activeElement=f.original;assert.equal(f.context.checkpoint(f.original),true);
 const result=f.close();assert.equal(result.complete,false);assert(result.projectionErrors>0);
});
