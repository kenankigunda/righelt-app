import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {renderBoardHeadingSlot,renderBoardMessageSlot,updateComputerBoardLoading} from '../shell/board-message-layout.js';
import {COMPUTER_PROFILES} from '../generated/packages/shared-types/src/computer-play.js';
import {describeComputerMove,describeMove} from '../shell/computer-narration.js';
import {renderBoardMessageHtml} from '../board/message-presentation.js';
import {SELECTED_PIECE_EXPLANATIONS} from '../board/piece-explanations.js';

test('message reservation uses real profile narration and excludes duplicate live actions',()=>{
 const html=renderBoardMessageSlot({id:'shell-board-preview-label'});
 assert.equal((html.match(/id=/g)??[]).length,1);
 assert.equal((html.match(/board-message-sizing/g)??[]).length,((Object.keys(COMPUTER_PROFILES).length+4)*15+SELECTED_PIECE_EXPLANATIONS.length*4)*2);
 assert(!html.includes('data-action'));assert(!html.includes('data-board-message-action'));assert(!html.includes('data-board-preview-action'));
 for(const profile of Object.keys(COMPUTER_PROFILES)){
  assert(html.includes(renderBoardMessageHtml({text:describeComputerMove({computerProof:{profile},action:{type:'retreat',from:{row:9,col:9},to:{row:9,col:9}}}),coordinates:[{row:9,col:9}]})));
 }
 for(const name of ['Your opponent','Red','Blue'])assert(html.includes(renderBoardMessageHtml({text:describeMove({action:{type:'retreat',from:{row:9,col:9},to:{row:9,col:9}}},name),coordinates:[{row:9,col:9}]})));
 for(const paragraph of html.matchAll(/<p class="board-preview-label board-message-sizing board-message-narration-sizing"([^>]*)>(.*?)<\/p>/g)){
  assert(paragraph[1].includes('aria-hidden="true" inert'));
  assert.equal((paragraph[2].match(/disabled tabindex="-1"/g)??[]).length,2);
  assert(paragraph[2].includes('>Pass</span></button>'));assert(paragraph[2].includes('>Show me again</span></button>'));
 }
 assert(html.includes('Your opponent rushed 2 pieces to'));
 assert(html.includes('lost piece at'));assert(html.includes('destroyed piece at'));
 assert((html.match(/board-message-narration-sizing/g)??[]).length>0);
 assert(html.includes('and had 1 piece follow'));assert(html.includes('and had 2 pieces follow'));
 assert(html.includes(`class="board-message-name" dir="auto" title="${'W'.repeat(32)}"`));
 for(const explanation of SELECTED_PIECE_EXPLANATIONS) assert(html.includes(explanation));
 const continuations=[...html.matchAll(/<p class="board-preview-label board-message-sizing board-explanation-sizing"[^>]*>(.*?)<\/p>/g)].map(match=>match[1]);
 assert(continuations.some(text=>text.includes('Reconnect piece at')&&text.includes('board-preview-coordinate-chip')));
 for(const text of continuations)if(/Reconnect piece|Select a retreat|Select a follow/.test(text))assert(!text.includes('End turn'));
});
test('loading retains identical sizing replicas without a visible prompt or identity',()=>{
 const loading=renderBoardMessageSlot({loading:true}),live=renderBoardMessageSlot();
 assert(loading.includes('<p class="board-preview-label" aria-hidden="true"></p>'));
 assert.equal(loading.slice(loading.indexOf('<p class="board-preview-label board-message-sizing"')),live.slice(live.indexOf('<p class="board-preview-label board-message-sizing"')));
 assert(!loading.includes(' id='));
 const app=readFileSync(new URL('../shell/app.js',import.meta.url),'utf8');
 assert(app.includes('renderBoardMessageSlot({loading:true,loadingKey:`game:${gameId}`})'));
 assert(app.includes('renderBoardMessageSlot({id:"shell-board-preview-label"})'));
 assert(app.includes('document.getElementById("shell-board-preview-label")'));
});

