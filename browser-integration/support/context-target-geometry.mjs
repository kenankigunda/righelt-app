// Context notices live outside the finite Board slot. Measure their targets
// only after finite motion on the target or its own ancestors has completed.
export const settleContextTarget = target => target.evaluate(async node => {
 const context=node.closest('[data-board-context]');
 if(!context)throw Error('A current Board context target is required');
 for(;;){
  if(!node.isConnected||node.closest('[data-board-context]')!==context)throw Error('Board context target changed during settlement');
  const ancestors=[];
  for(let ancestor=node;ancestor;ancestor=ancestor.parentElement)ancestors.push(ancestor);
  const finite=ancestors.flatMap(ancestor=>ancestor.getAnimations()).filter(animation=>
   Number.isFinite(animation.effect?.getComputedTiming().endTime)
   &&(animation.pending||animation.playState==='running'||animation.playState==='paused'));
  if(!finite.length)return;
  await Promise.all(finite.map(animation=>animation.finished));
 }
});
