import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {closeHostInvitation,continueFriendIntroduction} from '../../../e2e/support/app.mjs';
for(const invitation of [false,true])test(`host invitation waits for deferred game entry before optional dismissal: ${invitation}`,async()=>{
 let clicks=0, mounted=false, release;
 const pending=new Promise(resolve=>{release=()=>{mounted=true;resolve();};});
 const closing=closeHostInvitation({
  getByTestId(id){assert.equal(id,'game-shell');return {waitFor:async options=>{assert.deepEqual(options,{state:'visible'});await pending;}};},
  getByRole(role,options){assert.equal(role,'button');assert.deepEqual(options,{name:'Close invite',exact:true});assert.equal(mounted,true);return {isVisible:async()=>invitation,click:async()=>{clicks++;}};}
 });
 assert.equal(clicks,0);release();await closing;
 assert.equal(clicks,Number(invitation));
});

test('legacy home continuation does not inspect or click a Friend introduction',async()=>{
 await continueFriendIntroduction({getByRole(){throw Error('Legacy path must not inspect a story');}},{friendIntroduction:false});
});

test('Friend continuation waits for its deferred modal and clicks exactly once',async()=>{
 let release,clicks=0;
 const mounted=new Promise(resolve=>{release=resolve;});
 const page={getByRole(role,options){
  assert.equal(role,'dialog');assert.deepEqual(options,{name:'Friend',exact:true});
  return {waitFor:async options=>{assert.deepEqual(options,{state:'visible'});await mounted;},getByRole(role,options){
   assert.equal(role,'button');assert.deepEqual(options,{name:'Start a friend game',exact:true});return {click:async()=>{clicks++;}};
  }};
 }};
 const continuation=continueFriendIntroduction(page,{friendIntroduction:true});
 assert.equal(clicks,0);release();await continuation;assert.equal(clicks,1);
});

test('missing required Friend introduction fails instead of taking the old path',async()=>{
 await assert.rejects(continueFriendIntroduction({getByRole:()=>({waitFor:async()=>{throw Error('story did not mount');}})},{friendIntroduction:true}),/story did not mount/);
});

test('account home readiness accepts an empty games list while retaining loader/action checks',async()=>{
 const source=await readFile(new URL('../../../validation-account-e2e/accounts.spec.mjs',import.meta.url),'utf8');
 const functionSource=source.slice(source.indexOf('async function settledHome('),source.indexOf('async function accountOpen('));
 for(const personalHome of [false,true]){
  const calls=[];
  const page={getByTestId:id=>({id,locator:selector=>({id:`${id} ${selector}`})})};
  const expect=locator=>({
   toBeVisible:async()=>calls.push([locator.id,'visible']),
   toBeEnabled:async()=>calls.push([locator.id,'enabled']),
   toHaveCount:async count=>calls.push([locator.id,'count',count]),
   toHaveAttribute:async(...values)=>calls.push([locator.id,'attribute',...values]),
  });
  page.locator=selector=>{
   assert.notEqual(selector,'[data-home-section-root="my"]','An empty section is absent by design');
   return {id:selector};
  };
  const settledHome=new Function('expect','capabilities',`${functionSource};return settledHome;`)(expect,{personalHome});
  await settledHome(page);
  assert.ok(calls.some(call=>call[0]==='home-create-game'&&call[1]==='visible'));
  assert.ok(calls.some(call=>call[0]==='home-create-game'&&call[1]==='enabled'));
  for(const id of ['home-section-skeleton','home-card-skeleton'])assert.ok(calls.some(call=>call[0]===id&&call[1]==='count'&&call[2]===0));
  assert.equal(calls.some(call=>call[0]==='resume-slot'),personalHome);
 }
});
