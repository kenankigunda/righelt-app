import test from "node:test";
import vm from "node:vm";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { getCommandLegendColor, getCommandLegendSwatchStyle, updateLegendVisibility, getInspectionLegendState, updateInspectionLegend } from "../legend.js";

const testDir = fileURLToPath(new URL(".", import.meta.url));
const shellAppSource = readFileSync(join(testDir, "..", "shell", "app.js"), "utf8");
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

test("shell command legend swatch is state-driven", () => {
  assert.match(shellAppSource, /id="shell-command-legend-swatch"/);
  assert.match(shellAppSource, /getCommandLegendSwatchStyle\(game\.currentSnapshot \?\? null\)/);
  assert.match(shellAppSource, /updateInspectionLegend\(document\.querySelector\('.overlay-key'\),state,\{selectedPieceId,\.\.\.overlay\}\);/);
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
