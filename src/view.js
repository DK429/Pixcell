import {clamp} from './engine.js?v=0.4.0';

export function viewLayout(image,width,height,view,padding=26) {
  const availableWidth=Math.max(1,width-padding*2),availableHeight=Math.max(1,height-padding*2);
  const scale=view.mode==='fit'?Math.min(1,availableWidth/image.width,availableHeight/image.height):clamp(view.zoom,.1,4);
  const fullWidth=image.width*scale,fullHeight=image.height*scale;
  const maxX=Math.max(0,(fullWidth-availableWidth)/2),maxY=Math.max(0,(fullHeight-availableHeight)/2);
  const panX=view.mode==='fit'?0:clamp(view.panX,-maxX,maxX),panY=view.mode==='fit'?0:clamp(view.panY,-maxY,maxY);
  const left=(width-fullWidth)/2+panX,top=(height-fullHeight)/2+panY;
  const x=Math.max(0,Math.floor(-left-64)),y=Math.max(0,Math.floor(-top-64));
  const endX=Math.min(fullWidth,Math.ceil(width-left+64)),endY=Math.min(fullHeight,Math.ceil(height-top+64));
  return {scale,fullWidth,fullHeight,left,top,panX,panY,x,y,width:Math.max(1,Math.ceil(endX-x)),height:Math.max(1,Math.ceil(endY-y))};
}

export function zoomAt(layout,width,height,newZoom,point={x:width/2,y:height/2}) {
  const zoom=clamp(newZoom,.1,4);
  const nativeX=(point.x-layout.left)/layout.scale,nativeY=(point.y-layout.top)/layout.scale;
  const imageWidth=layout.fullWidth/layout.scale,imageHeight=layout.fullHeight/layout.scale;
  return {mode:'zoom',zoom,panX:point.x-width/2-(nativeX-imageWidth/2)*zoom,panY:point.y-height/2-(nativeY-imageHeight/2)*zoom};
}
