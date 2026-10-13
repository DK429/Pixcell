import {selectionPixels} from './mask.js?v=0.5.1';
import {processPixels,histogram} from './engine.js?v=0.5.1';
self.onmessage = ({data:{id,pixels,adjustments,width,height,options}}) => {
  try {
    const selectionMap=options?.showMask?new Float32Array(width*height):null;
    const output=processPixels(new Uint8ClampedArray(pixels),adjustments,width,height,{...options,selectionMap});
    const bins=histogram(output);
    const display=selectionMap?selectionPixels(selectionMap):output;
    self.postMessage({id,pixels:display.buffer,bins},[display.buffer]);
  } catch(error){self.postMessage({id,error:error.message});}
};
