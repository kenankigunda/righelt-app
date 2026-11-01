// Connection role is distinct from piece/inspector affiliation. Both adapter
// branches and compact legend samples consume this one presentation contract.
export const CONNECTION_STYLE = Object.freeze({
  width:3, linecap:'round', parallelOffset:2.5, sampleWidth:16, sampleHeight:3,
  supply:Object.freeze({stroke:'var(--connection-supply)',dash:'7 5',sampleMark:5,sampleGap:4}),
  command:Object.freeze({dash:'2 6',sampleMark:2,sampleGap:4}),
});
export const connectionStroke = (kind,owner) => kind==='supply'?CONNECTION_STYLE.supply.stroke:owner==='P2'?'var(--player-p2)':'var(--player-p1)';
export const connectionLegendProperties = () => ({'--connection-sample-width':`${CONNECTION_STYLE.sampleWidth}px`,'--connection-line-width':`${CONNECTION_STYLE.width}px`,...Object.fromEntries(['supply','command'].map(kind=>{
  const {sampleMark:mark,sampleGap:gap}=CONNECTION_STYLE[kind];
  return [`--connection-${kind}-sample`,`repeating-linear-gradient(to right,currentColor 0 ${mark}px,transparent ${mark}px ${mark+gap}px)`];
}))});
