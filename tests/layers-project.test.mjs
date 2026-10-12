import {test} from 'node:test';
import assert from 'node:assert/strict';
import {defaults,processPixels,validateState,History} from '../src/engine.js';
import {brushMask,emptyLayer,transformPoint,inversePoint} from '../src/mask.js';
import {imageTransform} from '../src/geometry.js';
import {SharpenSession} from '../src/sharpen-state.js';
import {saveProject,readProject,zipStore,unzipProject} from '../src/project.js';
const w=160,h=96;
function fixture(){const d=new Uint8ClampedArray(w*h*4);for(let y=0;y<h;y++)for(let x=0;x<w;x++){const v=Math.round(70+100/(1+Math.exp(-(x-80)/5)));d.set([v,v,v,255],(y*w+x)*4);}return d;}
const stroke=(mode='erase')=>({mode,radius:15,softness:0,strength:1,points:[[80,48],[80,60]]});
test('mask selection is independent of amount and suppressed texture leaves structural edges',()=>{
  const maps=[];
  for(const amount of [0,200]){const selectionMap=new Float32Array(w*h);processPixels(fixture(),{...defaults().adjustments,sharpenAmount:amount},w,h,{selectionMap});maps.push(selectionMap);}
  assert.deepEqual(maps[0],maps[1]);assert.ok(maps[0][48*w+80]>.8);assert.equal(maps[0][48*w+10],0);
  const data=fixture();for(let y=0;y<h;y++)for(let x=0;x<40;x++){const v=90+((x+y)%2?12:-12);data.set([v,v,v,255],(y*w+x)*4);}
  const mask=new Float32Array(w*h);processPixels(data,{...defaults().adjustments,sharpenAmount:100},w,h,{selectionMap:mask});
  assert.ok(mask[48*w+80]>.8);let texture=0;for(let y=20;y<76;y++)for(let x=5;x<30;x++)texture+=mask[y*w+x];assert.ok(texture/(56*25)<.02);
  const threshold=new Float32Array(w*h);processPixels(fixture(),{...defaults().adjustments,edgeThreshold:100},w,h,{selectionMap:threshold});assert.ok(threshold.reduce((a,b)=>a+b,0)<maps[0].reduce((a,b)=>a+b,0));
});
test('brush exclusions erase, restore, feather and retain source alignment through geometry',()=>{
  const m=brushMask(w,h,[stroke()]);assert.equal(m[48*w+80],0);assert.equal(m[48*w+20],1);
  assert.equal(brushMask(w,h,[stroke(),stroke('restore')])[48*w+80],1);
  const soft=brushMask(w,h,[{...stroke(),softness:1,strength:.5}]);assert.ok(soft[48*w+80]>=.5&&soft[48*w+80]<.6);assert.ok(soft[48*w+90]>soft[48*w+80]);
  for(const rotation of [0,90,180,270])for(const flipX of [false,true]){
    const edit={...defaults(),rotation,flipX,straighten:8,crop:{x:.1,y:.1,w:.8,h:.8}},matrix=imageTransform(w,h,edit,80),p=transformPoint(matrix,80,48),q=inversePoint(matrix,...p);assert.ok(Math.hypot(q[0]-80,q[1]-48)<1e-8);
    const mask=brushMask(80,80,[stroke()],matrix);assert.equal(mask[Math.floor(p[1])*80+Math.floor(p[0])],0);
  }
});
test('layer visibility, opacity and exclusions affect photo without changing base',()=>{
  const base=fixture(),settings={...defaults().adjustments,sharpenAmount:200},layer={...emptyLayer(),exists:true};
  for(const options of [{...layer,visible:false},{...layer,opacity:0},{...emptyLayer()}]){const d=base.slice();processPixels(d,settings,w,h,{layer:options});assert.deepEqual(d,base);}
  const full=base.slice(),half=base.slice();processPixels(full,settings,w,h,{layer});processPixels(half,settings,w,h,{layer:{...layer,opacity:50}});
  const delta=d=>d.reduce((a,v,i)=>a+Math.abs(v-base[i]),0);assert.ok(delta(full)>delta(half)&&delta(half)>0);
  const painted=base.slice();processPixels(painted,settings,w,h,{layer:{...layer,strokes:[stroke()]}});assert.deepEqual(painted.slice((48*w+84)*4,(48*w+84)*4+4),base.slice((48*w+84)*4,(48*w+84)*4+4));assert.notDeepEqual(painted,base);
});
test('draft mask survives slider changes; cancel, apply and history isolate layer state',()=>{
  const state=defaults(),history=new History(state),s=new SharpenSession();s.begin(state.adjustments,state.sharpeningLayer);s.draftLayer.strokes.push(stroke());s.set('edgeThreshold',45,state.adjustments,state.sharpeningLayer);assert.equal(state.sharpeningLayer.strokes.length,0);assert.equal(s.draftLayer.strokes.length,1);
  s.apply(state.adjustments,state.sharpeningLayer);history.push(state);assert.equal(state.sharpeningLayer.exists,true);assert.equal(history.undo().sharpeningLayer.exists,false);assert.equal(history.redo().sharpeningLayer.strokes.length,1);
  s.begin(state.adjustments,state.sharpeningLayer);s.draftLayer.strokes=[];s.cancel();assert.equal(state.sharpeningLayer.strokes.length,1);
});
test('project round trip preserves source bytes, geometry, painted mask and hidden layer',async()=>{
  const file=new File([new Uint8Array([137,80,78,71,1,2,3])],'original.png',{type:'image/png'}),state=defaults();state.sharpeningLayer={exists:true,visible:false,opacity:37,strokes:[stroke(),stroke('restore')]};state.adjustments.sharpenAmount=140;state.rotation=90;state.crop={x:.2,y:.1,w:.7,h:.8};
  const blob=await saveProject({file,mime:file.type,hash:'a'.repeat(64),bitmap:{width:w,height:h}},state),loaded=await readProject(blob);
  assert.deepEqual(loaded.state,state);assert.equal(loaded.file.name,file.name);assert.deepEqual(await loaded.file.arrayBuffer(),await file.arrayBuffer());assert.equal(loaded.hash,'a'.repeat(64));
  const bytes=new Uint8Array(await blob.arrayBuffer());bytes[50]^=1;await assert.rejects(()=>readProject(new Blob([bytes])));
  await assert.rejects(()=>readProject(new Blob([new Uint8Array(22)])));
  const entries=unzipProject(new Uint8Array(await blob.arrayBuffer()));const manifest=JSON.parse(new TextDecoder().decode(entries.get('project.json')));manifest.version=99;await assert.rejects(()=>readProject(zipStore([['project.json',new TextEncoder().encode(JSON.stringify(manifest))],['source',entries.get('source')]])),/version/);
});
test('layer validation rejects hostile coordinates, unlimited strokes and invalid state',()=>{
  for(const layer of [{...emptyLayer(),opacity:101},{...emptyLayer(),visible:'yes'},{...emptyLayer(),strokes:[{...stroke(),points:[[Infinity,0]]}]},{...emptyLayer(),strokes:Array(2001).fill(stroke())}])assert.throws(()=>validateState({...defaults(),sharpeningLayer:layer}));
  const legacy=defaults();delete legacy.sharpeningLayer;legacy.adjustments.sharpenAmount=100;assert.equal(validateState(legacy).sharpeningLayer.exists,true);
});

