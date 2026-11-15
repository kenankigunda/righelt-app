import test from "node:test";
import vm from "node:vm";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { getCommandLegendColor, getCommandLegendSwatchStyle, updateLegendVisibility, getInspectionLegendState, updateInspectionLegend, getRenderedPreviousTurnLegendState, updatePreviousTurnLegend } from "../legend.js";
import {renderBoardLegend} from "../shell/board-legend.js";

const testDir = fileURLToPath(new URL(".", import.meta.url));
const stylesSource = readFileSync(join(testDir, "..", "styles.css"), "utf8");

test("command legend uses current side-to-move color when no piece is selected", () => {
  assert.equal(
    getCommandLegendColor({ sideToMove: "P1", pieces: [] }, null),
    "var(--player-p1)",
  );
  assert.equal(
    getCommandLegendColor({ sideToMove: "P2", pieces: [] }, null),
    "var(--player-p2)",
  );
});

test("command legend uses selected piece color when a piece is selected", () => {
  assert.equal(
    getCommandLegendColor(
      {
        sideToMove: "P1",
        pieces: [
          { id: "A1", owner: "P2" },
          { id: "B1", owner: "P1" },
        ],
      },
      "A1",
    ),
    "var(--player-p2)",
  );
});

test("command legend swatch style exposes the CSS variable", () => {
  assert.equal(
    getCommandLegendSwatchStyle({ sideToMove: "P2", pieces: [] }),
    "--swatch-command-color: var(--player-p2);--connection-sample-width:16px;--connection-line-width:3px;--connection-supply-sample:repeating-linear-gradient(to right,currentColor 0 5px,transparent 5px 9px);--connection-command-sample:repeating-linear-gradient(to right,currentColor 0 2px,transparent 2px 6px);",
  );
});

test("Board legend renders semantic families in family-major reading order", () => {
  const html=renderBoardLegend({sideToMove:'P2',pieces:[]});
  const commandFamily=html.indexOf('data-legend-family="command"');
  const commandLine=html.indexOf('data-legend-entry="command"');
  const supplyFamily=html.indexOf('data-legend-family="supply"');
  const supplyLine=html.indexOf('data-legend-entry="supply"');
  const strength=html.indexOf('data-legend-entry="group"');
  const previous=html.indexOf('data-legend-entry="previousTurn"');
  assert.ok(commandFamily>=0&&commandFamily<commandLine&&commandLine<supplyFamily);
  assert.ok(supplyFamily<supplyLine&&supplyLine<strength&&strength<previous);
  assert.match(html,/role="group" aria-label="Commander and command line"/);
  assert.match(html,/role="group" aria-label="Supply point and supply line"/);
  assert.match(html,/data-legend-entry="command" hidden/);
  assert.match(html,/data-legend-entry="supply" hidden/);
  assert.match(html,/data-legend-entry="group" hidden/);
  assert.match(html,/class="legend-key-row legend-context-row" data-legend-entry="previousTurn" hidden/);
  assert.doesNotMatch(html,/class="legend-context-row">/,'the hidden updater target is the grid row, so no empty wrapper reserves space');
  assert.match(html,/--supply-owner:var\(--player-p2\)/);
  assert.match(html,/id="shell-command-legend-swatch"[^>]+--swatch-command-color: var\(--player-p2\)/);
  assert.equal((html.match(/<button\b/g)??[]).length,2,'only the two existing inspectors are interactive');
});

