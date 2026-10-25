import test from 'node:test';
import assert from 'node:assert/strict';
import {createLiveTransportStore} from '../shell/live-transport.js';
import {CURRENT_COMPUTER_MODEL} from '../generated/packages/shared-types/src/computer-play.js';
import {IDENTITY_KEY} from '../shell/persistence.js';
for(const operation of ['createGame','launchHistoryBranch'])for(const requested of [undefined,'initial-1554'])test(`${operation} serializes the selected model without replacing a retained choice: ${requested??'current'}`,async t=>{
 let sent;const storage={getItem:key=>key===IDENTITY_KEY?'owner':null,setItem(){},removeItem(){}};
 const store=createLiveTransportStore({storage,commandJournal:{list:async()=>[]},fetcher:async(url,options)=>{sent={url,body:JSON.parse(options.body)};return Response.json({error:'test-stop'},{status:400});}});t.after(()=>store.retire());
 await assert.rejects(store[operation]({computer:{p1:'babs',p2:null},computerModelId:requested,sourceGameId:'source',sourceDecisionId:'decision'}),/test-stop/);
 assert.equal(sent.body.computerModelId,requested??CURRENT_COMPUTER_MODEL.id);assert.deepEqual(sent.body.computer,{p1:'babs',p2:null});
});
