import {defaults,processPixels} from '../src/engine.js';
import {toLab} from '../src/sharpen.js';

// Synthetic regression measurements, not ISO 12233 lens/camera certification.
const w=384,h=192,slope=1/8;
function fixture(fn){const data=new Uint8ClampedArray(w*h*4);for(let y=0;y<h;y++)for(let x=0;x<w;x++){const v=Math.round(fn(x,y));data.set([v,v,v,255],(y*w+x)*4);}return data;}
const lightness=data=>Float32Array.from({length:w*h},(_,i)=>toLab(data[i*4],data[i*4+1],data[i*4+2])[0]);
function edgeMetrics(data){
  const L=lightness(data),n=512,sum=new Float64Array(n),count=new Uint32Array(n),step=.25;
  for(let y=16;y<h-16;y++)for(let x=0;x<w;x++){const distance=(x-w/2-slope*(y-h/2))/Math.hypot(1,slope),bin=Math.floor(distance/step+n/2);if(bin>=0&&bin<n){sum[bin]+=L[y*w+x];count[bin]++;}}
  const esf=Array.from(sum,(v,i)=>v/Math.max(1,count[i]));
  const low=esf.slice(0,32).reduce((a,b)=>a+b)/32,high=esf.slice(-32).reduce((a,b)=>a+b)/32;
  const crossing=f=>{const target=low+(high-low)*f;for(let i=1;i<n;i++)if(esf[i]>=target)return (i-1+(target-esf[i-1])/(esf[i]-esf[i-1]))*step;};
  const lsf=esf.slice(1).map((v,i)=>(v-esf[i])*(.5-.5*Math.cos(2*Math.PI*i/(n-2))));
  const dc=lsf.reduce((a,b)=>a+b);let previous=1,mtf50=null;
  for(let f=.001;f<=.5;f+=.001){let real=0,imag=0;for(let i=0;i<lsf.length;i++){real+=lsf[i]*Math.cos(2*Math.PI*f*i*step);imag+=lsf[i]*Math.sin(2*Math.PI*f*i*step);}const mtf=Math.hypot(real,imag)/Math.abs(dc);if(mtf<=.5){mtf50=f-.001+.001*(previous-.5)/(previous-mtf);break;}previous=mtf;}
  return {rise10to90Pixels:crossing(.9)-crossing(.1),approximateMTF50CyclesPerPixel:mtf50};
}
function sigma(data){const L=lightness(data),mean=L.reduce((a,b)=>a+b)/L.length;return Math.sqrt(L.reduce((a,b)=>a+(b-mean)**2,0)/L.length);}
function overshoot(data){const L=lightness(data),low=toLab(70,70,70)[0],high=toLab(170,170,170)[0];return 100*Math.max(0,...L.map(v=>Math.max(low-v,v-high)))/(high-low);}
let seed=123;const uniform=()=>{seed=(1664525*seed+1013904223)>>>0;return (seed+.5)/2**32;};
const noise=()=>Math.sqrt(-2*Math.log(uniform()))*Math.cos(2*Math.PI*uniform());
const soft=fixture((x,y)=>70+100/(1+Math.exp(-(x-w/2-slope*(y-h/2))/5))),flat=fixture(()=>120+5*noise()),step=fixture((x,y)=>x<w/2+slope*(y-h/2)?70:170);
const report={description:'Synthetic Oklab L metrics; approximate slanted-edge MTF with Hann-windowed LSF',before:{edge:edgeMetrics(soft),flatNoiseSigma:sigma(flat),stepOvershootPercent:overshoot(step)},runs:[]};
for(const amount of [100,200,350,500]){
  const settings={...defaults().adjustments,sharpenAmount:amount},edge=soft.slice(),patch=flat.slice(),hard=step.slice(),start=performance.now();
  for(const data of [edge,patch,hard])processPixels(data,settings,w,h);
  report.runs.push({amount,edge:edgeMetrics(edge),flatNoiseSigma:sigma(patch),flatNoiseRatio:sigma(patch)/report.before.flatNoiseSigma,stepOvershootPercent:overshoot(hard),processingMilliseconds:performance.now()-start,pixelsProcessed:w*h*3});
}
console.log(JSON.stringify(report,null,2));
