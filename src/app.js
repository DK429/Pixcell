import {CONTROLS,PRESETS,defaults,validateState,compositionSize,outputSize,processPixels,histogram,clippingOverlay,History,clamp} from './engine.js';
import {geometry} from './geometry.js';
import {viewLayout,zoomAt} from './view.js';
import {recoveryEnabled,setRecoveryEnabled,writeDraft,saveSession,readSession,clearSession} from './recovery.js';

const $=id=>document.getElementById(id);
let source=null, state=defaults(), history=new History(state), comparing=false, cropping=false;
let draftCrop=null, renderVersion=0, loadVersion=0, previewTimer, toastTimer, exporting=false;
let blocked=false,showClipping=false,view={mode:'fit',zoom:1,panX:0,panY:0};
let autosaveEnabled=recoveryEnabled(),autosaveTimer,pendingRecovery=null;
let worker=null, jobId=0;
let previewProcessing=false,previewPending=false;
const jobs=new Map();
try {
  worker=new Worker(new URL('./worker.js',import.meta.url),{type:'module'});
  worker.onmessage=({data})=>{const job=jobs.get(data.id);if(!job)return;jobs.delete(data.id);data.error?job.reject(new Error(data.error)):job.resolve({data:new Uint8ClampedArray(data.pixels),bins:data.bins});};
  worker.onerror=()=>{worker?.terminate();worker=null;for(const job of jobs.values())job.reject(new Error('Image processing interrupted. Please try again.'));jobs.clear();};
} catch {worker=null;}

function process(data,adjustments,width,height,options={}){
  if(!worker){processPixels(data,adjustments,width,height,options);return Promise.resolve({data,bins:histogram(data)});}
  const id=++jobId;
  return new Promise((resolve,reject)=>{jobs.set(id,{resolve,reject});try{worker.postMessage({id,pixels:data.buffer,adjustments,width,height,options},[data.buffer]);}catch(error){jobs.delete(id);reject(error);}});
}
function toast(message){$('toast').textContent=message;$('toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').hidden=true,7000);}
function status(message){$('status').textContent=message;}
function basename(name){return name.replace(/\.[^.]+$/,'');}
function busy(value){blocked=value;$('edit-controls').disabled=value||!source;$('export').disabled=value||!source;$('open').disabled=value;$('welcome-open').disabled=value;$('demo').disabled=value;$('resume-session').disabled=value;$('file').disabled=value;sync();}
function sync(){
  for(const c of CONTROLS){$('control-'+c.key).value=state.adjustments[c.key];$('value-'+c.key).value=numberText(c,state.adjustments[c.key]);}
  $('undo').disabled=!source||!history.canUndo||blocked||cropping;
  $('redo').disabled=!source||!history.canRedo||blocked||cropping;
  $('compare').disabled=!source||cropping||blocked;
  $('compare').setAttribute('aria-pressed',String(comparing));
  $('crop-toggle').setAttribute('aria-pressed',String(cropping));
  $('flip-x').setAttribute('aria-pressed',String(state.flipX));
  $('flip-y').setAttribute('aria-pressed',String(state.flipY));
  $('straighten').value=state.straighten;$('straighten-value').value=state.straighten.toFixed(1);$('straighten').disabled=cropping;$('straighten-value').disabled=cropping;$('reset-straighten').disabled=cropping;
  for(const id of ['fit','actual-size','zoom','zoom-in','zoom-out','clipping'])$(id).disabled=!source||blocked||cropping;
  $('fit').setAttribute('aria-pressed',String(view.mode==='fit'));
  $('actual-size').setAttribute('aria-pressed',String(view.mode==='zoom'&&view.zoom===1));
  $('clipping').setAttribute('aria-pressed',String(showClipping));$('clipping-info').hidden=!showClipping;
  if(view.mode==='fit')$('zoom').value='fit';
  else if([.25,.5,1,2,4].includes(view.zoom))$('zoom').value=String(view.zoom);
  else{$('custom-zoom').textContent=Math.round(view.zoom*100)+'%';$('custom-zoom').hidden=false;$('zoom').value='custom';}
  $('view-hint').textContent=showClipping?'Clipping: blue shadows · red highlights':'Drag to pan · scroll or pinch to zoom';
  if(source){const size=outputSize(source.bitmap.width,source.bitmap.height,state);$('edited-size').textContent=`${size.width} × ${size.height}`;}
}
function commit(){history.push(state);sync();schedulePreview();scheduleAutosave();}
function numberText(c,value){return Number(value).toFixed((String(c.step).split('.')[1]||'').length);}
function addPrecisionControl(heading,c,getValue,setValue){
  const group=document.createElement('div');group.className='control-value';
  const number=document.createElement('input');number.type='number';number.className='control-number';number.id=c.valueId;
  number.min=c.min;number.max=c.max;number.step=c.step;number.value=numberText(c,getValue());
  number.setAttribute('aria-label',`${c.label} exact value${c.unit||''}`);number.title='Enter a value, then press Enter or leave the field to apply';
  number.onfocus=()=>number.select();
  number.onchange=()=>{
    const value=number.valueAsNumber;
    if(!Number.isFinite(value)){number.value=numberText(c,getValue());return;}
    const next=Number(numberText(c,Math.round(clamp(value,c.min,c.max)/c.step)*c.step));
    number.value=numberText(c,next);if(next===getValue())return;setValue(next);commit();
  };
  number.onkeydown=e=>{
    if(e.key==='Enter'){e.preventDefault();number.blur();}
    if(e.key==='Escape'){e.preventDefault();number.value=numberText(c,getValue());number.blur();}
  };
  const reset=document.createElement('button');reset.type='button';reset.className='control-zero';reset.id=c.resetId;reset.textContent='↺';
  reset.title=`Reset ${c.label.toLowerCase()} to ${c.default??0}`;reset.setAttribute('aria-label',reset.title);
  reset.onclick=()=>{if(getValue()===(c.default??0))return;setValue(c.default??0);commit();};
  group.append(number);
  if(c.unit){const unit=document.createElement('span');unit.className='control-unit';unit.textContent=c.unit.trim();group.append(unit);}
  group.append(reset);heading.append(group);
}