test('transparent holes cannot poison feathered masks or create black opaque pixels',()=>{
  const data=fixture();for(let y=0;y<h;y++)for(let x=0;x<60;x++)data[(y*w+x)*4+3]=0;
  const before=data.slice(),selectionMap=new Float32Array(w*h);processPixels(data,{...defaults().adjustments,sharpenAmount:200,edgeWidth:8,edgeFeather:5},w,h,{selectionMap});
  assert.ok(selectionMap.every(Number.isFinite));for(let i=0;i<w*h;i++){if(before[i*4+3]===0){assert.deepEqual(data.slice(i*4,i*4+4),before.slice(i*4,i*4+4));assert.equal(selectionMap[i],0);}else assert.ok(data[i*4]>=60);}
});
test('edge threshold uses source-pixel gradient units at different preview scales',()=>{
  const coverage=[];
  for(const scale of [.5,1,2]){
    const width=160*scale,height=48*scale,data=new Uint8ClampedArray(width*height*4),selectionMap=new Float32Array(width*height);
    for(let y=0;y<height;y++)for(let x=0;x<width;x++){const v=Math.round(70+100/(1+Math.exp(-((x+.5)/scale-80)/5)));data.set([v,v,v,255],(y*width+x)*4);}
    processPixels(data,defaults().adjustments,width,height,{radiusScale:scale,selectionMap});let sum=0;for(let x=0;x<width;x++)sum+=selectionMap[Math.floor(height/2)*width+x];coverage.push(sum/scale);
  }
  assert.ok(coverage[1]>20);for(const value of coverage)assert.ok(Math.abs(value/coverage[1]-1)<.15,coverage.join(','));
});
