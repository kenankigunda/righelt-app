import assert from 'node:assert/strict';
const stable=value=>Array.isArray(value)?value.map(stable):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>[k,stable(v)])):value;
// spawnLogged prefixes stdout DATA CHUNKS, not every newline. All complete
// canonical objects must match the bound full raw API, tagged or untagged.
export function apiEvents(text){
 const events=new Map();let count=0;
 for(const raw of text.split('\n')){
  const line=raw.replace(/\x1b\[[0-9;]*[A-Za-z]/g,'');const start=line.indexOf('{"event":"api_request_completed"');if(start<0)continue;
  const value=JSON.parse(line.slice(start));assert.equal(value.event,'api_request_completed');
  const key=JSON.stringify(stable(value));events.set(key,(events.get(key)??0)+1);count++;
 }
 return {count,events:[...events.entries()].sort(([a],[b])=>a.localeCompare(b))};
}
export function compareApiEvents(rawText,stdoutText){const raw=apiEvents(rawText),stdout=apiEvents(stdoutText);assert(raw.count>0);assert.deepEqual(stdout,raw);return raw;}
