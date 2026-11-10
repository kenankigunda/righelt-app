import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {waitForOpponentReady} from '../../../e2e/support/computer-projection.mjs';
import {createComputerPreparation} from '../shell/computer-preparation.js';

test('native readiness helper recognizes elapsed preparation before response headers expose bytes',async()=>{
 let now=0,settle;
 const preparation=createComputerPreparation({clock:()=>now,runtime:{prepare:()=>new Promise(resolve=>settle=resolve),cancel(){}},timers:{setInterval:()=>1,clearInterval(){}}});
 const work=preparation.start('intro');
 const dialog={querySelector(selector){
  if(selector==='[data-story-play]')return{disabled:now<6500};
  if(selector==='[data-story-retry]')return{hidden:true};
  if(selector==='[data-story-readiness]')return{textContent:preparation.snapshot('intro').message};
 }};
 const page={evaluate(fn,args){return vm.runInNewContext(`(${fn.toString()})(args)`,{args,document:{querySelector:()=>dialog},performance:{now:()=>now},setTimeout(callback,ms){now+=ms;if(now>=6500)settle();queueMicrotask(callback);}});}};
 const receipt=await waitForOpponentReady(page);await work;
 assert.equal(receipt.detailed,true);
 assert.equal(receipt.byteSamples,0,'headers were unavailable while elapsed preparation was displayed');
 assert.equal(receipt.elapsedMs,6500);
});

test('native readiness helper still rejects a slow surface without visible elapsed detail',async()=>{
 let now=0;
 const dialog={querySelector(selector){
  if(selector==='[data-story-play]')return{disabled:now<6500};
  if(selector==='[data-story-retry]')return{hidden:true};
  if(selector==='[data-story-readiness]')return{textContent:now<6500?'Preparing your opponent…':'Ready to play'};
 }};
 const page={evaluate(fn,args){return vm.runInNewContext(`(${fn.toString()})(args)`,{args,document:{querySelector:()=>dialog},performance:{now:()=>now},setTimeout(callback,ms){now+=ms;queueMicrotask(callback);}});}};
 await assert.rejects(waitForOpponentReady(page),/Slow opponent preparation did not expose detailed progress/);
});
