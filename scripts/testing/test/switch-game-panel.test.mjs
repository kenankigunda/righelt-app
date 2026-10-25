import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const source=readFileSync(new URL('../../../e2e/support/app.mjs',import.meta.url),'utf8');
const start=source.indexOf('export const switchGamePanel ='),end=source.indexOf('export const buildAppUrl =',start);
assert.ok(start>=0&&end>start);
const script=new vm.Script(`${source.slice(start,end).replace('export const','const')};switchGamePanel`);
function fixture({selected=false,layout='narrow'}={}) {
  const calls=[];let remainingIdleMs=57;
  const tab={getAttribute:async name=>{assert.equal(name,'aria-pressed');return String(selected);},
    click:async()=>{calls.push('target');assert.ok(remainingIdleMs>60,'The bar would hide before the target click without refreshing its idle window');selected=true;}};
  const reveal={count:async()=>1,getAttribute:async()=> 'true',click:async()=>{calls.push('reveal');remainingIdleMs=3000;}};
  const track={getAnimations:()=>[],getBoundingClientRect:()=>({left:0})};
  const panel={getBoundingClientRect:()=>({left:0}),closest:()=>track};
  const page={locator:selector=>selector==='#app'?{getAttribute:async()=>layout}:selector.startsWith('[data-action=')?tab:{evaluate:async fn=>fn(panel)},
    getByRole:(role,options)=>{assert.equal(role,'button');assert.equal(options.name,'Show game navigation');assert.equal(options.exact,true);assert.deepEqual(Object.keys(options).sort(),['exact','name']);return reveal;}};
  const expect=locator=>({toHaveAttribute:async(name,value)=>assert.equal(await locator.getAttribute(name),value)});
  expect.poll=fn=>({toBe:async value=>assert.equal(await fn(),value),toBeLessThanOrEqual:async value=>assert.ok(await fn()<=value)});
  return{calls,page,switchPanel:script.runInNewContext({expect})};
}
test('switching panels refreshes the real reveal even while an expanded bar is about to hide',async()=>{
  const f=fixture();await f.switchPanel(f.page,'players');assert.deepEqual(f.calls,['reveal','target']);
});
test('an already selected panel does not reveal or click navigation',async()=>{
  const f=fixture({selected:true});await f.switchPanel(f.page,'board');assert.deepEqual(f.calls,[]);
});
test('wide layout does not operate narrow navigation',async()=>{
  const f=fixture({layout:'wide'});await f.switchPanel(f.page,'players');assert.deepEqual(f.calls,[]);
});
