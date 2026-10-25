// The CSS stone outline remains authoritative. Unsupported outlines stay quiet.
const length = (value,size) => {
 const plain=/^(-?[\d.]+)(px|%)?$/.exec(value);
 if(plain)return Number(plain[1])*(plain[2]==='%'?size/100:1);
 const calc=/^calc\((-?[\d.]+)%\s*([+-])\s*([\d.]+)px\)$/.exec(value);
 return calc?Number(calc[1])*size/100+(calc[2]==='-'?-1:1)*Number(calc[3]):NaN;
};
export function stoneOutlinePoints(outline,width,height) {
 if(!Number.isFinite(width)||!Number.isFinite(height)||width<=0||height<=0)return null;
 const match=/^polygon\((.*)\)$/.exec(outline?.trim()??'');
 if(!match)return null;
 const points=match[1].split(',').map(point=>{
  const tokens=point.trim().match(/calc\([^)]*\)|[^\s]+/g)??[];
  return tokens.length===2?[length(tokens[0],width),length(tokens[1],height)]:[NaN,NaN];
 });
 return points.length>=3&&points.every(pair=>pair.every(Number.isFinite))?points:null;
}

const EDGE_OUTSET_PX=2,EDGE_CLEARANCE_PX=2;
export const edgeProtectedRect = (rect,panel,outset=EDGE_OUTSET_PX,clearance=EDGE_CLEARANCE_PX) => ({
 x:rect.left-panel.left+outset-clearance,y:rect.top-panel.top+outset-clearance,
 width:rect.width+clearance*2,height:rect.height+clearance*2,
});

const NS='http://www.w3.org/2000/svg';
const VISIBLE_PHASE=':is([data-loading-phase="visible"],[data-loading-phase="slow"])';
const PROTECTED='h1,h2,h3,p,label,button,a,input,select,textarea,.board,.axis-label,.overlay-key,[role="status"]';
// A separate decorative layer survives shell patches without changing card size.
export function mountLoadingEdges(document) {
 const window=document.defaultView;
 const layer=document.createElement('div');layer.className='loading-edge-layer';
 layer.setAttribute('aria-hidden','true');layer.setAttribute('inert','');document.body.append(layer);
 const frames=new Map();let raf=null,disposed=false,serial=0;
 const resize=new window.ResizeObserver(()=>schedule());
 const create=tag=>document.createElementNS(NS,tag);
 const sync=()=>{
  raf=null;if(disposed)return;
  const transition=document.querySelector('.shell-route-transition-layer[data-active="true"]');
  const candidates=[...document.querySelectorAll('.shell-main-content section.panel')].filter(panel=>
   !panel.closest('[hidden],[inert],dialog:not([open])')&&panel.getClientRects().length&&
   (transition||panel.matches(`.loading-region[data-loading-state="pending"]${VISIBLE_PHASE}`)||panel.querySelector(`.board-loading-preview .board-message-activity[data-loading-state="pending"]${VISIBLE_PHASE},.board-wrap[data-reconnecting="true"][data-loading-state="pending"]${VISIBLE_PHASE}`)));
  const active=new Set(candidates);
  for(const [panel,frame] of frames)if(!active.has(panel)){resize.unobserve(panel);frame.svg.remove();frames.delete(panel);}
  for(const panel of candidates){
   const rect=panel.getBoundingClientRect();
   const points=stoneOutlinePoints(window.getComputedStyle(panel).getPropertyValue('--stone-outline'),rect.width,rect.height);
   if(!points){const stale=frames.get(panel);if(stale){resize.unobserve(panel);stale.svg.remove();frames.delete(panel);}continue;}
   let frame=frames.get(panel);
   if(!frame){
    const svg=create('svg');svg.classList.add('loading-edge-frame');
    const id=`loading-edge-${++serial}`,defs=create('defs'),mask=create('mask'),background=create('rect'),face=create('polygon'),group=create('g');
    mask.id=id;mask.setAttribute('maskUnits','userSpaceOnUse');mask.setAttribute('x','0');mask.setAttribute('y','0');
    background.setAttribute('width','100%');background.setAttribute('height','100%');background.setAttribute('fill','white');face.setAttribute('fill','black');
    mask.append(background,face);defs.append(mask);group.setAttribute('mask',`url(#${id})`);
    const paths=['p1','p2'].map(side=>{const path=create('polygon');path.setAttribute('pathLength','1000');path.setAttribute('fill','none');path.setAttribute('stroke-width',String(EDGE_OUTSET_PX*2));path.setAttribute('stroke-linejoin','miter');path.classList.add(`loading-edge-${side}`);group.append(path);return path;});
    svg.append(defs,group);frame={svg,mask,face,paths,cuts:[],key:''};frames.set(panel,frame);layer.append(svg);resize.observe(panel);
   }
   const {svg}=frame,outset=EDGE_OUTSET_PX;
   const protectedRects=[...panel.querySelectorAll(PROTECTED)].filter(node=>node.getClientRects().length&&!node.closest('[inert]')&&(!node.closest('.board')||node.matches('.board,.axis-label'))).map(node=>edgeProtectedRect(node.getBoundingClientRect(),rect));
   const key=JSON.stringify([rect.x,rect.y,rect.width,rect.height,points,protectedRects]);
   if(frame.key===key)continue;frame.key=key;
   svg.style.cssText=`left:${rect.left-outset}px;top:${rect.top-outset}px;width:${rect.width+outset*2}px;height:${rect.height+outset*2}px`;
   svg.setAttribute('viewBox',`0 0 ${rect.width+outset*2} ${rect.height+outset*2}`);
   const polygon=points.map(([x,y])=>`${x+outset},${y+outset}`).join(' ');
   frame.mask.setAttribute('width',String(rect.width+outset*2));frame.mask.setAttribute('height',String(rect.height+outset*2));
   frame.face.setAttribute('points',polygon);for(const path of frame.paths)path.setAttribute('points',polygon);
   protectedRects.forEach((box,index)=>{let cut=frame.cuts[index];if(!cut){cut=create('rect');cut.setAttribute('fill','black');frame.cuts.push(cut);frame.mask.append(cut);}for(const [name,value] of Object.entries(box))cut.setAttribute(name,String(value));});
   while(frame.cuts.length>protectedRects.length)frame.cuts.pop().remove();
  }
 };
 const schedule=()=>{if(!disposed&&raf===null)raf=window.requestAnimationFrame(sync);};
 const observer=new window.MutationObserver(records=>{if(records.some(record=>!layer.contains(record.target)))schedule();});
 observer.observe(document.body,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['data-active','data-phase','data-loading-state','data-loading-phase','data-reconnecting','hidden','inert','class','style']});
 window.addEventListener('resize',schedule);document.addEventListener('scroll',schedule,true);window.visualViewport?.addEventListener('resize',schedule);window.visualViewport?.addEventListener('scroll',schedule);
 document.fonts?.addEventListener?.('loadingdone',schedule);schedule();
 return ()=>{disposed=true;observer.disconnect();resize.disconnect();if(raf!==null)window.cancelAnimationFrame(raf);window.removeEventListener('resize',schedule);document.removeEventListener('scroll',schedule,true);window.visualViewport?.removeEventListener('resize',schedule);window.visualViewport?.removeEventListener('scroll',schedule);document.fonts?.removeEventListener?.('loadingdone',schedule);layer.remove();frames.clear();};
}