test("command and supply samples keep distinct role patterns and semantic supply color", () => {
 assert.match(stylesSource,/\.swatch\.command\s*\{[\s\S]*color:\s*var\(--swatch-command-color, var\(--player-p1\)\);/s);
 assert.match(stylesSource,/\.swatch\.supply\s*\{[\s\S]*color:\s*var\(--connection-supply\);/s);
 assert.match(stylesSource,/background:var\(--connection-command-sample\);/);
 assert.match(stylesSource,/\.swatch\.supply::before \{background:var\(--connection-supply-sample\);\}/);
});


test("same legend visibility retains running animation; changed visibility restarts from current height", () => {
  const item = { hidden: true }, animations = [];
  let cancelled = 0, currentHeight = 20;
  const legend = {
    querySelector: () => item,
    getBoundingClientRect: () => ({height: currentHeight}),
    getAnimations: () => animations,
    get scrollHeight() { return item.hidden ? 20 : 50; },
    animate: frames => animations.push({frames, cancel() { cancelled++; }})
  };
  updateLegendVisibility(legend, {command: true});
  assert.equal(animations.length, 1);
  updateLegendVisibility(legend, {command: true});
  assert.equal(animations.length, 1);
  assert.equal(cancelled, 0);
  currentHeight = 35;
  updateLegendVisibility(legend, {command: false});
  assert.equal(cancelled, 1);
  assert.deepEqual(animations[1].frames, [{height: '35px'}, {height: '20px'}]);
  updateLegendVisibility(legend, {command: true}, true);
  assert.equal(item.hidden, false);
  assert.equal(animations.length, 2);
});

test('previous-turn key follows only the rendered live cue and uses the prior player color',()=>{
 const item={hidden:true,style:{setProperty:(name,value)=>{item[name]=value}}},painted={};
 const board={context:'previous-turn',painted,getAttribute(name){return name==='data-presentation-context'?this.context:null;},querySelector(){return this.painted;}};
 const legend={querySelector:selector=>selector==='[data-legend-entry="previousTurn"]'?item:null,getBoundingClientRect:()=>({height:20}),getAnimations:()=>[],get scrollHeight(){return item.hidden?20:40;},animate:()=>{}};
 assert.deepEqual(getRenderedPreviousTurnLegendState(board,{sideToMove:'P2'}),{visible:true,owner:'P1'});
 assert.deepEqual(updatePreviousTurnLegend(legend,board,{sideToMove:'P2'},true),{visible:true,owner:'P1'});assert.equal(item.hidden,false);assert.equal(item['--previous-turn-color'],'var(--player-p1)');
 board.context='history';assert.deepEqual(updatePreviousTurnLegend(legend,board,{sideToMove:'P2'},true),{visible:false,owner:null});assert.equal(item.hidden,true);
 board.context='previous-turn';board.painted=null;assert.deepEqual(updatePreviousTurnLegend(legend,board,{sideToMove:'P1'},true),{visible:false,owner:null});assert.equal(item.hidden,true);
});


test('commander and supply colors and pressed states resolve independently',()=>{
 const snapshot={sideToMove:'P1',pieces:[{id:'C2',owner:'P2',kind:'commander'}]};
 const context={selectedPieceId:'C2',networkInspections:{command:{kind:'command',owner:'P2'},supply:{kind:'supply',owner:'P1'}},networkOwners:{command:'P2',supply:'P1'}};
 const state=getInspectionLegendState(snapshot,context);
 assert.deepEqual(getInspectionLegendState(snapshot,{inspection:{kind:'networks',...context.networkInspections}}),state);
 assert.deepEqual(state,{command:{owner:'P2',color:'var(--player-p2)',selected:true},supply:{owner:'P1',color:'var(--player-p1)',selected:true}});
 context.networkInspections.supply=null;
 assert.equal(getInspectionLegendState(snapshot,context).command.selected,true);
 assert.deepEqual(getInspectionLegendState(snapshot,context).supply,{owner:'P1',color:'var(--player-p1)',selected:false});
 const attrs={},style={},iconStyle={},lineStyle={};
 const button={setAttribute:(key,value)=>{attrs[key]=value},style:{setProperty:(key,value)=>{style[key]=value}},querySelector:()=>({style:{setProperty:(key,value)=>{iconStyle[key]=value}}})};
 const legend={style:{setProperty:(key,value)=>{lineStyle[key]=value}},querySelector:selector=>selector.includes('data-board-inspection')?button:{style:{setProperty:(key,value)=>{lineStyle[key]=value}}}};
 updateInspectionLegend(legend,snapshot,context);
 assert.equal(attrs['aria-pressed'],'false');assert.equal(attrs['aria-label'],'Red supply point inspection');
 assert.equal(style['--legend-owner-color'],'var(--player-p1)');assert.equal(iconStyle['--supply-owner'],'var(--player-p1)');assert.equal(lineStyle['--swatch-supply-color'],'var(--connection-supply)');assert.equal(lineStyle['--connection-supply-sample'],'repeating-linear-gradient(to right,currentColor 0 5px,transparent 5px 9px)');
});


// Execute the actual case-local browser callback, not a copy of its predicate.
const legendJourneySource=readFileSync(new URL('../../../e2e/workflows/ux-refresh-checkpoint.spec.mjs',import.meta.url),'utf8');
const atomicStart=legendJourneySource.indexOf(' const readLegendOwnershipColors = () => {');
const atomicEnd=legendJourneySource.indexOf(' const checkColors=',atomicStart);
assert.ok(atomicStart>=0 && atomicEnd>atomicStart,'actual atomic legend callback must be present');
const atomicSource=legendJourneySource.slice(atomicStart,atomicEnd)+';globalThis.read=readLegendOwnershipColors;';
const atomicLegendModel=()=>{
 const document={};
 const node=()=>({isConnected:true,ownerDocument:document,getRootNode:()=>document});
 const root=node(),board=node(),commander=node(),command=node(),supply=node(),selected=node();
 selected.classList={contains:kind=>kind==='p2'};
 const nodes={'.commander-key':commander,'.command':command,'.supply-point svg':supply};
 const owners={command:'P2',supply:'P2'};
 root.querySelector=selector=>selector==='[data-board-inspection="command"]'?{getAttribute:()=>owners.command}:selector==='[data-board-inspection="supply"]'?{getAttribute:()=>owners.supply}:nodes[selector];
 root.contains=value=>Object.values(nodes).includes(value);board.contains=value=>value===selected;
 board.querySelector=()=>selected;document.documentElement=node();
 document.querySelector=selector=>selector==='.overlay-key'?root:selector==='#shell-board'?board:null;
 const styles=new Map([[commander,{color:'rgb(45, 103, 199)',token:'#2d67c7'}],[command,{color:'rgb(45, 103, 199)',token:'#2d67c7'}],[supply,{fill:'rgb(45, 103, 199)',token:'#2d67c7'}],[document.documentElement,{token:'#2d67c7'}]]);
 const context=vm.createContext({document,getComputedStyle:value=>{const style=styles.get(value);return {...style,getPropertyValue:()=>style.token};}});
 vm.runInContext(atomicSource,context);
 return {read:context.read,document,root,board,commander,command,supply,selected,nodes,owners,styles};
};
const acceptsLegendSample=sample=>sample.valid===true && sample.owner==='P2' && sample.commandOwner==='P2' && sample.supplyOwner==='P2' && sample.colorsAgree===true && sample.ownerColorsAgree===true;
test('actual atomic legend callback accepts current connected matching ownership and colors',()=>{
 const model=atomicLegendModel();const sample=model.read();assert.equal(acceptsLegendSample(sample),true);assert.equal(sample.commanderColor,'rgb(45, 103, 199)');assert.equal(sample.supplyFill,sample.commanderColor);
});
for(const [name,change] of [
 ['missing icon',m=>{m.nodes['.commander-key']=null;}],
 ['detached icon',m=>{m.commander.isConnected=false;}],
 ['stale document root',m=>{m.root.getRootNode=()=>({});}],
 ['stale foreign document',m=>{m.commander.ownerDocument={};}],
 ['empty computed color',m=>{m.styles.get(m.commander).color='';}],
 ['connected wrong commander color',m=>{m.styles.get(m.commander).color='rgb(194, 69, 47)';}],
 ['connected wrong supply fill',m=>{m.styles.get(m.supply).fill='rgb(194, 69, 47)';}],
 ['all matching colors from wrong owner',m=>{for(const value of [m.commander,m.command,m.supply]){const style=m.styles.get(value);style.token='#c2452f';if('color' in style)style.color='rgb(194, 69, 47)';else style.fill='rgb(194, 69, 47)';}}],
 ['unselected ownership',m=>{m.selected.classList.contains=()=>false;}],
 ['stale inspection ownership',m=>{m.owners.command='P1';}],
])test(`actual atomic legend callback rejects ${name}`,()=>{
 const model=atomicLegendModel();change(model);assert.equal(acceptsLegendSample(model.read()),false);
});
