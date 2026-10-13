import {pixelCrop,compositionSize,outputSize} from './engine.js?v=0.5.1';

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

// Same source-to-output transform used by the photograph and brush masks.
export function imageTransform(width,height,edit,maxEdge=0,viewport=null){
  const crop=pixelCrop(width,height,edit.crop),native=compositionSize(width,height,edit),size=outputSize(width,height,edit,maxEdge);
  const sx=viewport?.scale??size.width/native.width,sy=viewport?.scale??size.height/native.height;
  const angle=(edit.rotation+(edit.straighten||0))*Math.PI/180,c=Math.cos(angle),s=Math.sin(angle),fx=edit.flipX?-1:1,fy=edit.flipY?-1:1;
  const a=sx*c*fx,b=sy*s*fx,d=sy*c*fy,k=-sx*s*fy,cx=crop.x+crop.w/2,cy=crop.y+crop.h/2;
  return [a,b,k,d,sx*native.width/2-(viewport?.x??0)-a*cx-k*cy,sy*native.height/2-(viewport?.y??0)-b*cx-d*cy];
}
