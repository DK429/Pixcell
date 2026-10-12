import {processPixels,histogram} from './engine.js';
self.onmessage = ({data:{id,pixels,adjustments,width,height,options}}) => {
  try {
    const output=processPixels(new Uint8ClampedArray(pixels),adjustments,width,height,options);
    const bins=histogram(output);
    self.postMessage({id,pixels:output.buffer,bins},[output.buffer]);
  } catch(error){self.postMessage({id,error:error.message});}
};
