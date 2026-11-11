import test from 'node:test';
import assert from 'node:assert/strict';
import {mountHoverTooltips} from '../shell/hover-tooltip.js';

// Public browser leaves only: production owns all tooltip policy and placement.
function browserLeaves() {
  class Events extends EventTarget {
    listeners=new Map();
    addEventListener(type,fn,options){super.addEventListener(type,fn,options);const set=this.listeners.get(type)??new Set();set.add(fn);this.listeners.set(type,set);}
    removeEventListener(type,fn,options){super.removeEventListener(type,fn,options);this.listeners.get(type)?.delete(fn);}
    get listenerCount(){return [...this.listeners.values()].reduce((n,set)=>n+set.size,0);}
    emit(type,fields={}){const event=new Event(type);for(const [key,value] of Object.entries(fields))Object.defineProperty(event,key,{value});this.dispatchEvent(event);}
  }
  const doc=new Events(),view=new Events(),nodes=[],timers=new Map(),attributes=new Map();
  let timerId=0,observer;
  Object.assign(view,{innerWidth:320,innerHeight:500,setTimeout(fn){const id=++timerId;timers.set(id,fn);return id;},clearTimeout(id){timers.delete(id);}});
  view.MutationObserver=class {
    constructor(callback){this.callback=callback;observer=this;this.connected=false;}
    observe(root,options){this.root=root;this.options=options;this.connected=true;}
    disconnect(){this.connected=false;}
    attribute(name){if(this.connected&&this.options.attributes&&this.options.attributeFilter.includes(name))this.callback([{type:'attributes',attributeName:name}]);}
    childList(){if(this.connected&&this.options.childList)this.callback([{type:'childList'}]);}
  };
  Object.assign(doc,{defaultView:view,hidden:false,body:{append(node){nodes.push(node);}},createElement(tag){
    return {style:{},attributes:{},setAttribute(key,value){this.attributes[key]=value;},contains(target){return target===this;},remove(){const index=nodes.indexOf(this);if(index!==-1)nodes.splice(index,1);},getBoundingClientRect(){const left=Number.parseFloat(this.style.left)||0,top=Number.parseFloat(this.style.top)||0;return {left,top,right:left+120,bottom:top+24,width:120,height:24};}};
  }});
  const anchor={isConnected:true,dataset:{tooltip:'Horus, Blue, Computer player, Active here'},contains(target){return target===this;},closest(selector){
    const matches=(part,has,get)=>{
      const parsed=/^\[\s*([\w-]+)\s*(?:=\s*(?:"([^"]*)"|'([^']*)'|([^\s\]]+))\s*)?\]$/.exec(part.trim());
      assert.ok(parsed,`unsupported public attribute selector: ${part}`);
      const [,name,doubleQuoted,singleQuoted,unquoted]=parsed,value=doubleQuoted??singleQuoted??unquoted;
      return has(name)&&(value===undefined||get(name)===value);
    };
    // The controlled tree has one named anchor and one attribute-bearing ancestor.
    // Interpret attribute selectors, rather than reproducing eligibility policy.
    const clauses=selector.split(',');
    if(clauses.some(part=>matches(part,name=>name==='data-tooltip',()=>this.dataset.tooltip)))return this;
    return clauses.some(part=>matches(part,name=>attributes.has(name),name=>attributes.get(name)))?this:null;
  },getBoundingClientRect(){return {left:100,top:200,right:200,bottom:240,width:100,height:40};}};
  const outside={closest(){return null;}},root={ownerDocument:doc,contains(target){return target===anchor&&anchor.isConnected;}};
  return {doc,view,root,anchor,outside,nodes,timers,attributes,get observer(){return observer;},hover(pointerType='mouse'){doc.emit('pointerover',{target:anchor,pointerType});},setAncestor(name,value){if(value)attributes.set(name,name==='aria-hidden'?'true':'');else attributes.delete(name);observer.attribute(name);}};
}

test('one live anchor retires independently for inert, hidden, aria-hidden, document hiding and removal',()=>{
  const b=browserLeaves(),owner=mountHoverTooltips(b.root);
  try {
    for(const attribute of ['inert','hidden','aria-hidden']){
      assert.equal(b.attributes.size,0,'each ancestor fault starts without any other hiding flag');
      b.hover();assert.equal(b.nodes.length,1);assert.equal(b.nodes[0].textContent,'Horus, Blue, Computer player, Active here');
      assert.equal(b.nodes[0].attributes['aria-hidden'],'true');
      b.setAncestor(attribute,true);assert.equal(b.nodes.length,0,`${attribute} must retire the tooltip`);
      b.hover();assert.equal(b.nodes.length,0,`${attribute} must block a new tooltip`);
      b.setAncestor(attribute,false);b.hover();assert.equal(b.nodes.length,1,'same restored anchor can hover');
    }
    b.doc.hidden=true;b.doc.emit('visibilitychange');assert.equal(b.nodes.length,0);
    b.hover();assert.equal(b.nodes.length,0);b.doc.hidden=false;b.hover();assert.equal(b.nodes.length,1);
    b.anchor.isConnected=false;b.observer.childList();assert.equal(b.nodes.length,0);
  } finally {owner.destroy();}
});

test('Escape dismissal survives reentry but retiring that anchor releases it; touch stays decorative-free',()=>{
  const b=browserLeaves(),owner=mountHoverTooltips(b.root);
  try {
    b.hover('touch');assert.equal(b.nodes.length,0);
    b.hover();assert.equal(b.nodes.length,1);b.doc.emit('keydown',{key:'Escape'});assert.equal(b.nodes.length,0);
    b.hover();assert.equal(b.nodes.length,0,'Escape cannot be undone by immediate same-anchor reentry');
    b.setAncestor('inert',true);assert.equal(b.attributes.size,1);b.setAncestor('inert',false);
    b.hover();assert.equal(b.nodes.length,1,'retired dismissed anchor is eligible after restoration');
    b.doc.emit('keydown',{key:'Escape'});b.doc.emit('pointerout',{target:b.anchor,relatedTarget:b.outside,clientX:0,clientY:0});
    b.hover();assert.equal(b.nodes.length,1,'leaving also releases ordinary dismissal');
  } finally {owner.destroy();}
});

test('destroy cancels owned timers, disconnects observation and removes every installed listener',()=>{
  const b=browserLeaves(),owner=mountHoverTooltips(b.root);
  try {
    assert.ok(b.doc.listenerCount>0);assert.ok(b.view.listenerCount>0);assert.equal(b.observer.connected,true);
    b.hover();assert.equal(b.nodes.length,1);
    b.doc.emit('pointerout',{target:b.anchor,relatedTarget:b.outside,clientX:0,clientY:0});assert.equal(b.timers.size,1);
    owner.destroy();assert.equal(b.nodes.length,0);assert.equal(b.timers.size,0);assert.equal(b.observer.connected,false);
    assert.equal(b.doc.listenerCount,0);assert.equal(b.view.listenerCount,0);
    b.hover();b.doc.emit('keydown',{key:'Escape'});b.view.emit('resize');b.setAncestor('inert',true);b.setAncestor('inert',false);
    assert.equal(b.nodes.length,0);assert.equal(b.timers.size,0);
  } finally {owner.destroy();}
});
