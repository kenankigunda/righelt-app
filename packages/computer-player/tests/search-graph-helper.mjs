import { readFileSync } from "node:fs";
import ts from "typescript";
let source=readFileSync(new URL('../src/search.ts',import.meta.url),'utf8');
source=source.replace('import { encodeState, experimentConfig as config, legalActionMap, scanLegalActions } from "./representation";',
  'import { experimentConfig as config } from "./representation";');
source=source.replace('import { terminalValue, transition } from "./transition";','');
const mock=`
import { checkEngineComputation } from '../../game-engine/src/index';
let graph; export const calls = new Map(); export const operations = [];
export function configure(value) { graph=value; calls.clear(); operations.length=0; }
function touch(key, limited) {
  calls.set(key,(calls.get(key)||0)+1); operations.push(key);
  if(limited) for(let i=0;i<=16384;i++)checkEngineComputation(true);
}
function node(key) { return {key,sideToMove:graph[key].controller||'P1'}; }
export function start() { return node('root'); }
function encodeState() { return new Float32Array(4600); }
function legalActionMap(state) {
  touch('legal:'+state.key,graph[state.key].legalLimit);
  return new Map((graph[state.key].actions||[]).map(a=>[a.index,{type:'move',actorId:String(a.index),target:a.to,limited:a.limit}]));
}
function scanLegalActions(state,classify,accept) {
  for(const a of graph[state.key].actions||[]) {
    const action={type:'move',actorId:String(a.index),target:a.to,limited:a.limit};
    const legal=classify(()=>{a.onValidate?.();touch('candidate:'+a.index,graph[state.key].legalLimit||a.legalLimit);return true;});
    accept(a.index,action,legal);
  }
}
function transition(state,action) { touch('transition:'+state.key+':'+action.actorId,action.limited); return node(action.target); }
function terminalValue(state) { return graph[state.key].terminal; }
`;
const absolute=(source+'\n'+mock).replace(/(from\s+["'])(\.\.?\/[^"']+)(["'])/g,(_,prefix,specifier,suffix)=>
  prefix+new URL(specifier+'.ts',new URL('../src/',import.meta.url)).href+suffix);
const compiled=ts.transpileModule(absolute,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
export const core=await import('data:text/javascript;base64,'+Buffer.from(compiled).toString('base64'));
