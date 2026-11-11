import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {scenarioPlayerCopy,renderScenarioPlayerCopy} from '../shell/scenario-player-copy.js';
const catalog=JSON.parse(await readFile(new URL('../scenarios/catalog.json',import.meta.url),'utf8'));
const ids=['6d7e4600-ab44-4fc8-a88f-54d3149e1c5e','5bbc0ebf-ed20-4e12-8143-67eaa5cc8676','7f0cf8bd-8af9-4f6d-9caf-7e6617d6c32d'];
const game={id:'context',player1:{identityId:'a',profile:{displayName:'Red <&>'}},player2:{identityId:'b',profile:{displayName:'Blue'}}};
for(const id of ids)test(`curated help ${id} resolves actual owners without editing saved copy`,()=>{
 const scenario=catalog.scenarios.find(item=>item.id===id),before=structuredClone({scenario,game});
 const parts=scenarioPlayerCopy(scenario,game);assert.ok(parts);
 const names=parts.filter(part=>typeof part!=='string');assert.ok(names.some(part=>part.text==='Red <&>'&&part.side==='P1'));
 assert.ok(names.some(part=>part.text==='Blue'&&part.side==='P2'&&!part.colorNamed));
 const html=renderScenarioPlayerCopy(scenario,game);assert.match(html,/Red: <\/span><bdi>Red &lt;&amp;&gt;/);assert.match(html,/Blue: <\/span><bdi>Blue/);
 assert.deepEqual({scenario,game},before);
});
test('abstract catalogs and edited or imported descriptions retain their exact authored text',()=>{
 const scenario=catalog.scenarios.find(item=>item.id===ids[0]);
 assert.equal(renderScenarioPlayerCopy(scenario,null),null);
 assert.equal(renderScenarioPlayerCopy({...scenario,description:'My Red and Blue story'},game),null);
 assert.equal(renderScenarioPlayerCopy({...scenario,id:'imported'},game),null);
});
test('an unassigned contextual seat stays an Open seat with nonvisual affiliation',()=>{
 const scenario=catalog.scenarios.find(item=>item.id===ids[1]);
 const html=renderScenarioPlayerCopy(scenario,{...game,player2:null});assert.match(html,/Blue: <\/span><bdi>Open seat<\/bdi>/);assert.doesNotMatch(html,/Guest/);
 const parts=scenarioPlayerCopy(scenario,{...game,player2:null});assert.equal(parts.find(part=>part?.side==='P2').text,'Open seat');
});
