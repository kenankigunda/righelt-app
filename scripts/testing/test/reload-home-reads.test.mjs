import assert from 'node:assert/strict';
import test from 'node:test';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { createHash } from 'node:crypto';
import { observeReloadHomeReads } from '../../../e2e/support/reload-home-reads.mjs';

// Exact original 659 predicate, retained as the controlled race counterexample.
const oldPredicateText="\n  const url=new URL(response.url());\n  return response.request().method()==='GET'&&url.pathname==='/api/shell/games'&&url.searchParams.get('section')===section&&response.status()===200;";
const oldPredicate=section=>vm.runInNewContext(`response=>{${oldPredicateText}}`,{URL,section});
function fixture(){
 const page=new EventEmitter();let mainURL='http://fixture/';
 const main={url:()=>mainURL},child={};page.mainFrame=()=>main;page.url=()=> 'http://fixture/';
 const request=(section='my',{frame=main,navigation=false,method='GET',origin='http://fixture'}={})=>({frame:()=>frame,isNavigationRequest:()=>navigation,method:()=>method,url:()=>section===null?`${origin}/`:`${origin}/api/shell/games?section=${section}`});
 const response=(req,status=200)=>({request:()=>req,url:()=>req.url(),status:()=>status,finished:async()=>null});
 const observer=observeReloadHomeReads(page);
 const commit=()=>{const req=request(null,{navigation:true});page.emit('request',req);page.emit('framenavigated',main);return response(req);};
 return{page,main,child,request,response,observer,commit,setFrameURL:url=>{mainURL=url;}};
}

test('actual old predicate selects late pre-reload responses; scoped helper waits for both new exact requests',()=>{
 const f=fixture(),old=['my','other'].map(section=>f.request(section));
 for(const req of old)f.page.emit('request',req);
 const navigation=f.commit();
 for(let i=0;i<old.length;i++){
  const section=['my','other'][i],late=f.response(old[i]);
  assert.equal(oldPredicate(section)(late),true);
  const selected=process.env.RIGHELT_RELOAD_READ_RED==='1'?oldPredicate(section)(late):f.observer.matches(late,section);
  assert.equal(selected,false,'a pre-commit Request must never satisfy the reloaded document read');
  // Same URL/status and frame do not substitute for exact Request identity.
  assert.equal(f.observer.matches(f.response(f.request(section)),section),false);
  const current=f.request(section);f.page.emit('request',current);
  assert.equal(f.observer.matches(f.response(current),section),true);
 }
 f.observer.assertReload(navigation);f.observer.dispose();
 assert.equal(f.page.eventNames().length,0);
});

test('requests emitted after navigation begins but before commit stay old-document ineligible',()=>{
 const f=fixture(),nav=f.request(null,{navigation:true});f.page.emit('request',nav);
 const old=f.request();f.page.emit('request',old);f.page.emit('framenavigated',f.main);
 assert.equal(f.observer.matches(f.response(old),'my'),false);f.observer.dispose();
});

for(const kind of ['iframe','post','wrong-section','wrong-status'])test(`current-document ${kind} cannot satisfy a Home read`,()=>{
 const f=fixture();f.commit();
 const req=f.request(kind==='wrong-section'?'completed':'my',{frame:kind==='iframe'?f.child:f.main,method:kind==='post'?'POST':'GET'});
 f.page.emit('request',req);
 assert.equal(f.observer.matches(f.response(req,kind==='wrong-status'?503:200),'my'),false);f.observer.dispose();
});

for(const retirement of ['navigation','commit','close'])test(`later ${retirement} irreversibly rejects stale read qualification`,()=>{
 const f=fixture(),navigation=f.commit(),req=f.request();f.page.emit('request',req);
 assert.equal(f.observer.matches(f.response(req),'my'),true);
 if(retirement==='navigation')f.page.emit('request',f.request(null,{navigation:true}));
 if(retirement==='commit'){f.setFrameURL('http://fixture/#/different-route');f.page.emit('framenavigated',f.main);}
 if(retirement==='close')f.page.emit('close');
 assert.throws(()=>f.observer.assertReload(navigation));
 assert.throws(()=>f.observer.matches(f.response(req),'my'));
 f.observer.dispose();assert.equal(f.page.eventNames().length,0);
});

test('reload navigation identity is exact and observer cleanup is idempotent',()=>{
 const f=fixture();f.commit();
 assert.throws(()=>f.observer.assertReload(f.response(f.request(null,{navigation:true}))),/completed reload navigation/);
 f.observer.dispose();f.observer.dispose();assert.equal(f.page.eventNames().length,0);
 assert.throws(()=>f.observer.matches(f.response(f.request()),'my'),/disposed/);
});

test('actual spec owns original waiter rejections, preserves primary reload failure and removes observers',async()=>{
 const current=readFileSync(new URL('../../../e2e/workflows/ux-refresh-checkpoint.spec.mjs',import.meta.url),'utf8');
 const body=current.slice(current.indexOf(' const reloadHome='),current.indexOf(" await expect(page.getByTestId('home-section-skeleton')).toHaveCount(0);",current.indexOf(' const reloadHome=')));
 const page=new EventEmitter();page.mainFrame=()=>({});page.url=()=> 'http://fixture/';
 const pending=[];page.waitForResponse=()=>new Promise((resolve,reject)=>pending.push({resolve,reject}));
 const primary=new Error('original reload failed');page.reload=async()=>{throw primary;};
 const actual=vm.runInNewContext(`(async()=>{${body}})`,{page,observeReloadHomeReads,expect:()=>{throw new Error('assertion must remain after successful reload');}});
 await assert.rejects(actual,error=>error===primary);
 assert.equal(page.eventNames().length,0);
 for(const waiter of pending)waiter.reject(new Error('original response waiter closed'));
 await Promise.resolve();
});

