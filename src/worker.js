import {processPixels,histogram} from './engine.js';
self.onmessage = ({data:{id,pixels,adjustments}}) => {
  try {
    const output=processPixels(new Uint8ClampedArray(pixels),adjustments);
    const bins=histogram(output);
    self.postMessage({id,pixels:output.buffer,bins},[output.buffer]);
  } catch(error){self.postMessage({id,error:error.message});}
};
