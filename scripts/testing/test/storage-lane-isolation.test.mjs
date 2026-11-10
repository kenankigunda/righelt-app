import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const root=new URL('../../../',import.meta.url);
// Evaluate the actual configuration bodies. Only the external Playwright/device
// and launch-option collaborators are inert, so these controls need no browser.
const config=(file,base)=>{
 const source=readFileSync(new URL(file,root),'utf8')
  .replace(/^import .*;\n/gm,'')
  .replace('export default config;','globalThis.result=config;')
  .replace('export default defineConfig(','globalThis.result=defineConfig(');
 const context=vm.createContext({base,process:{env:{}},defineConfig:value=>value,
  devices:{'Desktop Chrome':{},'Desktop Firefox':{},'Desktop Safari':{}},
  browserLaunchOptions:name=>({engine:name})});
 new vm.Script(source,{filename:file}).runInContext(context);
 return context.result;
};
const general=config('playwright.config.mjs');
const storage=config('playwright.storage-lifecycle.config.mjs',general);
const titles=[...readFileSync(new URL('e2e/workflows/storage-lifecycle.spec.mjs',root),'utf8')
 .matchAll(/^test\('([^']+)'/gm)].map(match=>match[1]);

for(const engine of ['chromium','firefox','webkit']){
 test(`${engine}: dedicated storage selection contains exactly the two original reset/archive cases`,()=>{
  const project=storage.projects.find(project=>project.name===engine);
  assert.ok(project);
  // A project match overrides the root match. This assertion catches the old
  // inherited Firefox/WebKit general-inventory regexp, even with a narrow root.
  assert.equal(project.testMatch,'**/storage-lifecycle.spec.mjs');
  assert.equal(storage.testMatch,project.testMatch);
  assert.equal(storage.testIgnore,'**/auth/**');
  assert.deepEqual(titles,[
   'archive preserves browser history, direct links and exactly-once resumed play',
   'reset fences a stale tab and creates a fresh game in the new generation',
  ]);
 });
 test(`${engine}: general and destructive storage inventories are disjoint`,()=>{
  assert.ok(general.projects.some(project=>project.name===engine));
  assert.ok(Array.isArray(general.testIgnore));
  assert.ok(general.testIgnore.includes('**/storage-lifecycle.spec.mjs'));
  assert.ok(general.testIgnore.includes('**/auth/**'));
  assert.ok(!general.testIgnore.includes('**/home-create-refresh.spec.mjs'));
 });
}

test('dedicated lane retains original stack, budgets, reporters and engine settings',()=>{
 assert.equal(storage.workers,general.workers);
 assert.equal(storage.timeout,general.timeout);
 assert.equal(storage.expect,general.expect);
 assert.equal(storage.use,general.use);
 assert.equal(storage.webServer,general.webServer);
 assert.equal(storage.reporter,general.reporter);
 for(const project of storage.projects){
  const original=general.projects.find(candidate=>candidate.name===project.name);
  assert.equal(project.use,original.use);
 }
});
