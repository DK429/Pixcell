import {pixelCrop,compositionSize,outputSize} from './engine.js';

// Crop, orient and straighten once in native image coordinates, then sample the
// requested viewport. Zoom never magnifies a cached reduced-resolution preview.
export function geometry(bitmap,edit,maxEdge=0,viewport=null) {
  const crop=pixelCrop(bitmap.width,bitmap.height,edit.crop);
  const native=compositionSize(bitmap.width,bitmap.height,edit);
  const size=outputSize(bitmap.width,bitmap.height,edit,maxEdge);
  const scaleX=viewport?.scale??size.width/native.width;
  const scaleY=viewport?.scale??size.height/native.height;
  const canvas=document.createElement('canvas');
  canvas.width=viewport?.width??size.width;canvas.height=viewport?.height??size.height;
  const ctx=canvas.getContext('2d',{willReadFrequently:true});
  if(!ctx)throw new Error('Your browser could not create an image canvas.');
  ctx.imageSmoothingEnabled=scaleX!==1||scaleY!==1||Boolean(edit.straighten);
  ctx.imageSmoothingQuality='high';
  ctx.save();
  ctx.translate(-(viewport?.x??0),-(viewport?.y??0));
  ctx.scale(scaleX,scaleY);ctx.translate(native.width/2,native.height/2);
  ctx.rotate((edit.rotation+(edit.straighten||0))*Math.PI/180);
  ctx.scale(edit.flipX?-1:1,edit.flipY?-1:1);
  ctx.drawImage(bitmap,crop.x,crop.y,crop.w,crop.h,-crop.w/2,-crop.h/2,crop.w,crop.h);
  ctx.restore();
  return canvas;
}
