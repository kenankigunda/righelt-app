// Training-only data boundaries. No changes to game rules or live search scores.
import {createHash} from 'node:crypto';
import {experimentConfig} from '../../packages/computer-player/src/index.ts';

const hash=value=>createHash('sha256').update(value).digest('hex');
const family=anchors=>'simple:'+hash(JSON.stringify(anchors.sort((a,b)=>
 a[0].localeCompare(b[0])||a[1]-b[1]||a[2]-b[2])));

export function commanderFamily(state) {
 return family(state.pieces.filter(p=>p.kind==='commander').map(p=>
  [p.owner,p.position.row,p.position.col]));
}

export function encodedFamily(encoded) {
 const n=experimentConfig.boardSize,squares=n*n;
 if(encoded.length!==experimentConfig.inputPlanes*squares)throw Error('Invalid protected encoding size');
 const anchors=[];
 for(const owner of ['P1','P2']) {
  const offset=experimentConfig.planes.indexOf(owner+'.commander')*squares;
  let count=0;
  for(let i=0;i<squares;i++) {
   const v=encoded[offset+i];if(v!==0&&v!==1)throw Error('Invalid protected commander plane');
   if(v){count++;anchors.push([owner,Math.floor(i/n),i%n]);}
  }
  if(count>1)throw Error('Duplicate protected commander');
 }
 return family(anchors);
}

export function encodedDigest(encoded) {
 const bytes=Buffer.alloc(encoded.length*4);
 encoded.forEach((v,i)=>bytes.writeFloatLE(v,i*4));
 return hash(bytes);
}
