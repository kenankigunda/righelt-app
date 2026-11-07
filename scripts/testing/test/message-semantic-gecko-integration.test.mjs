import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {assertSemanticGeometry} from '../../../browser-integration/support/message-semantic-geometry.mjs';
import {qualifyGeckoSharedEdge} from '../../../browser-integration/support/gecko-edge-composition.mjs';
const retained=JSON.parse(readFileSync(new URL('./fixtures/semantic-gecko-edge.json',import.meta.url),'utf8'));
const clone=value=>structuredClone(value);
// Synthetic qualified domain/calibration are model inputs here. Real APIs have separate controls.
const profile={engine:'firefox',version:'148.0.2',upstreamRevision:'d0f4d17d5aefe7ca5aa97afbcafcdc641cbd9f93',sourceQualified:true};
const qualified=()=>{const current=clone(retained.changed);current.edgeWitness={...qualifyGeckoSharedEdge({boardTop:current.board.top,slotTop:current.slot.top,slotHeight:current.slot.height,slotBottom:current.slot.bottom,profile}),domain:{qualified:true},calibration:{qualified:true}};return current;};
test('original strict nonoverlap still rejects retained raw discrepancy without a sample witness',()=>{assert.throws(()=>assertSemanticGeometry(retained.before,retained.changed));});
test('unique recovered edge with bound model witness permits only the retained representational discrepancy',()=>{const current=qualified();assert.equal(current.edgeWitness.appUnitEdges.board,15799);assert.equal(current.edgeWitness.appUnitEdges.slotBottom,15799);assert.doesNotThrow(()=>assertSemanticGeometry(retained.before,current));});
test('missing, incomplete or unsupported witness cannot weaken the original nonoverlap check',()=>{for(const mutate of [p=>p.qualified=false,p=>p.incomplete=true,p=>delete p.domain,p=>p.domain.qualified=false,p=>delete p.calibration,p=>p.calibration.qualified=false]){const current=qualified();mutate(current.edgeWitness);assert.throws(()=>assertSemanticGeometry(retained.before,current));}});
test('a previously positive witness cannot be reused for any independent tiny or one-pixel Board movement',()=>{for(const amount of [1/64,-1/64,1,-1]){const current=qualified();current.board.y+=amount;current.board.top+=amount;current.board.bottom+=amount;assert.throws(()=>assertSemanticGeometry(retained.before,current));}});
test('current sample operands must match every original proof primitive',()=>{for(const key of ['boardTop','slotTop','slotHeight','slotBottom']){const current=qualified();current.edgeWitness.raw[key]+=1/64;assert.throws(()=>assertSemanticGeometry(retained.before,current));}});
test('a bound edge witness never waives Board width, slot origin, layout height or measured edge composition',()=>{for(const mutate of [c=>c.board.width+=1,c=>c.slot.y+=1,c=>c.boardLayoutHeight='400px',c=>c.board.bottom+=1/64]){const current=qualified();mutate(current);assert.throws(()=>assertSemanticGeometry(retained.before,current));}});
test('different recovered app-unit edges still fail the specific adjacency predicate',()=>{const current=qualified();current.edgeWitness.appUnitEdges.board--;assert.throws(()=>assertSemanticGeometry(retained.before,current));});
test('ordinary exact adjacency keeps the original assertion and needs no engine profile',()=>{assert.doesNotThrow(()=>assertSemanticGeometry(retained.before,retained.before));});