for(const [index,c] of CONTROLS.entries()){
  const row=document.createElement('div');row.className='control';
  const heading=document.createElement('div');heading.className='control-heading';
  const label=document.createElement('label');label.htmlFor='control-'+c.key;label.textContent=c.label;
  const input=document.createElement('input');input.type='range';input.id=label.htmlFor;input.min=c.min;input.max=c.max;input.step=c.step;input.value=c.default??0;
  input.oninput=()=>{state.adjustments[c.key]=Number(input.value);$('value-'+c.key).value=numberText(c,Number(input.value));schedulePreview();scheduleAutosave();};
  input.onchange=commit;
  input.ondblclick=()=>{state.adjustments[c.key]=c.default??0;commit();};
  heading.append(label);addPrecisionControl(heading,{...c,valueId:'value-'+c.key,resetId:'reset-'+c.key},()=>state.adjustments[c.key],value=>state.adjustments[c.key]=value);
  row.append(heading,input);$(c.group==='detail'?'detail-controls':index<6?'light-controls':'colour-controls').append(row);
}
addPrecisionControl($('straighten').previousElementSibling,{label:'Straighten',min:-15,max:15,step:.1,unit:'°',valueId:'straighten-value',resetId:'reset-straighten'},()=>state.straighten,value=>state.straighten=value);
for(const [name,adjustments] of Object.entries(PRESETS)){
  const button=document.createElement('button');button.textContent=name;
  button.onclick=()=>{state.adjustments={...defaults().adjustments,...adjustments};commit();};$('presets').append(button);
}

