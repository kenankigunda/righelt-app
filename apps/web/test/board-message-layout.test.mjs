import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {renderBoardHeadingSlot,renderBoardMessageSlot,updateComputerBoardLoading} from '../shell/board-message-layout.js';
import {COMPUTER_PROFILES} from '../generated/packages/shared-types/src/computer-play.js';
import {describeComputerMove,describeMove} from '../shell/computer-narration.js';
import {renderBoardMessageHtml} from '../board/message-presentation.js';
import {SELECTED_PIECE_EXPLANATIONS} from '../board/piece-explanations.js';

test('routine-only reservation mirrors live grammar without opponent or replay maxima',()=>{
 const html=renderBoardMessageSlot({id:'shell-board-preview-label'});
 assert.equal((html.match(/id=/g)??[]).length,1);
 assert.equal((html.match(/board-message-sizing/g)??[]).length,10);
 assert.doesNotMatch(html,/data-board-message-action=|data-board-preview-action=|Show me again|rushed several|had several pieces follow/);
 for(const copy of ['Select a piece or','Select a move for piece at','Select a rush or','Select a retreat','Select a follow'])assert(html.includes(copy));
 assert.match(html,/disabled tabindex="-1"/);
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
  assert.equal((html.match(/aria-hidden="true" inert role="presentation"/g)??[]).length,10);
  for(const font of ['primary','fallback'])for(let index=0;index<5;index++)assert(html.includes(`data-heading-sizing-font="${font}" data-heading-sizing-caption="${index}"`));
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
 for(const options of [{game:{...game,board:{state:{outcome:{status:'p1_win'}}}}},{game:{...game,liveCurrentSnapshot:{outcome:{status:'draw'}}}},{game:{...game,computerTurn:null}},{game:{...game,inHistoryMode:true}},{game:{...game,computer:{paused:true}}},{status:{phase:'recovery'}},{status:{phase:'other-device'}},{replaying:true}]){
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
 assert.equal(primary.size,5);assert.deepEqual(fallback,primary);
 for(const [, , ,markup]of paragraphs){assert.doesNotMatch(markup,/data-action=|data-board-message-action=|data-board-preview-action=/);}
 const tokens=readFileSync(new URL('../design-tokens.css',import.meta.url),'utf8');
 const css=readFileSync(new URL('../shell/board-ux.css',import.meta.url),'utf8');
 assert.match(tokens,/--font-family-fallback: "Avenir Next", sans-serif/);
 assert.match(css,/\.board-message-fallback-sizing \{font-family:var\(--font-family-fallback\);\}/);
});
