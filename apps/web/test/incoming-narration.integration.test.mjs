import test from 'node:test';
import assert from 'node:assert/strict';
import {incomingNarrationContext,createIncomingNarrationState,renderIncomingNarration,syncIncomingNarrationRoot} from '../shell/incoming-narration.js';

const entry = () => ({key:'scope:accepted7',gameId:'g',purpose:'incoming-narration',actorSide:'P2',
 message:{actorName:'Maya <(8, 8)>',text:'Maya <(8, 8)> rushed from (1, 2) to (2, 3)',coordinates:[{row:1,col:2},{row:2,col:3}],action:{id:'replay-computer',label:'Show me again'}},
 replay:{turnIndex:3,moveIds:['push','retreat','follow'],revision:7}});

test('only explicitly incoming content is selected from the mixed store for the current game',()=>{
 const contexts=[{...entry(),purpose:'selected-history'},{...entry(),gameId:'another'},entry(),{...entry(),purpose:'required-continuation',mandatory:true}];
 assert.equal(incomingNarrationContext(contexts,'g'),contexts[2]);assert.equal(incomingNarrationContext(contexts,'none'),null);
 assert.equal(incomingNarrationContext([{...entry(),purpose:undefined,message:{text:'Incoming move'}}],'g'),null);
});

test('real renderer provides one flat History host or one bottom flyout without a notification card',()=>{
 const context=entry(),before=JSON.stringify(context);
 const wide=renderIncomingNarration(context,{layout:'wide',replayEnabled:true});
 assert.match(wide,/class="history-incoming incoming-owner-p2"/);assert.match(wide,/data-context-active-host="true"/);
 assert.match(wide,/Maya &lt;\(8, 8\)&gt;/);assert.match(wide,/board-preview-coordinate-chip/);assert.doesNotMatch(wide,/shell-game-alert|notice-paper|incoming-narration-toggle|Your turn/);
 assert.equal((wide.match(/data-action="replay-board-context"/g)??[]).length,1);
 const narrow=renderIncomingNarration(context,{layout:'narrow',replayEnabled:false});
 assert.match(narrow,/<aside class="incoming-move-flyout incoming-owner-p2"/);assert.match(narrow,/aria-expanded="true"/);assert.match(narrow,/data-action="replay-board-context"[^>]* disabled/);
 assert.equal((narrow.match(/data-context-active-host="true"/g)??[]).length,1);assert.doesNotMatch(narrow,/style=|max-height|overflow|notice-paper/);
 assert.equal(renderIncomingNarration(context,{layout:'unsettled'}),'');assert.equal(renderIncomingNarration({...context,purpose:'replay-progress'},{layout:'wide'}),'');
 assert.equal(JSON.stringify(context),before,'rendering cannot alter authority or replay payloads');
});

test('collapsed mobile surface has exact reveal copy and no hidden replay control',()=>{
 const html=renderIncomingNarration(entry(),{layout:'narrow',expanded:false,replayEnabled:true});
 assert.match(html,/>Show previous turn<svg/);assert.match(html,/aria-expanded="false"/);
 assert.doesNotMatch(html,/data-action="replay-board-context"|shell-incoming-move-body|incoming-narration-copy/);
});

test('explicit collapse survives same-turn revision and responsive rendering without extra lifetime timers',()=>{
 const owner=createIncomingNarrationState(),first=entry(),before=JSON.stringify(first);
 assert.deepEqual(owner.observe(first),{context:first,expanded:true,arrival:true,episode:'["g",3,["push","retreat","follow"]]'});
 assert.equal(owner.toggle(first.key),true);
 const updated={...first,key:'scope:accepted8',replay:{...first.replay,revision:8}};
 const next=owner.observe(updated);assert.equal(next.expanded,false);assert.equal(next.arrival,false);
 assert.equal(owner.toggle(first.key),false,'old native intent cannot act on a replaced context');
 renderIncomingNarration(updated,{layout:'wide',expanded:next.expanded});renderIncomingNarration(updated,{layout:'narrow',expanded:next.expanded});
 assert.equal(owner.observe(updated).expanded,false);assert.equal(JSON.stringify(first),before);
 const later={...entry(),key:'scope:later',replay:{turnIndex:5,moveIds:['new-action'],revision:9}};
 assert.equal(owner.observe(later).expanded,true);assert.equal(owner.observe(later).arrival,false);
 owner.retire();assert.equal(owner.toggle(later.key),false);assert.equal(owner.observe(null).context,null);
});

