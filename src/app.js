import {CONTROLS,PRESETS,defaults,validateState,pixelCrop,outputSize,processPixels,histogram,History,clamp} from './engine.js';

const $=id=>document.getElementById(id);
let source=null, state=defaults(), history=new History(state), comparing=false, cropping=false;
let draftCrop=null, renderVersion=0, loadVersion=0, previewTimer, toastTimer, exporting=false;
let worker=null, jobId=0;
const jobs=new Map();
try {
  worker=new Worker(new URL('./worker.js',import.meta.url),{type:'module'});
  worker.onmessage=({data})=>{const job=jobs.get(data.id);if(!job)return;jobs.delete(data.id);data.error?job.reject(new Error(data.error)):job.resolve({data:new Uint8ClampedArray(data.pixels),bins:data.bins});};
  worker.onerror=()=>{worker?.terminate();worker=null;for(const job of jobs.values())job.reject(new Error('Image processing interrupted. Please try again.'));jobs.clear();};
} catch {worker=null;}

function process(data,adjustments){
  if(!worker){processPixels(data,adjustments);return Promise.resolve({data,bins:histogram(data)});}
  const id=++jobId;
  return new Promise((resolve,reject)=>{jobs.set(id,{resolve,reject});try{worker.postMessage({id,pixels:data.buffer,adjustments},[data.buffer]);}catch(error){jobs.delete(id);reject(error);}});
}
function toast(message){$('toast').textContent=message;$('toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').hidden=true,7000);}
function status(message){$('status').textContent=message;}
function basename(name){return name.replace(/\.[^.]+$/,'');}
function busy(value){$('edit-controls').disabled=value||!source;$('export').disabled=value||!source;$('open').disabled=value;$('file').disabled=value;}
function sync(){
  for(const c of CONTROLS){$('control-'+c.key).value=state.adjustments[c.key];$('value-'+c.key).textContent=formatControl(c,state.adjustments[c.key]);}
  $('undo').disabled=!source||!history.canUndo||exporting||cropping;
  $('redo').disabled=!source||!history.canRedo||exporting||cropping;
  $('compare').disabled=!source||cropping||exporting;
  $('compare').setAttribute('aria-pressed',String(comparing));
  $('crop-toggle').setAttribute('aria-pressed',String(cropping));
  $('flip-x').setAttribute('aria-pressed',String(state.flipX));
  $('flip-y').setAttribute('aria-pressed',String(state.flipY));
  if(source){const size=outputSize(source.bitmap.width,source.bitmap.height,state);$('edited-size').textContent=`${size.width} × ${size.height}`;}
}
function commit(){history.push(state);sync();schedulePreview();}
function formatControl(c,v){return (v>0?'+':'')+(c.key==='exposure'?Number(v).toFixed(2):v)+(c.unit||'');}

for(const [index,c] of CONTROLS.entries()){
  const row=document.createElement('div');row.className='control';
  const heading=document.createElement('div');heading.className='control-heading';
  const label=document.createElement('label');label.htmlFor='control-'+c.key;label.textContent=c.label;
  const value=document.createElement('output');value.id='value-'+c.key;value.htmlFor=label.htmlFor;
  const input=document.createElement('input');input.type='range';input.id=label.htmlFor;input.min=c.min;input.max=c.max;input.step=c.step;input.value=0;
  input.oninput=()=>{state.adjustments[c.key]=Number(input.value);value.textContent=formatControl(c,Number(input.value));schedulePreview();};
  input.onchange=commit;
  input.ondblclick=()=>{state.adjustments[c.key]=0;commit();};
  heading.append(label,value);row.append(heading,input);$(index<6?'light-controls':'colour-controls').append(row);
}
for(const [name,adjustments] of Object.entries(PRESETS)){
  const button=document.createElement('button');button.textContent=name;
  button.onclick=()=>{state.adjustments={...defaults().adjustments,...adjustments};commit();};$('presets').append(button);
}

