import test from 'node:test';
import assert from 'node:assert/strict';
import {gameDateInlayModel,renderGameDateInlay} from '../shell/game-date-inlay.js';

test('game start instant renders in the viewer locale and timezone',()=>{
 const instant='2026-11-13T23:30:00.000Z';
 const losAngeles=gameDateInlayModel(instant,{locale:'en-US',timeZone:'America/Los_Angeles'});
 const tokyo=gameDateInlayModel(instant,{locale:'ja-JP',timeZone:'Asia/Tokyo'});
 assert.deepEqual([losAngeles.month,losAngeles.day,losAngeles.hour,losAngeles.phase],['Nov','13',15,'afternoon']);
 assert.deepEqual([tokyo.month,tokyo.day,tokyo.hour,tokyo.phase],['11','14',8,'early morning']);
 assert.match(renderGameDateInlay(instant,{locale:'en-US',timeZone:'America/Los_Angeles'}),/Started November 13, 2026 at 3:30 PM, afternoon/);
});

test('seven dayparts occupy the approved open etched orbit positions',()=>{
 const samples=[['2026-11-13T01:00:00Z','late night'],['2026-11-13T06:00:00Z','early morning'],['2026-11-13T10:00:00Z','mid morning'],['2026-11-13T12:00:00Z','noon'],['2026-11-13T15:00:00Z','afternoon'],['2026-11-13T19:00:00Z','evening'],['2026-11-13T22:00:00Z','night']];
 const positions=new Set(samples.map(([instant,phase])=>{const model=gameDateInlayModel(instant,{locale:'en-US',timeZone:'UTC'});assert.equal(model.phase,phase);return model.position.join(',');}));
 assert.equal(positions.size,7);
 assert.match(renderGameDateInlay(samples[0][0],{locale:'en-US',timeZone:'UTC'}),/game-date-orbit-highlight[\s\S]*game-date-orbit[\s\S]*game-date-celestial/);
 assert.doesNotMatch(renderGameDateInlay(samples[0][0],{locale:'en-US',timeZone:'UTC'}),/<rect/);
});

test('invalid or unavailable starts remain a bounded decorative loading slot',()=>{
 const html=renderGameDateInlay('not-a-date');
 assert.match(html,/game-date-inlay is-loading/);
 assert.match(html,/aria-hidden="true"/);
 assert.doesNotMatch(html,/role="img"/);
});
