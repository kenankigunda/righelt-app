import test from 'node:test';
import assert from 'node:assert/strict';
import {createPanelTransitionPreparation} from '../shell/panel-transition-preparation.js';
const game=(id,panel='board')=>({name:'game',gameId:id,panel});
function fixture(){
 const calls=[],queued=[];const owner={},scope={value:'account-a:storage-a'};const d={document:{hidden:false},currentRoute:null,getCurrentRoute:()=>d.currentRoute,viewingScope:()=>scope.value,window:{scrollY:72,requestAnimationFrame:fn=>queued.push(fn)},getGamePanel:r=>r.panel,layout:'narrow',getShellLayoutModeForRoute:()=>d.layout,pendingBoardContextReplay:null,pendingRoutePosition:null,
 cancelPendingBoardContextReplay:()=>calls.push('pending-cancel'),retireBoardContext:()=>calls.push('retire'),liveTurnOverview:{leave:()=>calls.push('overview-leave')},homeSectionReads:{leaveHome:()=>calls.push('home-leave')},
 viewingIntent:{saveScroll:(...args)=>calls.push(['save',...args]),cancelUndo:id=>calls.push(['undo-cancel',id]),scrollTop:()=>31},replayController:{stop:why=>calls.push(['stop',why])},replayRequests:{cancel:()=>calls.push('replay-cancel')},
 transport:{owner,getGameViewModel:()=>({inHistoryMode:false}),returnToLive:value=>calls.push(['live',value])},mobileNavigation:{restoreScroll:top=>calls.push(['restore',top])}};
 const prepare=createPanelTransitionPreparation(()=>d);return {d,calls,queued,scope,prepare(previous,next){prepare(previous,next);d.currentRoute=next;}};
}
test('same-game explicit panel visit restores saved scroll without retiring History ownership',()=>{
 const f=fixture();f.prepare(game('g','players'),game('g'));
 assert.deepEqual(f.calls,['home-leave',['save','g','players',72],'replay-cancel',['stop','navigation']]);assert.equal(f.queued.length,1);
 f.queued.shift()();assert.deepEqual(f.calls.at(-1),['restore',31]);
});
test('account-independent presentation scope and replay retire when leaving the game',()=>{
 const f=fixture();f.d.pendingBoardContextReplay={descriptor:{gameId:'g'}};f.prepare(game('g'),{name:'home'});
 assert.deepEqual(f.calls,['pending-cancel','retire','overview-leave','home-leave',['save','g','board',72],['undo-cancel','g'],['stop','navigation']]);assert.equal(f.queued.length,0);
});
test('pending incoming replay remains owned only by its exact destination Board',()=>{
 const f=fixture();f.d.pendingBoardContextReplay={descriptor:{gameId:'g'}};f.prepare(game('g','history'),game('g'));assert(!f.calls.includes('pending-cancel'));
 const other=fixture();other.d.pendingBoardContextReplay={descriptor:{gameId:'g'}};other.prepare(game('g'),game('other'));assert.equal(other.calls[0],'pending-cancel');
});
test('explicit History-to-Board selection returns live once but existing route-position owner wins scroll',()=>{
 const f=fixture();f.d.pendingRoutePosition={};f.d.transport.getGameViewModel=()=>({inHistoryMode:true});f.prepare(game('g','history'),game('g'));
 assert.deepEqual(f.calls.at(-1),['live',{gameId:'g'}]);assert.equal(f.queued.length,0);
});
test('completed History selection remains selected when mobile navigation returns to Board',()=>{
 const f=fixture();f.d.pendingRoutePosition={};f.d.isCompletedGame=()=>true;f.d.transport.getGameViewModel=()=>({inHistoryMode:true,board:{state:{outcome:{status:'p1_win'}}}});f.prepare(game('g','history'),game('g'));
 assert(!f.calls.some(call=>Array.isArray(call)&&call[0]==='live'));
});
for(const interruption of ['Home','other-game','account','transport','navigation-owner','uncommitted-route','hidden','wide-before-frame'])test(`queued panel restoration yields to ${interruption}`,()=>{
 const f=fixture();f.prepare(game('g','players'),game('g'));
 if(interruption==='Home')f.prepare(game('g'),{name:'home'});
 if(interruption==='other-game')f.prepare(game('g'),game('other'));
 if(interruption==='account')f.scope.value='account-b:storage-a';
 if(interruption==='transport')f.d.transport={...f.d.transport};
 if(interruption==='navigation-owner')f.d.mobileNavigation={restoreScroll:top=>f.calls.push(['foreign-restore',top])};
 if(interruption==='wide-before-frame')f.d.layout='wide';
 if(interruption==='hidden')f.d.document.hidden=true;
 if(interruption==='uncommitted-route')f.d.currentRoute=game('g','history');
 f.queued.shift()();assert(!f.calls.some(call=>Array.isArray(call)&&['restore','foreign-restore'].includes(call[0])),'superseded callback cannot scroll or reveal the foreign destination');
});
