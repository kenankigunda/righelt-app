import test from 'node:test';
import assert from 'node:assert/strict';
import {closeHostInvitation} from '../../../e2e/support/app.mjs';
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
