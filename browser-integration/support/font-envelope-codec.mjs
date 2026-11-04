// Only dataset labels and literal text are shared. Every measured style/geometry
// value stays with its sample, including scale-dependent line and minimum heights.
export function decodeFontBoundarySamples({definitions,samples}) {
 if(!Array.isArray(definitions)||!Array.isArray(samples))throw Error('Font boundary definitions and samples required');
 const decodeRows=rows=>{
  if(!Array.isArray(rows)||rows.length!==definitions.length)throw Error('Font boundary row count changed');
  return rows.map((metrics,index)=>{
   if(!Array.isArray(metrics)||metrics.length!==3)throw Error('Complete font boundary metrics required');
   const definition=definitions[index],{font,variant,text}=definition,[height,lineHeight,minHeight]=metrics;
   return {font,variant,text,...(Object.hasOwn(definition,'pattern')?{pattern:definition.pattern}:{}),height,lineHeight,minHeight};
  });
 };
 return samples.map(sample=>({...sample,rows:decodeRows(sample.rows),...(Object.hasOwn(sample,'intrinsicRows')?{intrinsicRows:decodeRows(sample.intrinsicRows)}:{})}));
}
