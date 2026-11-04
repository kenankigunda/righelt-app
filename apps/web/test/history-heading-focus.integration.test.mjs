import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {createHistoryHeadingFocus} from '../shell/history-heading-focus.js';
import {createRenderGestureGate,preserveBoardFocus} from '../shell/render-gesture.js';
const source=readFileSync(new URL('../shell/app.js',import.meta.url),'utf8');
const extract=(a,b)=>{const start=source.indexOf(a),end=source.indexOf(b,start);assert(start>=0&&end>start);return source.slice(start,end);};
// Production wrapper, analysis branch, gesture gate and preservation owner.
// DOM replacement/native-focus effects are explicitly modeled here. The real
// failing browser receipt remains separate from these source regressions.
function fixture(){
 const events=()=>{const handlers=new Map();return {addEventListener(type,fn){if(!handlers.has(type))handlers.set(type,new Set());handlers.get(type).add(fn);},removeEventListener(type,fn){handlers.get(type)?.delete(fn);},emit(type,event={}){for(const fn of handlers.get(type)??[])fn(event);}};};
 const doc={...events(),body:{},hidden:false,hasFocus:()=>true},win=events();doc.defaultView=win;doc.activeElement=doc.body;
 let context,current=null,count=0,replace=true,during=null;
 const element=(isHeading=false)=>({isConnected:true,focusCalls:[],matches:selector=>isHeading&&selector==='[data-game-panel="history"] h2',contains(target){return target===this;},closest(){return isHeading&&context.currentRoute.panel!=='history'?{}:null;},focus(options){this.focusCalls.push(options);doc.activeElement=this;doc.emit('focusin',{target:this});}});
 const jobs=new Map();let sequence=0;
 context={document:doc,appEl:{querySelector:()=>current},currentRoute:{name:'game',gameId:'g',panel:'board'},generation:1,visit:1,pendingResultReviewFocus:null,activeResultGameId:'g',
  getGamePanel:()=>context.currentRoute.panel,getCurrentViewedGameId:()=>context.currentRoute.gameId,preserveBoardFocus,
  utilityMemory:{capture(){},restore(){}},inlineProfiles:{sync(){}},syncMountedGameShellPanelUi(){},syncRenderedMarkupSnapshot(){},joinFeedback:{restoreFocus(){}},resumeBoardContextReplay(){},
  resultPresentation:{clear(){}},buildGameHash:(_id,_move,state)=>state.panel,getCurrentGameHashState:panel=>({panel}),
  renderContent(){count++;if(replace){if(current){current.isConnected=false;if(doc.activeElement===current)doc.activeElement=doc.body;}current=element(true);}during?.();return true;},
 };
 context.historyHeadingFocus=createHistoryHeadingFocus({doc,getScope:()=>JSON.stringify([context.generation,context.visit,context.currentRoute.gameId,context.currentRoute.panel])});
 context.renderGesture=createRenderGestureGate({render:options=>context.renderActual(options),schedule:fn=>{jobs.set(++sequence,fn);return sequence;},cancel:id=>jobs.delete(id)});
 runInNewContext(extract('const render = (','const renderContent =')+'\nglobalThis.renderActual=render;globalThis.analysis=()=>{const action="analysis",actionGameId="g";'+extract('  if (action === "analysis")','  if (action === "rematch")')+'};',context);
 context.navigateTo=panel=>{context.currentRoute.panel=panel;context.renderActual({animatePanels:false});};
 return {context,doc,win,element,heading:()=>current,count:()=>count,
  enter(){context.renderGesture.begin();context.analysis();context.renderGesture.end();for(const [id,fn]of [...jobs]){jobs.delete(id);fn();}},
  render(){context.renderActual({animatePanels:false});},patch(){replace=false;},during(fn){during=fn;},close(){context.historyHeadingFocus.destroy();}};
}
test('actual Review focus survives the next full shell replacement after successful native focus',()=>{
 const f=fixture();f.enter();const first=f.heading();assert.equal(f.doc.activeElement,first);assert.equal(f.context.pendingResultReviewFocus,null);assert.equal(first.focusCalls.length,1);
 f.render();assert.notEqual(f.heading(),first);assert.equal(first.isConnected,false);assert.equal(f.doc.activeElement,f.heading(),'the second committed History root must retain focus already granted by Review');assert.equal(f.heading().focusCalls.length,1);f.close();
});
test('an unchanged History node is not focused again during an incremental commit',()=>{const f=fixture();f.enter();const first=f.heading();f.patch();f.render();assert.equal(f.heading(),first);assert.equal(first.focusCalls.length,1);f.close();});
for(const kind of ['foreign-focus','foreign-pointer','foreign-mouse','tab','foreign-key','blur','hidden','account','visit','game','panel'])test(`actual next render does not reclaim focus after ${kind}`,()=>{
 const f=fixture();f.enter();const foreign=f.element();
 if(kind==='foreign-focus')foreign.focus({});
 if(kind==='foreign-pointer')f.doc.emit('pointerdown',{target:foreign});
 if(kind==='foreign-mouse')f.doc.emit('mousedown',{target:foreign});
 if(kind==='tab')f.doc.emit('keydown',{target:f.heading(),key:'Tab'});
 if(kind==='foreign-key')f.doc.emit('keydown',{target:foreign,key:'Enter'});
 if(kind==='blur')f.win.emit('blur');
 if(kind==='hidden'){f.doc.hidden=true;f.doc.emit('visibilitychange');f.doc.hidden=false;}
 if(kind==='account')f.context.generation++;
 if(kind==='visit')f.context.visit++;
 if(kind==='game')f.context.currentRoute.gameId='other';
 if(kind==='panel')f.context.currentRoute.panel='board';
 f.render();assert.equal(f.heading().focusCalls.length,0);assert.equal(f.doc.activeElement,kind==='foreign-focus'?foreign:f.doc.body);f.close();
});
test('foreign focus during the actual DOM commit wins over captured History ownership',()=>{const f=fixture();f.enter();const foreign=f.element();f.during(()=>foreign.focus({}));f.render();assert.equal(f.doc.activeElement,foreign);assert.equal(f.heading().focusCalls.length,0);f.close();});
