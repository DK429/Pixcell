import {brushMask} from './mask.js?v=0.5.0';
// Oklab matrices: https://bottosson.github.io/posts/oklab/
// Guided filter: He, Sun & Tang, ECCV 2010. All filter planes use float32.
const clamp=(x,a=0,b=1)=>Math.min(b,Math.max(a,x));
const smooth=(x,a,b)=>{const t=clamp((x-a)/(b-a));return t*t*(3-2*t);};
const linear=Float32Array.from({length:256},(_,i)=>{const v=i/255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;});
const encode=v=>255*(v<=.0031308?12.92*v:1.055*v**(1/2.4)-.055);
export function toLab(r,g,b){
  r=linear[r];g=linear[g];b=linear[b];
  const l=Math.cbrt(.4122214708*r+.5363325363*g+.0514459929*b);
  const m=Math.cbrt(.2119034982*r+.6806995451*g+.1073969566*b);
  const s=Math.cbrt(.0883024619*r+.2817188376*g+.6299787005*b);
  return [.2104542553*l+.793617785*m-.0040720468*s,1.9779984951*l-2.428592205*m+.4505937099*s,.0259040371*l+.7827717662*m-.808675766*s];
}
function fromLab(L,a,b){
  const l=(L+.3963377774*a+.2158037573*b)**3,m=(L-.1055613458*a-.0638541728*b)**3,s=(L-.0894841775*a-1.291485548*b)**3;
  return [4.0767416621*l-3.3077115913*m+.2309699292*s,-1.2684380046*l+2.6097574011*m-.3413193965*s,-.0041960863*l-.7034186147*m+1.707614701*s];
}
function writeLightness(data,i,L){
  const [original,a,b]=toLab(data[i],data[i+1],data[i+2]);
  if(Math.abs(L-original)<1e-7)return;
  let rgb=fromLab(L,a,b);
  // Reduce only the requested L delta when outside sRGB; never clip a/b.
  if(rgb.some(v=>v<0||v>1)){
    let low=0,high=1;
    for(let n=0;n<12;n++){const t=(low+high)/2,trial=fromLab(original+(L-original)*t,a,b);if(trial.every(v=>v>=0&&v<=1))low=t;else high=t;}
    if(low<1e-3)return;
    rgb=fromLab(original+(L-original)*low,a,b);
  }
  for(let c=0;c<3;c++)data[i+c]=Math.round(encode(clamp(rgb[c])));
}