function previewEdit(){const edit=structuredClone(state);if(cropping){edit.crop=defaults().crop;edit.rotation=0;edit.straighten=0;edit.flipX=false;edit.flipY=false;}if(comparing)edit.adjustments=defaults().adjustments;return edit;}
function currentLayout(edit=previewEdit()){return viewLayout(compositionSize(source.bitmap.width,source.bitmap.height,edit),$('stage').clientWidth,$('stage').clientHeight,cropping?{mode:'fit'}:view);}
function schedulePreview(){++renderVersion;clearTimeout(previewTimer);if(source&&!exporting)status('Updating…');previewTimer=setTimeout(renderPreview,45);}
async function renderPreview(){
  if(!source||exporting)return;
  if(previewProcessing){previewPending=true;return;}
  previewProcessing=true;previewPending=false;
  const version=++renderVersion;
  const edit=previewEdit(),layout=currentLayout(edit);
  status('Updating…');
  try {
    const canvas=geometry(source.bitmap,edit,0,layout);
    const ctx=canvas.getContext('2d');const pixels=ctx.getImageData(0,0,canvas.width,canvas.height);
    const output=await process(pixels.data,edit.adjustments,canvas.width,canvas.height,{radiusScale:layout.scale});
    if(version!==renderVersion)return;
    if(showClipping&&!cropping&&!comparing)clippingOverlay(output.data);
    const preview=$('preview');preview.width=canvas.width;preview.height=canvas.height;
    preview.getContext('2d').putImageData(new ImageData(output.data,canvas.width,canvas.height),0,0);
    $('canvas-wrap').hidden=false;$('welcome').hidden=true;$('before-label').hidden=!comparing;$('stage').classList.add('has-image');
    layoutCanvas(layout);drawHistogram(output.bins);$('histogram-title').textContent=view.mode==='fit'||cropping?'HISTOGRAM':'HISTOGRAM · VIEWED AREA';
    status(cropping?'Drag a crop region':comparing?'Original · same composition':'All edits applied');
  } catch(error){if(version===renderVersion){status('Preview failed');toast(error.message);}}
  finally{previewProcessing=false;if(previewPending){previewPending=false;schedulePreview();}}
}
function layoutCanvas(layout){
  const wrap=$('canvas-wrap'),canvas=$('preview');
  wrap.style.width=layout.fullWidth+'px';wrap.style.height=layout.fullHeight+'px';wrap.style.left=layout.left+'px';wrap.style.top=layout.top+'px';
  canvas.style.width=layout.width+'px';canvas.style.height=layout.height+'px';canvas.style.left=layout.x+'px';canvas.style.top=layout.y+'px';
  if(!cropping){view.panX=layout.panX;view.panY=layout.panY;}drawCropSelection();
}
new ResizeObserver(()=>{if(source&&!blocked)schedulePreview();}).observe($('stage'));
function drawHistogram(bins){
  const canvas=$('histogram'),ctx=canvas.getContext('2d');ctx.clearRect(0,0,canvas.width,canvas.height);
  const max=Math.max(1,...bins.flat());const colours=['#f0a89a','#b9dbad','#9fbbe4'];
  ctx.globalCompositeOperation='screen';
  for(let c=0;c<3;c++){ctx.fillStyle=colours[c]+'55';ctx.strokeStyle=colours[c];ctx.lineWidth=1.4;ctx.beginPath();ctx.moveTo(0,canvas.height);for(let i=0;i<256;i++)ctx.lineTo(i/255*canvas.width,canvas.height-2-Math.log1p(bins[c][i])/Math.log1p(max)*(canvas.height-10));ctx.lineTo(canvas.width,canvas.height);ctx.closePath();ctx.fill();ctx.stroke();}
  ctx.globalCompositeOperation='source-over';
}

