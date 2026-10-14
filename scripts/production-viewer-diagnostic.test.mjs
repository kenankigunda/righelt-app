import {test} from 'node:test';
import assert from 'node:assert/strict';
import {tailDecoder,exceptionSummary,diagnosticTarget} from './production-viewer-diagnostic.mjs';
test('the incident ID is accepted while URL and argument injection are rejected',()=>{
 const env={DIAGNOSTIC_GAME_ID:'game-a06f27bd21cf74b01a82750e57b71b50dcb5',RIGHELT_SITE_ORIGIN:'https://righelt.pages.dev',CLOUDFLARE_PAGES_PROJECT:'righelt'};
 assert.equal(diagnosticTarget(env).gameId,env.DIAGNOSTIC_GAME_ID);
 for(const gameId of ['game-abc/../other','game-abc?other=1','--other'])assert.throws(()=>diagnosticTarget({...env,DIAGNOSTIC_GAME_ID:gameId}));
 assert.throws(()=>diagnosticTarget({...env,RIGHELT_SITE_ORIGIN:'https://righelt.pages.dev/path'}));
 assert.throws(()=>diagnosticTarget({...env,CLOUDFLARE_PAGES_PROJECT:'righelt --other'}));
});
test('formatted and split tail objects decode without printing startup text',()=>{
 const events=[],decode=tailDecoder(event=>events.push(event));
 decode('Connected to worker\n{\n"event":{"request":');
 decode('{"headers":{"x":"quote \\" and brace }"}}},"exceptions":[]}\n{"outcome":"ok"}\n');
 assert.equal(events.length,2);assert.equal(events[0].event.request.headers.x,'quote " and brace }');assert.equal(events[1].outcome,'ok');
});
test('only controlled request exceptions are projected, without headers, bodies or console logs',()=>{
 const event={outcome:'exception',event:{request:{headers:{'X-Righelt-Request-Id':'owned',Cookie:'session=private'},body:'private body'}},logs:[{message:['private log']}],exceptions:[{name:'Error',message:'Failure for id-private',stack:'id-private stack'}]};
 assert.equal(exceptionSummary(event,'other'),null);
 assert.deepEqual(exceptionSummary(event,'owned'),{outcome:'exception',exceptions:[{name:'Error',message:'Failure for [identity]',stack:'[identity] stack'}]});
 assert.equal(JSON.stringify(exceptionSummary(event,'owned')).includes('private'),false);
});
test('a controlled healthy event produces no output',()=>assert.equal(exceptionSummary({event:{request:{headers:{'x-righelt-request-id':'owned'}}},exceptions:[]},'owned'),null));
