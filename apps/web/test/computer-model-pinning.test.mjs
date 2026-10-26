import test from 'node:test';
import assert from 'node:assert/strict';
import {createLiveTransportStore} from '../shell/live-transport.js';
import {CURRENT_COMPUTER_MODEL,createComputerControl,changeComputerControl,parseComputerControl} from '../generated/packages/shared-types/src/computer-play.js';
import {renderComputerProgress} from '../shell/computer-view.js';
import {IDENTITY_KEY} from '../shell/persistence.js';
for(const operation of ['createGame','launchHistoryBranch'])for(const requested of [undefined,'initial-1554'])test(`${operation} serializes the selected model without replacing a retained choice: ${requested??'current'}`,async t=>{
 let sent;const storage={getItem:key=>key===IDENTITY_KEY?'owner':null,setItem(){},removeItem(){}};
 const store=createLiveTransportStore({storage,commandJournal:{list:async()=>[]},fetcher:async(url,options)=>{sent={url,body:JSON.parse(options.body)};return Response.json({error:'test-stop'},{status:400});}});t.after(()=>store.retire());
 await assert.rejects(store[operation]({computer:{p1:'babs',p2:null},computerModelId:requested,sourceGameId:'source',sourceDecisionId:'decision'}),/test-stop/);
 assert.equal(sent.body.computerModelId,requested??CURRENT_COMPUTER_MODEL.id);assert.deepEqual(sent.body.computer,{p1:'babs',p2:null});
});

test('retained1554 update notice offers an explicit choice and Keep current never changes its model',()=>{
 assert.notEqual(CURRENT_COMPUTER_MODEL.id,'initial-1554','This promotion must publish a different current model');
 const input={ownerId:'owner',authContextId:'session',deviceId:'device',turnIndex:4,now:100};
 const original=changeComputerControl(createComputerControl('owner',{p1:null,p2:'tau'},'initial-1554'),{...input,generation:0,action:'acquire'});
 const before=structuredClone(original),game={id:'retained',canControlComputer:true,computerTurn:null,computer:original};
 const offered=renderComputerProgress(game,{phase:'idle'});
 assert.match(offered,/data-control="upgrade"[^>]*>[\s\S]*?Update opponent/);
 assert.match(offered,/data-control="decline-upgrade"[^>]*>[\s\S]*?Keep current/);
 assert.deepEqual(original,before,'Rendering the update choice cannot mutate a retained control');
 const declined=changeComputerControl(original,{...input,generation:original.generation,action:'decline-upgrade'});
 assert.equal(declined.modelId,'initial-1554');assert.equal(declined.declinedModelId,CURRENT_COMPUTER_MODEL.id);
 assert.equal(declined.generation,original.generation+1);assert.deepEqual(original,before);
 const reloaded=parseComputerControl(JSON.parse(JSON.stringify(declined)));
 assert.equal(reloaded.modelId,'initial-1554');assert.equal(renderComputerProgress({...game,computer:reloaded},{phase:'idle'}),'');
});
