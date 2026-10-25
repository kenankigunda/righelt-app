import test from 'node:test';
import assert from 'node:assert/strict';
import {createJoinFeedback} from '../shell/join-feedback.js';
const fixture=()=>{let scope={owner:{},generation:1,visit:0,route:'#/invite/a'};return {feedback:createJoinFeedback({getScope:gameId=>({gameId,...scope})}),change:values=>Object.assign(scope,values)};};
test('join error remains static across unrelated reads and clears only on an intentional retry or success',()=>{
 const {feedback}=fixture();const first=feedback.begin('g');assert.equal(feedback.message('g'),null);assert.equal(feedback.fail(first),true);
 for(let i=0;i<5;i++)assert.equal(feedback.message('g'),'Could not join. Try again');
 const retry=feedback.begin('g');assert.equal(feedback.message('g'),null);assert.equal(feedback.fail(first),false);assert.equal(feedback.complete(retry),true);assert.equal(feedback.message('g'),null);assert.equal(feedback.fail(retry),false);
});
for(const change of [{generation:2},{owner:{}},{visit:1},{route:'#/' }])test(`late join failure is ignored after scope change ${Object.keys(change)[0]}`,()=>{
 const {feedback,change:alter}=fixture();const token=feedback.begin('g');alter(change);assert.equal(feedback.fail(token),false);assert.equal(feedback.isCurrent(token),false);assert.equal(feedback.message('g'),null);assert.equal(feedback.complete(token),false);
});
test('route away and back retires the earlier request even with identical final URL',()=>{
 const {feedback}=fixture();const old=feedback.begin('g');feedback.clear();const next=feedback.begin('g');assert.equal(feedback.fail(old),false);assert.equal(feedback.isCurrent(next),true);feedback.fail(next);assert.equal(feedback.message('other'),null);feedback.clear();assert.equal(feedback.message('g'),null);
});

const focusFixture=()=>{
 const {feedback,change}=fixture();
 const body={},document={body,activeElement:body,hidden:false,hasFocus:()=>true};
 const control={disabled:false,closest(){return this;},getAttribute:name=>name==='data-action'?'accept-invite-player':name==='data-game-id'?'g':null,
  focus(options){assert.deepEqual(options,{preventScroll:true});document.activeElement=this;feedback.noteFocus(this);}};
 const root={querySelectorAll:()=>[control]};
 return {feedback,change,body,document,control,root};
};
test('failed join focus belongs to its enabled logical action and survives later replacements',()=>{
 const f=focusFixture(),token=f.feedback.begin('g',{focusAction:'accept-invite-player'});
 f.feedback.fail(token);
 for(let i=0;i<2;i++){
  f.document.activeElement=f.body;
  assert.equal(f.feedback.restoreFocus({...f,previousActive:i?f.control:f.body}),true);
  assert.equal(f.document.activeElement,f.control);
 }
});
test('deliberate focus and pointer movement retire failed-join focus intent',()=>{
 for(const target of [{},null]){
  const f=focusFixture(),token=f.feedback.begin('g',{focusAction:'accept-invite-player'});f.feedback.fail(token);
  f.feedback.noteFocus(target);
  assert.equal(f.feedback.restoreFocus({...f,previousActive:f.body}),false);
  assert.equal(f.document.activeElement,f.body);
 }
});
test('focus restoration rejects unavailable controls, unrelated focus and stale scopes',()=>{
 for(const mode of ['disabled','hidden','background','previous-other','current-other','stale','unarmed','success']){
  const f=focusFixture(),token=f.feedback.begin('g',mode==='unarmed'?{}:{focusAction:'accept-invite-player'});f.feedback.fail(token);
  let previousActive=f.body;
  if(mode==='disabled')f.control.disabled=true;
  if(mode==='hidden')f.document.hidden=true;
  if(mode==='background')f.document.hasFocus=()=>false;
  if(mode==='previous-other')previousActive={};
  if(mode==='current-other')f.document.activeElement={};
  if(mode==='stale')f.change({visit:1});
  if(mode==='success')f.feedback.complete(token);
  const before=f.document.activeElement;
  assert.equal(f.feedback.restoreFocus({...f,previousActive}),false,mode);
  assert.equal(f.document.activeElement,before,mode);
 }
});
