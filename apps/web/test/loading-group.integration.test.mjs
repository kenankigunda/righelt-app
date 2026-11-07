import test from 'node:test';
import assert from 'node:assert/strict';
import {mountLoadingFeedback} from '../shell/loading.js';

function harness({grouped=true}={}) {
 let time=0,scope='home',observer,timer;
 const node=tag=>({tagName:tag,dataset:{},children:[],isConnected:true,className:'',classList:{add(){}},
  setAttribute(name,value){this[name]=value;},removeAttribute(name){if(name==='data-loading-phase')delete this.dataset.loadingPhase;},
  closest(selector){if(selector==='[data-loading-context-group]')return grouped?group:null;return this.hidden?{}:null;},
  querySelector(selector){if(selector.includes('loading-pieces'))return this.cue??null;return this.children.find(child=>selector.includes('loading-icon-slot')?child.className==='loading-icon-slot':selector.includes('svg')?child.tagName==='SVG':child.className==='loading-context')??null;},
  append(child){child.parent=this;child.isConnected=true;this.children.push(child);},
  insertBefore(child,before){child.parent=this;this.children.splice(Math.max(0,this.children.indexOf(before)),0,child);},
  insertAdjacentElement(_position,child){const siblings=this.parent.children;child.parent=this.parent;siblings.splice(siblings.indexOf(this)+1,0,child);},
  insertAdjacentHTML(){const host=this;this.cue={remove(){host.cue=null;}};},
  remove(){this.isConnected=false;if(this.parent)this.parent.children=this.parent.children.filter(child=>child!==this);},
  get firstChild(){return this.children[0]??null;},
 });
 const group=node('SECTION'),row=node('DIV');group.append(row);
 const buttons=['prev','next'].map(direction=>{const button=node('BUTTON');Object.assign(button.dataset,{loadingState:'pending',loadingKey:`home:${direction}`,...(grouped?{loadingContext:'group'}:{})});button.append(node('SVG'));row.append(button);return button;});
 const document={elements:buttons,body:node('BODY'),documentElement:{toggleAttribute(){}},hidden:false,
  querySelectorAll(){return this.elements;},createElement:tag=>node(tag.toUpperCase()),addEventListener(){},removeEventListener(){},
  defaultView:{MutationObserver:class{constructor(callback){observer=callback;}observe(){}disconnect(){}},addEventListener(){},removeEventListener(){}},
 };
 const dispose=mountLoadingFeedback(document,{now:()=>time,setTimer:callback=>(timer=callback),clearTimer:()=>{timer=null;},getScope:()=>scope});
 return {document,group,row,buttons,dispose,sync:()=>observer(),advance(ms){time+=ms;const callback=timer;timer=null;callback?.();},setScope(value){scope=value;}};
}

test('sibling pending arrows share one slow status outside their unchanged row and busy buttons',()=>{
 const env=harness();assert.equal(env.group.children.length,1);
 env.advance(199);assert.equal(env.group.children.length,1);
 env.advance(1);assert.ok(env.buttons.every(button=>button.dataset.loadingPhase==='visible'));
 env.advance(4799);assert.equal(env.group.children.length,1);
 env.advance(1);assert.equal(env.group.children.length,2);assert.equal(env.row.children.length,2);
 const status=env.group.children[1];assert.equal(status.role,'status');assert.equal(status.textContent,'This is taking a little longer than usual.');
 env.sync();assert.equal(env.group.children[1],status);assert.equal(env.group.children.length,2);
 env.buttons[0].dataset.loadingState='idle';env.sync();assert.equal(env.group.children[1],status);
 env.buttons[1].dataset.loadingState='idle';env.sync();assert.equal(env.group.children.length,1);
 env.buttons[0].dataset.loadingState='pending';env.sync();assert.equal(env.buttons[0].dataset.loadingPhase,'quiet');assert.equal(env.group.children.length,1);
 env.dispose();
});

test('route changes, hidden controls, removal and disposal retire the shared notice and its delay',()=>{
 const env=harness();env.advance(5000);assert.equal(env.group.children.length,2);
 env.setScope('other');env.sync();assert.equal(env.group.children.length,1);assert.ok(env.buttons.every(button=>button.dataset.loadingPhase==='quiet'));
 env.advance(5000);assert.equal(env.group.children.length,2);
 env.buttons.forEach(button=>{button.hidden=true;});env.sync();assert.equal(env.group.children.length,1);
 env.buttons.forEach(button=>{button.hidden=false;});env.sync();env.advance(5000);assert.equal(env.group.children.length,2);
 env.document.elements=[];env.sync();assert.equal(env.group.children.length,1);
 env.document.elements=env.buttons;env.sync();env.advance(5000);env.dispose();assert.equal(env.group.children.length,1);
});

test('ordinary controls retain their existing independent slow messages',()=>{
 const env=harness({grouped:false});env.advance(5000);assert.equal(env.row.children.length,4);assert.equal(env.group.children.length,1);
 assert.equal(env.row.children.filter(child=>child.role==='status').length,2);env.dispose();assert.equal(env.row.children.length,2);
});
