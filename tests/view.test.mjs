import {test} from 'node:test';
import assert from 'node:assert/strict';
import {defaults,compositionSize,outputSize,validateState,clippingOverlay} from '../src/engine.js';
import {viewLayout,zoomAt} from '../src/view.js';

test('straightening trims edges, quarter rotation swaps dimensions, and reset restores resolution',()=>{
  const state=defaults();state.straighten=10;
  const result=compositionSize(4000,3000,state);assert.ok(result.width<4000&&result.height<3000);
  const a=10*Math.PI/180;assert.ok(result.width*Math.cos(a)+result.height*Math.sin(a)<=4000);assert.ok(result.width*Math.sin(a)+result.height*Math.cos(a)<=3000);
  state.rotation=90;assert.deepEqual(compositionSize(4000,3000,state),{width:result.height,height:result.width});
  state.straighten=0;assert.deepEqual(outputSize(4000,3000,state),{width:3000,height:4000});
});
test('straightening handles a narrow portrait without blank corners',()=>{
  const state=defaults();state.straighten=-15;const size=compositionSize(500,4000,state),a=Math.PI/12;
  assert.ok(size.width*Math.cos(a)+size.height*Math.sin(a)<=500);assert.ok(size.width*Math.sin(a)+size.height*Math.cos(a)<=4000);
});
test('legacy recipes default to zero straightening and invalid new angles are rejected',()=>{
  const legacy=defaults();delete legacy.straighten;assert.equal(validateState(legacy).straighten,0);
  for(const angle of [NaN,Infinity,-16,16,null,'2']){const state=defaults();state.straighten=angle;assert.throws(()=>validateState(state));}
});
test('100% inspection uses native scale with a bounded viewport, not a scaled preview',()=>{
  const result=viewLayout({width:8000,height:5000},800,600,{mode:'zoom',zoom:1,panX:0,panY:0});
  assert.equal(result.scale,1);assert.equal(result.fullWidth,8000);assert.ok(result.width<=928);assert.ok(result.height<=728);assert.ok(result.x>0);
});
test('fit centres small images without upscaling and resets pan',()=>{
  const result=viewLayout({width:100,height:70},800,600,{mode:'fit',panX:500,panY:500});
  assert.equal(result.scale,1);assert.equal(result.panX,0);assert.equal(result.panY,0);assert.equal(result.left,350);assert.equal(result.top,265);
});
test('zoom preserves the native pixel under the chosen cursor position',()=>{
  const image={width:4000,height:3000},width=800,height=600,point={x:350,y:220};
  const before=viewLayout(image,width,height,{mode:'zoom',zoom:.5,panX:40,panY:20});
  const after=viewLayout(image,width,height,zoomAt(before,width,height,1,point));
  assert.equal((point.x-before.left)/before.scale,(point.x-after.left)/after.scale);assert.equal((point.y-before.top)/before.scale,(point.y-after.top)/after.scale);
});
test('pan is bounded so the image cannot be lost outside the viewport',()=>{
  const result=viewLayout({width:1000,height:1000},800,600,{mode:'zoom',zoom:1,panX:1e6,panY:-1e6});assert.equal(result.panX,126);assert.equal(result.panY,-226);assert.ok(result.width>0&&result.height>0);
});
test('clipping marks channel endpoints, preserves alpha and ignores invisible pixels',()=>{
  const data=new Uint8ClampedArray([255,120,40,255,0,0,0,128,254,1,2,255,255,255,255,0]);
  assert.deepEqual(clippingOverlay(data),{highlights:1,shadows:1});assert.deepEqual([...data],[255,65,65,255,60,110,255,128,254,1,2,255,255,255,255,0]);
});
