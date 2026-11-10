import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {renderDecisionDebug} from '../shell/computer-view.js';

const source=readFileSync(new URL('../shell/app.js',import.meta.url),'utf8');
test('actual editor focus/input handlers preserve note ownership across a displayed decision update',()=>{
 const listeners=new Map(),state={drafts:new Map(),notes:[],attempts:new Map(),open:new Set(['notes']),items:[]};
 const start=source.indexOf("document.addEventListener('focusin', event => {\n  if (!event.target?.dataset?.debugNote)");
 const end=source.indexOf("document.addEventListener('change', event =>",start);
 assert.ok(start>=0&&end>start);
 vm.runInNewContext(source.slice(start,end),{document:{addEventListener:(name,callback)=>listeners.set(name,callback)},getCurrentViewedGameId:()=> 'g',getDecisionDebugState:()=>state});
 const field={dataset:{debugNote:'text',decisionId:'prior'},value:'Private draft'};
 listeners.get('focusin')({target:field});
 const game={id:'g',moves:[{moveId:'prior',action:{type:'pass'}},{moveId:'next',action:{type:'pass'}}],currentSnapshot:{sideToMove:'P1'}};
 // Playback renders before the subsequent input event, as in the failing native trace.
 let html=renderDecisionDebug({game,status:{},state,signedIn:true});
 assert.match(html,/<textarea[^>]*data-decision-id="prior"/);
 listeners.get('input')({target:field});
 html=renderDecisionDebug({game,status:{},state,signedIn:true});
 assert.equal(state.drafts.get('prior').text,'Private draft');
 assert.equal(state.drafts.has('next'),false);
 assert.match(html,/<textarea[^>]*data-decision-id="prior"[^>]*>Private draft<\/textarea>/);
 assert.match(html,/data-action="debug-save-note" data-decision-id="prior"/);
 assert.match(html,/data-action="debug-delete-note" data-decision-id="prior"/);
});


test('actual Notes close/reopen refreshes the editor before the next focus',()=>{
 const state={drafts:new Map(),notes:[],attempts:new Map(),open:new Set(['notes']),items:[],noteDecisionId:'prior'},listeners=new Map();
 const game={id:'g',moves:[{moveId:'next',action:{type:'pass'}}],currentSnapshot:{sideToMove:'P1'}};
 let html='',renders=0;
 const start=source.indexOf("document.addEventListener('toggle', event => {\n  const key = event.target?.dataset?.debugSection;");
 const end=source.indexOf("document.addEventListener('change', event =>",start);
 vm.runInNewContext(source.slice(start,end),{document:{addEventListener:(name,callback)=>listeners.set(name,callback)},getCurrentViewedGameId:()=> 'g',getDecisionDebugState:()=>state,updateComputerUi:()=>{renders++;html=renderDecisionDebug({game,status:{},state,signedIn:true});}});
 listeners.get('toggle')({target:{dataset:{debugSection:'notes'},open:false}});
 assert.equal(state.noteDecisionId,undefined);
 listeners.get('toggle')({target:{dataset:{debugSection:'notes'},open:true}});
 assert.equal(renders,1,'native reopen refreshes previously mounted note controls');
 assert.match(html,/<textarea[^>]*data-decision-id="next"/);
 listeners.get('focusin')({target:{dataset:{debugNote:'text',decisionId:'next'}}});
 assert.equal(state.noteDecisionId,'next');
});
