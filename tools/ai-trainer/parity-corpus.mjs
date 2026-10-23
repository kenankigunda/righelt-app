import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { createInitialState, deterministicStateHash } from '../../packages/game-engine/src/index.ts';
import { encodeState, legalActionMap, transition, seededRandom } from '../../packages/computer-player/src/index.ts';

// Separate validation families, never the sealed final partition. No model answers.
const count=Number(process.argv[2]??1000),output=process.argv[3];
if(!Number.isSafeInteger(count)||count<1000||!output)throw new Error('Usage: parity-corpus.mjs 1000 output.json');
const states=[],seen=new Set();
let family=0;
while(states.length<count){
  const familyId=`export-validation-${family++}`;
  if(parseInt(createHash('sha256').update(familyId).digest('hex').slice(0,8),16)%100<80)continue;
  // Use only validation (80..89), not final (90..99).
  if(parseInt(createHash('sha256').update(familyId).digest('hex').slice(0,8),16)%100>=90)continue;
  const random=seededRandom(family);let state=createInitialState();
  for(let decision=0;decision<64&&state.outcome.status==='ongoing'&&states.length<count;decision++){
    const legal=legalActionMap(state);if(!legal.size)break;
    const hash=deterministicStateHash(state);
    if(!seen.has(hash)){
      seen.add(hash);states.push({id:`${familyId}:${decision}`,familyId,partition:'validation',state,hash,
                                  encoded:Array.from(encodeState(state)),legal:[...legal.keys()]});
    }
    const choices=[...legal.values()];state=transition(state,choices[Math.floor(random()*choices.length)]);
  }
  if(family>100000)throw new Error('Unable to produce distinct held-out states');
}
writeFileSync(output,JSON.stringify({schema:1,kind:'export-validation',states}));
console.log(JSON.stringify({states:states.length,output}));