function resetView(){view={mode:'fit',zoom:1,panX:0,panY:0};sync();schedulePreview();}
function changeZoom(zoom,point){if(!source||blocked||cropping)return;view=zoomAt(currentLayout(),$('stage').clientWidth,$('stage').clientHeight,zoom,point);sync();schedulePreview();}
$('fit').onclick=resetView;
$('actual-size').onclick=()=>changeZoom(1);
$('zoom').onchange=()=>{if($('zoom').value==='fit')resetView();else if($('zoom').value!=='custom')changeZoom(Number($('zoom').value));};
$('zoom-in').onclick=()=>changeZoom(currentLayout().scale*1.25);
$('zoom-out').onclick=()=>changeZoom(currentLayout().scale/1.25);
$('clipping').onclick=()=>{showClipping=!showClipping;sync();schedulePreview();};
$('stage').addEventListener('wheel',e=>{
  if(!source||blocked||cropping)return;e.preventDefault();
  const rect=$('stage').getBoundingClientRect();changeZoom(currentLayout().scale*Math.exp(-e.deltaY/500),{x:e.clientX-rect.left,y:e.clientY-rect.top});
},{passive:false});
$('stage').ondblclick=e=>{if(!source||blocked||cropping||e.target.closest('button'))return;view.mode==='zoom'&&view.zoom===1?resetView():changeZoom(1);};
const pointers=new Map();let drag=null;
function pointerLocation(e){const rect=$('stage').getBoundingClientRect();return {x:e.clientX-rect.left,y:e.clientY-rect.top};}
function pointerPair(){const [a,b]=[...pointers.values()];return {distance:Math.hypot(a.x-b.x,a.y-b.y),centre:{x:(a.x+b.x)/2,y:(a.y+b.y)/2}};}
$('stage').onpointerdown=e=>{
  if(!source||blocked||cropping||e.button>0)return;e.preventDefault();$('stage').focus({preventScroll:true});
  $('stage').setPointerCapture(e.pointerId);const point=pointerLocation(e);pointers.set(e.pointerId,point);
  if(pointers.size===1){const layout=currentLayout();drag={point,panX:layout.panX,panY:layout.panY,scale:layout.scale};}
  else drag=null;$('stage').classList.add('panning');
};
$('stage').onpointermove=e=>{
  if(!pointers.has(e.pointerId)||blocked||cropping)return;
  const previous=pointers.size===2?pointerPair():null,point=pointerLocation(e);pointers.set(e.pointerId,point);
  if(pointers.size===2){const next=pointerPair();if(previous.distance>0){view=zoomAt(currentLayout(),$('stage').clientWidth,$('stage').clientHeight,currentLayout().scale*next.distance/previous.distance,previous.centre);view.panX+=next.centre.x-previous.centre.x;view.panY+=next.centre.y-previous.centre.y;}}
  else if(drag)view={mode:'zoom',zoom:drag.scale,panX:drag.panX+point.x-drag.point.x,panY:drag.panY+point.y-drag.point.y};
  sync();schedulePreview();
};
function finishPan(e){
  pointers.delete(e.pointerId);if($('stage').hasPointerCapture(e.pointerId))$('stage').releasePointerCapture(e.pointerId);
  if(pointers.size===1){const layout=currentLayout();drag={point:[...pointers.values()][0],panX:layout.panX,panY:layout.panY,scale:layout.scale};}
  else{drag=null;$('stage').classList.remove('panning');}
}
$('stage').onpointerup=finishPan;$('stage').onpointercancel=finishPan;
$('straighten').oninput=()=>{state.straighten=Number($('straighten').value);$('straighten-value').value=state.straighten.toFixed(1);schedulePreview();scheduleAutosave();};
$('straighten').onchange=commit;
$('straighten').ondblclick=()=>{state.straighten=0;commit();};

