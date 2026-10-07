export const SWIPE_EASING = [.18, .72, .24, 1];
export const SWIPE_EASING_CSS = `cubic-bezier(${SWIPE_EASING.join(',')})`;
export const swipeProgress = (elapsed) => {
  const [x1,y1,x2,y2] = SWIPE_EASING;
  const curve = (t,a,b) => 3*(1-t)*(1-t)*t*a + 3*(1-t)*t*t*b + t*t*t;
  let low=0, high=1;
  for(let i=0;i<18;i++){const t=(low+high)/2;if(curve(t,x1,x2)<elapsed)low=t;else high=t;}
  return curve((low+high)/2,y1,y2);
};
