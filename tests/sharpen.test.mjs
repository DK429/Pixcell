import {test} from 'node:test';
import assert from 'node:assert/strict';
import {defaults,validateState,processPixels} from '../src/engine.js';
import {toLab,estimateNoise} from '../src/sharpen.js';

const settings=()=>({...defaults().adjustments,sharpenAmount:100});
function image(w,h,pixel){const data=new Uint8ClampedArray(w*h*4);for(let y=0;y<h;y++)for(let x=0;x<w;x++)data.set(pixel(x,y),(y*w+x)*4);return data;}
function noise(seed=123){let state=seed;const uniform=()=>{state=(1664525*state+1013904223)>>>0;return (state+.5)/2**32;};return ()=>Math.sqrt(-2*Math.log(uniform()))*Math.cos(2*Math.PI*uniform());}
function sigma(data){const v=Array.from({length:data.length/4},(_,i)=>toLab(...data.slice(i*4,i*4+3))[0]);const mean=v.reduce((a,b)=>a+b)/v.length;return Math.sqrt(v.reduce((a,b)=>a+(b-mean)**2,0)/v.length);}
function rise(data,w,h){const line=Array.from({length:w},(_,x)=>toLab(...data.slice((Math.floor(h/2)*w+x)*4,(Math.floor(h/2)*w+x)*4+3))[0]);const low=line[0],range=line.at(-1)-low;
  const crossing=f=>{const target=low+range*f;for(let x=1;x<w;x++)if(line[x]>=target)return x-1+(target-line[x-1])/(line[x]-line[x-1]);};return crossing(.9)-crossing(.1);
}
test('zero amount is exact and constant fields do not acquire detail',()=>{
  const random=noise(),data=image(65,35,()=>[Math.round(120+random()*5),100,90,255]),original=data.slice();
  processPixels(data,defaults().adjustments,65,35);assert.deepEqual(data,original);
  for(const colour of [[128,128,128,255],[230,70,30,255],[0,0,0,255],[255,255,255,255]]){const field=image(43,31,()=>colour),before=field.slice();processPixels(field,settings(),43,31);assert.deepEqual(field,before);}
});
test('noise estimate matches independent Gaussian noise and flat patch sigma stays bounded',()=>{
  const random=noise(),w=160,h=120,data=image(w,h,()=>{const v=Math.round(120+random()*5);return [v,v,v,255];});
  const before=sigma(data),L=Float32Array.from({length:w*h},(_,i)=>toLab(...data.slice(i*4,i*4+3))[0]),estimated=estimateNoise(L,data,w,h);
  assert.ok(estimated/before>.9&&estimated/before<1.1,`${estimated}/${before}`);
  processPixels(data,{...settings(),sharpenAmount:200},w,h);assert.ok(sigma(data)/before<=1.05);
});
test('clean soft edge sharpens at zero estimated noise without overshoot',()=>{
  const w=160,h=48,data=image(w,h,x=>{const v=Math.round(70+100/(1+Math.exp(-(x-80)/5)));return [v,v,v,255];}),original=data.slice();
  const before=rise(data,w,h);processPixels(data,{...settings(),sharpenAmount:200},w,h);assert.ok(rise(data,w,h)<before,`${rise(data,w,h)} vs ${before}`);
  for(let i=0;i<data.length;i+=4){let low=255,high=0;const x=(i/4)%w,y=Math.floor(i/4/w);for(let dy=-2;dy<=2;dy++)for(let dx=-2;dx<=2;dx++){if(x+dx<0||x+dx>=w||y+dy<0||y+dy>=h)continue;const v=original[((y+dy)*w+x+dx)*4];low=Math.min(low,v);high=Math.max(high,v);}assert.ok(data[i]>=low&&data[i]<=high);}
});
test('default amount produces a meaningful edge response and every detail gain changes pixels',()=>{
  const w=160,h=48,source=image(w,h,x=>{const v=Math.round(70+100/(1+Math.exp(-(x-80)/5)));return [v,v,v,255];});
  const normal=source.slice(),strong=source.slice();processPixels(normal,settings(),w,h);processPixels(strong,{...settings(),sharpenAmount:200},w,h);
  assert.ok(rise(normal,w,h)<rise(source,w,h)*.95,'Amount 100 must reduce the 10–90% rise distance by at least 5%');
  assert.ok(rise(strong,w,h)<rise(normal,w,h),'Raising Amount must increase edge response');
  let maximum=0;for(let i=0;i<normal.length;i+=4)maximum=Math.max(maximum,Math.abs(normal[i]-source[i]));assert.ok(maximum>=2);
  for(const band of ['sharpenFine','sharpenMedium','sharpenCoarse']){
    const out=source.slice();processPixels(out,{...settings(),sharpenFine:0,sharpenMedium:0,sharpenCoarse:0,[band]:200},w,h);
    assert.notDeepEqual(out,source,band+' must affect pixels independently');
  }
});
test('lightness-only sharpening preserves Oklab chroma to 8-bit quantization tolerance',()=>{
  const w=120,h=40,data=image(w,h,x=>{const v=Math.round(100+60/(1+Math.exp(-(x-60)/5)));return [v,Math.round(v*.7),Math.round(v*.45),255];}),original=data.slice();
  processPixels(data,{...settings(),sharpenAmount:200},w,h);let changed=0;
  for(let i=0;i<data.length;i+=4){const a=toLab(...original.slice(i,i+3)),b=toLab(...data.slice(i,i+3));assert.ok(Math.hypot(a[1]-b[1],a[2]-b[2])<.003);if(data[i]!==original[i])changed++;}assert.ok(changed>0);
});
test('hidden colours do not influence opaque edges, and all alpha bytes survive',()=>{
  const w=70,h=35,make=colour=>image(w,h,x=>x<20?colour:[Math.round(80+70/(1+Math.exp(-(x-38)/3))),110,70,255]);
  const a=make([255,0,255,0]),b=make([0,255,0,0]);a[23*4+3]=128;b[23*4+3]=128;const original=a.slice();
  processPixels(a,settings(),w,h);processPixels(b,settings(),w,h);
  for(let i=0;i<a.length;i+=4){assert.equal(a[i+3],original[i+3]);if(original[i+3]!==255)assert.deepEqual(a.slice(i,i+4),original.slice(i,i+4));else assert.deepEqual(a.slice(i,i+4),b.slice(i,i+4));}
});
test('tile boundaries are invariant, including image edges and scaled radii',()=>{
  const w=137,h=93,random=noise(),source=image(w,h,(x,y)=>{const v=Math.round(80+60/(1+Math.exp(-(x-y*.3-55)/4))+random());return [v,v,Math.round(v*.8),255];});
  for(const radiusScale of [1,2]){const a=source.slice(),b=source.slice();processPixels(a,settings(),w,h,{tileSize:32,radiusScale});processPixels(b,settings(),w,h,{tileSize:512,radiusScale});assert.deepEqual(a,b);}
});
test('old recipes disable sharpening; invalid detail controls are rejected',()=>{
  const old=defaults();for(const key of Object.keys(old.adjustments))if(key.startsWith('sharpen'))delete old.adjustments[key];assert.deepEqual(validateState(old),defaults());
  for(const [key,value] of [['sharpenAmount',201],['sharpenNoise',null],['sharpenFine','80'],['sharpenHalo',-1],['sharpenCoarse',Infinity]]){const state=defaults();state.adjustments[key]=value;assert.throws(()=>validateState(state));}
  const tiny=image(1,1,()=>[80,100,120,255]);processPixels(tiny,settings(),1,1);assert.deepEqual([...tiny],[80,100,120,255]);
  assert.throws(()=>processPixels(tiny,settings(),2,2));
});
