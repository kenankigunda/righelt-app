// Isolated diagnostic. Does not change normal tests or product rendering.
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { devices, webkit, expect } from '@playwright/test';
import { browserLaunchOptions } from './playwright-launch-options.mjs';
if (!process.env.RIGHELT_RESOURCE_RUN) throw new Error('Use resource supervisor');
const output=resolve('test-results/webkit-rendering-diagnostic');
await mkdir(output,{recursive:true});
const report={revision:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),startedAt:new Date().toISOString(),samples:[],note:'Fresh contexts; same UI registration and Account open/close; second context retains a real self-play board. Static intervention applies to all contexts. Trace settings, device and action timeout constant. No normal tests changed.'};
const save=()=>writeFile(resolve(output,'report.json'),JSON.stringify(report,null,2));
const browser=await webkit.launch({headless:true,...browserLaunchOptions('webkit')});
const variants=[{name:'one-stepped',count:1,static:false},{name:'one-static',count:1,static:true},{name:'two-stepped',count:2,static:false},{name:'two-static',count:2,static:true},{name:'one-stepped-repeat',count:1,static:false}];
async function cadence(page){return page.evaluate(()=>new Promise(resolve=>{const intervals=[];let previous=performance.now(),done=false;const finish=()=>{if(!done){done=true;resolve(intervals);}};setTimeout(finish,8000);function frame(now){intervals.push(now-previous);previous=now;if(intervals.length>=12)finish();else if(!done)requestAnimationFrame(frame);}requestAnimationFrame(frame);}));}
async function register(page,name,timings){
 const time=async(label,fn)=>{const start=performance.now();try{return await fn();}finally{timings.push({label,ms:performance.now()-start});}};
 await page.goto('https://127.0.0.1:9988/',{waitUntil:'domcontentloaded'});
 await expect(page.getByTestId('home-create-game')).toBeVisible();
 await page.waitForFunction(()=>document.querySelector('.shell-header')&&!document.querySelector('[data-action="retry-account-startup"]')&&![...document.querySelectorAll('[role="status"]')].some(n=>n.textContent.trim()==='Connecting…'));
 await time('play-both',()=>page.getByRole('button',{name:'Play both sides',exact:true}).click());
 const dialog=page.getByTestId('account-dialog');
 await time('create-account',()=>dialog.getByRole('button',{name:'Create account',exact:true}).click());
 await dialog.getByLabel('Username',{exact:true}).fill(name);
 await dialog.getByLabel('Password',{exact:true}).fill('Diagnostic account password 482');
 await time('submit-account',()=>dialog.getByRole('button',{name:'Create account & continue',exact:true}).click());
 await expect(dialog).not.toBeVisible();await expect(page.getByTestId('game-board')).toBeVisible();
 await expect(page.locator('#app')).toHaveAttribute('data-shell-transition-phase','idle');
}
try{
 for(let round=0;round<2;round++){
 const middle=variants.slice(1,-1);const order=[variants[0],...(round?middle.reverse():middle),variants.at(-1)];
 for(const variant of order){
 const id=`${round+1}-${variant.name}`,sample={id,...variant,actions:[],backgroundActions:[]},contexts=[];report.samples.push(sample);
 try{
 const response=await fetch('http://127.0.0.1:10088/reset-limits',{method:'POST'});if(!response.ok)throw new Error('Rate limit reset failed');
 async function context(label){const ctx=await browser.newContext({...devices['Desktop Safari'],ignoreHTTPSErrors:true});contexts.push({ctx,label});await ctx.tracing.start({screenshots:true,snapshots:true,sources:true});await ctx.addInitScript(isStatic=>{const style=document.createElement('style');style.textContent=isStatic?'.brand-grid{animation:none!important}':'/* baseline */';document.addEventListener('DOMContentLoaded',()=>document.head.append(style),{once:true});},variant.static);const page=await ctx.newPage();page.setDefaultTimeout(20000);return page;}
 let background;
 if(variant.count===2){background=await context('background');await register(background,`Bg_${Date.now().toString(36)}`,sample.backgroundActions);}
 const page=await context('measured');await register(page,`Main_${Date.now().toString(36)}`,sample.actions);
 const time=async(label,fn)=>{const start=performance.now();try{return await fn();}finally{sample.actions.push({label,ms:performance.now()-start});}};
 await time('account-open',()=>page.getByTestId('account-open').click());
 await expect(page.getByTestId('account-dialog').getByLabel('Display name',{exact:true})).toBeVisible();
 await time('account-close',()=>page.getByTestId('account-dialog').getByRole('button',{name:'Close',exact:true}).click());
 sample.postCloseFrames=await cadence(page);
 sample.pages=[];for(const p of [background,page].filter(Boolean)){sample.pages.push(await p.evaluate(()=>({active:document.documentElement.dataset.pageActive,hidden:document.hidden,focus:document.hasFocus(),animation:getComputedStyle(document.querySelector('.brand-grid')).animation,grid:getComputedStyle(document.querySelector('.brand-grid')).animationPlayState})));}
 await page.screenshot({path:resolve(output,`${id}.png`)});
 }catch(error){sample.error=String(error.stack||error);}
 finally{for(const {ctx,label} of contexts.reverse()){await ctx.tracing.stop({path:resolve(output,`${id}-${label}.zip`)}).catch(error=>{sample.traceError=String(error);});await ctx.close();}await save();console.log(JSON.stringify(sample));}
 }
 }
}finally{await browser.close();report.finishedAt=new Date().toISOString();await save();}
if(report.samples.some(s=>s.error))process.exitCode=1;
