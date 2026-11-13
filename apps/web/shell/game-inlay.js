// Presentation identity only: never derives authority, seats, or a game key.
// The versioned recipe depends only on the complete immutable game ID.
const OUTLINES=Object.freeze([
 [[7,0],[29,0],[36,7],[36,29],[29,36],[7,36],[0,29],[0,7]],
 [[9,0],[27,0],[36,9],[36,27],[27,36],[9,36],[0,27],[0,9]],
 [[0,7],[27,0],[36,9],[36,29],[9,36],[0,27]],
 [[5,0],[31,0],[36,12],[31,36],[5,36],[0,24]],
 [[0,0],[27,0],[36,9],[36,36],[9,36],[0,27]],
 [[9,0],[36,0],[36,27],[27,36],[0,36],[0,9]],
]);
const PALETTES=Object.freeze([
 ['#39766a','#659585','#b48b41','#d0ab61','#79516c','#52749a'],
 ['#37699a','#688ca9','#ad8542','#cfaf75','#79558a','#428275'],
 ['#78558e','#a17c9d','#3b7b70','#74a38b','#a17b3d','#53789d'],
 ['#a27137','#c09d60','#478477','#6fa69b','#65558b','#3d6994'],
]);

function randomForId(id){
 let a=0x811c9dc5,b=0x9e3779b9;
 for(const char of `righelt:tessera:v1:${id}`){const value=char.codePointAt(0);a=Math.imul(a^value,0x01000193)>>>0;b=Math.imul(b^value,0x85ebca6b)>>>0;}
 return()=>{a=(a+0x6d2b79f5)>>>0;let t=a^b;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);b=(b+0x9e3779b9)>>>0;return((t^(t>>>14))>>>0)/4294967296;};
}

// Intersect each square-cut tessera with the convex outer silhouette. Repeated
// cards use no SVG IDs or clip paths, so one icon cannot own another's shape.
function clipped(subject,clip){let output=subject;for(let i=0;i<clip.length;i++){const a=clip[i],b=clip[(i+1)%clip.length],input=output;output=[];const cross=p=>(b[0]-a[0])*(p[1]-a[1])-(b[1]-a[1])*(p[0]-a[0]);for(let j=0;j<input.length;j++){const p=input[j],q=input[(j+1)%input.length],cp=cross(p),cq=cross(q);if(cp>=0)output.push(p);if((cp>=0)!==(cq>=0)){const t=cp/(cp-cq);output.push([p[0]+t*(q[0]-p[0]),p[1]+t*(q[1]-p[1])]);}}}return output;}
const rounded=points=>points.map(([x,y])=>[Number(x.toFixed(3)),Number(y.toFixed(3))]);

export function gameInlayModel(gameId){
 if(typeof gameId!=='string'||!gameId)throw new TypeError('A stable game ID is required');
 const random=randomForId(gameId),outline=OUTLINES[Math.floor(random()*OUTLINES.length)],palette=PALETTES[Math.floor(random()*PALETTES.length)],x1=9+Math.floor(random()*5),x2=22+Math.floor(random()*5),y1=9+Math.floor(random()*5),y2=22+Math.floor(random()*5),xs=[0,x1,x2,36],ys=[0,y1,y2,36],tiles=[];
 for(let row=0;row<3;row++)for(let column=0;column<3;column++){
  const inset=.28,points=clipped([[xs[column]+inset,ys[row]+inset],[xs[column+1]-inset,ys[row]+inset],[xs[column+1]-inset,ys[row+1]-inset],[xs[column]+inset,ys[row+1]-inset]],outline);
  const grain=clipped([[xs[column]+1,ys[row]+3],[xs[column+1]-1,ys[row]+5],[xs[column+1]-1,ys[row]+5.25],[xs[column]+1,ys[row]+3.25]],points);
  tiles.push({points:rounded(points),grain:rounded(grain),fill:palette[Math.floor(random()*palette.length)]});
 }
 return{version:1,outline:rounded(outline),tiles};
}

const points=value=>value.map(pair=>pair.join(',')).join(' ');
export function renderGameInlay(gameId){
 const model=gameInlayModel(gameId);
 return `<svg class="game-inlay" viewBox="0 0 36 36" aria-hidden="true" focusable="false"><polygon fill="#f5f0e7" points="${points(model.outline)}"/>${model.tiles.map(tile=>`<polygon fill="${tile.fill}" points="${points(tile.points)}"/><polygon fill="#fff" opacity=".09" points="${points(tile.grain)}"/>`).join('')}</svg>`;
}
