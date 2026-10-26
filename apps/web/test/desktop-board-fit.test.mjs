import test from 'node:test';
import assert from 'node:assert/strict';
import {desktopBoardSide} from '../shell/desktop-board-fit.js';
const measured={viewportHeight:800,flowTop:149.17,chromeHeight:239.89,availableWidth:506.8};
test('1440×800 measured chrome fits square mouse cells while retaining a comfortable floor',()=>{
 assert.equal(desktopBoardSide(measured),396);
 assert.equal(desktopBoardSide({...measured,viewportHeight:768}),396);
 assert.equal(desktopBoardSide({...measured,viewportHeight:600}),396);
 assert.equal(desktopBoardSide({...measured,viewportHeight:1100}),506);
 assert.equal(desktopBoardSide({...measured,coarse:true}),476);
});
test('large text and short windows scroll instead of shrinking symbols, and narrow widths never overflow',()=>{
 assert.equal(desktopBoardSide({...measured,flowTop:416,chromeHeight:452}),396);
 assert.equal(desktopBoardSide({...measured,availableWidth:350}),350);
 for(const key of Object.keys(measured))assert.equal(desktopBoardSide({...measured,[key]:NaN}),null);
 assert.equal(desktopBoardSide({...measured,availableWidth:0}),null);
});

import {createDesktopBoardFit} from '../shell/desktop-board-fit.js';
test('controller applies loading/live geometry synchronously once, ignores scrolling and cleans up after route changes',()=>{
 const values=new Map(),observed=new Set();let notifications=0,scheduled=0;
 const view={innerHeight:800,scrollY:0,getComputedStyle:()=>({paddingLeft:'24px',paddingRight:'24px'}),matchMedia:()=>({matches:false}),ResizeObserver:class{constructor(callback){this.callback=callback;}observe(el){observed.add(el);}disconnect(){observed.clear();}}};
 const board={get offsetWidth(){return Number.parseFloat(values.get('--desktop-board-side')??'506');},get offsetHeight(){return this.offsetWidth;}};
 const wrap={style:{setProperty:(key,value)=>values.set(key,value),removeProperty:key=>values.delete(key)},querySelector:()=>board};
 const track={offsetTop:149,offsetParent:null};const column={offsetTop:0,offsetParent:track};
 const panel={isConnected:true,offsetTop:0,offsetParent:column,clientWidth:554,get offsetHeight(){return board.offsetHeight+240;},closest:selector=>selector==='.game-shell-track'?track:column,querySelector:selector=>selector==='.board-wrap'?wrap:{}};
 let available=panel;
 const listeners=new Map(),fonts={ready:Promise.resolve(),addEventListener:(name,callback)=>listeners.set(name,callback),removeEventListener:name=>listeners.delete(name)};
 const appEl={ownerDocument:{defaultView:view,fonts},querySelector:selector=>selector==='[data-shell-panel="board"]'?available:{}};
 const fit=createDesktopBoardFit({appEl,requestLayout:()=>scheduled++,onSizeChange:()=>notifications++});
 assert.equal(fit.sync({wide:true}),true);assert.equal(values.get('--desktop-board-side'),'396px');assert.equal(notifications,1);
 assert.equal(fit.sync({wide:true}),false);view.scrollY=600;assert.equal(fit.sync({wide:true}),false);assert.equal(notifications,1);
 view.innerHeight=900;fit.sync({wide:true});assert.equal(values.get('--desktop-board-side'),'495px');assert.equal(notifications,2);
 listeners.get('loadingdone')();assert.equal(scheduled,1);
 available=null;fit.sync({wide:true});assert.equal(values.size,0);assert.equal(observed.size,0);
 fit.destroy();assert.equal(listeners.size,0);assert.equal(fit.sync({wide:true}),false);
});