test('all original workflow assertions after the reload block remain byte-exact',()=>{
 const current=readFileSync(new URL('../../../e2e/workflows/ux-refresh-checkpoint.spec.mjs',import.meta.url),'utf8');
 const anchor=" await expect(page.getByTestId('home-section-skeleton')).toHaveCount(0);\n await expect(page.getByTestId('home-create-game')).toBeEnabled();";
 assert.ok(current.includes(anchor));
 assert.equal(createHash('sha256').update(current.slice(current.indexOf(anchor))).digest('hex'),'b01b2f1c671f3eac064701a808e737324cde373fb615acab026c55b5dfd0b2cf');
 assert.ok(current.includes('expect(await response.finished()).toBeNull()'));
});


test('foreign-origin main-frame Home request never qualifies despite same path and section',()=>{
 const f=fixture();f.commit();const request=f.request('my',{origin:'http://foreign'});f.page.emit('request',request);
 assert.equal(f.observer.matches(f.response(request),'my'),false);f.observer.dispose();
});

test('foreign-origin response cannot qualify an otherwise recorded exact Home request',()=>{
 const f=fixture();f.commit();const request=f.request();f.page.emit('request',request);
 const response={...f.response(request),url:()=> 'http://foreign/api/shell/games?section=my'};
 assert.equal(f.observer.matches(response,'my'),false);f.observer.dispose();
});

test('foreign-origin reload navigation is rejected and never acquires Home reads',()=>{
 const f=fixture(),request=f.request(null,{navigation:true,origin:'http://foreign'});f.page.emit('request',request);f.page.emit('framenavigated',f.main);
 assert.throws(()=>f.observer.assertReload(f.response(request)),/Foreign-origin navigation/);f.observer.dispose();
});

test('reload response origin remains bound even when navigation Request identity matches',()=>{
 const f=fixture(),response=f.commit();
 assert.throws(()=>f.observer.assertReload({...response,url:()=> 'http://foreign/'}),/completed reload navigation/);f.observer.dispose();
});


test('duplicate exact-URL public frame events preserve a bound reload and exact current Home Requests',()=>{
 const f=fixture(),old=['my','other'].map(section=>f.request(section));
 for(const request of old)f.page.emit('request',request);
 const navigation=f.commit();
 f.page.emit('framenavigated',f.main);
 f.observer.assertReload(navigation);
 for(const [index,section]of ['my','other'].entries()){
  assert.equal(f.observer.matches(f.response(old[index]),section),false,'an old Request stays ineligible across the duplicate public event');
  assert.equal(f.observer.matches(f.response(f.request(section)),section),false,'same URL/status without recorded Request identity stays ineligible');
  const request=f.request(section);f.page.emit('request',request);
  f.page.emit('framenavigated',f.main);
  assert.equal(f.observer.matches(f.response(request),section),true);
 }
 f.observer.assertReload(navigation);f.observer.dispose();assert.equal(f.page.eventNames().length,0);
});

test('a second distinct navigation Request retires the reload even when its URL is exactly identical',()=>{
 const f=fixture(),navigation=f.commit(),request=f.request();f.page.emit('request',request);
 assert.equal(f.observer.matches(f.response(request),'my'),true);
 const second=f.request(null,{navigation:true});
 assert.equal(second.url(),navigation.request().url());assert.notEqual(second,navigation.request());
 f.page.emit('request',second);f.page.emit('framenavigated',f.main);
 assert.throws(()=>f.observer.assertReload(navigation),/Unexpected main-frame navigation/);
 assert.throws(()=>f.observer.matches(f.response(request),'my'),/Unexpected main-frame navigation/);
 f.page.emit('framenavigated',f.main);
 assert.throws(()=>f.observer.assertReload(navigation),/Unexpected main-frame navigation/);
 f.observer.dispose();
});

test('foreign or different same-origin frame URLs remain sticky retirement without a second Request',()=>{
 for(const url of ['http://foreign/','http://fixture/game/other','http://fixture/?changed=1','http://fixture/#/different']){
  const f=fixture(),navigation=f.commit(),request=f.request();f.page.emit('request',request);
  f.setFrameURL(url);f.page.emit('framenavigated',f.main);
  assert.throws(()=>f.observer.assertReload(navigation),/Unexpected main-frame commit/);
  assert.throws(()=>f.observer.matches(f.response(request),'my'),/Unexpected main-frame commit/);
  f.setFrameURL('http://fixture/');f.page.emit('framenavigated',f.main);
  assert.throws(()=>f.observer.assertReload(navigation),/Unexpected main-frame commit/);
  f.observer.dispose();
 }
});

test('an exact-URL public frame event before the actual reload Request cannot create ownership',()=>{
 const f=fixture();f.page.emit('framenavigated',f.main);
 const navigation=f.commit(),request=f.request();f.page.emit('request',request);
 assert.throws(()=>f.observer.assertReload(navigation),/Unexpected main-frame commit/);
 assert.throws(()=>f.observer.matches(f.response(request),'my'),/Unexpected main-frame commit/);
 f.observer.dispose();
});
