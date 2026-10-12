// Brush coordinates and radii are measured in original image pixels.
export const emptyLayer=()=>({exists:false,visible:true,opacity:100,strokes:[]});
export function validateLayer(value,legacyExists=false){
  if(value===undefined)return {...emptyLayer(),exists:legacyExists};
  if(!value||typeof value.exists!=='boolean'||typeof value.visible!=='boolean'||!Number.isFinite(value.opacity)||value.opacity<0||value.opacity>100||!Array.isArray(value.strokes)||value.strokes.length>2000)throw new Error('Invalid sharpening layer.');
  let count=0;
  const strokes=value.strokes.map(s=>{
    if(!s||!['erase','restore'].includes(s.mode)||!Number.isFinite(s.radius)||s.radius<=0||s.radius>16384||!Number.isFinite(s.softness)||s.softness<0||s.softness>1||!Number.isFinite(s.strength)||s.strength<0||s.strength>1||!Array.isArray(s.points)||!s.points.length||(count+=s.points.length)>100000)throw new Error('Invalid brush mask.');
    const points=s.points.map(p=>{if(!Array.isArray(p)||p.length!==2||p.some(v=>!Number.isFinite(v)||Math.abs(v)>32768))throw new Error('Invalid brush coordinates.');return [...p];});
    return {mode:s.mode,radius:s.radius,softness:s.softness,strength:s.strength,points};
  });
  return {exists:value.exists,visible:value.visible,opacity:value.opacity,strokes};
}
export const transformPoint=(m,x,y)=>[m[0]*x+m[2]*y+m[4],m[1]*x+m[3]*y+m[5]];
export function inversePoint(m,x,y){const d=m[0]*m[3]-m[1]*m[2];if(Math.abs(d)<1e-12)throw new Error('Invalid image transform.');return [(m[3]*(x-m[4])-m[2]*(y-m[5]))/d,(-m[1]*(x-m[4])+m[0]*(y-m[5]))/d];}
export function brushMask(width,height,strokes=[],matrix=[1,0,0,1,0,0]){
  if(!strokes.length)return null;
  const mask=new Float32Array(width*height).fill(1),coverage=new Float32Array(width*height);
  // Inverse coordinates preserve circular source brushes after any rotation/flip/resize.
  for(const stroke of strokes){
    coverage.fill(0);const points=stroke.points.map(p=>transformPoint(matrix,...p));
    const rx=stroke.radius*Math.hypot(matrix[0],matrix[2]),ry=stroke.radius*Math.hypot(matrix[1],matrix[3]);
    for(let n=0;n<points.length;n++){
      const a=points[Math.max(0,n-1)],b=points[n],sa=stroke.points[Math.max(0,n-1)],sb=stroke.points[n];
      const left=Math.max(0,Math.floor(Math.min(a[0],b[0])-rx)),right=Math.min(width-1,Math.ceil(Math.max(a[0],b[0])+rx));
      const top=Math.max(0,Math.floor(Math.min(a[1],b[1])-ry)),bottom=Math.min(height-1,Math.ceil(Math.max(a[1],b[1])+ry));
      const dx=sb[0]-sa[0],dy=sb[1]-sa[1],length=dx*dx+dy*dy;
      for(let y=top;y<=bottom;y++)for(let x=left;x<=right;x++){
        const p=inversePoint(matrix,x+.5,y+.5),t=length?Math.max(0,Math.min(1,((p[0]-sa[0])*dx+(p[1]-sa[1])*dy)/length)):0;
        const d=Math.hypot(p[0]-sa[0]-t*dx,p[1]-sa[1]-t*dy)/stroke.radius;
        const feather=stroke.softness,alpha=d>=1?0:feather===0?1:Math.min(1,(1-d)/feather);
        coverage[y*width+x]=Math.max(coverage[y*width+x],alpha*alpha*(3-2*alpha)*stroke.strength);
      }
    }
    for(let i=0;i<mask.length;i++)mask[i]=stroke.mode==='erase'?mask[i]*(1-coverage[i]):mask[i]+(1-mask[i])*coverage[i];
  }
  return mask;
}
export function selectionPixels(map){const data=new Uint8ClampedArray(map.length*4);for(let i=0;i<map.length;i++){const v=Math.round(255*Math.max(0,Math.min(1,map[i])));data.set([v,v,v,255],i*4);}return data;}
