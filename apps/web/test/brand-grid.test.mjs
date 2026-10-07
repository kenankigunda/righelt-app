import test from 'node:test';
import assert from 'node:assert/strict';
import { createBrandGrid } from '../shell/brand.js';

const fixture=()=>{
  const writes=[], frames=new Map(), listeners=new Map();
  let nextFrame=0, observer, rect={left:40,top:24,width:755,height:151}, logo;
  const element=label=>{
    const attributes=new Map(), styles=new Map();
    return {
      classList:{add(){}},
      getAttribute:name=>attributes.get(name)??null,
      setAttribute(name,value){attributes.set(name,String(value));writes.push(`${label}:${name}`);},
      style:{getPropertyValue:name=>styles.get(name)??'',setProperty(name,value){styles.set(name,value);writes.push(`style:${name}`);}},
      remove(){this.removed=true;},
    };
  };
  const grid=element('grid'), pattern=element('pattern'), path=element('path');
  grid.querySelector=()=>pattern;pattern.querySelector=()=>path;
  const newLogo=()=>({getBoundingClientRect:()=>({...rect})});logo=newLogo();
  const app={};
  const documentObject={createElementNS:()=>grid,body:{prepend(){}},getElementById:()=>app,querySelector:()=>logo};
  const windowObject={
    MutationObserver:class{constructor(callback){observer=this;this.callback=callback;}observe(target,options){this.target=target;this.options=options;}disconnect(){this.disconnected=true;}},
    requestAnimationFrame(callback){const id=++nextFrame;frames.set(id,callback);return id;},
    cancelAnimationFrame(id){frames.delete(id);},
    addEventListener(name,callback){listeners.set(name,callback);},
    removeEventListener(name,callback){if(listeners.get(name)===callback)listeners.delete(name);},
  };
  const destroy=createBrandGrid({documentObject,windowObject});
  return {grid,pattern,path,writes,frames,listeners,app,destroy,get observer(){return observer;},
    flush(){const pending=[...frames.values()];frames.clear();pending.forEach(callback=>callback());},
    move(next){rect={...rect,...next};},replaceLogo(){logo=newLogo();},setLogoPresent(present){logo=present?newLogo():null;},
  };
};

test('unchanged app updates and equal-geometry logo replacement do not rewrite grid paint inputs',()=>{
  const f=fixture();f.flush();
  assert.equal(f.pattern.getAttribute('width'),'74');
  assert.equal(f.pattern.getAttribute('x'),'565');
  assert.equal(f.path.getAttribute('d'),'M0 37L37 0L74 37L37 74Z');
  f.writes.length=0;
  f.observer.callback();f.observer.callback();f.listeners.get('scroll')();
  assert.equal(f.frames.size,1);f.flush();assert.deepEqual(f.writes,[]);
  f.replaceLogo();f.observer.callback();f.flush();assert.deepEqual(f.writes,[]);
  f.destroy();
});

test('scroll changes origin without invalidating pitch/path; responsive width updates actual geometry',()=>{
  const f=fixture();f.flush();f.writes.length=0;
  f.move({top:-24});f.listeners.get('scroll')();f.flush();
  assert.deepEqual(f.writes,['style:--grid-origin-y','pattern:y']);
  assert.equal(f.pattern.getAttribute('y'),'20');
  f.move({width:377.5,height:75.5});f.listeners.get('resize')();f.flush();
  assert.equal(f.pattern.getAttribute('width'),'37');
  assert.equal(f.pattern.getAttribute('height'),'37');
  assert.equal(f.pattern.getAttribute('x'),'302.5');
  assert.equal(f.path.getAttribute('d'),'M0 18.5L18.5 0L37 18.5L18.5 37Z');
  assert.equal(f.path.getAttribute('stroke-width'),'1');f.destroy();
});

test('observer lifecycle tolerates absent logo and cancels pending grid work on destruction',()=>{
  const f=fixture();
  assert.equal(f.observer.target,f.app);assert.deepEqual(f.observer.options,{childList:true,subtree:true});
  f.setLogoPresent(false);f.flush();assert.equal(f.pattern.getAttribute('width'),null);
  f.setLogoPresent(true);f.observer.callback();f.flush();assert.equal(f.pattern.getAttribute('width'),'74');
  f.observer.callback();f.destroy();
  assert.equal(f.frames.size,0);assert.equal(f.listeners.size,0);
  assert.equal(f.observer.disconnected,true);assert.equal(f.grid.removed,true);
});
