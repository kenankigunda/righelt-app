import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {renderBoardHeadingSlot,renderBoardMessageSlot,updateComputerBoardLoading} from '../shell/board-message-layout.js';
import {COMPUTER_PROFILES} from '../generated/packages/shared-types/src/computer-play.js';
import {describeComputerMove} from '../shell/computer-narration.js';

test('message reservation uses real profile narration and excludes duplicate live actions',()=>{
 const html=renderBoardMessageSlot({id:'shell-board-preview-label'});
 assert.equal((html.match(/id=/g)??[]).length,1);
 assert.equal((html.match(/board-message-sizing/g)??[]).length,Object.keys(COMPUTER_PROFILES).length*6);
 assert(!html.includes('data-action'));assert(!html.includes('data-board-message-action'));assert(!html.includes('data-board-preview-action'));
 for(const profile of Object.keys(COMPUTER_PROFILES)){
  assert(html.includes(describeComputerMove({computerProof:{profile},action:{type:'retreat',from:{row:9,col:9},to:{row:9,col:9}}})));
 }
 for(const paragraph of html.matchAll(/<p class="board-preview-label board-message-sizing"([^>]*)>(.*?)<\/p>/g)){
  assert(paragraph[1].includes('aria-hidden="true" inert'));
  assert(paragraph[2].includes('disabled tabindex="-1"'));
 }
});
test('loading retains identical sizing replicas without a visible prompt or identity',()=>{
 const loading=renderBoardMessageSlot({loading:true}),live=renderBoardMessageSlot();
 assert(loading.includes('<p class="board-preview-label" aria-hidden="true"></p>'));
 assert.equal(loading.slice(loading.indexOf('<p class="board-preview-label board-message-sizing"')),live.slice(live.indexOf('<p class="board-preview-label board-message-sizing"')));
 assert(!loading.includes(' id='));
 const app=readFileSync(new URL('../shell/app.js',import.meta.url),'utf8');
 assert(app.includes('renderBoardMessageSlot({loading:true})'));
 assert(app.includes('renderBoardMessageSlot({id:"shell-board-preview-label"})'));
 assert(app.includes('document.getElementById("shell-board-preview-label")'));
});

test('cold and live headings share reserved turn captions and one accessible heading',()=>{
 const live=renderBoardHeadingSlot(),loading=renderBoardHeadingSlot({loading:true});
 assert.equal((live.match(/id="shell-board-turn-indicator"/g)??[]).length,1);
 assert(!loading.includes('id='));
 for(const html of [live,loading]){
  assert.equal((html.match(/aria-hidden="true" inert role="presentation"/g)??[]).length,2);
  assert(html.includes('Player 1 to play'));assert(html.includes('Player 2 to play'));
 }
 const app=readFileSync(new URL('../shell/app.js',import.meta.url),'utf8');
 assert(app.includes('renderBoardHeadingSlot({loading:true})'));
 assert(app.includes('${renderBoardHeadingSlot()}'));
});

test('computer cue keeps one operation across search/save revisions and retires on nonworking views',()=>{
 const host={dataset:{loadingState:'idle'},hasAttribute(name){return name==='data-loading-key'&&this.dataset.loadingKey!==undefined;},removeAttribute(){delete this.dataset.loadingKey;}};
 const game={id:'g',computer:{paused:false},computerTurn:'horus'};
 updateComputerBoardLoading(host,game,{phase:'preparing'},{scope:'owner1'});const key=host.dataset.loadingKey;
 for(const phase of ['checking','looking-ahead','saving']){updateComputerBoardLoading(host,{...game,gameplayRevision:7,pendingComputerSaveStartedAt:0},{phase},{scope:'owner1'});assert.equal(host.dataset.loadingKey,key);}
 for(const options of [{game:{...game,computerTurn:null}},{game:{...game,inHistoryMode:true}},{game:{...game,computer:{paused:true}}},{status:{phase:'recovery'}},{status:{phase:'other-device'}},{replaying:true}]){
  updateComputerBoardLoading(host,options.game??game,options.status??{}, {scope:'owner1',replaying:options.replaying});
  assert.equal(host.dataset.loadingState,'idle');assert.equal(host.dataset.loadingKey,undefined);
  updateComputerBoardLoading(host,game,{}, {scope:'owner1'});assert.notEqual(host.dataset.loadingKey,key);
 }
 const previous=host.dataset.loadingKey;updateComputerBoardLoading(host,game,{}, {scope:'owner2'});assert.notEqual(host.dataset.loadingKey,previous);
});
