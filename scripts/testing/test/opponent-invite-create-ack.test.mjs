import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {runInNewContext} from 'node:vm';
const source=readFileSync(new URL('../../../e2e/workflows/opponent-invite-polish.spec.mjs',import.meta.url),'utf8');
const start=source.indexOf("  await page.goto('/');await waitForLegacyIdentity(page);");
const end=source.indexOf('  const viewerContext=',start);
assert.ok(start>=0&&end>start,'the actual first invitation callback prefix must exist');
const prefix=source.slice(start,end);
const originalPrefix="  await page.goto('/');await waitForLegacyIdentity(page);\n  await page.getByTestId('home-create-game').click();await continueFriendIntroduction(page,{friendIntroduction:true});\n  const dialog=page.getByRole('dialog',{name:'Invite a friend',exact:true});await expect(dialog).toBeVisible();\n  await expect(dialog.locator('[data-invite-role=\"viewer\"]')).toHaveCount(0);\n  const gameId=decodeURIComponent(new URL(page.url()).hash.match(/^#\\/game\\/([^?]+)/)[1]);\n  const game=await page.evaluate(async id=>{\n   const identityId=localStorage.getItem('righelt.identity.id.v1');return(await(await fetch(`/api/shell/games/${id}?identityId=${encodeURIComponent(identityId)}`)).json()).game;\n  },gameId);\n";
assert.equal(createHash('sha256').update(originalPrefix).digest('hex'),'6f745895640e7fec3bd1858fdb9f05447bcff7a0ed190ec3706bacbb542dbbd5');
const flush=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(code=prefix,{postStatus=200,postOk=true,postId='game-held',getStatus=200,getOk=true,getId='game-held',earlyFailureAt=null,primaryError=null}={}){
 const events=[],game={id:'game-held',inviteTokens:{viewer:'viewer'},inviteToken:'player'};
 let release,reject,acknowledged=false,creates=0,reads=0;
 const held=new Promise((resolve,rejectResponse)=>{release=resolve;reject=rejectResponse;});
 const response={url:()=> 'http://127.0.0.1:9888/api/shell/games',request:()=>({method:()=> 'POST'}),status:()=>postStatus,json:async()=>{events.push('creation-body');return {ok:postOk,game:{...game,id:postId}};}};
 const dialog={kind:'dialog',locator:()=>({kind:'viewer-choice'})};
 const page={goto:async()=>events.push('goto'),url:()=> 'http://127.0.0.1:9888/#/game/game-held',
  waitForResponse(predicate){events.push('capture');assert.equal(predicate(response),true);assert.equal(predicate({...response,request:()=>({method:()=> 'GET'})}),false);assert.equal(predicate({...response,url:()=> 'http://127.0.0.1:9888/api/other'}),false);return held;},
  getByTestId(id){assert.equal(id,'home-create-game');return {click:async()=>{creates++;events.push('create-click');if(earlyFailureAt==='click')throw primaryError;}};},
  getByRole(role,options){assert.equal(role,'dialog');assert.equal(options.name,'Invite a friend');return dialog;},
  evaluate:async(fn,id)=>fn(id)};
 const expect=value=>({toBe(expected){assert.equal(value,expected);},async toBeVisible(){assert.equal(value,dialog);events.push('invite-visible');if(earlyFailureAt==='invite')throw primaryError;},async toHaveCount(n){assert.equal(value.kind,'viewer-choice');assert.equal(n,0);events.push('viewer-choice-absent');}});
 const context={page,expect,URL,waitForLegacyIdentity:async()=>{},continueFriendIntroduction:async()=>events.push('friend-introduction'),localStorage:{getItem:key=>{assert.equal(key,'righelt.identity.id.v1');return 'identity-held';}},fetch:async url=>{
  reads++;events.push(acknowledged?'read-after-ack':'read-before-ack');assert.equal(url,'/api/shell/games/game-held?identityId=identity-held');
  return acknowledged?{status:getStatus,json:async()=>({ok:getOk,game:{...game,id:getId}})}:{status:404,json:async()=>({ok:false,error:'game_not_found'})};
 }};
 const result=runInNewContext('(async()=>{'+code+'return game;})()',context);
 return {result,events,game,reject,counts:()=>({creates,reads}),release(){acknowledged=true;events.push('creation-ack');release(response);}};
}

test('the actual native-create callback holds its single authority read until the original creation acknowledgment',async()=>{
 const f=fixture();await flush();
 assert.deepEqual(f.counts(),{creates:1,reads:0});
 assert.ok(f.events.indexOf('capture')<f.events.indexOf('create-click'));
 assert.ok(f.events.includes('invite-visible'));assert.ok(f.events.includes('viewer-choice-absent'));
 f.release();const game=await f.result;assert.equal(game.id,'game-held');
 assert.deepEqual(f.counts(),{creates:1,reads:1});
 assert.ok(f.events.indexOf('creation-body')<f.events.indexOf('read-after-ack'));
 assert.equal(f.events.includes('read-before-ack'),false);
});

test('immutable main16779 callback demonstrates the original held-create404 ordering counterexample',async()=>{
 const f=fixture(originalPrefix);await flush();
 assert.deepEqual(f.counts(),{creates:1,reads:1});assert.ok(f.events.includes('read-before-ack'));
 assert.equal(await f.result,undefined);f.release();
});

for(const [label,options]of [['status',{postStatus:503}],['body-ok',{postOk:false}],['game-id',{postId:'different-game'}]])test(`creation ${label} mismatch fails before an authority read`,async()=>{
 const f=fixture(prefix,options);await flush();assert.deepEqual(f.counts(),{creates:1,reads:0});
 f.release();await assert.rejects(f.result);assert.equal(f.counts().reads,0);
});
for(const [label,options]of [['status',{getStatus:404}],['body-ok',{getOk:false}],['game-id',{getId:'different-game'}]])test(`authority ${label} mismatch fails before downstream invitation actions`,async()=>{
 const f=fixture(prefix,options);await flush();f.release();await assert.rejects(f.result);
 assert.deepEqual(f.counts(),{creates:1,reads:1});assert.equal(f.events.includes('read-before-ack'),false);
});

for(const earlyFailureAt of ['click','invite'])test(`early ${earlyFailureAt} failure stays primary when original response rejects during cleanup`,async()=>{
 const primaryError=Error(`primary-${earlyFailureAt}`),cleanupError=Error('creation-page-closed');
 const f=fixture(prefix,{earlyFailureAt,primaryError});
 await assert.rejects(f.result,error=>error===primaryError);
 f.reject(cleanupError);await flush();await flush();
 await assert.rejects(f.result,error=>error===primaryError);
 assert.equal(f.counts().reads,0,'cleanup must not start the authority read');
});

test('a rejection of the original creation response still propagates through its later await',async()=>{
 const responseError=Error('creation-response-failed'),f=fixture();await flush();
 assert.equal(f.counts().reads,0);f.reject(responseError);
 await assert.rejects(f.result,error=>error===responseError);
 await flush();assert.equal(f.counts().reads,0);
});
