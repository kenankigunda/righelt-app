import test from 'node:test';
import assert from 'node:assert/strict';
import {restoreHomeFocus,refreshHomeFocus,restoreHomeReadingPosition} from '../shell/home-focus.js';
const target=id=>({getAttribute:()=>id,matches:()=>true,focus(options){this.focused=options;}});
const rootFor=(cards,heading=target('heading'))=>({querySelectorAll:()=>[{getAttribute:()=> 'completed',querySelectorAll:()=>cards,querySelector:()=>heading}],querySelector:()=>target('start')});
test('a retained Home card keeps keyboard focus without changing scroll',()=>{
  const card=target('same');
  assert.equal(restoreHomeFocus(rootFor([card]),{active:{isConnected:false},sectionKey:'completed',gameId:'same',cardIndex:0}),true);
  assert.deepEqual(card.focused,{preventScroll:true});
});
test('accepted Undo selects a stable neighbor in the old section instead of jumping sections',()=>{
  const neighbor=target('neighbor');
  restoreHomeFocus(rootFor([neighbor]),{active:{isConnected:false},sectionKey:'completed',gameId:'reopened',cardIndex:2});
  assert.deepEqual(neighbor.focused,{preventScroll:true});
});
test('an empty old page uses its heading and leaves connected controls untouched',()=>{
  const heading=target('heading');
  restoreHomeFocus(rootFor([],heading),{active:{isConnected:false},sectionKey:'completed',cardIndex:0});
  assert.deepEqual(heading.focused,{preventScroll:true});
  delete heading.focused;
  const connected={isConnected:true};
  assert.equal(restoreHomeFocus(rootFor([],heading),{active:connected,sectionKey:'completed'},{activeElement:connected}),false);
  assert.equal(heading.focused,undefined);
});

test('focus moved to a connected header while Home refresh waits is never stolen',()=>{
  const header=target('header');header.isConnected=true;
  const document={activeElement:header,body:{}};
  const card=target('old');card.isConnected=false;
  const captured={active:card,sectionKey:'completed',gameId:'old',cardIndex:0};
  assert.equal(restoreHomeFocus(rootFor([target('neighbor')]),captured,document),false);
  header.closest=()=>null;
  assert.equal(refreshHomeFocus({contains:()=>false},captured,document),null);
});

test('a list patch preserves the section viewport anchor while document height changes',()=>{
 const scrolls=[];
 let top=330;
 const section={getAttribute:()=> 'completed',getBoundingClientRect:()=>({top})};
 const listeners={};const body={};const document={activeElement:body,body,addEventListener:(type,listener)=>listeners[type]=listener,defaultView:{scrollBy:options=>scrolls.push(options)}};
 const root={querySelectorAll:()=>[section]};
 const captured=refreshHomeFocus(root,{active:{isConnected:false},sectionKey:'completed'},document);
 top=455;restoreHomeReadingPosition(root,captured,document);
 assert.deepEqual(scrolls,[{top:125,behavior:'instant'}]);
 // Browser clamping/internal patches cannot ratchet the original anchor.
 top=360;assert.equal(refreshHomeFocus(root,captured,document).sectionTop,330);
 // A real user wheel before the next patch becomes the new reading position.
 listeners.wheel({isTrusted:true});
 top=220;const next=refreshHomeFocus(root,captured,document);
 top=250;restoreHomeReadingPosition(root,next,document);
 assert.deepEqual(scrolls[1],{top:30,behavior:'instant'});
 document.activeElement={isConnected:true};restoreHomeReadingPosition(root,next,document);
 assert.equal(scrolls.length,2);
});

test('only actual user scrolling supersedes a pending Home reading anchor',()=>{
 const listeners={};let top=300;
 const section={getAttribute:()=> 'completed',getBoundingClientRect:()=>({top})};
 const body={};const document={body,activeElement:body,documentElement:{clientWidth:1000,clientHeight:800},addEventListener:(type,callback)=>listeners[type]=callback};
 const root={querySelectorAll:()=>[section]};
 let captured=refreshHomeFocus(root,{active:{isConnected:false},sectionKey:'completed'},document);
 top=400;listeners.wheel({isTrusted:false});assert.equal(refreshHomeFocus(root,captured,document).sectionTop,300);
 listeners.keydown({isTrusted:true,key:' ',target:{closest:()=>({})}});assert.equal(refreshHomeFocus(root,captured,document).sectionTop,300);
 listeners.keydown({isTrusted:true,key:'PageDown',target:{closest:()=>null}});captured=refreshHomeFocus(root,captured,document);assert.equal(captured.sectionTop,400);
 top=450;listeners.touchmove({isTrusted:true});captured=refreshHomeFocus(root,captured,document);assert.equal(captured.sectionTop,450);
 top=500;listeners.pointerdown({isTrusted:true,clientX:1001,clientY:400});assert.equal(refreshHomeFocus(root,captured,document).sectionTop,500);
});
