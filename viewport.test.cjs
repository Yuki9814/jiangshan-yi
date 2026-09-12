'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const context={window:{}};vm.createContext(context);
vm.runInContext(fs.readFileSync(__dirname+'/map-view.js','utf8'),context);
const AtlasView=context.window.AtlasView;
const maps=[...(fs.existsSync(__dirname+'/world-map.js')?[require('./world-map.js')]:[]),...require('./map-catalog.js')];
let checks=0;
for(const map of maps)for(const dimensions of [[1212,784],[972,544],[558,784],[390,600],[320,960]]){
  const view=Object.create(AtlasView.prototype);view.map=map;view.mobile=dimensions[0]<500;
  let viewport={width:dimensions[0],height:dimensions[1]};
  view.svg={getBoundingClientRect:()=>viewport,setAttribute:()=>{}};
  view.base=view.defaultView();view.minZoom=view.minimumZoom();view.zoom=1;view.view={...view.base};
  view.reset();view.zoomBy(.001);
  const verify=()=>{
    const box=view.view,frame=map.backgroundBounds;
    const scale=Math.min(viewport.width/box.w,viewport.height/box.h);
    assert.ok(box.x>=frame.x-1e-7&&box.y>=frame.y-1e-7);
    assert.ok(box.x+viewport.width/scale<=frame.x+frame.width+1e-7,`${map.id} right edge escaped`);
    assert.ok(box.y+viewport.height/scale<=frame.y+frame.height+1e-7,`${map.id} bottom edge escaped`);
    checks++;
  };
  for(const [x,y] of [[-1e6,-1e6],[1e6,-1e6],[-1e6,1e6],[1e6,1e6]]){
    view.view.x=x;view.view.y=y;view.applyView();verify();
  }
  // A same-breakpoint resize can change the visible region without a reset.
  viewport={width:dimensions[1],height:dimensions[0]};view.minZoom=view.minimumZoom();view.applyView();verify();
}
console.log(JSON.stringify({ok:true,maps:maps.length,viewportShapes:5,checks,contract:'All visible SVG corners stay inside the rendered background after min zoom, extreme pan and aspect-ratio change.'}));
