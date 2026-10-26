// Only dataset labels and literal text are shared. Every measured style/geometry
// value stays with its sample, including scale-dependent line and minimum heights.
export function decodeFontBoundarySamples({definitions,samples}) {
 if(!Array.isArray(definitions)||!Array.isArray(samples))throw Error('Font boundary definitions and samples required');
 return samples.map(sample=>{
  if(sample.rows.length!==definitions.length)throw Error('Font boundary row count changed');
  return {...sample,rows:sample.rows.map((metrics,index)=>{
   if(!Array.isArray(metrics)||metrics.length!==3)throw Error('Complete font boundary metrics required');
   const {font,variant,text}=definitions[index], [height,lineHeight,minHeight]=metrics;
   return {font,variant,text,height,lineHeight,minHeight};
  })};
 });
}