function scheduleAutosave(){
  clearTimeout(autosaveTimer);if(!source||!autosaveEnabled)return;
  writeDraft(source.hash,state);$('recovery-status').textContent='Saving session on this device…';
  autosaveTimer=setTimeout(persistSession,200);
}
async function persistSession(){
  clearTimeout(autosaveTimer);if(!source||!autosaveEnabled)return;
  const current=source,edit=structuredClone(state);writeDraft(current.hash,edit);
  try{await saveSession(current,edit);if(source===current&&autosaveEnabled)$('recovery-status').textContent='Session saved on this device';}
  catch{if(source===current&&autosaveEnabled)$('recovery-status').textContent='Recovery unavailable. Save edits manually.';}
}
async function forgetSession(){
  autosaveEnabled=false;setRecoveryEnabled(false);$('autosave').checked=false;clearTimeout(autosaveTimer);pendingRecovery=null;$('recovery-banner').hidden=true;
  try{await clearSession();$('recovery-status').textContent='Saved session cleared · recovery off';}
  catch{$('recovery-status').textContent='Could not clear recovery. Check browser site storage.';}
}
$('autosave').checked=autosaveEnabled;
$('autosave').onchange=async()=>{
  autosaveEnabled=$('autosave').checked;setRecoveryEnabled(autosaveEnabled);
  if(autosaveEnabled){$('recovery-status').textContent='Recovery ready on this device';scheduleAutosave();}
  else await forgetSession();
};
$('clear-session').onclick=$('discard-session').onclick=forgetSession;
$('resume-session').onclick=()=>{if(pendingRecovery)loadImage(pendingRecovery.file,{restored:pendingRecovery});};
window.addEventListener('pagehide',()=>{if(source&&autosaveEnabled){writeDraft(source.hash,state);persistSession();}});
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden')persistSession();});
async function checkRecovery(){
  try{const saved=await readSession();
    if(loadVersion||source)return;pendingRecovery=saved;
    if(saved&&autosaveEnabled){$('recovery-name').textContent=`${saved.file.name} · saved ${new Date(saved.savedAt).toLocaleString()}`;$('recovery-banner').hidden=false;$('recovery-status').textContent='A saved session is ready to resume';}
    else $('recovery-status').textContent=autosaveEnabled?'Recovery ready on this device':'Local recovery is off';
  }catch{if(!source)$('recovery-status').textContent='Recovery unavailable. Save edits manually.';}
}

