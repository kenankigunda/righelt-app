import {createPanelTransitionPreparation} from '../shell/panel-transition-preparation.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {mountRecoverySpace,syncRecoverySpace} from '../shell/recovery-space.js';
import {createBoardContextLayout} from '../shell/board-context-layout.js';
import {mountMobileNavigation} from '../shell/mobile-navigation.js';
import {createHomeSectionReads} from '../shell/home-section-reads.js';

const events=()=>{const listeners=new Map();return {addEventListener(k,f){if(!listeners.has(k))listeners.set(k,new Set());listeners.get(k).add(f);},removeEventListener(k,f){listeners.get(k)?.delete(f);},fire(k,event={}){for(const f of [...listeners.get(k)??[]])f(event);},count(){return [...listeners.values()].reduce((n,set)=>n+set.size,0);}};};
function fixture(){
 const jobs=new Map(),timers=new Map(),observers=[];let serial=0,headerDocumentBottom=68;
 class ResizeObserver{constructor(fn){this.fn=fn;this.nodes=new Set();observers.push(this);}observe(n){this.nodes.add(n);}unobserve(n){this.nodes.delete(n);}disconnect(){this.nodes.clear();}}
 class MutationObserver{constructor(fn){this.fn=fn;}observe(){}disconnect(){this.closed=true;}}
 const viewport={...events(),offsetTop:0,height:640},fonts=events();
 const win={...events(),ResizeObserver,MutationObserver,visualViewport:viewport,innerWidth:390,innerHeight:640,scrollY:0,requestAnimationFrame(fn){jobs.set(++serial,fn);return serial;},cancelAnimationFrame(id){jobs.delete(id);},setTimeout(fn){timers.set(++serial,fn);return serial;},clearTimeout(id){timers.delete(id);},getComputedStyle:()=>({fontSize:'16px',fontFamily:'Manrope'})};
 const values=new Map(),reserve=new Map(),style=map=>({getPropertyValue:k=>map.get(k)||'',setProperty:(k,v)=>map.set(k,v),removeProperty:k=>map.delete(k)});
 const wrap={style:style(reserve),closest:()=>null,querySelector:()=>({getBoundingClientRect:()=>({top:120+(parseFloat(reserve.get('--board-center-clearance'))||0)-win.scrollY,height:320})})};
 const frame={dataset:{gameId:'game'},querySelector:key=>key==='[data-testid="game-board-wrap"]'?wrap:{getBoundingClientRect:()=>({bottom:500+(parseFloat(reserve.get('--board-center-clearance'))||0)-win.scrollY})}};
 const header={getBoundingClientRect:()=>({bottom:headerDocumentBottom-win.scrollY})};
 const anchor={getBoundingClientRect:()=>({top:parseFloat(values.get('--recovery-space-top'))||58,width:374})};
 const app={dataset:{shellLayoutMode:'narrow'},style:style(values),querySelector:selector=>selector==='.shell-header'?header:selector==='[data-game-shell-root]'?frame:anchor};
 const doc={...events(),defaultView:win,fonts,hidden:false,documentElement:{scrollHeight:2000},querySelector:()=>null,getElementById:()=>app,querySelectorAll:()=>[],body:{append(){}},createElement:()=>({style:{},setAttribute(){},getBoundingClientRect:()=>({height:180}),remove(){}})};
 win.scrollTo=({top})=>{win.scrollY=top;win.fire('scroll',{target:doc});};
 const dispose=mountRecoverySpace(app,{window:win,document:doc}),layout=createBoardContextLayout(doc),nav=mountMobileNavigation({window:win,document:doc,isNarrow:()=>true});
 const homeSectionReads=createHomeSectionReads({state:{pendingHomeRefresh:null,homeFocusToRestore:null},pendingHomeSectionKeys:new Set()});
 const context={pendingRoutePosition:null,homeSectionReads,window:win,pendingBoardContextReplay:null,cancelPendingBoardContextReplay(){throw Error('no replay');},retireBoardContext(){throw Error('same game');},liveTurnOverview:{leave(){throw Error('same game');}},viewingIntent:{saveScroll(){},scrollTop:()=>0,cancelUndo(){}},replayController:null,replayRequests:{cancel(){}},getGamePanel:route=>route.panel,getShellLayoutModeForRoute:()=> 'narrow',transport:{getGameViewModel:()=>({inHistoryMode:false})},mobileNavigation:nav};
 context.prepare=createPanelTransitionPreparation(()=>context);
 const flush=()=>{const batch=[...jobs.values()];jobs.clear();for(const fn of batch)fn();};
 return {win,doc,fonts,viewport,app,frame,header,layout,dispose,nav,jobs,timers,observers,values,flush,reserve:()=>reserve.get('--board-center-clearance'),headerBottom:value=>{headerDocumentBottom=value;},prepare(){context.prepare({name:'game',gameId:'game',panel:'players'},{name:'game',gameId:'game',panel:'board'});},admit(){syncRecoverySpace(app);layout.sync();},close(){layout.destroy();nav.destroy();dispose();assert.equal(jobs.size,0);assert.equal(timers.size,0);assert.equal(win.count()+doc.count()+fonts.count()+viewport.count(),0);assert(observers.every(o=>o.nodes.size===0));}};
}
test('actual production panel scroll restore preserves independent Board center clearance before the next Pass',()=>{
 const f=fixture();
 try{
  f.admit();assert.equal(f.reserve(),'40px');
  f.win.scrollTo({top:343});f.flush();f.admit();
  f.prepare();f.layout.sync();f.flush();f.flush();
  assert.equal(f.win.scrollY,0);assert.equal(f.values.get('--recovery-space-top'),'76px');
  assert.equal(f.reserve(),'40px','AFTER_REAL_PANEL_SCROLL_RESTORE reserve must already match its document geometry, before any Pass-like sync');
  const before=f.reserve();f.admit();assert.equal(f.reserve(),before,'next ordinary app sync cannot move the Board');
 }finally{f.close();}
});
for(const top of [0,32,343,500,-12])test(`Board center clearance remains fixed while the existing notice owner follows scroll${top}`,()=>{
 const f=fixture();try{f.admit();const before=f.reserve();f.win.scrollTo({top});f.flush();f.admit();assert.equal(f.reserve(),before);assert.equal(f.values.get('--recovery-space-top'),`${Math.max(8,76-top)}px`);}finally{f.close();}
});
test('font and viewport callbacks refresh overlay placement without allocating Board notice space',()=>{
 const f=fixture();try{
  f.admit();const count=f.observers.length;assert.equal(mountRecoverySpace(f.app,{window:f.win,document:f.doc}),f.dispose);
  f.win.scrollTo({top:343});f.flush();f.headerBottom(120);f.fonts.fire('loadingdone');f.flush();f.flush();
  assert.equal(f.reserve(),'40px');assert.equal(f.observers.length,count);
  f.viewport.offsetTop=24;f.win.fire('resize');f.flush();f.flush();assert.equal(f.reserve(),'64px','visible viewport changes recenter the initial Board without following reader scroll');
 }finally{f.close();}
});
for(const event of ['pointer','Enter'])test(`held native${event} retains reservation through restored scroll and release`,()=>{
 const f=fixture();try{
  f.admit();if(event==='pointer')f.doc.fire('pointerdown');else f.doc.fire('keydown',{key:'Enter'});
  f.win.scrollTo({top:343});f.flush();f.admit();assert.equal(f.reserve(),'40px');
  f.prepare();f.flush();f.flush();assert.equal(f.reserve(),'40px');
  if(event==='pointer')f.doc.fire('pointerup');else f.doc.fire('keyup',{key:'Enter'});f.flush();assert.equal(f.reserve(),'40px');
 }finally{f.close();}
});

test('visual viewport pan changes overlay clipping and grid centering without page scrolling',()=>{
 const f=fixture();try{
  f.admit();assert.equal(f.reserve(),'40px');
  for(const offset of [0,24,100,240]){
   f.viewport.offsetTop=offset;f.viewport.fire('resize');f.flush();f.layout.sync();
   assert.equal(f.values.get('--recovery-space-top'),`${Math.max(offset+8,76)}px`);
   assert.equal(f.reserve(),`${40+offset}px`);assert.equal(f.win.scrollY,0,'centering never scrolls the page');
  }
 }finally{f.close();}
});
