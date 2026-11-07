// PRIVATE test-domain proposal. No general epsilon, guessed engine quantum or geometry mutation.
const REV='d0f4d17d5aefe7ca5aa97afbcafcdc641cbd9f93',SCALE=65536;
function adjacent(value,direction){
 const view=new DataView(new ArrayBuffer(4));view.setFloat32(0,value);let bits=view.getUint32(0);
 if(value===0){view.setUint32(0,direction>0?1:0x80000001);return view.getFloat32(0);}
 bits+=(value>0?direction:-direction);view.setUint32(0,bits);return view.getFloat32(0);
}
export function layoutPrimitiveCandidates(value){
 if(!Number.isFinite(value)||Math.abs(value)>2**20||Math.fround(value)!==value)return null;
 const lower=(adjacent(value,-1)+value)/2,upper=(value+adjacent(value,1))/2;
 const first=Math.ceil(lower*SCALE),last=Math.floor(upper*SCALE);
 if(!Number.isSafeInteger(first)||!Number.isSafeInteger(last)||last-first+1>128)return null;
 const values=[];
 for(let i=first;i<=last;i++)if(Math.fround(i/SCALE)===value)values.push(i===0?0:i);
 return values.length?values:null;
}
// Pinned Gecko nsRect uses integer nscoord and AppUnitsPerCSSPixel()==60.
// Keep only quantized edges that are images of an ACTUAL integer app-unit edge.
export function appUnitEdgeCandidates(quantized){
 if(!Number.isSafeInteger(quantized))return [];
 const near=Math.round(quantized*60/SCALE),out=[];
 for(let n=near-2;n<=near+2;n++)if(n>=-2147483648&&n<=2147483647&&Math.floor(n*(SCALE/60)+0.5)===quantized)out.push(n);
 return out;
}
export function qualifyGeckoSharedEdge({boardTop,slotTop,slotHeight,slotBottom,profile}={}){
 const fail=reason=>({qualified:false,incomplete:true,reason});
 // sourceQualified must be supplied by a separately reviewed driver/source/binary binding,
 // never inferred from numeric representability or a user-agent string alone.
 if(profile?.sourceQualified!==true||profile.engine!=='firefox'||profile.version!=='148.0.2'||profile.upstreamRevision!==REV)return fail('unqualified-engine-source');
 if(!Number.isFinite(slotBottom)||slotHeight<0||slotBottom!==slotTop+slotHeight)return fail('original-edge-composition');
 const boardRaw=layoutPrimitiveCandidates(boardTop),topRaw=layoutPrimitiveCandidates(slotTop),height=layoutPrimitiveCandidates(slotHeight);
 const board=boardRaw?.filter(q=>appUnitEdgeCandidates(q).length===1),top=topRaw?.filter(q=>appUnitEdgeCandidates(q).length===1);
 if(!board||!top||!height)return fail('unsupported-primitives');
 const bottom=[...new Set(top.flatMap(y=>height.map(h=>y+h)))].filter(q=>appUnitEdgeCandidates(q).length===1);
 if(bottom.length>256||bottom.some(value=>!Number.isSafeInteger(value)))return fail('candidate-bound');
 if(board.length!==1||top.length!==1||bottom.length!==1)return fail('nonunique-appunit-edge');
 const shared=board.filter(value=>bottom.includes(value));
 return {qualified:shared.length>0,incomplete:false,reason:shared.length?'shared-layout-edge-observable':'distinct-layout-edges',scale:SCALE,raw:{boardTop,slotTop,slotHeight,slotBottom},candidateUnits:{board,top,height,bottom,shared},appUnitEdges:{board:appUnitEdgeCandidates(board[0])[0],slotTop:appUnitEdgeCandidates(top[0])[0],slotBottom:appUnitEdgeCandidates(bottom[0])[0]},limits:'Unique inverse app-unit edges conditional on source and normal-flow witness. No image or product proof.'};
}