async function sniff(file){
  const b=new Uint8Array(await file.slice(0,16).arrayBuffer());
  const png=[137,80,78,71,13,10,26,10];
  if(png.every((v,i)=>b[i]===v))return 'image/png';
  if(b[0]===255&&b[1]===216&&b[2]===255)return 'image/jpeg';
  if(String.fromCharCode(...b.slice(0,4))==='RIFF'&&String.fromCharCode(...b.slice(8,12))==='WEBP')return 'image/webp';
  throw new Error('This release opens JPEG, PNG and WebP. DNG, camera RAW, HEIC and TIFF are not supported yet.');
}
async function digest(file){
  if(!crypto.subtle)throw new Error('Use HTTPS or localhost to open images and save edit recipes.');
  const bytes=await crypto.subtle.digest('SHA-256',await file.arrayBuffer());
  return Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('');
}
async function loadImage(file,{restored=null}={}){
  if(!file||exporting)return;
  const version=++loadVersion;busy(true);status('Opening image…');
  let bitmap;
  try {
    if(file.size>50*1024*1024)throw new Error('Please choose an image smaller than 50 MB for this release.');
    const mime=await sniff(file);
    bitmap=await createImageBitmap(file,{imageOrientation:'from-image'});
    if(bitmap.width*bitmap.height>40_000_000||Math.max(bitmap.width,bitmap.height)>16384)throw new Error('This release supports up to 40 megapixels and 16,384 pixels on either edge.');
    const hash=await digest(file);
    const restoredState=restored?validateState(restored.state):null;
    if(restored&&restored.hash!==hash)throw new Error('The saved source does not match these edits. Open your original photograph.');
    if(version!==loadVersion){bitmap.close();return;}
    renderVersion++;source?.bitmap.close();source={bitmap,file,mime,hash};bitmap=null;
    clearTimeout(autosaveTimer);state=restoredState||defaults();history=new History(defaults());history.push(state);comparing=false;view={mode:'fit',zoom:1,panX:0,panY:0};exitCrop(false);
    pendingRecovery=null;$('recovery-banner').hidden=true;
    $('image-name').textContent=file.name;$('original-size').textContent=`${source.bitmap.width} × ${source.bitmap.height}`;$('file-size').textContent=(file.size/1024/1024).toFixed(2)+' MB';
    $('image-info').textContent=`${file.name} · ${source.bitmap.width} × ${source.bitmap.height}`;
    sync();schedulePreview();scheduleAutosave();if(restored)toast('Photograph and saved edits restored.');
  } catch(error){bitmap?.close();if(version===loadVersion){status(source?'Current image retained':'Ready');toast(error.message);}}
  finally {if(version===loadVersion)busy(false);$('file').value='';}
}
$('open').onclick=$('welcome-open').onclick=()=>$('file').click();
$('file').onchange=()=>loadImage($('file').files[0]);
document.addEventListener('dragover',e=>{if(e.dataTransfer.types.includes('Files')){e.preventDefault();$('stage').classList.add('dragging');}});
document.addEventListener('dragleave',e=>{if(!e.relatedTarget)$('stage').classList.remove('dragging');});
document.addEventListener('drop',e=>{e.preventDefault();$('stage').classList.remove('dragging');if(e.dataTransfer.files.length>1)toast('One photograph at a time in this release. Opening the first file.');loadImage(e.dataTransfer.files[0]);});
$('demo').onclick=async()=>{
  const canvas=document.createElement('canvas');canvas.width=1800;canvas.height=1200;const c=canvas.getContext('2d');
  const sky=c.createLinearGradient(0,0,0,1200);sky.addColorStop(0,'#7394ac');sky.addColorStop(.48,'#e4c89d');sky.addColorStop(1,'#7a9199');c.fillStyle=sky;c.fillRect(0,0,1800,1200);
  const glow=c.createRadialGradient(1240,390,5,1240,390,430);glow.addColorStop(0,'#fff1c7');glow.addColorStop(.12,'#f5deb9cc');glow.addColorStop(1,'#edd2a300');c.fillStyle=glow;c.fillRect(0,0,1800,1200);
  for(const [colour,points] of [['#6b7f86',[[0,720],[260,410],[600,760],[980,320],[1350,770],[1640,510],[1800,700]]],['#475f67',[[0,890],[410,610],[780,890],[1320,640],[1800,850]]],['#293f48',[[0,1050],[440,900],[1020,1050],[1800,900]]]]){c.fillStyle=colour;c.beginPath();c.moveTo(0,1200);for(const [x,y]of points)c.lineTo(x,y);c.lineTo(1800,1200);c.closePath();c.fill();}
  const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));if(blob)loadImage(new File([blob],'generated-landscape-demo.png',{type:'image/png'}));
};

