import test from 'node:test';
import assert from 'node:assert/strict';
import {runInNewContext} from 'node:vm';
import {currentScalePublication} from '../../../browser-integration/support/fixture-publication.mjs';
import {installHeightPublicationCollector} from '../../../browser-integration/support/height-publication-observer.mjs';
import {measurePublicationUsedSize} from '../../../browser-integration/support/css-used-size-proof.mjs';
const validProof=()=>({schema:1,pseudoFree:true,pseudoBeforeContent:'none',pseudoAfterContent:'none',pseudoBeforeDisplay:'none',pseudoAfterDisplay:'none',ideal:227.504,property:'height',width:366,assignedValue:'227.504px',computedMinHeight:0,maxHeight:'none',computedHeight:227.5,rectHeight:227.5,offsetHeight:228,children:0,childNodes:0,textLength:0,flowFootprint:0,removed:true,contractMatch:true,boxSizing:'border-box',transform:'none',zoom:1,ancestorsUntransformed:true});
const fixture=()=>{
 const sandbox={};runInNewContext(`(${installHeightPublicationCollector.toString()})();`,sandbox);const collector=sandbox.__heightPublication;
 const font={fontSize:'32px',fontFamily:'Manrope',lineHeight:'48px'},slotStyle={height:'227.5px',minHeight:'0px',maxHeight:'none',transform:'none',zoom:'1'},live={};
 const slot={isConnected:true,dataset:{heightManaged:'true'},style:{height:'227.504px'},offsetHeight:228,parentElement:null,querySelector:()=>live,getAnimations:()=>[],getBoundingClientRect:()=>({width:366,height:227.5}),ownerDocument:{defaultView:{getComputedStyle:node=>node===live?font:slotStyle}}};
 let current=slot,calls=0;const options={readPublication:collector.read,used:false,measurePublication(original){calls++;return measurePublicationUsedSize({...original,measure:()=>validProof()});}};
 return {slot,font,collector,options,read:()=>current,replace:()=>{current={...slot};},calls:()=>calls,publish(key='32px:Manrope:48px'){collector.record(slot,227.504,key,366);},sample(extra={}){return currentScalePublication(()=>current,{...options,...extra});}};
};
test('current-scale readiness rejects an old-scale original assignment while the font can remain loading',()=>{const f=fixture();f.publish('16px:Manrope:24px');assert.equal(f.sample().ready,false);assert.equal(f.calls(),0);f.publish();assert.equal(f.sample().ready,true);assert.equal(f.sample().original.target,227.504);assert.equal(f.calls(),0);});
test('unrecorded or replaced current nodes cannot manufacture publication from an inline value',()=>{const f=fixture();assert.equal(f.sample().ready,false);f.publish();f.replace();assert.equal(f.sample().ready,false);});
test('original retained target plus real used-size adapter admits legitimate ideal-to-used serialization',()=>{const f=fixture();f.publish();const sample=f.sample({used:true});assert.equal(sample.ready,true);assert.equal(sample.original.target,227.504);assert.equal(sample.used.qualification.usedHeight,227.5);assert.equal(f.calls(),1);});
test('overwritten assignment cannot be turned into the expected target',()=>{const f=fixture();f.publish();f.slot.style.height='300px';assert.equal(f.sample({used:true}).ready,false);assert.equal(f.calls(),0);});
test('replacement during independent sampling loses canonical-current identity even if old node stays connected',()=>{const f=fixture();f.publish();const sample=f.sample({used:true,measurePublication(original){f.replace();return measurePublicationUsedSize({...original,measure:()=>validProof()});}});assert.equal(sample.ready,false);assert.equal(sample.sameCurrent,false);});
test('assignment and metric changes during sampling are independently rejected',()=>{
 for(const mutate of [f=>f.slot.style.height='300px',f=>f.font.fontSize='16px']){const f=fixture();f.publish();const sample=f.sample({used:true,measurePublication(original){mutate(f);return measurePublicationUsedSize({...original,measure:()=>validProof()});}});assert.equal(sample.ready,false);}
});
test('pending animation preserves the original settle gate and never samples a used oracle early',()=>{const f=fixture();f.publish();f.slot.getAnimations=()=>[{pending:true,playState:'running'}];assert.equal(f.sample({used:true}).ready,false);assert.equal(f.calls(),0);});
