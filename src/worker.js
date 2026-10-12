import {processPixels,histogram} from './engine.js?v=0.4.0';
import {effectMaskPixels} from './sharpen.js?v=0.4.0';
self.onmessage = ({data:{id,pixels,adjustments,width,height,options}}) => {
  try {
    const effectMap=options?.showMask?new Float32Array(width*height):null;
    const output=processPixels(new Uint8ClampedArray(pixels),adjustments,width,height,{...options,effectMap});
    const bins=histogram(output);
    const display=effectMap?effectMaskPixels(effectMap):output;
    self.postMessage({id,pixels:display.buffer,bins},[display.buffer]);
  } catch(error){self.postMessage({id,error:error.message});}
};
