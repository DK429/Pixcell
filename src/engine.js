export const CONTROLS = [
  {key:'exposure',label:'Exposure',min:-3,max:3,step:0.05,unit:' EV'},
  {key:'contrast',label:'Contrast',min:-100,max:100,step:1},
  {key:'highlights',label:'Highlights',min:-100,max:100,step:1},
  {key:'shadows',label:'Shadows',min:-100,max:100,step:1},
  {key:'whites',label:'Whites',min:-100,max:100,step:1},
  {key:'blacks',label:'Blacks',min:-100,max:100,step:1},
  {key:'temperature',label:'Warmth',min:-100,max:100,step:1},
  {key:'tint',label:'Tint',min:-100,max:100,step:1},
  {key:'saturation',label:'Saturation',min:-100,max:100,step:1},
  {key:'vibrance',label:'Vibrance',min:-100,max:100,step:1}
];
export const PRESETS = {
  Natural: {},
  Landscape: {contrast:12, saturation:10, vibrance:20, highlights:-18, shadows:12},
  Portrait: {contrast:-8, highlights:-12, shadows:14, temperature:6, vibrance:8},
  Monochrome: {saturation:-100, contrast:20, highlights:-10},
  'Golden hour': {temperature:24, tint:5, contrast:8, shadows:12}
};
export const clamp = (v, min=0, max=1) => Math.min(max, Math.max(min, v));
export const defaults = () => ({adjustments:Object.fromEntries(CONTROLS.map(c=>[c.key,0])),crop:{x:0,y:0,w:1,h:1},rotation:0,flipX:false,flipY:false});

export function validateState(value) {
  if (!value || typeof value !== 'object') throw new Error('Invalid edit recipe.');
  const state = defaults();
  for (const c of CONTROLS) {
    const v = value.adjustments?.[c.key];
    if (!Number.isFinite(v) || v<c.min || v>c.max) throw new Error(`Invalid ${c.label.toLowerCase()} value.`);
    state.adjustments[c.key]=v;
  }
  const crop = value.crop;
  if (!crop || ['x','y','w','h'].some(k=>!Number.isFinite(crop[k])) || crop.x<0 || crop.y<0 || crop.w<=0 || crop.h<=0 || crop.x+crop.w>1.000001 || crop.y+crop.h>1.000001) throw new Error('Invalid crop region.');
  state.crop = {x:crop.x,y:crop.y,w:crop.w,h:crop.h};
  if (![0,90,180,270].includes(value.rotation) || typeof value.flipX!=='boolean' || typeof value.flipY!=='boolean') throw new Error('Invalid image orientation.');
  state.rotation=value.rotation; state.flipX=value.flipX; state.flipY=value.flipY;
  return state;
}

export function pixelCrop(width,height,crop) {
  const x=Math.min(width-1,Math.round(crop.x*width));
  const y=Math.min(height-1,Math.round(crop.y*height));
  const w=clamp(Math.round((crop.x+crop.w)*width)-x,1,width-x);
  const h=clamp(Math.round((crop.y+crop.h)*height)-y,1,height-y);
  return {x,y,w,h};
}
export function outputSize(width,height,state,maxEdge=0) {
  const crop=pixelCrop(width,height,state.crop);
  const swapped=state.rotation%180!==0;
  let w=swapped?crop.h:crop.w, h=swapped?crop.w:crop.h;
  const scale=maxEdge>0?Math.min(1,maxEdge/Math.max(w,h)):1;
  return {width:Math.max(1,Math.round(w*scale)),height:Math.max(1,Math.round(h*scale))};
}

// Preview and export share this engine. Exposure is applied in linear light;
// the remaining controls are approximate SDR creative adjustments, not RAW development.
const linear = new Float64Array(256);
for(let i=0;i<256;i++){const v=i/255;linear[i]=v<=0.04045?v/12.92:((v+0.055)/1.055)**2.4;}
function srgb(v){return v<=0.0031308?12.92*v:1.055*Math.pow(v,1/2.4)-0.055;}
export function processPixels(data,a) {
  const neutral=CONTROLS.every(c=>a[c.key]===0);
  if(neutral)return data;
  const gain=2**a.exposure, contrast=1+a.contrast/140;
  const warmth=a.temperature/500, tint=a.tint/600;
  for(let i=0;i<data.length;i+=4){
    if(data[i+3]===0)continue;
    let r=srgb(linear[data[i]]*gain),g=srgb(linear[data[i+1]]*gain),b=srgb(linear[data[i+2]]*gain);
    const l=clamp(0.2126*r+0.7152*g+0.0722*b);
    const highlight=Math.max(0,(l-0.45)/0.55)**2, shadow=Math.max(0,(0.55-l)/0.55)**2;
    const tone=a.highlights/100*highlight*0.28+a.shadows/100*shadow*0.28+a.whites/100*l**4*0.18+a.blacks/100*(1-l)**4*0.18;
    r=(r+tone-0.5)*contrast+0.5+warmth+tint/2;
    g=(g+tone-0.5)*contrast+0.5-tint;
    b=(b+tone-0.5)*contrast+0.5-warmth+tint/2;
    const grey=0.2126*r+0.7152*g+0.0722*b;
    const spread=clamp(Math.max(r,g,b)-Math.min(r,g,b));
    const saturation=Math.max(0,(1+a.saturation/100)*(1+a.vibrance/100*(1-spread)));
    data[i]=Math.round(clamp(grey+(r-grey)*saturation)*255);
    data[i+1]=Math.round(clamp(grey+(g-grey)*saturation)*255);
    data[i+2]=Math.round(clamp(grey+(b-grey)*saturation)*255);
  }
  return data;
}
export function histogram(data) {
  const bins=Array.from({length:3},()=>new Array(256).fill(0));
  for(let i=0;i<data.length;i+=4)if(data[i+3])for(let c=0;c<3;c++)bins[c][data[i+c]]++;
  return bins;
}
export class History {
  constructor(state,limit=80){this.limit=limit;this.items=[structuredClone(state)];this.index=0;}
  push(state){if(JSON.stringify(this.items[this.index])===JSON.stringify(state))return;this.items=this.items.slice(0,this.index+1);this.items.push(structuredClone(state));if(this.items.length>this.limit)this.items.shift();this.index=this.items.length-1;}
  undo(){if(this.index>0)this.index--;return structuredClone(this.items[this.index]);}
  redo(){if(this.index<this.items.length-1)this.index++;return structuredClone(this.items[this.index]);}
  get canUndo(){return this.index>0;}
  get canRedo(){return this.index<this.items.length-1;}
}