// Separable running sums are O(pixels), independent of the radius.
function boxSum(input,w,h,r){
  const tmp=new Float32Array(input.length),out=new Float32Array(input.length);
  for(let y=0;y<h;y++){
    const row=y*w;let sum=0;for(let x=0;x<=Math.min(r,w-1);x++)sum+=input[row+x];
    for(let x=0;x<w;x++){tmp[row+x]=sum;if(x-r>=0)sum-=input[row+x-r];if(x+r+1<w)sum+=input[row+x+r+1];}
  }
  for(let x=0;x<w;x++){
    let sum=0;for(let y=0;y<=Math.min(r,h-1);y++)sum+=tmp[y*w+x];
    for(let y=0;y<h;y++){out[y*w+x]=sum;if(y-r>=0)sum-=tmp[(y-r)*w+x];if(y+r+1<h)sum+=tmp[(y+r+1)*w+x];}
  }
  return out;
}
function mean(input,weight,w,h,r,counts){
  const product=Float32Array.from(input,(v,i)=>v*weight[i]),sum=boxSum(product,w,h,r);
  for(let i=0;i<sum.length;i++)sum[i]/=Math.max(1,counts[i]);return sum;
}
function guided(guide,input,weight,w,h,r,eps){
  const counts=boxSum(weight,w,h,r),mi=mean(guide,weight,w,h,r,counts),mp=mean(input,weight,w,h,r,counts);
  const ii=Float32Array.from(guide,v=>v*v),ip=Float32Array.from(guide,(v,i)=>v*input[i]);
  const corrI=mean(ii,weight,w,h,r,counts),corrP=mean(ip,weight,w,h,r,counts);
  const a=new Float32Array(input.length),b=new Float32Array(input.length);
  for(let i=0;i<a.length;i++){a[i]=(corrP[i]-mi[i]*mp[i])/(Math.max(0,corrI[i]-mi[i]*mi[i])+eps);b[i]=mp[i]-a[i]*mi[i];}
  const ma=mean(a,weight,w,h,r,counts),mb=mean(b,weight,w,h,r,counts);
  return Float32Array.from(guide,(v,i)=>ma[i]*v+mb[i]);
}
function median(values){values.sort((a,b)=>a-b);const n=values.length;return n?(values[(n-1)>>1]+values[n>>1])/2:0;}
function localExtrema(input,weight,w,h,r,minimum){
  const tmp=new Float32Array(input.length),out=new Float32Array(input.length),deque=new Int32Array(Math.max(w,h));
  const empty=minimum?Infinity:-Infinity,better=(a,b)=>minimum?a<=b:a>=b;
  for(let y=0;y<h;y++){
    let head=0,tail=0,right=0;const row=y*w,value=x=>weight[row+x]?input[row+x]:empty;
    for(let x=0;x<w;x++){
      while(right<=Math.min(w-1,x+r)){while(tail>head&&better(value(right),value(deque[tail-1])))tail--;deque[tail++]=right++;}
      while(head<tail&&deque[head]<x-r)head++;tmp[row+x]=value(deque[head]);
    }
  }
  for(let x=0;x<w;x++){
    let head=0,tail=0,bottom=0;const value=y=>tmp[y*w+x];
    for(let y=0;y<h;y++){
      while(bottom<=Math.min(h-1,y+r)){while(tail>head&&better(value(bottom),value(deque[tail-1])))tail--;deque[tail++]=bottom++;}
      while(head<tail&&deque[head]<y-r)head++;out[y*w+x]=value(deque[head]);
    }
  }
  return out;
}
export function estimateNoise(L,data,w,h){
  const values=[],stride=Math.max(1,Math.ceil(Math.sqrt(w*h/16384)));
  for(let y=1;y<h-1;y+=stride)for(let x=1;x<w-1;x+=stride){
    const i=y*w+x,neighbors=[i,i-1,i+1,i-w,i+w];
    if(neighbors.some(k=>data[k*4+3]!==255))continue;
    // Unit noise energy: var(4c-left-right-up-down) = 20 sigma^2.
    values.push((4*L[i]-L[i-1]-L[i+1]-L[i-w]-L[i+w])/Math.sqrt(20));
  }
  const centre=median(values);return 1.4826*median(values.map(v=>Math.abs(v-centre)));
}
function sharpenTile(L,weight,w,h,settings,sigma,radii,scale){
  const radius=n=>Math.max(1,Math.round(n*scale)),noise=Math.max(.0002,sigma*settings.sharpenNoise/100);
  const guide=guided(L,L,weight,w,h,radius(2),Math.max(1e-7,(1.5*noise)**2));
  const suppression=Math.max(0,Math.round((settings.edgeSuppression??2)*scale));
  let edgeGuide=guide;
  if(suppression){const counts=boxSum(weight,w,h,suppression);for(let n=0;n<3;n++)edgeGuide=mean(edgeGuide,weight,w,h,suppression,counts);}
  const xx=new Float32Array(L.length),yy=new Float32Array(L.length),xy=new Float32Array(L.length),grad=new Float32Array(L.length);
  for(let y=1;y<h-1;y++)for(let x=1;x<w-1;x++){
    const i=y*w+x;if(!weight[i]||!weight[i-1]||!weight[i+1]||!weight[i-w]||!weight[i+w])continue;
    const gx=(edgeGuide[i+1]-edgeGuide[i-1])*.5,gy=(edgeGuide[i+w]-edgeGuide[i-w])*.5;
    xx[i]=gx*gx;yy[i]=gy*gy;xy[i]=gx*gy;grad[i]=Math.hypot(gx,gy);
  }
  const tensorR=radius(2),counts=boxSum(weight,w,h,tensorR);
  const Jxx=mean(xx,weight,w,h,tensorR,counts),Jyy=mean(yy,weight,w,h,tensorR,counts),Jxy=mean(xy,weight,w,h,tensorR,counts);
  let mask=new Float32Array(L.length);
  for(let i=0;i<mask.length;i++){
    const coherence=Math.hypot(Jxx[i]-Jyy[i],2*Jxy[i])/(Jxx[i]+Jyy[i]+1e-10);
    const threshold=.0002+(settings.edgeThreshold??15)/100*.018;
    const floor=Math.max(threshold,noise/Math.max(1,2*suppression+1));
    mask[i]=smooth(grad[i]*scale,floor,floor*2.5)*smooth(coherence,.15,.8)*smooth(guide[i],.02,.1)*(1-smooth(guide[i],.9,.99));
  }
  const expand=Math.max(0,Math.round((settings.edgeWidth??1)*scale)),feather=Math.max(0,Math.round((settings.edgeFeather??1)*scale));
  if(expand){mask=localExtrema(mask,weight,w,h,expand,false);for(let i=0;i<mask.length;i++)if(!Number.isFinite(mask[i]))mask[i]=0;}
  if(feather){const counts=boxSum(weight,w,h,feather);for(let n=0;n<3;n++)mask=mean(mask,weight,w,h,feather,counts);}
  for(let i=0;i<mask.length;i++)mask[i]=weight[i]?clamp(mask[i]):0;
  const out=L.slice(),gains=[settings.sharpenFine,settings.sharpenMedium,settings.sharpenCoarse];let previous=L;
  for(let band=0;band<radii.length;band++){
    // A fixed detail floor is essential: sigma=0 must still sharpen a clean edge.
    const base=guided(guide,previous,weight,w,h,radii[band],Math.max(2.5e-3,(2*noise)**2));
    // Averaging reduces noise in the coarser bands; keep the fine band conservative.
    const bandNoise=noise*[1,.5,.25][band];
    for(let i=0;i<out.length;i++){
      const detail=previous[i]-base[i],cored=detail*smooth(Math.abs(detail),bandNoise,3*bandNoise);
      out[i]+=settings.sharpenAmount/100*gains[band]/100*clamp(mask[i])*cored*(detail>0?.65:1);
    }
    previous=base;
  }
  const halo=settings.sharpenHalo/1000,localR=radius(2),low=localExtrema(L,weight,w,h,localR,true),high=localExtrema(L,weight,w,h,localR,false);
  for(let i=0;i<out.length;i++){
    if(!weight[i]){out[i]=L[i];continue;}
    // Reapply extreme protection after feathering, and apply a hard local clamp.
    const protect=smooth(L[i],.02,.1)*(1-smooth(L[i],.9,.99));
    out[i]=clamp(L[i]+(out[i]-L[i])*protect,Math.max(0,low[i]-halo),Math.min(1,high[i]+halo));
  }
  return {out,mask};
}