test('confirmed individual frames remain distinct and unknown actor identity never gains a player color',()=>{
 const owner=createIncomingNarrationState(),first={...entry(),replay:null,key:'frame:one',actorSide:null};
 owner.observe(first);owner.toggle(first.key);assert.equal(owner.observe({...first,key:'frame:two'}).arrival,true);
 const html=renderIncomingNarration(first,{layout:'wide'});assert.match(html,/incoming-owner-neutral/);assert.doesNotMatch(html,/incoming-owner-p[12]/);
});

test('final outer purpose routes a synthetic incoming frame without trusting its historical body tag',()=>{
 const synthetic={...entry(),message:{...entry().message,purpose:'selected-history'}};
 assert.match(renderIncomingNarration(synthetic,{layout:'wide'}),/history-incoming/);
 assert.equal(renderIncomingNarration({...synthetic,purpose:'selected-history',message:{...synthetic.message,purpose:'incoming-narration'}},{layout:'narrow'}),'');
});

test('mobile incoming root mounts once between the header and game shell and repairs reversed order',()=>{
 const document={createElement:()=>({attributes:new Map(),parentElement:null,nextElementSibling:null,setAttribute(name,value){this.attributes.set(name,value);}})};
 const header={name:'header'},shell={name:'game-shell'},children=[header,shell],patches=[];
 const refresh=()=>children.forEach((node,index)=>{node.parentElement=main;node.nextElementSibling=children[index+1]??null;});
 const main={insertBefore(node,before){const current=children.indexOf(node);if(current>=0)children.splice(current,1);const target=children.indexOf(before);children.splice(target<0?children.length:target,0,node);refresh();}};refresh();
 const app={ownerDocument:document,get firstElementChild(){return main;},querySelector(selector){if(selector==='[data-game-shell-root]')return shell;return children.find(node=>node.attributes?.has('data-incoming-narration-root'))??null;},insertBefore(){assert.fail('incoming root belongs with the game shell, not before the page header');}};
 const patch=(host,html)=>patches.push({host,html});
 const host=syncIncomingNarrationRoot(app,'<aside>incoming</aside>',patch);
 assert.deepEqual(children,[header,host,shell]);assert.equal(host.attributes.get('data-incoming-narration-root'),'');
 assert.deepEqual(patches.map(entry=>entry.html),['<aside>incoming</aside>']);
 assert.equal(syncIncomingNarrationRoot(app,'<aside>updated</aside>',patch),host);assert.equal(children.filter(node=>node===host).length,1);
 children.splice(1,2,shell,host);refresh();
 assert.equal(syncIncomingNarrationRoot(app,'<aside>settled</aside>',patch),host);assert.deepEqual(children,[header,host,shell]);
 assert.deepEqual(patches.map(entry=>entry.html),['<aside>incoming</aside>','<aside>updated</aside>','<aside>settled</aside>']);
});

test('empty mobile narration does not manufacture a focus stop',()=>{
 const shell={},children=[shell],app={ownerDocument:{createElement(){assert.fail('empty narration cannot create a root');}},get firstElementChild(){return children[0];},querySelector(){return null;},insertBefore(){assert.fail('empty narration cannot change document order');}};
 assert.equal(syncIncomingNarrationRoot(app,'',()=>assert.fail('empty narration has nothing to patch')),null);
 assert.deepEqual(children,[shell]);
});
