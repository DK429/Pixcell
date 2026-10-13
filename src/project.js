import {validateState} from './engine.js?v=0.5.1';
const encoder=new TextEncoder(),decoder=new TextDecoder('utf-8',{fatal:true});
const MAX_SOURCE=50*1024*1024,MAX_MANIFEST=8*1024*1024;
const table=Uint32Array.from({length:256},(_,i)=>{for(let j=0;j<8;j++)i=(i>>>1)^((i&1)?0xedb88320:0);return i>>>0;});
export function crc32(bytes){let crc=0xffffffff;for(const b of bytes)crc=(crc>>>8)^table[(crc^b)&255];return (crc^0xffffffff)>>>0;}
// ZIP STORE: source JPEG/PNG/WebP is already compressed. No external library,
// recompression or image decoding is needed to preserve the original bytes.
export function zipStore(entries){
  const parts=[],directory=[];let offset=0;
  for(const [name,data] of entries){
    const filename=encoder.encode(name),crc=crc32(data),header=new Uint8Array(30+filename.length),v=new DataView(header.buffer);
    v.setUint32(0,0x04034b50,true);v.setUint16(4,20,true);v.setUint16(6,0x800,true);v.setUint32(14,crc,true);v.setUint32(18,data.length,true);v.setUint32(22,data.length,true);v.setUint16(26,filename.length,true);header.set(filename,30);
    const central=new Uint8Array(46+filename.length),c=new DataView(central.buffer);c.setUint32(0,0x02014b50,true);c.setUint16(4,20,true);c.setUint16(6,20,true);c.setUint16(8,0x800,true);c.setUint32(16,crc,true);c.setUint32(20,data.length,true);c.setUint32(24,data.length,true);c.setUint16(28,filename.length,true);c.setUint32(42,offset,true);central.set(filename,46);
    parts.push(header,data);directory.push(central);offset+=header.length+data.length;
  }
  const end=new Uint8Array(22),e=new DataView(end.buffer),directorySize=directory.reduce((n,v)=>n+v.length,0);
  e.setUint32(0,0x06054b50,true);e.setUint16(8,entries.length,true);e.setUint16(10,entries.length,true);e.setUint32(12,directorySize,true);e.setUint32(16,offset,true);
  return new Blob([...parts,...directory,end],{type:'application/x-pixcell'});
}
export function unzipProject(bytes){
  const fail=()=>{throw new Error('This project is damaged or uses an unsupported archive format.');};
  if(bytes.length<22||bytes.length>MAX_SOURCE+MAX_MANIFEST+4096)fail();
  const v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),end=bytes.length-22;
  if(v.getUint32(end,true)!==0x06054b50||v.getUint16(end+4,true)||v.getUint16(end+6,true)||v.getUint16(end+8,true)!==2||v.getUint16(end+10,true)!==2||v.getUint16(end+20,true))fail();
  let pos=v.getUint32(end+16,true);const start=pos;if(pos+v.getUint32(end+12,true)!==end)fail();
  const entries=new Map();let localEnd=0;
  for(let n=0;n<2;n++){
    if(pos+46>end||v.getUint32(pos,true)!==0x02014b50)fail();
    const len=v.getUint32(pos+24,true),nl=v.getUint16(pos+28,true),extra=v.getUint16(pos+30,true),comment=v.getUint16(pos+32,true),offset=v.getUint32(pos+42,true);
    if(pos+46+nl+extra+comment>end||v.getUint16(pos+10,true)!==0||v.getUint16(pos+8,true)!==0x800||v.getUint32(pos+20,true)!==len||v.getUint16(pos+34,true))fail();
    const name=decoder.decode(bytes.subarray(pos+46,pos+46+nl));
    if(!['project.json','source'].includes(name)||entries.has(name)||len>(name==='source'?MAX_SOURCE:MAX_MANIFEST)||offset!==localEnd||offset+30>start)fail();
    const localName=v.getUint16(offset+26,true),localExtra=v.getUint16(offset+28,true),dataStart=offset+30+localName+localExtra;
    if(v.getUint32(offset,true)!==0x04034b50||v.getUint16(offset+6,true)!==0x800||v.getUint16(offset+8,true)!==0||v.getUint32(offset+18,true)!==len||v.getUint32(offset+22,true)!==len||dataStart+len>start||decoder.decode(bytes.subarray(offset+30,offset+30+localName))!==name)fail();
    const data=bytes.slice(dataStart,dataStart+len),crc=crc32(data);
    if(crc!==v.getUint32(pos+16,true)||crc!==v.getUint32(offset+14,true))fail();
    entries.set(name,data);localEnd=dataStart+len;pos+=46+nl+extra+comment;
  }
  if(pos!==end||localEnd!==start)fail();return entries;
}
export async function saveProject(source,state){
  const manifest={application:'dk-pixcell',format:'project',version:1,source:{name:source.file.name,type:source.mime,sha256:source.hash,width:source.bitmap.width,height:source.bitmap.height},state:validateState(state)};
  const json=encoder.encode(JSON.stringify(manifest));if(json.length>MAX_MANIFEST)throw new Error('The project has too many brush points.');
  return zipStore([['project.json',json],['source',new Uint8Array(await source.file.arrayBuffer())]]);
}
export async function readProject(file){
  if(file.size>MAX_SOURCE+MAX_MANIFEST+4096)throw new Error('This project is too large.');
  const entries=unzipProject(new Uint8Array(await file.arrayBuffer())),m=JSON.parse(decoder.decode(entries.get('project.json')));
  if(m.application!=='dk-pixcell'||m.format!=='project'||m.version!==1)throw new Error('This project version is not supported.');
  if(!m.source||typeof m.source.name!=='string'||m.source.name.length>1024||!['image/jpeg','image/png','image/webp'].includes(m.source.type)||!/^[0-9a-f]{64}$/.test(m.source.sha256)||![m.source.width,m.source.height].every(v=>Number.isInteger(v)&&v>0&&v<=16384)||m.source.width*m.source.height>40000000)throw new Error('Invalid project source.');
  const state=validateState(m.state);
  return {file:new File([entries.get('source')],m.source.name,{type:m.source.type}),state,hash:m.source.sha256,width:m.source.width,height:m.source.height};
}
