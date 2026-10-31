import test from 'node:test';
import assert from 'node:assert/strict';
import {restoreHomeFocus,refreshHomeFocus} from '../shell/home-focus.js';
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
  assert.equal(restoreHomeFocus(rootFor([],heading),{active:{isConnected:true},sectionKey:'completed'}),false);
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
