// Diagnostic only. No product changes or normal test configuration overrides.
// Existing preview: node scripts/resources/cli.mjs run --kind heavy -- node scripts/diagnose-webkit-rendering.mjs --url http://127.0.0.1:9888
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { devices, webkit } from '@playwright/test';
import { browserLaunchOptions } from './playwright-launch-options.mjs';

const args = process.argv.slice(2);
const option = (key, fallback) => {
  const index = args.indexOf(key);
  return index < 0 ? fallback : args[index + 1];
};
if (args.includes('--help')) {
  console.log('Usage: supervised node scripts/diagnose-webkit-rendering.mjs --url URL [--out DIR] [--rounds 2] [--trace on|snapshots|off] [--variants baseline,grid-wrapper-animation,grid-static,baseline-repeat]');
  process.exit(0);
}
if (!process.env.RIGHELT_RESOURCE_RUN) throw new Error('Run through scripts/resources/cli.mjs run --kind heavy.');
const url = new URL(option('--url', 'http://127.0.0.1:9888')).href;
const output = resolve(option('--out', 'test-results/webkit-rendering-diagnostic'));
const rounds = Number(option('--rounds', '2'));
const trace = option('--trace', 'on');
if (!Number.isInteger(rounds) || rounds < 1 || rounds > 5 || !['on', 'snapshots', 'off'].includes(trace)) throw new Error('Invalid rounds or trace option.');
const availableVariants = [
  { name: 'baseline', css: '' },
  { name: 'grid-disabled', css: '.brand-grid { display:none!important; }' },
  { name: 'surface-filters-disabled', css: ':is(.home-refresh,.game-shell-frame,.game-shell-mobile-panel,.invite-gate) section.panel,.home-refresh .mini-board-card,button.opponent-choice { filter:none!important; }' },
  { name: 'grid-tiled-image', css: '.brand-grid > rect { display:none!important; }', tileGrid:true },
  { name: 'grid-unmasked', css: '.brand-grid { mask:none!important; -webkit-mask:none!important; }' },
  { name: 'grid-static', css: '.brand-grid { animation:none!important; }' },
  { name: 'grid-unmasked-static', css: '.brand-grid { mask:none!important; -webkit-mask:none!important; animation:none!important; }' },
  { name: 'grid-wrapper-animation', css: '', wrapGrid:true },
  { name: 'grid-raster-canvas', css: '', rasterGrid:true },
  { name: 'baseline-repeat', css: '' },
];
const selection=option('--variants',availableVariants.map(variant=>variant.name).join(',')).split(',');
if(selection.length<3 || selection[0]!=='baseline' || selection.at(-1)!=='baseline-repeat' || new Set(selection).size!==selection.length || selection.some(name=>!availableVariants.some(variant=>variant.name===name)))throw new Error('Variants must be unique known names with baseline first and baseline-repeat last.');
const variants=selection.map(name=>availableVariants.find(variant=>variant.name===name));
const percentile = (values, fraction) => {
  const sorted = [...values].sort((a,b) => a-b);
  return sorted.length ? sorted[Math.ceil(sorted.length * fraction)-1] : null;
};
await mkdir(output, { recursive:true });
const report = {
  revision:execFileSync('git', ['rev-parse','HEAD'], { encoding:'utf8' }).trim(),
  platform:process.platform, node:process.version, url, trace, rounds, variants:selection,
  device:devices['Desktop Safari'], startedAt:new Date().toISOString(),
  note:'Fresh anonymous context per sample. Same home and first Friend click. No match creation. Diagnostic rendering interventions only; raster preparation reported separately. Baseline repeated to expose drift. Frame sample bounded at 8s; trace capture is held constant.',
  samples:[],
};
const save = () => writeFile(resolve(output, 'report.json'), JSON.stringify(report, null, 2));
const browser = await webkit.launch({ headless:true, ...browserLaunchOptions('webkit') });
report.browserVersion = browser.version();
try {
  for (let round=0; round<rounds; round++) {
    // Keep baseline bookends and reverse all interventions on alternate rounds.
    const interventions=variants.slice(1,-1);
    const order=[variants[0],...(round % 2 ? interventions.reverse() : interventions),variants.at(-1)];
    for (const variant of order) {
      const id = `${round+1}-${variant.name}`;
      const context = await browser.newContext({ ...devices['Desktop Safari'] });
      const sample = { id, variant:variant.name, css:variant.css, startedAt:new Date().toISOString() };
      report.samples.push(sample);
      try {
        if (trace !== 'off') await context.tracing.start({ screenshots:trace === 'on', snapshots:true, sources:true });
        const page = await context.newPage();
        page.setDefaultTimeout(20_000);
        await page.goto(url, { waitUntil:'domcontentloaded' });
        const create = page.getByTestId('home-create-game');
        await create.waitFor({ state:'visible' });
        await page.waitForFunction(() => !document.querySelector('[data-testid="home-section-skeleton"]'));
        // Baseline receives the same style insertion/reflow boundary.
        await page.addStyleTag({ content:variant.css || '/* diagnostic baseline */' });
        if(variant.tileGrid) await page.evaluate(()=>{
          const grid=document.querySelector('.brand-grid'), pattern=grid.querySelector('pattern'), path=pattern.querySelector('path');
          const width=pattern.getAttribute('width'),height=pattern.getAttribute('height');
          const tile=`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${path.outerHTML}</svg>`;
          grid.style.backgroundImage=`url("data:image/svg+xml,${encodeURIComponent(tile)}")`;
          grid.style.backgroundSize=`${width}px ${height}px`;
          grid.style.backgroundPosition=`${pattern.getAttribute('x')}px ${pattern.getAttribute('y')}px`;
        });
        if(variant.wrapGrid) sample.wrapper=await page.evaluate(()=>{
          const grid=document.querySelector('.brand-grid'), style=getComputedStyle(grid);
          const animation=style.animation, willChange=style.willChange;
          const phase=grid.getAnimations().find(effect=>effect.animationName==='righelt-grid-breathe')?.currentTime;
          const before=grid.getBoundingClientRect().toJSON();
          const wrapper=document.createElement('div');wrapper.className='diagnostic-grid-wrapper';
          wrapper.setAttribute('aria-hidden','true');
          Object.assign(wrapper.style,{position:'fixed',inset:'0',width:'100%',height:'100%',pointerEvents:'none',zIndex:'-1',animation,willChange});
          grid.before(wrapper);wrapper.append(grid);
          grid.style.setProperty('animation','none','important');
          Object.assign(grid.style,{position:'absolute',zIndex:'auto',opacity:'1',willChange:'auto'});
          const animatedWrapper=wrapper.getAnimations().find(effect=>effect.animationName==='righelt-grid-breathe');
          if(animatedWrapper && typeof phase==='number')animatedWrapper.currentTime=phase;
          const after=grid.getBoundingClientRect().toJSON();
          if(['x','y','width','height'].some(key=>before[key]!==after[key]))throw new Error('Wrapper intervention changed grid geometry');
          if(!animatedWrapper)throw new Error('Wrapper intervention failed to retain grid animation');
          return {animation,phase,before,after};
        });
        if(variant.rasterGrid) sample.raster=await page.evaluate(async()=>{
          const started=performance.now();
          const grid=document.querySelector('.brand-grid'), style=getComputedStyle(grid);
          const before=grid.getBoundingClientRect().toJSON(), ratio=devicePixelRatio;
          const pattern=grid.querySelector('pattern');
          if(!pattern || before.x!==0 || before.y!==0)throw new Error('Raster diagnostic requires the current viewport-aligned SVG grid');
          const sourceMask=style.maskImage || style.webkitMaskImage;
          // Match the current two masks explicitly: this diagnostic must fail
          // rather than silently flatten a different approved corner treatment.
          if(!/1050px 850px/.test(sourceMask) || !/650px 650px/.test(sourceMask) ||
            !/0\.55/.test(sourceMask) || !/0\.2\)/.test(sourceMask) || !/0\.85/.test(sourceMask))throw new Error('Unexpected grid mask; update diagnostic equivalence first');
          const originX=parseFloat(style.getPropertyValue('--grid-origin-x'));
          const originY=parseFloat(style.getPropertyValue('--grid-origin-y'));
          if(!Number.isFinite(originX)||!Number.isFinite(originY))throw new Error('Grid origin has not settled');
          const animation=style.animation, phase=grid.getAnimations().find(effect=>effect.animationName==='righelt-grid-breathe')?.currentTime;
          const serializedPattern=pattern.outerHTML;
          // Rasterize the existing pattern at device resolution once. Two white
          // alpha gradients combine source-over, matching CSS mask-composite:add.
          // This preserves the actual logo-derived pitch/origin/path/stroke.
          const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="${before.width}" height="${before.height}" viewBox="0 0 ${before.width} ${before.height}"><defs>${serializedPattern}
            <radialGradient id="diagnostic-corner-a" gradientUnits="userSpaceOnUse" cx="0" cy="0" r="1" gradientTransform="translate(${originX} ${originY}) scale(1050 850)"><stop offset="0" stop-color="white"/><stop offset=".3" stop-color="white" stop-opacity=".55"/><stop offset=".85" stop-color="white" stop-opacity=".2"/></radialGradient>
            <radialGradient id="diagnostic-corner-b" gradientUnits="userSpaceOnUse" cx="0" cy="0" r="1" gradientTransform="translate(${before.width} ${before.height}) scale(650 650)"><stop offset="0" stop-color="white" stop-opacity=".85"/><stop offset=".85" stop-color="white" stop-opacity="0"/></radialGradient>
            <mask id="diagnostic-baked-mask" maskUnits="userSpaceOnUse" x="0" y="0" width="${before.width}" height="${before.height}" style="mask-type:alpha"><rect width="100%" height="100%" fill="url(#diagnostic-corner-a)"/><rect width="100%" height="100%" fill="url(#diagnostic-corner-b)"/></mask></defs><rect width="100%" height="100%" fill="url(#${pattern.id})" mask="url(#diagnostic-baked-mask)"/></svg>`;
          const bitmap=new Image();bitmap.src=`data:image/svg+xml,${encodeURIComponent(svg)}`;
          await bitmap.decode();
          const canvas=document.createElement('canvas');canvas.width=Math.ceil(before.width*ratio);canvas.height=Math.ceil(before.height*ratio);
          const context=canvas.getContext('2d');context.drawImage(bitmap,0,0,canvas.width,canvas.height);
          canvas.className='brand-grid diagnostic-raster-grid';canvas.setAttribute('aria-hidden','true');
          canvas.style.cssText=grid.style.cssText;
          canvas.style.setProperty('mask','none','important');canvas.style.setProperty('-webkit-mask','none','important');
          canvas.style.setProperty('animation',animation);
          grid.before(canvas);grid.classList.remove('brand-grid');grid.classList.add('diagnostic-source-grid');grid.style.display='none';
          const effect=canvas.getAnimations().find(effect=>effect.animationName==='righelt-grid-breathe');
          if(effect && typeof phase==='number')effect.currentTime=phase;
          if(!effect)throw new Error('Raster diagnostic lost breathing animation');
          const after=canvas.getBoundingClientRect().toJSON();
          if(['x','y','width','height'].some(key=>before[key]!==after[key]))throw new Error('Raster diagnostic changed grid geometry');
          window.diagnosticGridPattern=serializedPattern;
          return {sourceMask,originX,originY,pattern:serializedPattern,animation,phase,before,after,bitmap:[canvas.width,canvas.height],preparationMs:performance.now()-started};
        });
        sample.computed = await page.evaluate(() => ({
          gridDisplay:getComputedStyle(document.querySelector('.brand-grid')).display,
          gridWillChange:getComputedStyle(document.querySelector('.brand-grid')).willChange,
          gridMaskImage:getComputedStyle(document.querySelector('.brand-grid')).maskImage,
          gridWebkitMaskImage:getComputedStyle(document.querySelector('.brand-grid')).webkitMaskImage,
          gridAnimationName:getComputedStyle(document.querySelector('.brand-grid')).animationName,
          wrapperAnimationName:document.querySelector('.diagnostic-grid-wrapper')?getComputedStyle(document.querySelector('.diagnostic-grid-wrapper')).animationName:null,
          sectionFilters:[...document.querySelectorAll('.home-refresh section.panel, .home-refresh > section.panel, button.opponent-choice')].map(el => ({tag:el.className, filter:getComputedStyle(el).filter})),
          viewport:[innerWidth,innerHeight,devicePixelRatio],
        }));
        // Record event delivery separately from Playwright's full actionability wait.
        await create.evaluate(el => el.addEventListener('pointerdown', () => {
          window.diagnosticPointerAt=performance.now();
        }, {once:true}));
        const browserBefore = await page.evaluate(()=>performance.now());
        const started = performance.now();
        await create.click();
        sample.clickMs = performance.now()-started;
        sample.pointerDelayMs = await page.evaluate(before=>window.diagnosticPointerAt-before,browserBefore);
        // Different copy versions are irrelevant; verify the actual Friend primary action.
        await page.getByRole('button', { name:'Start a friend game',exact:true }).waitFor({state:'visible'});
        sample.friendOpened = true;
        await page.screenshot({path:resolve(output, `${id}.png`)});
        await page.keyboard.press('Escape');
        await page.getByRole('button', { name:'Start a friend game',exact:true }).waitFor({state:'hidden'});
        sample.frames = await page.evaluate(() => new Promise(resolve => {
          const intervals=[]; let previous=null, frame, finished=false;
          const finish = timedOut => {
            if(finished)return;finished=true;clearTimeout(timer);cancelAnimationFrame(frame);
            resolve({intervals,timedOut});
          };
          const timer=setTimeout(()=>finish(true),8000);
          const tick=time=>{
            if(previous!==null)intervals.push(time-previous);previous=time;
            if(intervals.length>=12)finish(false);else frame=requestAnimationFrame(tick);
          };
          frame=requestAnimationFrame(tick);
        }));
        sample.frames.medianMs = percentile(sample.frames.intervals, .5);
        sample.frames.p95Ms = percentile(sample.frames.intervals, .95);
        await page.screenshot({path:resolve(output, `${id}-home.png`)});
        if(variant.rasterGrid) {
          sample.raster.patternUnchanged=await page.evaluate(()=>document.querySelector('.diagnostic-source-grid pattern').outerHTML===window.diagnosticGridPattern);
          if(!sample.raster.patternUnchanged)throw new Error('Logo/grid geometry changed after rasterization; sample is not comparable');
        }
        sample.completedAt = new Date().toISOString();
      } catch (error) {
        sample.error = String(error.stack || error);
      } finally {
        if(trace !== 'off') await context.tracing.stop({path:resolve(output, `${id}.zip`)}).catch(error => {sample.traceError=String(error);});
        await context.close();
        await save();
        console.log(JSON.stringify({id,clickMs:sample.clickMs,pointerDelayMs:sample.pointerDelayMs,frames:sample.frames,error:sample.error}));
      }
    }
  }
} finally {
  await browser.close();
  report.finishedAt = new Date().toISOString();
  report.summary = Object.fromEntries(variants.map(({name})=>{
    const samples=report.samples.filter(s=>s.variant===name&&!s.error);
    return [name,{completed:samples.length,clickMedianMs:percentile(samples.map(s=>s.clickMs),.5),frameMedianMs:percentile(samples.flatMap(s=>s.frames.intervals),.5)}];
  }));
  await save();
}
if(report.samples.some(sample=>sample.error)) process.exitCode=1;
