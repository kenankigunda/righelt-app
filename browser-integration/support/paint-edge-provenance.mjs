// Read-only diagnostics only. These observations never qualify an edge or change an oracle.
export function projectEdgeEvidence(heading,headingSlot){
 const fields=['x','y','width','height','top','right','bottom','left'];
 const copy=rect=>Object.fromEntries(fields.map(key=>[key,Number.isFinite(rect?.[key])?rect[key]:null]));
 const h=copy(heading),s=copy(headingSlot);
 const complete=fields.every(key=>h[key]!==null&&s[key]!==null);
 return {heading:h,headingSlot:s,incomplete:!complete,bottomEqual:complete?h.bottom===s.bottom:null,bottomDelta:complete?h.bottom-s.bottom:null,headingComposedBottom:complete?h.y+h.height:null,slotComposedBottom:complete?s.y+s.height:null,qualification:'NONE: raw observations, no rounding or tolerance'};
}
export function captureEdgeContext(heading,headingSlot){
 const properties=['display','position','box-sizing','margin-top','margin-bottom','padding-top','padding-bottom','border-top-width','border-bottom-width','line-height','font-family','font-size','font-weight','transform','transform-origin','zoom','writing-mode','overflow','overflow-x','overflow-y','align-items','align-self','justify-content','gap','row-gap'];
 const out={schema:1,incomplete:false,issues:[],relation:{sameDocument:heading?.ownerDocument===headingSlot?.ownerDocument,directParent:heading?.parentElement===headingSlot,contains:Boolean(headingSlot?.contains(heading)),headingConnected:heading?.isConnected===true,slotConnected:headingSlot?.isConnected===true},ancestors:[],quads:{supported:typeof heading?.getBoxQuads==='function'}};
 let node=heading;
 for(let i=0;node&&i<8;i++,node=node.parentElement){
  try{const style=node.ownerDocument.defaultView.getComputedStyle(node);out.ancestors.push({depth:i,tag:node.localName,heading:node===heading,headingSlot:node===headingSlot,css:Object.fromEntries(properties.map(key=>[key,style.getPropertyValue(key)]))});}catch{out.incomplete=true;out.issues.push('ancestor-style-read');break;}
 }
 if(node){out.incomplete=true;out.issues.push('ancestor-bound');}
 if(out.quads.supported){
  try{const sample=n=>{const q=n.getBoxQuads({box:'border'});if(q.length>4){out.incomplete=true;out.issues.push('quad-bound');}return q.slice(0,4).map(x=>Object.fromEntries(['p1','p2','p3','p4'].map(k=>[k,{x:x[k].x,y:x[k].y}])));};out.quads.heading=sample(heading);out.quads.headingSlot=sample(headingSlot);}catch{out.incomplete=true;out.issues.push('quad-read');}
 }
 return out;
}

export function enrichEdgeSample(sample,heading,headingSlot){
 // Caller has completed every original geometry/hit read. Never recapture its BCRs.
 let context;
 try{context=captureEdgeContext(heading,headingSlot);}catch{context={incomplete:true,issues:['context-capture']};}
 sample.edgeDiagnostic={raw:projectEdgeEvidence(sample.heading,sample.headingSlot),context};
 return sample;
}
export function finalizeEdgeEvidence(evidence){
 return {...evidence,incomplete:Boolean(evidence.incomplete)||evidence.samples.some(sample=>!sample.edgeDiagnostic||sample.edgeDiagnostic.raw.incomplete||sample.edgeDiagnostic.context.incomplete)};
}
export async function persistEdgeEvidence(evidence,{write,attach,onError=()=>{}}){
 const failures=[];
 const report=name=>{failures.push(name);try{onError(name);}catch{}};
 let body;try{body=JSON.stringify(evidence);}catch{report('serialize');return {incomplete:true,failures};}
 try{await write(body);}catch{report('write');}
 try{await attach(body);}catch{report('attach');}
 return {incomplete:failures.length>0,failures};
}
