import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as brand from '../shell/brand.js';

// The selected canvas has no page-grid owner. Reintroducing its startup call
// used to install subtree/scroll observers and animation work on every page.
test('the removed page grid has no startup, paint or lifecycle owner',()=>{
 const source=readFileSync(new URL('../shell/brand.js',import.meta.url),'utf8');
 const app=readFileSync(new URL('../shell/app.js',import.meta.url),'utf8');
 const css=readFileSync(new URL('../shell/refresh.css',import.meta.url),'utf8');
 assert.equal('createBrandGrid' in brand,false);
 assert.doesNotMatch(source,/MutationObserver|requestAnimationFrame|brand-background-grid/);
 assert.doesNotMatch(app,/createBrandGrid/);
 assert.doesNotMatch(css,/\.brand-grid|--grid-origin/);
 assert.equal(typeof brand.createBrandController,'function','wordmark activity remains independently owned');
 assert.match(brand.renderWordmark(),/class="brand-motif"/);
});

test('wordmark activity remains finite and releases timers/listeners while hidden or destroyed',()=>{
 const timers=new Map(),events=new Map(),motionEvents=new Map();let next=0;
 const motion={matches:false,addEventListener:(key,fn)=>motionEvents.set(key,fn),removeEventListener:key=>motionEvents.delete(key)};
 const documentObject={hidden:false,querySelectorAll:()=>[],addEventListener:(key,fn)=>events.set(key,fn),removeEventListener:key=>events.delete(key)};
 const windowObject={matchMedia:()=>motion,setTimeout:fn=>{timers.set(++next,fn);return next;},clearTimeout:key=>timers.delete(key)};
 const controller=brand.createBrandController({documentObject,windowObject});controller.setHome(true);assert.equal(timers.size,1);
 const tick=[...timers.values()][0];timers.clear();tick();assert.deepEqual(controller.getState(),{player:'blue',cell:1});assert.equal(timers.size,1);
 documentObject.hidden=true;events.get('visibilitychange')();assert.equal(timers.size,0);
 documentObject.hidden=false;events.get('visibilitychange')();assert.equal(timers.size,1);
 motion.matches=true;motionEvents.get('change')();assert.equal(timers.size,0);assert.deepEqual(controller.getState(),{player:'red',cell:0});
 controller.destroy();assert.equal(timers.size,0);assert.equal(events.size,0);assert.equal(motionEvents.size,0);
});


test('the retained wordmark cells use inset edge paint without changing their three positions',()=>{
 const markup=brand.renderWordmark();assert.equal((markup.match(/data-brand-cell=/g)||[]).length,3);
 assert.match(markup,/class="brand-cell-depth"/);assert.match(markup,/class="brand-cell-light"/);
 assert.match(markup,/<circle class="brand-piece" cx="562" cy="81" r="17"/);
});
