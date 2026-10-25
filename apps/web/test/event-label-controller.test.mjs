import test from 'node:test';
import assert from 'node:assert/strict';
import {createBoardEventLabels} from '../board/event-label-controller.js';
const target=()=>({listeners:new Map(),addEventListener(type,fn,capture=false){this.listeners.set(`${type}:${capture}`,fn)},removeEventListener(type,fn,capture=false){if(this.listeners.get(`${type}:${capture}`)===fn)this.listeners.delete(`${type}:${capture}`)},emit(type,capture=false){this.listeners.get(`${type}:${capture}`)?.()}});
const fixture=()=>{
 const frames=new Map(),observers=[];let sequence=0;
 const doc={...target(),hidden:false,fonts:{...target(),ready:Promise.resolve()}};
 const node=(rect={left:120,top:200,right:145,bottom:225})=>({ownerDocument:doc,parentElement:null,children:[],style:{},dataset:{},attributes:{},isConnected:true,rect,textContent:'',setAttribute(key,value){this.attributes[key]=value},appendChild(child){child.parentElement=this;this.children.push(child)},remove(){this.isConnected=false;const index=this.parentElement?.children.indexOf(this);if(index>=0)this.parentElement.children.splice(index,1)},closest(){return this.unavailable?this:null},getClientRects(){return this.isConnected?[this.rect]:[]},getBoundingClientRect(){return this.className==='board-event-label'?{width:72,height:22}:this.rect}});
 class Observer{constructor(callback){this.callback=callback;this.nodes=new Set();this.disconnected=false;observers.push(this)}observe(node){this.nodes.add(node)}unobserve(node){this.nodes.delete(node)}disconnect(){this.disconnected=true;this.nodes.clear()}}
 const view={...target(),innerWidth:320,innerHeight:600,visualViewport:{...target(),offsetLeft:0,offsetTop:0,width:320,height:600},requestAnimationFrame:fn=>{frames.set(++sequence,fn);return sequence},cancelAnimationFrame:id=>frames.delete(id),getComputedStyle:board=>({visibility:board.visibility??'visible'}),ResizeObserver:Observer,MutationObserver:Observer};
 doc.defaultView=view;doc.body=node();doc.createElement=()=>node();const board=node();board.parentElement=doc.body;
 const controller=createBoardEventLabels({boardEl:board});const anchor=node();
 const update=(options={})=>controller.update({scope:'game:a',events:[{id:'event:a',anchorEl:anchor,record:{reason:'loss_of_supply'}}],...options});
 const flush=()=>{const callbacks=[...frames.values()];frames.clear();callbacks.forEach(fn=>fn())};
 return {doc,view,board,anchor,controller,update,flush,frames,observers};
};
test('per-board labels retain node identity within a scope and never capture interaction',()=>{
 const f=fixture();const record=Object.freeze({reason:'loss_of_supply',message:'Original long data',pieceId:'A'});
 f.update({events:[{id:'event:a',anchorEl:f.anchor,record}]});f.flush();
 const layer=f.doc.body.children[0],label=layer.children[0];assert.equal(label.textContent,'Lost supply');assert.equal(layer.inert,true);assert.equal(layer.attributes['aria-hidden'],'true');assert.equal(layer.style.pointerEvents,'none');assert.equal(label.style.pointerEvents,'none');assert.equal(label.attributes.tabindex,undefined);
 f.update();f.flush();assert.equal(f.doc.body.children[0].children[0],label);
 f.update({scope:'game:b'});f.flush();assert.notEqual(f.doc.body.children[0].children[0],label);assert.equal(label.isConnected,false);assert.equal(record.message,'Original long data');
 f.controller.destroy();
});
test('scroll, visual viewport, resize and font notifications schedule current geometry once',()=>{
 const f=fixture();f.update();f.flush();const before=f.controller.positions();f.anchor.rect={left:10,top:35,right:35,bottom:60};
 f.view.emit('scroll',true);f.view.emit('resize');f.doc.fonts.emit('loadingdone');assert.equal(f.frames.size,1);f.flush();assert.notDeepEqual(f.controller.positions(),before);
 f.view.visualViewport.width=110;f.view.visualViewport.offsetLeft=20;f.view.visualViewport.emit('resize');f.flush();const [position]=f.controller.positions();assert(position.left>=28&&position.left+position.width<=122);
 f.observers[0].callback();assert.equal(f.frames.size,1);f.controller.destroy();
});
test('hidden, inert, static and disconnected boards remove their labels without restarting old events',()=>{
 for(const kind of ['document','inert','static','disconnected']){
  const f=fixture();f.update();f.flush();assert.equal(f.doc.body.children.length,1);
  if(kind==='document'){f.doc.hidden=true;f.doc.emit('visibilitychange')}
  else {if(kind==='inert')f.board.unavailable=true;if(kind==='static')f.board.dataset.interactionMode='static';if(kind==='disconnected')f.board.isConnected=false;f.view.emit('resize');f.flush()}
  assert.equal(f.doc.body.children.length,0);assert.deepEqual(f.controller.positions(),[]);
  f.doc.hidden=false;f.board.unavailable=false;f.board.dataset.interactionMode='interactive';f.board.isConnected=true;f.doc.emit('visibilitychange');f.flush();assert.equal(f.doc.body.children.length,0);
  f.controller.destroy();
 }
});
test('expiry remains caller-owned and cleanup removes observers, listeners and pending frames',async()=>{
 const f=fixture();f.update();f.flush();f.update({events:[]});assert.equal(f.doc.body.children.length,0);
 f.update();f.controller.destroy();f.controller.destroy();await Promise.resolve();
 assert.equal(f.frames.size,0);assert.equal(f.doc.body.children.length,0);assert(f.observers.every(observer=>observer.disconnected));
 for(const eventTarget of [f.view,f.view.visualViewport,f.doc,f.doc.fonts])assert.equal(eventTarget.listeners.size,0);
 f.update();f.view.emit('resize');assert.equal(f.frames.size,0);
});
