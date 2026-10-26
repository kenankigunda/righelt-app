// Browser-evaluable: no imported closure, calculated pixel target or CSS-string
// precision assumption. Preserve the caller's positioning check and prove that
// the selected panel's actual geometry has stopped changing.
export async function panelGeometrySettledAcrossFrame(panel) {
 const track=panel.closest('.game-shell-track'),wrap=panel.closest('.game-shell-track-wrap');
 if(!track||!wrap)throw Error('Selected panel track and wrap are required');
 const selected=()=>panel.dataset.active==='true'&&!panel.inert&&panel.getAttribute('aria-hidden')==='false';
 if(!selected())return false;
 // Flush pending style before collecting transitions that may start this frame.
 panel.getBoundingClientRect();
 const animations=track.getAnimations();
 // Never await an active/paused animation inside a polling sample. The existing
 // poll budget owns retries until the browser reports the transition finished.
 if(animations.some(animation=>animation.playState!=='finished'||animation.pending))return false;
 const finished=await Promise.all(animations.map(animation=>animation.finished.then(()=>true,error=>{
  if(error?.name==='AbortError')return false;
  throw error;
 })));
 if(!finished.every(Boolean))return false;
 const inspect=()=>{
  const rect=panel.getBoundingClientRect();
  return {selected:selected(),unsettled:track.getAnimations().some(animation=>animation.playState!=='finished'||animation.pending),
   x:rect.x,y:rect.y,width:rect.width,height:rect.height};
 };
 const before=inspect();
 // Two callbacks include a real rendered frame between the endpoint reads.
 await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
 const after=inspect();
 return before.selected&&after.selected&&!before.unsettled&&!after.unsettled
  &&['x','y','width','height'].every(key=>before[key]===after[key]);
}
