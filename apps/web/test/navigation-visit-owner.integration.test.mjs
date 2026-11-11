import test from 'node:test';
import assert from 'node:assert/strict';
import {createNavigationVisitOwner} from '../shell/navigation-visit-owner.js';

const fixture=({generation=1,ready=true,hash='#/'}={})=>{
 const scroll=[],focus=[],saves=[];
 const target={matches:()=>true,focus:options=>focus.push(options)};
 const retained={hash:'#/',generation:1,y:240,focusGameId:'saved-card'};
 const context={pendingRoutePosition:retained,routeHydrated:ready,currentRoute:{name:'home'},
  account:{snapshot:()=>({generation})},window:{location:{hash},scrollTo:options=>scroll.push(options)},
  appEl:{querySelector:()=>target},CSS:{escape:value=>value},navigationHistory:{save:()=>saves.push(true)}};
 const owner=createNavigationVisitOwner(()=>({...context,state:context}));context.restore=owner.restore;return{context,scroll,focus,saves,retained};
};

test('actual deferred visit restoration cannot apply an old account reading position or focus',()=>{
 const f=fixture({generation:2});f.context.restore();
 assert.deepEqual(f.scroll,[]);assert.deepEqual(f.focus,[]);assert.deepEqual(f.saves,[]);assert.equal(f.context.pendingRoutePosition,null);
});

test('actual same-account ready visit restores once before reveal without a focus scroll jump',()=>{
 const f=fixture(),origin={isConnected:true};f.retained.focusOrigin=origin;f.context.appEl.ownerDocument={activeElement:origin,body:{}};f.context.restore();f.context.restore();
 assert.equal(f.scroll.length,1);assert.equal(f.scroll[0].top,240);assert.equal(f.scroll[0].behavior,'instant');
 assert.equal(f.focus.length,1);assert.equal(f.focus[0].preventScroll,true);assert.equal(f.saves.length,1);assert.equal(f.context.pendingRoutePosition,null);
});

for(const options of [{ready:false},{hash:'#/game/other'}])test(`actual visit restoration waits for readiness and exact destination ${JSON.stringify(options)}`,()=>{
 const f=fixture(options);f.context.restore();assert.deepEqual(f.scroll,[]);assert.deepEqual(f.focus,[]);assert.equal(f.context.pendingRoutePosition,f.retained);
});

test('a missing saved Home card restores the stable heading without a focus scroll jump',()=>{
 const f=fixture(),selectors=[];
 f.context.appEl.querySelector=selector=>{selectors.push(selector);return selector.startsWith('.mini-board-card-link-surface')?null:{matches:()=>true,focus:options=>f.focus.push(options)};};
 f.context.restore();assert.equal(f.scroll.length,1);assert.equal(f.scroll[0].top,240);assert.deepEqual(f.focus,[{preventScroll:true}]);assert.ok(selectors.includes('.shell-header-title-link'));
});

test('a newer connected reader control prevents deferred visit scroll and focus stealing',()=>{
 const f=fixture(),origin={isConnected:true},body={},reader={isConnected:true};
 f.context.appEl.ownerDocument={activeElement:reader,body};f.retained.focusOrigin=origin;
 f.context.restore();assert.deepEqual(f.scroll,[]);assert.deepEqual(f.focus,[]);assert.equal(f.context.pendingRoutePosition,null);
});

test('a restored History or Players visit focuses its current panel instead of an inert Board',()=>{
 for(const [panel,selector]of [['history','[data-game-panel="history"] h2'],['players','[data-game-panel="join"] h2']]){
  const f=fixture(),queries=[],heading={isConnected:true,matches:()=>true,focus:options=>f.focus.push(options)},board={isConnected:true,closest:()=>({}),focus:()=>assert.fail('The inactive Board must not receive focus')};
  f.context.currentRoute={name:'game',panel};f.context.getGamePanel=route=>route.panel;f.retained.hash=`#/game/g?panel=${panel}`;f.context.window.location.hash=f.retained.hash;
  f.context.appEl.querySelector=query=>{queries.push(query);return query===selector?heading:board;};
  f.context.restore();assert.deepEqual(f.focus,[{preventScroll:true}]);assert.equal(f.scroll.length,1);assert.equal(f.scroll[0].top,240);assert.deepEqual(queries,[selector]);
 }
});
