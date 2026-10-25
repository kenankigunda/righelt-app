import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {mountLoadingFeedback} from '../shell/loading.js';
import {renderGameAlertCard} from '../shell/game-alert.js';

function harness({external=false,modal=false}={}) {
 let clock=0,scope='route-a',observer,timer=null;
 const updates=[],created=[];
 const element=(tag='SPAN')=>({tagName:tag,dataset:{},children:[],isConnected:true,className:'',
  classList:{add(){}},setAttribute(name,value){this[name]=value;},removeAttribute(name){if(name==='data-loading-phase')delete this.dataset.loadingPhase;},
  getClientRects(){return this.hidden?[]:[{}];},
  closest(selector){return selector.includes('dialog:not([open])')?(this.inert?{}:null):this.modal?{}:null;},
  querySelector(selector){if(selector.includes('loading-pieces'))return this.cue??null;if(selector.includes('loading-context'))return this.children.find(child=>child.className==='loading-context')??null;return null;},
  insertAdjacentHTML(){const host=this;this.cue={remove(){host.cue=null;}};},
  append(child){this.children.push(child);child.parent=this;child.isConnected=true;},
  remove(){this.isConnected=false;if(this.parent)this.parent.children=this.parent.children.filter(child=>child!==this);},
 });
 const source=element('SECTION');Object.assign(source.dataset,{loadingState:'pending',loadingKey:'home:my',loadingMessage:'Games are still loading'});source.modal=modal;if(external)source.dataset.loadingContext='external';
 const document={hidden:false,elements:[source],body:element('BODY'),documentElement:{toggleAttribute(){}},
  querySelectorAll(){return this.elements;},createElement(tag){const node=element(tag.toUpperCase());created.push(node);return node;},addEventListener(){},removeEventListener(){},
  defaultView:{MutationObserver:class{constructor(callback){observer=callback;}observe(){}disconnect(){}},addEventListener(){},removeEventListener(){}},
 };
 const dispose=mountLoadingFeedback(document,{now:()=>clock,setTimer:callback=>{timer=callback;return callback;},clearTimer:()=>{timer=null;},getScope:()=>scope,onContextsChange:value=>updates.push(structuredClone(value))});
 return {document,source,updates,created,dispose,sync:()=>observer(),advance(ms){clock+=ms;const callback=timer;timer=null;callback?.();},setScope(value){scope=value;}};
}

test('slow nonbutton context publishes once outside the source without changing its cue or adding in-flow/duplicate status nodes',()=>{
 const env=harness();const cue=env.source.cue;
 assert.deepEqual(env.updates,[]);
 env.advance(200);assert.equal(env.source.dataset.loadingPhase,'visible');
 env.advance(4799);assert.deepEqual(env.updates,[]);
 env.advance(1);assert.deepEqual(env.updates,[[{key:'loading:route-a:home:my',scope:'route-a',message:'Games are still loading'}]]);
 assert.equal(env.source.cue,cue);assert.equal(env.source.children.length,0);assert.equal(env.document.body.children.length,0);assert.equal(env.created.length,0);
 env.sync();env.advance(5000);env.sync();assert.equal(env.updates.length,1);assert.equal(env.source.cue,cue);
 env.source.dataset.loadingMessage='Updated context';env.sync();assert.equal(env.updates.length,2);assert.equal(env.updates[1][0].message,'Updated context');
 env.source.dataset.loadingState='idle';env.sync();assert.deepEqual(env.updates.at(-1),[]);assert.equal(env.source.cue,null);
 env.dispose();
});

test('route scope, inert/hidden/removal and disposal retire notices and require a fresh operation delay',()=>{
 const env=harness();env.advance(5000);assert.equal(env.updates.length,1);
 env.setScope('route-b');env.sync();assert.deepEqual(env.updates.at(-1),[]);assert.equal(env.source.dataset.loadingPhase,'quiet');
 env.advance(5000);assert.equal(env.updates.at(-1)[0].scope,'route-b');
 env.source.inert=true;env.sync();assert.deepEqual(env.updates.at(-1),[]);
 env.source.inert=false;env.sync();assert.equal(env.source.dataset.loadingPhase,'quiet');env.advance(5000);
 env.source.hidden=true;env.sync();assert.deepEqual(env.updates.at(-1),[]);
 env.source.hidden=false;env.sync();env.advance(5000);
 env.document.elements=[];env.sync();assert.deepEqual(env.updates.at(-1),[]);
 env.document.elements=[env.source];env.sync();env.advance(5000);env.dispose();assert.deepEqual(env.updates.at(-1),[]);
});

test('externally managed sources stay suppressed and real modal context stays inside its foreground owner',()=>{
 const external=harness({external:true});external.advance(5000);assert.deepEqual(external.updates,[]);assert.equal(external.source.children.length,0);external.dispose();
 const modal=harness({modal:true});modal.advance(5000);assert.deepEqual(modal.updates,[]);
 assert.equal(modal.source.children.length,1);assert.equal(modal.source.children[0].className,'loading-context');
 assert.equal(modal.document.body.children.length,1);modal.source.dataset.loadingContext='external';modal.sync();assert.equal(modal.source.children.length,0);assert.equal(modal.document.body.children.length,0);modal.dispose();
});

const app=readFileSync(new URL('../shell/app.js',import.meta.url),'utf8');
const headerItemsSource=app.slice(app.indexOf('const getHeaderAlertItems ='),app.indexOf('const renderGameAlertsHtml ='));
const escapeHtml=value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
const headerItems=({scope='route-a',contexts=[],startupError=null,gameItems=[]}={})=>Function('loadingContextScope','slowLoadingContexts','accountStartupError','renderGameAlertCard','escapeHtml','getGameAlertItems',`${headerItemsSource};return getHeaderAlertItems;`)(()=>scope,contexts,startupError,renderGameAlertCard,escapeHtml,()=>gameItems);
test('actual header alert mapping uses the current scope, one escaped status and existing urgent items without republishing external metadata',()=>{
 const contexts=[{key:'loading:route-a:home',scope:'route-a',message:'<Games & waiting>'},{key:'old',scope:'previous-route',message:'Old context'}];
 const urgent={key:'real-error',priority:'urgent',html:'Actual recovery'};
 const items=headerItems({contexts,gameItems:[urgent]})({id:'game'});
 assert.equal(items[0],urgent);assert.equal(items.length,2);assert.equal(items[1].key,contexts[0].key);
 assert.match(items[1].html,/<span role="status">&lt;Games &amp; waiting&gt;<\/span>/);
 assert.equal((items[1].html.match(/role="status"/g)||[]).length,1);assert.doesNotMatch(items[1].html,/data-loading-(?:key|state)/);
 assert.deepEqual(headerItems({contexts,startupError:'Startup failed'})(null),[]);
 assert.equal(headerItems({contexts})(null).length,1);
});
