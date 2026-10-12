import {test} from 'node:test';
import assert from 'node:assert/strict';
import {defaults,processPixels,History} from '../src/engine.js';
import {effectMaskPixels} from '../src/sharpen.js';
import {SharpenSession} from '../src/sharpen-state.js';

function edge(){const data=new Uint8ClampedArray(160*48*4);for(let y=0;y<48;y++)for(let x=0;x<160;x++){const v=Math.round(70+100/(1+Math.exp(-(x-80)/5)));data.set([v,v,v,255],(y*160+x)*4);}return data;}
test('effect map marks exactly the final changed opaque pixels and does not change output',()=>{
  const source=edge(),output=source.slice(),reference=source.slice(),effectMap=new Float32Array(160*48),a={...defaults().adjustments,sharpenAmount:100};
  source[3]=output[3]=reference[3]=0;source[7]=output[7]=reference[7]=128;
  processPixels(output,a,160,48,{effectMap});processPixels(reference,a,160,48);assert.deepEqual(output,reference);
  const mask=effectMaskPixels(effectMap);let changed=0;
  for(let i=0;i<effectMap.length;i++){const k=i*4,diff=[0,1,2].some(c=>output[k+c]!==source[k+c]);assert.equal(effectMap[i]>0,diff);assert.equal(mask[k]>0,diff);assert.equal(mask[k],mask[k+1]);assert.equal(mask[k],mask[k+2]);assert.equal(mask[k+3],255);if(diff)changed++;}
  assert.ok(changed>100);assert.equal(effectMap[0],0);assert.equal(effectMap[1],0);
});
test('effect map is black for disabled sharpening and zero gains; display scaling stays fixed',()=>{
  for(const amount of [0,100]){const data=edge(),map=new Float32Array(160*48).fill(1);processPixels(data,{...defaults().adjustments,sharpenAmount:amount,sharpenFine:0,sharpenMedium:0,sharpenCoarse:0},160,48,{effectMap:map});assert.ok(map.every(v=>v===0));}
  const values=effectMaskPixels(new Float32Array([0,.001,.004,.02]));assert.equal(values[0],0);assert.ok(values[4]<values[8]);assert.equal(values[12],255);assert.equal(effectMaskPixels(new Float32Array([.004]))[0],values[8]);
});
test('staged values are separate from applied state and cancel restores all sharpening values',()=>{
  const applied=defaults().adjustments,original=structuredClone(applied),s=new SharpenSession();assert.equal(s.showMask,true);
  s.set('sharpenAmount',150,applied);s.set('sharpenFine',20,applied);assert.deepEqual(applied,original);assert.equal(s.preview(applied).sharpenAmount,150);assert.equal(s.dirty(applied),true);
  applied.exposure=1;assert.equal(s.preview(applied).exposure,1);s.cancel();assert.equal(s.value('sharpenAmount',applied),0);assert.equal(s.active,false);assert.equal(applied.exposure,1);
});
test('Apply commits all staged sharpening in one undo step and keeps other edits',()=>{
  const state=defaults(),history=new History(state),s=new SharpenSession();
  s.set('sharpenAmount',100,state.adjustments);s.set('sharpenFine',93,state.adjustments);s.set('sharpenCoarse',120,state.adjustments);
  assert.equal(history.canUndo,false);assert.equal(s.apply(state.adjustments),true);history.push(state);assert.equal(history.items.length,2);
  assert.equal(history.undo().adjustments.sharpenAmount,0);const redo=history.redo();assert.equal(redo.adjustments.sharpenFine,93);assert.equal(redo.adjustments.sharpenCoarse,120);assert.equal(s.active,false);
  s.begin(state.adjustments);assert.equal(s.apply(state.adjustments),false);assert.equal(s.active,false);
});
