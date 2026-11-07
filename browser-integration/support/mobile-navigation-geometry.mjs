// The controls are siblings of the reveal handle. Their own finite movement
// and ancestor movement must finish before strict native rectangle sampling.
export const settleMobileNavigationRow = nav => nav.evaluate(async node => {
 const row=node.querySelector('[data-mobile-nav-controls]');
 if(!row)throw Error('Current mobile navigation controls are required');
 const assertCurrent=()=>{
  if(!node.isConnected||document.querySelector('.shell-mobile-tabbar')!==node||node.dataset.visible!=='true'||!row.isConnected||node.querySelector('[data-mobile-nav-controls]')!==row)throw Error('Mobile navigation controls changed during settlement');
 };
 for(;;){
  assertCurrent();
  const ancestors=[];
  for(let ancestor=row;ancestor;ancestor=ancestor.parentElement)ancestors.push(ancestor);
  const finite=ancestors.flatMap(ancestor=>ancestor.getAnimations()).filter(animation=>
   Number.isFinite(animation.effect?.getComputedTiming().endTime)
   &&(animation.pending||animation.playState==='running'||animation.playState==='paused'));
  if(!finite.length)return;
  try{await Promise.all(finite.map(animation=>animation.finished));}
  catch(error){assertCurrent();throw error;}
  assertCurrent();
 }
});