$('undo').onclick=()=>{state=history.undo();comparing=false;sync();schedulePreview();scheduleAutosave();};
$('redo').onclick=()=>{state=history.redo();comparing=false;sync();schedulePreview();scheduleAutosave();};
$('reset').onclick=()=>{state=defaults();comparing=false;exitCrop(false);commit();};
$('rotate').onclick=()=>{exitCrop(false);state.rotation=(state.rotation+90)%360;commit();};
$('flip-x').onclick=()=>{exitCrop(false);state.flipX=!state.flipX;commit();};
$('flip-y').onclick=()=>{exitCrop(false);state.flipY=!state.flipY;commit();};
$('clear-crop').onclick=()=>{exitCrop(false);state.crop=defaults().crop;commit();};
function setComparing(value){if(!source||cropping||exporting)return;comparing=value;sync();schedulePreview();}
$('compare').onclick=()=>setComparing(!comparing);
let spaceHeld=false,previousCompare=false;
document.addEventListener('keydown',e=>{
  const editingText=e.target.tagName==='TEXTAREA'||e.target.isContentEditable||(e.target.tagName==='INPUT'&&e.target.type!=='range');
  if(editingText||$('export-dialog').open)return;
  if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='z'&&!blocked&&!cropping){e.preventDefault();if(e.shiftKey)$('redo').click();else $('undo').click();return;}
  if(['INPUT','SELECT','BUTTON'].includes(e.target.tagName))return;
  if(e.code==='Space'&&source&&!e.repeat){e.preventDefault();spaceHeld=true;previousCompare=comparing;setComparing(true);}
  if(source&&!blocked&&!cropping&&!e.ctrlKey&&!e.metaKey){
    if(e.key.toLowerCase()==='j')$('clipping').click();
    if(e.key.toLowerCase()==='f')resetView();
    if(e.key==='1')changeZoom(1);
    if(e.key==='+'||e.key==='='){e.preventDefault();$('zoom-in').click();}
    if(e.key==='-'){e.preventDefault();$('zoom-out').click();}
    if(e.target.id==='stage'&&['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)){e.preventDefault();const layout=currentLayout();view={mode:'zoom',zoom:layout.scale,panX:layout.panX+(e.key==='ArrowLeft'?40:e.key==='ArrowRight'?-40:0),panY:layout.panY+(e.key==='ArrowUp'?40:e.key==='ArrowDown'?-40:0)};sync();schedulePreview();}
  }
  if(e.key==='Escape'&&cropping)exitCrop();
});
document.addEventListener('keyup',e=>{if(e.code==='Space'&&spaceHeld){e.preventDefault();spaceHeld=false;setComparing(previousCompare);}});
window.addEventListener('blur',()=>{if(spaceHeld){spaceHeld=false;setComparing(previousCompare);}});

function enterCrop(){cropping=true;comparing=false;draftCrop={...state.crop};$('crop-tools').hidden=false;$('crop-overlay').hidden=false;sync();schedulePreview();drawCropSelection();}
function exitCrop(render=true){cropping=false;draftCrop=null;cropStart=null;$('crop-tools').hidden=true;$('crop-overlay').hidden=true;sync();if(render)schedulePreview();}
$('crop-toggle').onclick=()=>cropping?exitCrop():enterCrop();
$('crop-cancel').onclick=()=>exitCrop();
$('crop-apply').onclick=()=>{if(!draftCrop)return;state.crop={...draftCrop};exitCrop(false);commit();};
function drawCropSelection(){if(!cropping||!draftCrop)return;const box=$('crop-selection');box.style.left=draftCrop.x*100+'%';box.style.top=draftCrop.y*100+'%';box.style.width=draftCrop.w*100+'%';box.style.height=draftCrop.h*100+'%';}
let cropStart=null;
function cropPoint(e){const rect=$('crop-overlay').getBoundingClientRect();return {x:clamp((e.clientX-rect.left)/rect.width),y:clamp((e.clientY-rect.top)/rect.height)};}
$('crop-overlay').onpointerdown=e=>{if(!cropping)return;e.preventDefault();cropStart=cropPoint(e);$('crop-overlay').setPointerCapture(e.pointerId);};
$('crop-overlay').onpointermove=e=>{
  if(!cropStart||!source)return;const p=cropPoint(e);let dx=p.x-cropStart.x,dy=p.y-cropStart.y;
  const ratio=Number($('aspect').value);
  if(ratio){const normalizedRatio=ratio*source.bitmap.height/source.bitmap.width;let w=Math.abs(dx),h=Math.abs(dy);if(w/h>normalizedRatio)w=h*normalizedRatio;else h=w/normalizedRatio;dx=(dx<0?-1:1)*w;dy=(dy<0?-1:1)*h;}
  draftCrop={x:Math.min(cropStart.x,cropStart.x+dx),y:Math.min(cropStart.y,cropStart.y+dy),w:Math.abs(dx),h:Math.abs(dy)};drawCropSelection();
};
function finishCrop(e){if(!cropStart)return;cropStart=null;if($('crop-overlay').hasPointerCapture(e.pointerId))$('crop-overlay').releasePointerCapture(e.pointerId);if(!draftCrop||draftCrop.w*source.bitmap.width<2||draftCrop.h*source.bitmap.height<2){draftCrop={...state.crop};drawCropSelection();}}
$('crop-overlay').onpointerup=finishCrop;$('crop-overlay').onpointercancel=finishCrop;

function download(blob,name){const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);}
$('save-recipe').onclick=()=>{if(!source)return;const recipe={application:'dk-pixcell',version:3,source:{name:source.file.name,sha256:source.hash,width:source.bitmap.width,height:source.bitmap.height},state:structuredClone(state)};download(new Blob([JSON.stringify(recipe,null,2)],{type:'application/json'}),basename(source.file.name)+'.pixcell.json');toast('Edit recipe saved. Keep it with the original photograph.');};
$('load-recipe').onclick=()=>$('recipe-file').click();
$('recipe-file').onchange=async()=>{
  const file=$('recipe-file').files[0];const currentSource=source;
  try{if(!file||!source)return;if(file.size>65536)throw new Error('That edit recipe is too large.');const recipe=JSON.parse(await file.text());if(source!==currentSource)throw new Error('The image changed. Load the recipe again.');if(recipe.application!=='dk-pixcell'||![1,2,3].includes(recipe.version))throw new Error('This is not a supported Pixcell recipe.');if(recipe.source?.sha256!==source.hash||recipe.source.width!==source.bitmap.width||recipe.source.height!==source.bitmap.height)throw new Error('Open the exact original photograph used to save these edits first.');state=validateState(recipe.state);comparing=false;exitCrop(false);commit();toast('Edit recipe loaded.');}catch(error){toast(error.message);}finally{$('recipe-file').value='';}
};

