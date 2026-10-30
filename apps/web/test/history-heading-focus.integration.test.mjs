import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {renderHistorySlots} from '../shell/panel-loading.js';

const source=readFileSync(new URL('../shell/app.js',import.meta.url),'utf8');
const start=source.indexOf('const render = ({ animatePanels'),end=source.indexOf('\nconst renderContent =',start);
assert.ok(start>=0&&end>start);
test('History markup retains its programmatic focus target through attribute reconciliation',()=>{
 assert.match(renderHistorySlots({rows:''}),/<h2 tabindex="-1">History<\/h2>/);
});

for(const retainedNode of [true,false])for(const selected of [true,false])test(`actual warm render ${selected?'retains History heading focus':'leaves other focus alone'} with ${retainedNode?'patched':'replaced'} heading`,()=>{
 const body={},document={body,activeElement:body};let heading;
 const makeHeading=()=>({isConnected:true,matches:selector=>selector==='[data-game-panel="history"] h2',focus(){document.activeElement=this;}});
 heading=makeHeading();if(selected)document.activeElement=heading;
 const context={document,currentRoute:{name:'game',gameId:'g'},getGamePanel:()=> 'history',pendingResultReviewFocus:null,
  appEl:{querySelector:()=>heading},renderGesture:{defer:()=>false},recoveryPresentationOptions(){},syncDestinationNotice(){},
  transport:{getGameViewModel:()=>({id:'g'})},utilityMemory:{capture(){},restore(){}},getCurrentViewedGameId:()=> 'g',
  preserveBoardFocus:(_options,render)=>render(),destinationRestoreFocus:false,inlineProfiles:{sync(){}},syncMountedGameShellPanelUi(){},joinFeedback:{restoreFocus(){}},
  renderContent(){const wasFocused=document.activeElement===heading;if(!retainedNode){heading.isConnected=false;heading=makeHeading();}if(wasFocused)document.activeElement=body;}};
 runInNewContext(`${source.slice(start,end)}\nglobalThis.paint=render;`,context);
 context.paint({includeBoard:false});assert.equal(document.activeElement,selected?heading:body);
 context.paint({includeBoard:false});assert.equal(document.activeElement,selected?heading:body);
});
