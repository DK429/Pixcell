import {test} from 'node:test';
import assert from 'node:assert/strict';
import {defaults,validateState,processPixels,histogram,History,pixelCrop,outputSize} from '../src/engine.js';

test('neutral adjustments retain exact source pixels and transparency',()=>{
  const input=new Uint8ClampedArray([0,255,127,255,10,20,30,80,201,12,109,0]);
  const expected=input.slice();processPixels(input,defaults().adjustments);assert.deepEqual(input,expected);
});
test('one EV approximately doubles linear light; exposure leaves alpha alone',()=>{
  const data=new Uint8ClampedArray([100,100,100,80]);const a=defaults().adjustments;a.exposure=1;processPixels(data,a);
  assert.ok(data[0]>=137&&data[0]<=139);assert.equal(data[1],data[0]);assert.equal(data[2],data[0]);assert.equal(data[3],80);
});
test('desaturation produces equal colour channels and ignores hidden pixels',()=>{
  const data=new Uint8ClampedArray([200,30,70,255,17,98,202,0]);const a=defaults().adjustments;a.saturation=-100;processPixels(data,a);
  assert.equal(data[0],data[1]);assert.equal(data[1],data[2]);assert.deepEqual([...data.slice(4)],[17,98,202,0]);
});
test('shadows predominantly change dark tones and highlights predominantly change bright tones',()=>{
  const shadow=new Uint8ClampedArray([20,20,20,255,230,230,230,255]);const a=defaults().adjustments;a.shadows=50;processPixels(shadow,a);assert.ok(shadow[0]-20>shadow[4]-230);
  const highlight=new Uint8ClampedArray([20,20,20,255,230,230,230,255]);a.shadows=0;a.highlights=-50;processPixels(highlight,a);assert.ok(230-highlight[4]>20-highlight[0]);
});
test('histogram counts visible pixels and excludes fully transparent pixels',()=>{
  const bins=histogram(new Uint8ClampedArray([255,0,10,255,255,0,10,128,12,13,14,0]));
  assert.equal(bins[0][255],2);assert.equal(bins[1][0],2);assert.equal(bins[2][10],2);assert.equal(bins[0][12],0);
});
test('pixel crop rounds boundaries safely and rotation/export retain intended dimensions',()=>{
  const s=defaults();s.crop={x:.1,y:.2,w:.5,h:.5};
  assert.deepEqual(pixelCrop(4000,3000,s.crop),{x:400,y:600,w:2000,h:1500});s.rotation=90;
  assert.deepEqual(outputSize(4000,3000,s),{width:1500,height:2000});
  assert.deepEqual(outputSize(4000,3000,s,1000),{width:750,height:1000});
  assert.deepEqual(outputSize(4000,3000,s,9000),{width:1500,height:2000});
  assert.deepEqual(pixelCrop(1,1,{x:0,y:0,w:1,h:1}),{x:0,y:0,w:1,h:1});
});
test('undo/redo are immutable and a new edit removes future redo states',()=>{
  const s=defaults(),h=new History(s);s.adjustments.exposure=1;h.push(s);s.adjustments.exposure=2;h.push(s);
  const undo=h.undo();assert.equal(undo.adjustments.exposure,1);undo.adjustments.exposure=9;assert.equal(h.redo().adjustments.exposure,2);
  h.undo();s.adjustments.exposure=-1;h.push(s);assert.equal(h.canRedo,false);assert.equal(h.undo().adjustments.exposure,1);
});
test('recipe validation rejects malformed controls, crop and orientation',()=>{
  assert.deepEqual(validateState(defaults()),defaults());
  for(const mutate of [s=>s.adjustments.exposure=Infinity,s=>s.adjustments.saturation=101,s=>s.crop.w=0,s=>s.crop.x=-1,s=>s.crop.h=2,s=>s.rotation=45,s=>s.flipX='false']){const s=defaults();mutate(s);assert.throws(()=>validateState(s));}
});
test('bounded history retains a usable undo sequence',()=>{
  const s=defaults(),h=new History(s,3);for(let i=1;i<=5;i++){s.adjustments.contrast=i;h.push(s);}assert.equal(h.items.length,3);assert.equal(h.undo().adjustments.contrast,4);assert.equal(h.undo().adjustments.contrast,3);assert.equal(h.canUndo,false);
});
