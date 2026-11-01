import test from "node:test";
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
