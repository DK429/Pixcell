import {validateState} from './engine.js';

const DB_NAME='dk-pixcell-recovery',DRAFT_KEY='dk-pixcell-draft',PREFERENCE_KEY='dk-pixcell-autosave';
let connection=null,queue=Promise.resolve();
function database(){
  if(connection)return connection;
  connection=new Promise((resolve,reject)=>{
    if(!globalThis.indexedDB){reject(new Error('Local recovery storage is unavailable.'));return;}
    const request=indexedDB.open(DB_NAME,1);
    request.onupgradeneeded=()=>request.result.createObjectStore('session');
    request.onsuccess=()=>{const db=request.result;db.onversionchange=()=>{db.close();connection=null;};resolve(db);};
    request.onerror=()=>{connection=null;reject(request.error);};
    request.onblocked=()=>{connection=null;reject(new Error('Close other Pixcell tabs to enable local recovery.'));};
  });
  return connection;
}
function ordered(operation){const result=queue.then(operation);queue=result.catch(()=>{});return result;}
export function recoveryEnabled(){try{return localStorage.getItem(PREFERENCE_KEY)!=='false';}catch{return true;}}
export function setRecoveryEnabled(enabled){try{localStorage.setItem(PREFERENCE_KEY,String(enabled));}catch{/* Browser storage can be blocked. */}}
export function writeDraft(hash,state){
  try{localStorage.setItem(DRAFT_KEY,JSON.stringify({hash,state,savedAt:Date.now()}));}catch{/* IndexedDB remains the main recovery store. */}
}
function clearDraft(){try{localStorage.removeItem(DRAFT_KEY);}catch{/* No draft to remove. */}}
export function saveSession(source,state){
  const record={hash:source.hash,state:structuredClone(state),savedAt:Date.now()};
  return ordered(async()=>{
    const db=await database();
    const previous=await new Promise((resolve,reject)=>{
      const tx=db.transaction('session','readonly'),request=tx.objectStore('session').get('meta');
      tx.oncomplete=()=>resolve(request.result);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);
    });
    // Store bytes rather than a File/Blob for browser compatibility. Read the
    // file before opening a write transaction, and only when the source changes.
    const bytes=previous?.hash!==source.hash?await source.file.arrayBuffer():null;
    await new Promise((resolve,reject)=>{
      const tx=db.transaction('session','readwrite'),store=tx.objectStore('session');
      tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||new Error('Local recovery save was interrupted.'));
      if(bytes){store.put({bytes,name:source.file.name,type:source.file.type},'source');store.put({hash:source.hash},'meta');}
      store.put(record,'edits');
    });
    return record.savedAt;
  });
}
export function readSession(){
  return ordered(async()=>{
    const db=await database();
    const record=await new Promise((resolve,reject)=>{
      const tx=db.transaction('session','readonly'),store=tx.objectStore('session');
      const a=store.get('source'),b=store.get('edits'),c=store.get('meta');
      tx.oncomplete=()=>resolve({source:a.result,edits:b.result,meta:c.result});tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);
    });
    if(!record.source||!record.edits||record.meta?.hash!==record.edits.hash)return null;
    let edits=record.edits;
    try{const draft=JSON.parse(localStorage.getItem(DRAFT_KEY));if(draft?.hash===edits.hash&&draft.savedAt>=edits.savedAt)edits=draft;}catch{/* Ignore incomplete lightweight drafts. */}
    const state=validateState(edits.state);
    const data=record.source.bytes||record.source.blob;
    if(!(data instanceof ArrayBuffer)&&!(data instanceof Blob))throw new Error('The saved photograph is unavailable.');
    return {file:new File([data],record.source.name,{type:record.source.type||data.type||''}),hash:edits.hash,state,savedAt:edits.savedAt};
  });
}
export function clearSession(){
  clearDraft();
  return ordered(async()=>{
    const db=await database();
    await new Promise((resolve,reject)=>{const tx=db.transaction('session','readwrite');tx.objectStore('session').clear();tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);});
  });
}
