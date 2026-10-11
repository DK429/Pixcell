import {createRequire} from 'node:module';
import {spawn} from 'node:child_process';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url);
const {chromium,firefox,webkit}=require('playwright');
const name=process.env.BROWSER||'chromium';
const launcher={chromium,firefox,webkit}[name];
if(!launcher)throw new Error('Choose chromium, firefox or webkit.');
const server=spawn(process.execPath,['scripts/serve.mjs'],{stdio:['ignore','pipe','pipe'],env:{...process.env,PORT:'4173'}});
const serverErrors=[];server.stderr.on('data',b=>serverErrors.push(b.toString()));
const address=process.env.TEST_BASE_URL||'http://localhost:4173';
for(let i=0;i<50;i++){try{const r=await fetch(address);if(r.ok)break;}catch{}if(i===49){server.kill();throw new Error('Test server did not start: '+serverErrors.join(''));}await new Promise(r=>setTimeout(r,200));}
await mkdir('test-results',{recursive:true});
let browser,page;
const errors=[],checks=[];
const check=(description)=>{checks.push(description);console.log('PASS '+description);};
try {
  browser=await launcher.launch({headless:true});
  const context=await browser.newContext({viewport:{width:1440,height:1000},acceptDownloads:true});
  page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
  const wait=async()=>{await page.waitForFunction(()=>document.getElementById('status').textContent==='All edits applied');await page.waitForTimeout(120);};
  const input=async(id,value)=>{await page.locator(id).evaluate((el,value)=>{el.value=value;el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));},value);await wait();};
  const px=async()=>page.locator('#preview').evaluate(c=>Array.from(c.getContext('2d').getImageData(Math.floor(c.width/2),Math.floor(c.height/2),1,1).data));
  const imageInfo=async download=>{const data=await readFile(await download.path());return page.evaluate(async b64=>{const bytes=Uint8Array.from(atob(b64),x=>x.charCodeAt(0));const bitmap=await createImageBitmap(new Blob([bytes]));const c=document.createElement('canvas');c.width=bitmap.width;c.height=bitmap.height;c.getContext('2d').drawImage(bitmap,0,0);const pixels=c.getContext('2d').getImageData(0,0,c.width,c.height).data;let minimumAlpha=255;for(let i=3;i<pixels.length;i+=4)minimumAlpha=Math.min(minimumAlpha,pixels[i]);return {width:bitmap.width,height:bitmap.height,pixel:Array.from(pixels.slice(0,4)),minimumAlpha,header:Array.from(bytes.slice(0,12))};},data.toString('base64'));};
  async function exportImage(mime,size='0'){
    await page.locator('#export').click();await page.locator('#export-format').selectOption(mime);await page.locator('#export-size').selectOption(size);
    const download=page.waitForEvent('download');await page.locator('#download').click();const result=await download;await page.waitForFunction(()=>!document.getElementById('export-dialog').open);return result;
  }
  await page.goto(address);await page.waitForFunction(()=>!document.getElementById('recovery-status').textContent.includes('Checking'));
  await page.screenshot({path:`test-results/${name}-welcome.png`});
  const fixture=await page.evaluate(()=>{
    const c=document.createElement('canvas');c.width=2000;c.height=1500;const x=c.getContext('2d'),pixels=x.createImageData(c.width,c.height);
    for(let y=0;y<c.height;y++)for(let i=0;i<c.width;i++){const k=(y*c.width+i)*4;pixels.data[k]=i%2?180:100;pixels.data[k+1]=100;pixels.data[k+2]=100;pixels.data[k+3]=i<50?0:255;}
    x.putImageData(pixels,0,0);x.fillStyle='white';x.fillRect(80,80,100,100);x.fillStyle='black';x.fillRect(200,80,100,100);return c.toDataURL('image/png').split(',')[1];
  });
  const fixtureFile={name:'pixel-detail.png',mimeType:'image/png',buffer:Buffer.from(fixture,'base64')};
  await page.locator('#file').setInputFiles(fixtureFile);await wait();assert.equal(await page.locator('#original-size').textContent(),'2000 × 1500');check('PNG import');
  const original=await px();await input('#control-exposure','1');assert.ok((await px())[1]>original[1]);
  await page.locator('#undo').click();await wait();assert.deepEqual(await px(),original);await page.locator('#redo').click();await wait();assert.ok((await px())[1]>original[1]);check('Exposure and undo/redo');
  await page.locator('#compare').click();await page.waitForFunction(()=>document.getElementById('status').textContent.startsWith('Original'));assert.deepEqual(await px(),original);await page.locator('#compare').click();await wait();
  await page.locator('#control-exposure').focus();await page.keyboard.press('Control+z');await wait();assert.equal(await page.locator('#control-exposure').inputValue(),'0');check('Comparison and keyboard undo while a slider is focused');
  await page.locator('#actual-size').click();await wait();
  const detail=await page.locator('#preview').evaluate(c=>{const wrap=document.getElementById('canvas-wrap');return {virtualWidth:parseFloat(wrap.style.width),width:c.width,x:parseInt(c.style.left),pixel:Array.from(c.getContext('2d').getImageData(75,75,1,1).data),stage:document.getElementById('stage').clientWidth};});
  assert.equal(detail.virtualWidth,2000);assert.ok(detail.width<=detail.stage+128);assert.deepEqual(detail.pixel,[(detail.x+75)%2?180:100,100,100,255]);check('100% inspection samples original single-pixel detail in a bounded viewport');
  const stage=await page.locator('#stage').boundingBox();const beforePan=await page.locator('#canvas-wrap').evaluate(el=>parseFloat(el.style.left));
  await page.mouse.move(stage.x+stage.width/2,stage.y+stage.height/2);await page.mouse.down();await page.mouse.move(stage.x+stage.width/2+100,stage.y+stage.height/2+60,{steps:6});await page.mouse.up();await wait();assert.ok(await page.locator('#canvas-wrap').evaluate(el=>parseFloat(el.style.left))>beforePan);check('Pointer panning');
  await page.mouse.wheel(0,-180);await wait();assert.ok(await page.locator('#canvas-wrap').evaluate(el=>parseFloat(el.style.width))>2000);await page.locator('#fit').click();await wait();assert.equal(await page.locator('#zoom').inputValue(),'fit');check('Wheel zoom and Fit reset');
  await page.locator('#clipping').click();await wait();
  const overlay=await page.locator('#preview').evaluate(c=>{const p=c.getContext('2d').getImageData(0,0,c.width,c.height).data;let red=0,blue=0;for(let i=0;i<p.length;i+=4){if(p[i]===255&&p[i+1]===65&&p[i+2]===65)red++;if(p[i]===60&&p[i+1]===110&&p[i+2]===255)blue++;}return {red,blue};});assert.ok(overlay.red>0&&overlay.blue>0);
  const clipExport=await imageInfo(await exportImage('image/png'));assert.equal(clipExport.width,2000);assert.equal(clipExport.height,1500);assert.equal(clipExport.pixel[3],0);check('Clipping overlay and clean full-resolution PNG export with transparency');
  await page.locator('#clipping').click();await wait();
  await page.locator('#crop-toggle').click();await page.waitForFunction(()=>document.getElementById('status').textContent==='Drag a crop region');const rect=await page.locator('#crop-overlay').boundingBox();
  await page.mouse.move(rect.x+rect.width*.1,rect.y+rect.height*.2);await page.mouse.down();await page.mouse.move(rect.x+rect.width*.6,rect.y+rect.height*.7,{steps:10});await page.mouse.up();await page.locator('#crop-apply').click();await wait();assert.equal(await page.locator('#edited-size').textContent(),'1000 × 750');
  await page.locator('#rotate').click();await wait();assert.equal(await page.locator('#edited-size').textContent(),'750 × 1000');
  await input('#straighten','10');const dimensions=await page.locator('#edited-size').textContent();assert.notEqual(dimensions,'750 × 1000');
  const straightened=await imageInfo(await exportImage('image/png'));const [sw,sh]=dimensions.split(' × ').map(Number);assert.equal(straightened.width,sw);assert.equal(straightened.height,sh);assert.equal(straightened.minimumAlpha,255);check('Crop, quarter rotation and straightening export without empty edges');
  const recipeEvent=page.waitForEvent('download');await page.locator('#save-recipe').click();const recipeBytes=await readFile(await(await recipeEvent).path());const recipe=JSON.parse(recipeBytes);assert.equal(recipe.version,2);assert.equal(recipe.state.straighten,10);
  await page.locator('#reset').click();await wait();await page.locator('#recipe-file').setInputFiles({name:'edits.json',mimeType:'application/json',buffer:recipeBytes});await page.waitForFunction(()=>document.getElementById('straighten').value==='10');await wait();check('Recipe round trip retains straightening');
  await page.waitForFunction(()=>document.getElementById('recovery-status').textContent==='Session saved on this device');await page.reload();await page.locator('#resume-session').waitFor({state:'visible'});await page.locator('#resume-session').click();await wait();assert.equal(await page.locator('#image-name').textContent(),'pixel-detail.png');assert.equal(await page.locator('#straighten').inputValue(),'10');assert.equal(await page.locator('#edited-size').textContent(),dimensions);check('Recovery restores the original file and edits after reload');
  await input('#control-shadows','17');await page.reload();await page.locator('#resume-session').waitFor({state:'visible'});await page.locator('#resume-session').click();await wait();assert.equal(await page.locator('#control-shadows').inputValue(),'17');check('Lightweight draft recovers the latest slider edit');
  await page.locator('#reset').click();await wait();
  const legacy={...recipe,version:1,state:{...recipe.state,straighten:undefined}};await page.locator('#recipe-file').setInputFiles({name:'legacy.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(legacy))});await wait();assert.equal(await page.locator('#straighten').inputValue(),'0');check('v0.1 recipe compatibility');
  await page.locator('#reset').click();await wait();
  const jpeg=await imageInfo(await exportImage('image/jpeg'));assert.equal(jpeg.width,2000);assert.equal(jpeg.height,1500);assert.deepEqual(jpeg.pixel,[255,255,255,255]);check('JPEG export fills transparency with white');
  const webpSupported=await page.evaluate(()=>document.createElement('canvas').toDataURL('image/webp').startsWith('data:image/webp'));
  if(webpSupported){const webp=await imageInfo(await exportImage('image/webp','1080'));assert.equal(webp.width,1080);assert.equal(webp.height,810);assert.equal(String.fromCharCode(...webp.header.slice(8,12)),'WEBP');check('WebP encoding and resized export');}
  else{await page.locator('#export').click();await page.locator('#export-format').selectOption('image/webp');await page.locator('#download').click();await page.waitForFunction(()=>document.getElementById('export-error').textContent.includes('cannot export'));await page.locator('#close-export').click();check('Unsupported WebP export reports an error');}
  await page.locator('#file').setInputFiles({name:'camera.dng',mimeType:'application/octet-stream',buffer:Buffer.from('raw')});await page.waitForFunction(()=>document.getElementById('toast').textContent.includes('not supported'));assert.equal(await page.locator('#image-name').textContent(),'pixel-detail.png');check('Unsupported RAW import retains the current image');
  await page.locator('#presets button').filter({hasText:'Landscape'}).click();await wait();await page.screenshot({path:`test-results/${name}-desktop.png`});
  await page.locator('#clear-session').click();await page.waitForFunction(()=>document.getElementById('recovery-status').textContent.includes('cleared'));await page.reload();await page.waitForFunction(()=>!document.getElementById('recovery-status').textContent.includes('Checking'));assert.equal(await page.locator('#recovery-banner').isVisible(),false);check('Clear recovery removes the saved session and disables autosave');
  const mobileContext=await browser.newContext({viewport:{width:390,height:844},isMobile:name!=='firefox',hasTouch:true,acceptDownloads:true});const mobile=await mobileContext.newPage();mobile.on('pageerror',e=>errors.push(e.message));await mobile.goto(address);await mobile.locator('#demo').click();await mobile.waitForFunction(()=>document.getElementById('status').textContent==='All edits applied');
  assert.equal(await mobile.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await mobile.locator('#actual-size').tap();await mobile.waitForFunction(()=>document.getElementById('actual-size').getAttribute('aria-pressed')==='true');await mobile.waitForFunction(()=>document.getElementById('status').textContent==='All edits applied');
  assert.equal(await mobile.locator('#canvas-wrap').evaluate(el=>parseFloat(el.style.width)),1800);await mobile.locator('#fit').tap();await mobile.waitForFunction(()=>document.getElementById('status').textContent==='All edits applied');await mobile.screenshot({path:`test-results/${name}-mobile.png`,fullPage:true});await mobileContext.close();check('390px mobile layout, touch controls and native detail view');
  // A blocked worker or storage implementation must not prevent basic editing.
  const fallback=await browser.newContext({viewport:{width:1440,height:1000}});await fallback.addInitScript(()=>{window.Worker=class{constructor(){throw new Error('Worker blocked');}};Object.defineProperty(window,'indexedDB',{value:undefined});});const fallbackPage=await fallback.newPage();fallbackPage.on('pageerror',e=>errors.push(e.message));await fallbackPage.goto(address);await fallbackPage.locator('#demo').click();await fallbackPage.waitForFunction(()=>document.getElementById('status').textContent==='All edits applied');await fallbackPage.locator('#control-exposure').evaluate(el=>{el.value='1';el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));});await fallbackPage.waitForFunction(()=>document.getElementById('status').textContent==='All edits applied');await fallback.close();check('Editing continues when workers and recovery storage are unavailable');
  assert.deepEqual(errors,[]);check('No uncaught browser errors');
  await writeFile(`test-results/${name}-results.json`,JSON.stringify({browser:name,checks,errors},null,2));
}catch(error){if(page)await page.screenshot({path:`test-results/${name}-failure.png`,fullPage:true}).catch(()=>{});await writeFile(`test-results/${name}-results.json`,JSON.stringify({browser:name,checks,errors,error:error.stack},null,2));throw error;}
finally{await browser?.close();server.kill();}