function geometry(bitmap,edit,maxEdge=0,white=false){
  const crop=pixelCrop(bitmap.width,bitmap.height,edit.crop);
  const size=outputSize(bitmap.width,bitmap.height,edit,maxEdge);
  const canvas=document.createElement('canvas');canvas.width=size.width;canvas.height=size.height;
  const ctx=canvas.getContext('2d',{willReadFrequently:true});if(!ctx)throw new Error('Your browser could not create an image canvas.');
  if(white){ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);}
  const swapped=edit.rotation%180!==0;
  const drawW=swapped?size.height:size.width, drawH=swapped?size.width:size.height;
  ctx.save();ctx.translate(size.width/2,size.height/2);ctx.rotate(edit.rotation*Math.PI/180);ctx.scale(edit.flipX?-1:1,edit.flipY?-1:1);
  ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';
  ctx.drawImage(bitmap,crop.x,crop.y,crop.w,crop.h,-drawW/2,-drawH/2,drawW,drawH);ctx.restore();
  return canvas;
}
function schedulePreview(){++renderVersion;clearTimeout(previewTimer);previewTimer=setTimeout(renderPreview,45);}
async function renderPreview(){
  if(!source)return;
  const version=++renderVersion;
  const edit=structuredClone(state);
  if(cropping){edit.crop=defaults().crop;edit.rotation=0;edit.flipX=false;edit.flipY=false;}
  if(comparing)edit.adjustments=defaults().adjustments;
  status('Updating…');
  try {
    const canvas=geometry(source.bitmap,edit,1600);
    const ctx=canvas.getContext('2d');const pixels=ctx.getImageData(0,0,canvas.width,canvas.height);
    const output=await process(pixels.data,edit.adjustments);
    if(version!==renderVersion)return;
    const preview=$('preview');preview.width=canvas.width;preview.height=canvas.height;
    preview.getContext('2d').putImageData(new ImageData(output.data,canvas.width,canvas.height),0,0);
    $('canvas-wrap').hidden=false;$('welcome').hidden=true;$('before-label').hidden=!comparing;
    fitCanvas();drawHistogram(output.bins);status(cropping?'Drag a crop region':comparing?'Original · same composition':'All edits applied');
  } catch(error){if(version===renderVersion){status('Preview failed');toast(error.message);}}
}
function fitCanvas(){
  const canvas=$('preview');if(!canvas.width)return;
  const rect=$('stage').getBoundingClientRect();const scale=Math.min((rect.width-52)/canvas.width,(rect.height-52)/canvas.height);
  if(scale<=0)return;$('canvas-wrap').style.width=`${canvas.width*scale}px`;$('canvas-wrap').style.height=`${canvas.height*scale}px`;drawCropSelection();
}
new ResizeObserver(fitCanvas).observe($('stage'));
function drawHistogram(bins){
  const canvas=$('histogram'),ctx=canvas.getContext('2d');ctx.clearRect(0,0,canvas.width,canvas.height);
  const max=Math.max(1,...bins.flat());const colours=['#f0a89a','#b9dbad','#9fbbe4'];
  ctx.globalCompositeOperation='screen';
  for(let c=0;c<3;c++){ctx.fillStyle=colours[c]+'55';ctx.strokeStyle=colours[c];ctx.lineWidth=1.4;ctx.beginPath();ctx.moveTo(0,canvas.height);for(let i=0;i<256;i++)ctx.lineTo(i/255*canvas.width,canvas.height-2-Math.log1p(bins[c][i])/Math.log1p(max)*(canvas.height-10));ctx.lineTo(canvas.width,canvas.height);ctx.closePath();ctx.fill();ctx.stroke();}
  ctx.globalCompositeOperation='source-over';
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
async function loadImage(file){
  if(!file||exporting)return;
  const version=++loadVersion;busy(true);status('Opening image…');
  let bitmap;
  try {
    if(file.size>50*1024*1024)throw new Error('Please choose an image smaller than 50 MB for this release.');
    const mime=await sniff(file);
    bitmap=await createImageBitmap(file,{imageOrientation:'from-image'});
    if(bitmap.width*bitmap.height>40_000_000||Math.max(bitmap.width,bitmap.height)>16384)throw new Error('This release supports up to 40 megapixels and 16,384 pixels on either edge.');
    const hash=await digest(file);
    if(version!==loadVersion){bitmap.close();return;}
    renderVersion++;source?.bitmap.close();source={bitmap,file,mime,hash};bitmap=null;
    state=defaults();history=new History(state);comparing=false;exitCrop(false);
    $('image-name').textContent=file.name;$('original-size').textContent=`${source.bitmap.width} × ${source.bitmap.height}`;$('file-size').textContent=(file.size/1024/1024).toFixed(2)+' MB';
    $('image-info').textContent=`${file.name} · ${source.bitmap.width} × ${source.bitmap.height}`;
    sync();schedulePreview();
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

$('undo').onclick=()=>{state=history.undo();comparing=false;sync();schedulePreview();};
$('redo').onclick=()=>{state=history.redo();comparing=false;sync();schedulePreview();};
$('reset').onclick=()=>{state=defaults();comparing=false;exitCrop(false);commit();};
$('rotate').onclick=()=>{exitCrop(false);state.rotation=(state.rotation+90)%360;commit();};
$('flip-x').onclick=()=>{exitCrop(false);state.flipX=!state.flipX;commit();};
$('flip-y').onclick=()=>{exitCrop(false);state.flipY=!state.flipY;commit();};
$('clear-crop').onclick=()=>{exitCrop(false);state.crop=defaults().crop;commit();};
function setComparing(value){if(!source||cropping||exporting)return;comparing=value;sync();schedulePreview();}
$('compare').onclick=()=>setComparing(!comparing);
let spaceHeld=false,previousCompare=false;
document.addEventListener('keydown',e=>{
  if(['INPUT','SELECT','TEXTAREA','BUTTON'].includes(e.target.tagName)||$('export-dialog').open)return;
  if(e.code==='Space'&&source&&!e.repeat){e.preventDefault();spaceHeld=true;previousCompare=comparing;setComparing(true);}
  if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='z'&&!exporting&&!cropping){e.preventDefault();if(e.shiftKey)$('redo').click();else $('undo').click();}
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
$('save-recipe').onclick=()=>{if(!source)return;const recipe={application:'dk-pixcell',version:1,source:{name:source.file.name,sha256:source.hash,width:source.bitmap.width,height:source.bitmap.height},state:structuredClone(state)};download(new Blob([JSON.stringify(recipe,null,2)],{type:'application/json'}),basename(source.file.name)+'.pixcell.json');toast('Edit recipe saved. Keep it with the original photograph.');};
$('load-recipe').onclick=()=>$('recipe-file').click();
$('recipe-file').onchange=async()=>{
  const file=$('recipe-file').files[0];const currentSource=source;
  try{if(!file||!source)return;if(file.size>65536)throw new Error('That edit recipe is too large.');const recipe=JSON.parse(await file.text());if(source!==currentSource)throw new Error('The image changed. Load the recipe again.');if(recipe.application!=='dk-pixcell'||recipe.version!==1)throw new Error('This is not a supported Pixcell recipe.');if(recipe.source?.sha256!==source.hash||recipe.source.width!==source.bitmap.width||recipe.source.height!==source.bitmap.height)throw new Error('Open the exact original photograph used to save these edits first.');state=validateState(recipe.state);comparing=false;exitCrop(false);commit();toast('Edit recipe loaded.');}catch(error){toast(error.message);}finally{$('recipe-file').value='';}
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
  exporting=true;busy(true);sync();$('download').disabled=true;$('close-export').disabled=true;$('export-error').textContent='';$('download').textContent='Preparing full image…';status('Exporting…');
  try {
    const edit=structuredClone(state),mime=$('export-format').value;
    const canvas=geometry(source.bitmap,edit,Number($('export-size').value));const ctx=canvas.getContext('2d');
    const pixels=ctx.getImageData(0,0,canvas.width,canvas.height);const output=await process(pixels.data,edit.adjustments);
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
