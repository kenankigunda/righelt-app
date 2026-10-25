// Fixed recovery surfaces follow the visible header, never its assumed height.
export const recoverySpaceGeometry = ({headerBottom = 0, viewportTop = 0, viewportHeight = 0} = {}) => {
 const top = Number.isFinite(viewportTop) ? Math.max(0,viewportTop) : 0;
 const height = Number.isFinite(viewportHeight) ? Math.max(0,viewportHeight) : 0;
 const bottom = Number.isFinite(headerBottom) ? headerBottom : top;
 return {top:Math.max(top+8,bottom+8),viewportBottom:top+height};
};
const mounted = new WeakMap();
export function mountRecoverySpace(app,{window:win=globalThis.window,document:doc=globalThis.document}={}) {
 if(!app||!win)return ()=>{};
 if(mounted.has(app))return mounted.get(app);
 let frame=null,header=null,disposed=false;
 const names=['--recovery-space-top','--recovery-viewport-bottom'];
 const previous=names.map(name=>app.style.getPropertyValue(name));
 const write=(name,value)=>{if(app.style.getPropertyValue(name)!==value)app.style.setProperty(name,value);};
 const schedule=()=>{if(!disposed&&frame===null)frame=win.requestAnimationFrame(measure);};
 const resize=new win.ResizeObserver(schedule);
 const measure=()=>{
  frame=null;if(disposed)return;
  const next=app.querySelector('.shell-header');
  if(next!==header){if(header)resize.unobserve(header);header=next;if(header)resize.observe(header);}
  const viewport=win.visualViewport;
  const geometry=recoverySpaceGeometry({headerBottom:header?.getBoundingClientRect().bottom,viewportTop:viewport?.offsetTop??0,viewportHeight:viewport?.height??win.innerHeight});
  write(names[0],`${geometry.top}px`);write(names[1],`${geometry.viewportBottom}px`);
 };
 // Only child changes discover replacement headers. Observing our own style
 // variables would schedule an unnecessary second layout on every measurement.
 const mutations=new win.MutationObserver(schedule);mutations.observe(app,{childList:true,subtree:true});
 win.addEventListener('resize',schedule);win.addEventListener('scroll',schedule,{passive:true,capture:true});
 const viewport=win.visualViewport;viewport?.addEventListener('resize',schedule);viewport?.addEventListener('scroll',schedule);
 doc?.fonts?.addEventListener?.('loadingdone',schedule);doc?.fonts?.ready?.then(schedule);
 const dispose=()=>{
  if(disposed)return;disposed=true;if(frame!==null)win.cancelAnimationFrame(frame);
  resize.disconnect();mutations.disconnect();win.removeEventListener('resize',schedule);win.removeEventListener('scroll',schedule,true);
  viewport?.removeEventListener('resize',schedule);viewport?.removeEventListener('scroll',schedule);doc?.fonts?.removeEventListener?.('loadingdone',schedule);
  names.forEach((name,index)=>previous[index]?app.style.setProperty(name,previous[index]):app.style.removeProperty(name));
  mounted.delete(app);
 };
 mounted.set(app,dispose);schedule();return dispose;
}