function exportDetails(){
  if(!source)return;const size=outputSize(source.bitmap.width,source.bitmap.height,state,Number($('export-size').value));$('export-details').textContent=`${size.width} × ${size.height} pixels · no upscaling`;
  $('quality-label').hidden=$('export-format').value==='image/png';
}
$('export').onclick=()=>{exitCrop(false);comparing=false;sync();schedulePreview();$('export-name').value=basename(source.file.name)+'-edited';$('export-error').textContent='';exportDetails();$('export-dialog').showModal();};
$('close-export').onclick=()=>$('export-dialog').close();
$('export-format').onchange=$('export-size').onchange=exportDetails;
$('quality').oninput=()=>$('quality-value').textContent=$('quality').value+'%';
$('export-dialog').addEventListener('cancel',e=>{if(exporting)e.preventDefault();});
$('export-form').onsubmit=async e=>{
  e.preventDefault();if(!source||exporting)return;
  ++renderVersion;clearTimeout(previewTimer);
  exporting=true;busy(true);sync();$('download').disabled=true;$('close-export').disabled=true;$('export-error').textContent='';$('download').textContent='Preparing full image…';status('Exporting…');
  try {
    const edit=structuredClone(state),mime=$('export-format').value;
    const canvas=geometry(source.bitmap,edit,Number($('export-size').value));const ctx=canvas.getContext('2d');
    const pixels=ctx.getImageData(0,0,canvas.width,canvas.height);const output=await process(pixels.data,edit.adjustments,canvas.width,canvas.height);
    ctx.putImageData(new ImageData(output.data,canvas.width,canvas.height),0,0);
    if(mime==='image/jpeg'){ctx.globalCompositeOperation='destination-over';ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.globalCompositeOperation='source-over';}
    const blob=await new Promise(resolve=>canvas.toBlob(resolve,mime,Number($('quality').value)/100));
    if(!blob)throw new Error('The browser could not encode this image. Try a smaller export.');
    if(blob.type!==mime)throw new Error('Your browser cannot export that format. Choose PNG or JPEG instead.');
    const ext={'image/jpeg':'jpg','image/png':'png','image/webp':'webp'}[mime];
    const name=($('export-name').value.replace(/[<>:"/\\|?*\x00-\x1f]/g,'-').replace(/\.(jpe?g|png|webp)$/i,'').trim()||'photo')+'.'+ext;
    download(blob,name);$('export-dialog').close();toast(`${canvas.width} × ${canvas.height} ${ext.toUpperCase()} downloaded.`);status('Export complete');
  }catch(error){$('export-error').textContent=error.message;status('Export failed');}
  finally{exporting=false;busy(false);sync();$('download').disabled=false;$('close-export').disabled=false;$('download').textContent='Download image';}
};
sync();
checkRecovery();
