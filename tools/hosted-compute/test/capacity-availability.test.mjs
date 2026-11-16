import test from 'node:test';
import assert from 'node:assert/strict';
import {validateCapacityAvailability} from '../capacity-availability.mjs';
import {capacityObservationFixture} from './capacity-availability-fixture.mjs';
test('one coherent native filtered LOW observation permits the approved272-cent all-in quote without claiming reservation',async()=>{
 const f=await capacityObservationFixture();assert.equal(f.capacity.observationSha256,'6770587fccf9752ce295a0d1fcc367e900e5ff46829c5038e8a259b092ce0439');
 await validateCapacityAvailability(f.core,f.host,f.intent,f.capacity);
 assert.equal(f.capacity.observation.response.availability,'LOW');assert.equal(f.capacity.observation.notReservation,true);
 for(const availability of ['MEDIUM','HIGH']){f.capacity.observation.response.availability=availability;f.capacity.observation.response.dataCenters[0].availability=availability;await f.freeze();await validateCapacityAvailability(f.core,f.host,f.intent,f.capacity);}
});
test('NONE, unavailable CUDA, mismatched filters/DC/identity/minima, stale observations and quote floors fail even with a freshly bound hash',async()=>{
 const changes=[
  f=>{f.capacity.observation.response.availability='NONE';},f=>{f.capacity.observation.response.dataCenters[0].availability='NONE';},
  f=>{f.capacity.observation.response.cudaVersions[0].available=false;},f=>{f.capacity.observation.response.cudaVersions[0].version='12.8';},
  f=>{f.capacity.observation.response.cudaVersions.push({available:true,version:'12.8'});},
  f=>{delete f.capacity.observation.response.cudaVersions;},f=>{f.capacity.observation.response.dataCenters[0].id='US-NC-3';},
  f=>{f.capacity.observation.response.dataCenters.push({...f.capacity.observation.response.dataCenters[0]});},
  f=>{f.capacity.observation.response.id='different';},f=>{f.capacity.observation.response.secure=false;},
  f=>{f.capacity.observation.response.minRam=187;},f=>{f.capacity.observation.response.minVcpuCount=15;},
  f=>{f.capacity.observation.query.cloud='COMMUNITY';},f=>{f.capacity.observation.query.count=2;},
  f=>{f.capacity.observation.query.countryCodes=['US','CA'];},f=>{f.capacity.observation.query.product=['SERVERLESS'];},
  f=>{f.capacity.observation.query.include=[];},f=>{f.capacity.observation.query.minCudaVersion='12.8';},
  f=>{f.capacity.observation.query.cudaVersions=['13.2'];},f=>{f.capacity.observation.query.id='different';},
  f=>{f.capacity.observation.requestStartedAt='2026-11-16 12:00:00 UTC';},f=>{f.capacity.observation.observedAt='2026-11-16 13:20:00 UTC';},
  f=>{f.capacity.validUntil=f.intent.expiresAt-1;},f=>{f.capacity.validUntil=f.intent.createdAt+900001;},
  f=>{f.host.hourlyCents=273;},f=>{f.host.hourlyCents=268;},f=>{f.host.quoteObservedAt-=3000;},
  f=>{f.host.quoteExpires=f.intent.expiresAt-1;},f=>{f.host.minRamGb=187;},f=>{f.host.minVcpu=15;},
  f=>{f.host.diskGb=79;},f=>{f.host.minCudaVersion='12.8';},f=>{f.host.dataCenterId='US-NC-3';}
 ];
 for(const change of changes){const f=await capacityObservationFixture();change(f);await f.freeze();await assert.rejects(validateCapacityAvailability(f.core,f.host,f.intent,f.capacity));}
});
test('mismatched snapshot hash and old unscoped stock-improvement receipt cannot supply availability authority',async()=>{
 const f=await capacityObservationFixture();f.capacity.observation.response.availability='HIGH';await assert.rejects(validateCapacityAvailability(f.core,f.host,f.intent,f.capacity),/hash differs/);
 await assert.rejects(validateCapacityAvailability(f.core,f.host,f.intent,{observedAt:f.intent.createdAt,validUntil:f.intent.expiresAt,gpu:f.host.gpu,dataCenterId:f.host.dataCenterId,priorAvailability:'LOW',availability:'HIGH',evidenceSha256:'4'.repeat(64)}),/typed fresh/);
});
