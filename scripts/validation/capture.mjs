import {writeFile} from 'node:fs/promises';

// Beyond-viewport Chromium capture can silently render hover CSS and disable
// touch. Capture mobile evidence as viewport tiles, retaining actual input mode.
export async function capture(page,target=page,options={}) {
 const before=await page.evaluate(()=>({touch:navigator.maxTouchPoints,hover:matchMedia('(any-hover: hover)').matches,x:scrollX,y:scrollY}));
 let bytes;
 try {
  if(!before.touch || (target===page&&!options.fullPage)) {
   bytes=await target.screenshot({animations:'disabled',...options});
  } else {
   const region=target===page
    ? await page.evaluate(()=>({x:0,y:0,width:document.documentElement.scrollWidth,height:document.documentElement.scrollHeight}))
    : await target.evaluate(element=>{const r=element.getBoundingClientRect();return {x:r.x+scrollX,y:r.y+scrollY,width:r.width,height:r.height};});
   region.x=Math.floor(region.x);region.y=Math.floor(region.y);region.width=Math.ceil(region.width);region.height=Math.ceil(region.height);
   if(region.width<=0||region.height<=0)throw Error('Cannot capture an empty evidence region');
   // A visible fixed/sticky subject must be cropped in place: scrolling the
   // document would move its relationship to document coordinates.
   const visibleRegion=target!==page&&await page.evaluate(r=>r.x>=scrollX&&r.y>=scrollY&&r.x+r.width<=scrollX+innerWidth&&r.y+r.height<=scrollY+innerHeight,region);
   const tiles=[];
   for(let y=region.y;y<region.y+region.height;){
    let rowHeight=Infinity;
    for(let x=region.x;x<region.x+region.width;){
     if(!visibleRegion)await page.evaluate(async({x,y})=>{scrollTo({left:x,top:y,behavior:'instant'});await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));},{x,y});
     const view=await page.evaluate(()=>({x:scrollX,y:scrollY,width:innerWidth,height:innerHeight}));
     const sx=x-view.x,sy=y-view.y,width=Math.min(view.width-sx,region.x+region.width-x),height=Math.min(view.height-sy,region.y+region.height-y);
     if(width<=0||height<=0)throw Error('Evidence region is outside the scrollable viewport');
     const image=await page.screenshot({...options,path:undefined,fullPage:false,scale:'css',animations:'disabled'});
     tiles.push({image:image.toString('base64'),sx,sy,width,height,dx:x-region.x,dy:y-region.y});
     rowHeight=Math.min(rowHeight,height);x+=width;
    }
    y+=rowHeight;
   }
   const encoded=await page.evaluate(async({tiles,region})=>{const canvas=document.createElement('canvas');canvas.width=region.width;canvas.height=region.height;const context=canvas.getContext('2d');for(const tile of tiles){const image=new Image();image.src=`data:image/png;base64,${tile.image}`;await image.decode();context.drawImage(image,tile.sx,tile.sy,tile.width,tile.height,tile.dx,tile.dy,tile.width,tile.height);}return canvas.toDataURL('image/png').split(',')[1];},{tiles,region});
   bytes=Buffer.from(encoded,'base64');
   if(options.path)await writeFile(options.path,bytes);
  }
 } finally {
  await page.evaluate(({x,y})=>scrollTo({left:x,top:y,behavior:'instant'}),before);
 }
 const after=await page.evaluate(()=>({touch:navigator.maxTouchPoints,hover:matchMedia('(any-hover: hover)').matches}));
 if(after.touch!==before.touch||after.hover!==before.hover)throw Error('Screenshot changed browser input emulation');
 return bytes;
}
