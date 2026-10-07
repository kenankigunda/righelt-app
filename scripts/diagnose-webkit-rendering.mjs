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
  console.log('Usage: supervised node scripts/diagnose-webkit-rendering.mjs --url URL [--out DIR] [--rounds 2] [--trace on|snapshots|off]');
  process.exit(0);
}
if (!process.env.RIGHELT_RESOURCE_RUN) throw new Error('Run through scripts/resources/cli.mjs run --kind heavy.');
const url = new URL(option('--url', 'http://127.0.0.1:9888')).href;
const output = resolve(option('--out', 'test-results/webkit-rendering-diagnostic'));
const rounds = Number(option('--rounds', '2'));
const trace = option('--trace', 'on');
if (!Number.isInteger(rounds) || rounds < 1 || rounds > 5 || !['on', 'snapshots', 'off'].includes(trace)) throw new Error('Invalid rounds or trace option.');
const variants = [
  { name: 'baseline', css: '' },
  { name: 'grid-disabled', css: '.brand-grid { display:none!important; }' },
  { name: 'surface-filters-disabled', css: ':is(.home-refresh,.game-shell-frame,.game-shell-mobile-panel,.invite-gate) section.panel,.home-refresh .mini-board-card,button.opponent-choice { filter:none!important; }' },
  { name: 'grid-tiled-image', css: '.brand-grid > rect { display:none!important; }', tileGrid:true },
  { name: 'grid-unmasked', css: '.brand-grid { mask:none!important; -webkit-mask:none!important; }' },
  { name: 'grid-static', css: '.brand-grid { animation:none!important; }' },
  { name: 'grid-unmasked-static', css: '.brand-grid { mask:none!important; -webkit-mask:none!important; animation:none!important; }' },
  { name: 'baseline-repeat', css: '' },
];
const percentile = (values, fraction) => {
  const sorted = [...values].sort((a,b) => a-b);
  return sorted.length ? sorted[Math.ceil(sorted.length * fraction)-1] : null;
};
await mkdir(output, { recursive:true });
const report = {
  revision:execFileSync('git', ['rev-parse','HEAD'], { encoding:'utf8' }).trim(),
  platform:process.platform, node:process.version, url, trace, rounds,
  device:devices['Desktop Safari'], startedAt:new Date().toISOString(),
  note:'Fresh anonymous context per sample. Same home and first Friend click. No match creation. Diagnostic CSS only. Baseline repeated to expose drift. Frame sample bounded at 8s; trace capture is held constant.',
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
        sample.computed = await page.evaluate(() => ({
          gridDisplay:getComputedStyle(document.querySelector('.brand-grid')).display,
          gridWillChange:getComputedStyle(document.querySelector('.brand-grid')).willChange,
          gridMaskImage:getComputedStyle(document.querySelector('.brand-grid')).maskImage,
          gridWebkitMaskImage:getComputedStyle(document.querySelector('.brand-grid')).webkitMaskImage,
          gridAnimationName:getComputedStyle(document.querySelector('.brand-grid')).animationName,
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
