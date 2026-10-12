import {CONTROLS} from './engine.js?v=0.4.0';
const keys=CONTROLS.filter(c=>c.group==='detail').map(c=>c.key);

// Temporary sharpening belongs to the preview, not recipes, recovery or exports.
export class SharpenSession {
  constructor(){this.reset();}
  reset(){this.draft=null;this.showMask=true;}
  get active(){return this.draft!==null;}
  begin(applied){if(!this.active)this.draft=Object.fromEntries(keys.map(k=>[k,applied[k]]));}
  value(key,applied){return this.active?this.draft[key]:applied[key];}
  set(key,value,applied){this.begin(applied);this.draft[key]=value;}
  preview(applied){return {...applied,...this.draft};}
  dirty(applied){return this.active&&keys.some(k=>this.draft[k]!==applied[k]);}
  apply(applied){const changed=this.dirty(applied);if(changed)Object.assign(applied,this.draft);this.cancel();return changed;}
  cancel(){this.draft=null;}
}