test('cold and live headings share reserved turn captions and one accessible heading',()=>{
 const live=renderBoardHeadingSlot(),loading=renderBoardHeadingSlot({loading:true});
 assert.equal((live.match(/id="shell-board-turn-indicator"/g)??[]).length,1);
 assert(!loading.includes('id='));
 for(const html of [live,loading]){
  assert.equal((html.match(/aria-hidden="true" inert role="presentation"/g)??[]).length,8);
  for(const font of ['primary','fallback'])for(let index=0;index<4;index++)assert(html.includes(`data-heading-sizing-font="${font}" data-heading-sizing-caption="${index}"`));
  for(const caption of ['Your turn to play','Opponent to play','Guest 1 to play','Guest 2 to play'])assert(html.includes(caption));
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
 updateComputerBoardLoading(host,game,{phase:'checking'},{scope:'owner1',inspecting:true});assert.equal(host.dataset.loadingKey,key);assert.equal(host.dataset.loadingSuppressed,'true');
 updateComputerBoardLoading(host,game,{phase:'checking'},{scope:'owner1'});assert.equal(host.dataset.loadingKey,key);assert.equal(host.dataset.loadingSuppressed,'false');
 for(const options of [{game:{...game,computerTurn:null}},{game:{...game,inHistoryMode:true}},{game:{...game,computer:{paused:true}}},{status:{phase:'recovery'}},{status:{phase:'other-device'}},{replaying:true}]){
  updateComputerBoardLoading(host,options.game??game,options.status??{}, {scope:'owner1',replaying:options.replaying});
  assert.equal(host.dataset.loadingState,'idle');assert.equal(host.dataset.loadingKey,undefined);
  updateComputerBoardLoading(host,game,{}, {scope:'owner1'});assert.notEqual(host.dataset.loadingKey,key);
 }
 const previous=host.dataset.loadingKey;updateComputerBoardLoading(host,game,{}, {scope:'owner2'});assert.notEqual(host.dataset.loadingKey,previous);
});


test('cold loading activity occupies the reserved message sibling and retires on hydration without a footer host',()=>{
 const loading=renderBoardMessageSlot({loading:true,loadingKey:'game:a"<'}),live=renderBoardMessageSlot();
 assert.match(loading,/class="board-message-activity" aria-hidden="true" data-loading-state="pending" data-loading-context="external" data-loading-key="game:a&quot;&lt;"/);
 assert.equal((loading.match(/data-loading-key=/g)||[]).length,1);assert.doesNotMatch(live,/data-loading-key=/);
 assert.equal(loading.slice(loading.indexOf('<p class="board-preview-label board-message-sizing"')),live.slice(live.indexOf('<p class="board-preview-label board-message-sizing"')));
 const app=readFileSync(new URL('../shell/app.js',import.meta.url),'utf8');const preview=app.slice(app.indexOf('const renderBoardLoadingPreview'),app.indexOf('const renderGameViewSkeleton'));
 assert.match(preview,/<div class="board-loading-preview" aria-busy="true">/);assert.doesNotMatch(preview,/loadingAttributes|class="loading-region"/);
});


test('fallback sizing permanently mirrors the same formatted messages and inert controls',()=>{
 const html=renderBoardMessageSlot();
 const paragraphs=[...html.matchAll(/<p class="[^"]*board-message-sizing[^"]*" data-sizing-font="(primary|fallback)" data-sizing-variant="([^"]+)" aria-hidden="true" inert>(.*?)<\/p>/g)];
 const primary=new Map(paragraphs.filter(row=>row[1]==='primary').map(row=>[row[2],row[3]]));
 const fallback=new Map(paragraphs.filter(row=>row[1]==='fallback').map(row=>[row[2],row[3]]));
 assert.equal(primary.size,165);assert.deepEqual(fallback,primary);
 for(const [, , ,markup]of paragraphs){assert.doesNotMatch(markup,/data-action=|data-board-message-action=|data-board-preview-action=/);}
 const tokens=readFileSync(new URL('../design-tokens.css',import.meta.url),'utf8');
 const css=readFileSync(new URL('../shell/board-ux.css',import.meta.url),'utf8');
 assert.match(tokens,/--font-family-fallback: "Avenir Next", sans-serif/);
 assert.match(css,/\.board-message-fallback-sizing \{font-family:var\(--font-family-fallback\);\}/);
});