export function sharpenPixels(data,width,height,settings,{radiusScale=1,tileSize=256,effectMap=null,selectionMap=null,layer=null,matrix}={}){
  if(effectMap){if(effectMap.length!==data.length/4)throw new Error('Invalid sharpening effect buffer.');effectMap.fill(0);}
  if(selectionMap){if(selectionMap.length!==data.length/4)throw new Error('Invalid edge mask buffer.');selectionMap.fill(0);}
  if((!settings.sharpenAmount&&!selectionMap)||(layer&&(!layer.exists||!layer.visible)))return data;
  if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||data.length!==width*height*4)throw new Error('Sharpening requires image dimensions.');
  if(!Number.isFinite(radiusScale)||!Number.isInteger(tileSize)||tileSize<1)throw new Error('Invalid sharpening scale or tile size.');
  const scale=clamp(radiusScale,.1,4),r=n=>Math.max(1,Math.round(n*scale)),radii=[r(1),r(3),r(6)];
  const L=new Float32Array(width*height);
  for(let i=0;i<L.length;i++)if(data[i*4+3]===255)L[i]=toLab(data[i*4],data[i*4+1],data[i*4+2])[0];
  const sigma=estimateNoise(L,data,width,height),paint=brushMask(width,height,layer?.strokes,matrix),opacity=(layer?.opacity??100)/100;
  // Exact finite filter support: each guided pass has support 2*r.
  const pad=Math.max(2*r(2)+2*radii.reduce((a,b)=>a+b,0),2*r(2)+3*Math.max(0,Math.round((settings.edgeSuppression??2)*scale))+1+r(2)+Math.max(0,Math.round((settings.edgeWidth??1)*scale))+3*Math.max(0,Math.round((settings.edgeFeather??1)*scale)),r(2));
  for(let y=0;y<height;y+=tileSize)for(let x=0;x<width;x+=tileSize){
    const right=Math.min(width,x+tileSize),bottom=Math.min(height,y+tileSize);
    const left=Math.max(0,x-pad),top=Math.max(0,y-pad),w=Math.min(width,right+pad)-left,h=Math.min(height,bottom+pad)-top;
    const tile=new Float32Array(w*h),weight=new Float32Array(w*h);
    for(let ty=0;ty<h;ty++)for(let tx=0;tx<w;tx++){const src=(top+ty)*width+left+tx,k=ty*w+tx;tile[k]=L[src];weight[k]=data[src*4+3]===255?1:0;}
    const {out,mask}=sharpenTile(tile,weight,w,h,settings,sigma,radii,scale);
    for(let cy=y;cy<bottom;cy++)for(let cx=x;cx<right;cx++){
      const i=cy*width+cx;if(data[i*4+3]!==255)continue;
      const k=i*4,r=data[k],g=data[k+1],b=data[k+2];
      const ti=(cy-top)*w+cx-left,brush=paint?paint[i]:1;
      if(selectionMap)selectionMap[i]=mask[ti]*brush;
      writeLightness(data,k,L[i]+(out[ti]-L[i])*brush*opacity);
      // Measure actual final 8-bit pixel change, after all masks, bounds and gamut handling.
      if(effectMap&&(r!==data[k]||g!==data[k+1]||b!==data[k+2]))effectMap[i]=Math.abs(toLab(data[k],data[k+1],data[k+2])[0]-L[i]);
    }
  }
  return data;
}

export function effectMaskPixels(effectMap){
  const pixels=new Uint8ClampedArray(effectMap.length*4);
  for(let i=0;i<effectMap.length;i++){
    // Fixed (not per-frame normalized) contrast: slider strength remains comparable.
    // A 0.02 Oklab L change reaches white; unchanged pixels remain exactly black.
    const v=effectMap[i]>0?Math.max(1,Math.round(255*Math.sqrt(clamp(effectMap[i]/.02)))):0;
    pixels.set([v,v,v,255],i*4);
  }
  return pixels;
}
