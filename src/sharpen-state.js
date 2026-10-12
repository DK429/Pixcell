import {emptyLayer} from './mask.js?v=0.5.0';
import {CONTROLS} from './engine.js?v=0.5.0';
const keys=CONTROLS.filter(c=>c.group==='detail').map(c=>c.key);

// Temporary sharpening belongs to the preview, not recipes, recovery or exports.
export class SharpenSession {
  constructor(){this.reset();}
  reset(){this.draft=null;this.draftLayer=null;this.showMask=true;this.brushUndo=[];}
  get active(){return this.draft!==null;}
  begin(applied,layer=emptyLayer()){if(!this.active){this.draft=Object.fromEntries(keys.map(k=>[k,applied[k]]));this.draftLayer=structuredClone(layer);this.draftLayer.exists=true;this.brushUndo=[];}}
  value(key,applied){return this.active?this.draft[key]:applied[key];}
  set(key,value,applied,layer){this.begin(applied,layer);this.draft[key]=value;}
  preview(applied){return {...applied,...this.draft};}
  dirty(applied,layer){return this.active&&(keys.some(k=>this.draft[k]!==applied[k])||(!!layer&&JSON.stringify(layer)!==JSON.stringify(this.draftLayer)));}
  apply(applied,layer){const changed=this.dirty(applied,layer);if(changed){Object.assign(applied,this.draft);if(layer)Object.assign(layer,structuredClone(this.draftLayer));}this.cancel();return changed;}
  cancel(){this.draft=null;this.draftLayer=null;this.brushUndo=[];}
}
