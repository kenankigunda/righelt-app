import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

test('continuous delivery guidance keeps its canonical links and critical contracts aligned',()=>{
 const agents=readFileSync(new URL('../AGENTS.md',import.meta.url),'utf8');
 const guide=readFileSync(new URL('../docs/ai/CONTINUOUS_DELIVERY_DOS_AND_DONTS.md',import.meta.url),'utf8');
 const skill=readFileSync(new URL('../skills/righelt-continuous-delivery/SKILL.md',import.meta.url),'utf8');
 assert.match(agents,/skills\/righelt-continuous-delivery\/SKILL\.md/);
 assert.match(agents,/docs\/ai\/CONTINUOUS_DELIVERY_DOS_AND_DONTS\.md/);
 assert.match(skill,/\.\.\/\.\.\/docs\/ai\/CONTINUOUS_DELIVERY_DOS_AND_DONTS\.md/);
 for(const text of [guide,skill]){
  assert.match(text,/decision-delivery-register\.json/);
  assert.match(text,/pnpm check:test-durability|durability first/);
  assert.match(text,/PR validation/);
  assert.match(text,/detail read/);
  assert.match(text,/retire/i);
  assert.match(text,/never (?:create a )?duplicate/i);
  assert.match(text,/explicit install|explicit installation/);
 }
});
