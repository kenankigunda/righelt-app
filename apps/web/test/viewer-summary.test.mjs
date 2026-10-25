import test from 'node:test';
import assert from 'node:assert/strict';
import {viewerSummary} from '../shell/viewer-summary.js';
const named = (name,identityId=name) => ({identityId,profile:{displayName:name,username:name.toLowerCase()}});
test('empty, guest-only and singular summaries stay compact',()=>{
 assert.equal(viewerSummary().text,'No viewers');
 assert.equal(viewerSummary([{identityId:'a'}]).text,'1 guest');
 assert.equal(viewerSummary([{identityId:'a'},{identityId:'b'}]).text,'2 guests');
});
test('two names precede remaining named viewers and guest counts',()=>{
 const viewers=[named('Ada'),{identityId:'a'},named('Bo'),named('Cy'),{identityId:'b'}];
 const result=viewerSummary(viewers);
 assert.equal(result.text,'Ada, Bo, 1 other, and 2 guests');
 assert.equal(result.count,5);
 assert.deepEqual(result.entries.map(v=>v.identityId),['Ada','Bo','Cy','a','b']);
 assert.equal(viewers[1].identityId,'a','input order is unchanged');
});
test('the current viewer takes the first name slot even when a guest',()=>{
 assert.equal(viewerSummary([named('Ada'),{identityId:'me'},named('Bo'),{identityId:'guest'}],{identityId:'me'}).text,'You, Ada, 1 other, and 1 guest');
});
test('username fallback, duplicate display names and repeated identities',()=>{
 assert.equal(viewerSummary([{identityId:'a',profile:{username:'handle'}},named('Ada','b'),named('Ada','c'),named('Ada','b')]).text,'handle, Ada, and 1 other');
 assert.equal(viewerSummary([{identityId:'me'}],{identityId:'different'}).text,'1 guest');
});
