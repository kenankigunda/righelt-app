import test from 'node:test';
import assert from 'node:assert/strict';
import {incomingNarrationContext,renderIncomingNarration} from '../shell/incoming-narration.js';

const entry = () => ({key:'scope:accepted7',gameId:'g',purpose:'incoming-narration',actorSide:'P2',
 message:{actorName:'Maya <(8, 8)>',text:'Maya <(8, 8)> rushed from (1, 2) to (2, 3)',coordinates:[{row:1,col:2},{row:2,col:3}],action:{id:'replay-computer',label:'Show me again'}},
 replay:{turnIndex:3,moveIds:['push','retreat','follow'],revision:7}});

test('only explicitly incoming content is selected from the mixed store for the current game',()=>{
 const contexts=[{...entry(),purpose:'selected-history'},{...entry(),gameId:'another'},entry(),{...entry(),purpose:'required-continuation',mandatory:true}];
 assert.equal(incomingNarrationContext(contexts,'g'),contexts[2]);assert.equal(incomingNarrationContext(contexts,'none'),null);
 assert.equal(incomingNarrationContext([{...entry(),purpose:undefined,message:{text:'Incoming move'}}],'g'),null);
});

test('real renderer provides one flat wide History host and no narrow presentation',()=>{
 const context=entry(),before=JSON.stringify(context);
 const wide=renderIncomingNarration(context,{layout:'wide',replayEnabled:true});
 assert.match(wide,/class="history-incoming incoming-owner-p2"/);assert.match(wide,/data-context-active-host="true"/);
 assert.match(wide,/Maya &lt;\(8, 8\)&gt;/);assert.match(wide,/board-preview-coordinate-chip/);assert.doesNotMatch(wide,/shell-game-alert|notice-paper|incoming-narration-toggle|Your turn/);
 assert.equal((wide.match(/data-action="replay-board-context"/g)??[]).length,1);
 assert.equal(renderIncomingNarration(context,{layout:'narrow',replayEnabled:false}),'');
 assert.equal(renderIncomingNarration(context,{layout:'unsettled'}),'');assert.equal(renderIncomingNarration({...context,purpose:'replay-progress'},{layout:'wide'}),'');
 assert.equal(JSON.stringify(context),before,'rendering cannot alter authority or replay payloads');
});

test('confirmed individual frames remain distinct and unknown actor identity never gains a player color',()=>{
 const first={...entry(),replay:null,key:'frame:one',actorSide:null};
 const html=renderIncomingNarration(first,{layout:'wide'});assert.match(html,/incoming-owner-neutral/);assert.doesNotMatch(html,/incoming-owner-p[12]/);
});

test('final outer purpose routes a synthetic incoming frame without trusting its historical body tag',()=>{
 const synthetic={...entry(),message:{...entry().message,purpose:'selected-history'}};
 assert.match(renderIncomingNarration(synthetic,{layout:'wide'}),/history-incoming/);
 assert.equal(renderIncomingNarration({...synthetic,purpose:'selected-history',message:{...synthetic.message,purpose:'incoming-narration'}},{layout:'narrow'}),'');
});

test('local push sequence retains accurate wide History copy and has no narrow surface',()=>{
 const sequence={...entry(),purpose:'local-sequence',actorSide:'P1',message:{text:'Your push group automatically followed',action:{id:'replay-push-sequence',label:'Show me again'}},replay:{source:'push-sequence',moveIds:['push','follow'],revision:8}};
 assert.equal(incomingNarrationContext([sequence],'g'),sequence);
 const wide=renderIncomingNarration(sequence,{layout:'wide',replayEnabled:true});
 assert.match(wide,/history-incoming incoming-owner-p1/);assert.match(wide,/Your push group automatically followed/);assert.match(wide,/Show me again/);
 assert.equal(renderIncomingNarration(sequence,{layout:'narrow',replayEnabled:true}),'');
});
