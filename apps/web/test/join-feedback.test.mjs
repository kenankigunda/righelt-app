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
