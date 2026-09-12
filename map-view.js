/* The atlas is native SVG; map-data.js contains geographic paths and shared-edge adjacency. */
(() => {
  'use strict';
  const NS = 'http://www.w3.org/2000/svg';
  const NUMBER_TOKEN = /[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?|[a-zA-Z]/g;
  const EDGE_PRECISION = 1000;
  const BORDER_TOLERANCE = 1.75;
  const PORTRAIT_SAFE_RADIUS = 30;
  const CENTROID_SAFE_RADIUS = PORTRAIT_SAFE_RADIUS;

  const finite = value => Number.isFinite(Number(value)) ? Number(value) : null;
  const pointFrom = value => {
    if (Array.isArray(value)) {
      const x=finite(value[0]),y=finite(value[1]);
      return x===null||y===null?null:{x,y};
    }
    if (value && typeof value==='object') {
      const x=finite(value.x??value[0]),y=finite(value.y??value[1]);
      return x===null||y===null?null:{x,y};
    }
    return null;
  };
  const samePoint = (a,b,epsilon=1e-6) => !!a&&!!b&&Math.abs(a.x-b.x)<=epsilon&&Math.abs(a.y-b.y)<=epsilon;
  const cleanRing = points => {
    const ring=[];
    (points||[]).forEach(point=>{
      const p=pointFrom(point);if(!p)return;
      if(!ring.length||!samePoint(ring[ring.length-1],p))ring.push(p);
    });
    if(ring.length>1&&samePoint(ring[0],ring[ring.length-1]))ring.pop();
    return ring.length>=3?ring:[];
  };

  // Region paths are currently M/L/Z, but keeping the parser tolerant of the
  // common SVG commands makes the marker layout safe for future naturalized
  // geometry without requiring a geometry package in the browser bundle.
  const parseSvgSubpaths = path => {
    if(typeof path!=='string')return [];
    const tokens=String(path).match(NUMBER_TOKEN)||[];let index=0,command=null;
    let current={x:0,y:0},start=null,active=[];const paths=[];
    const flush=()=>{if(active.length>=2)paths.push(active);active=[];};
    const isCommand=token=>/^[a-zA-Z]$/.test(token);
    const readNumbers=count=>{
      if(index+count>tokens.length||tokens.slice(index,index+count).some(isCommand))return null;
      const values=tokens.slice(index,index+count).map(Number);index+=count;
      return values.every(Number.isFinite)?values:null;
    };
    const absolute=(x,y,relative)=>({x:relative?current.x+x:x,y:relative?current.y+y:y});
    const addCubic=(c1,c2,end)=>{
      const from=current;for(let i=1;i<=6;i++){const t=i/6,u=1-t;active.push({x:u*u*u*from.x+3*u*u*t*c1.x+3*u*t*t*c2.x+t*t*t*end.x,y:u*u*u*from.y+3*u*u*t*c1.y+3*u*t*t*c2.y+t*t*t*end.y});}
      current=end;
    };
    const addQuadratic=(control,end)=>{
      const from=current;for(let i=1;i<=5;i++){const t=i/5,u=1-t;active.push({x:u*u*from.x+2*u*t*control.x+t*t*end.x,y:u*u*from.y+2*u*t*control.y+t*t*end.y});}
      current=end;
    };
    while(index<tokens.length){
      if(isCommand(tokens[index])){
        command=tokens[index++];
        if(command.toUpperCase()==='Z'){
          if(start){if(active.length&&!samePoint(active[active.length-1],start))active.push({...start});flush();current={...start};}
          command=null;start=null;
        }
        continue;
      }
      if(!command){index++;continue;}
      const type=command.toUpperCase(),relative=command===command.toLowerCase();let values;
      if(type==='M'){
        values=readNumbers(2);if(!values){command=null;continue;}
        const next=absolute(values[0],values[1],relative);if(active.length)flush();current=next;start={...next};active=[{...next}];command=relative?'l':'L';continue;
      }
      if(type==='L'){
        values=readNumbers(2);if(!values){command=null;continue;}current=absolute(values[0],values[1],relative);active.push({...current});continue;
      }
      if(type==='H'){
        values=readNumbers(1);if(!values){command=null;continue;}current={x:relative?current.x+values[0]:values[0],y:current.y};active.push({...current});continue;
      }
      if(type==='V'){
        values=readNumbers(1);if(!values){command=null;continue;}current={x:current.x,y:relative?current.y+values[0]:values[0]};active.push({...current});continue;
      }
      if(type==='C'){
        values=readNumbers(6);if(!values){command=null;continue;}
        addCubic(absolute(values[0],values[1],relative),absolute(values[2],values[3],relative),absolute(values[4],values[5],relative));continue;
      }
      if(type==='S'){
        values=readNumbers(4);if(!values){command=null;continue;}
        addCubic(current,absolute(values[0],values[1],relative),absolute(values[2],values[3],relative));continue;
      }
      if(type==='Q'){
        values=readNumbers(4);if(!values){command=null;continue;}
        addQuadratic(absolute(values[0],values[1],relative),absolute(values[2],values[3],relative));continue;
      }
      if(type==='T'){
        values=readNumbers(2);if(!values){command=null;continue;}
        addQuadratic(current,absolute(values[0],values[1],relative));continue;
      }
      if(type==='A'){
        values=readNumbers(7);if(!values){command=null;continue;}
        // An arc's end point is sufficient for the current polygon schema;
        // preserve a little curvature by adding a midpoint on the chord.
        const end=absolute(values[5],values[6],relative);active.push({x:(current.x+end.x)/2,y:(current.y+end.y)/2});current=end;active.push({...current});continue;
      }
      command=null;
    }
    flush();return paths;
  };
  const parseSvgRings = path => parseSvgSubpaths(path).map(cleanRing).filter(ring=>ring.length>=3);
  const normalizeRings = value => {
    if(typeof value==='string')return parseSvgRings(value);
    if(!Array.isArray(value)){
      if(value&&Array.isArray(value.coordinates))return normalizeRings(value.coordinates);
      if(value&&Array.isArray(value.points))return normalizeRings(value.points);
      return [];
    }
    if(value.length>=6&&value.every(item=>finite(item)!==null))return [cleanRing(Array.from({length:value.length/2},(_,i)=>({x:value[i*2],y:value[i*2+1]})))].filter(ring=>ring.length>=3);
    if(value.length&&pointFrom(value[0]))return [cleanRing(value).filter(Boolean)].filter(ring=>ring.length>=3);
    return value.flatMap(item=>normalizeRings(item));
  };
  const regionRings = region => {
    const rings=region?.rings;
    return Array.isArray(rings)&&rings.length?normalizeRings(rings):normalizeRings(region?.geometry?.coordinates||region?.geometry||region?.path);
  };
  const signedRingArea = ring => {
    let area=0;for(let i=0;i<ring.length;i++){const a=ring[i],b=ring[(i+1)%ring.length];area+=a.x*b.y-b.x*a.y;}return area/2;
  };
  const ringCentroid = ring => {
    let crossSum=0,cx=0,cy=0;for(let i=0;i<ring.length;i++){const a=ring[i],b=ring[(i+1)%ring.length],cross=a.x*b.y-b.x*a.y;crossSum+=cross;cx+=(a.x+b.x)*cross;cy+=(a.y+b.y)*cross;}
    if(Math.abs(crossSum)<1e-9)return ring.reduce((p,c)=>({x:p.x+c.x/ring.length,y:p.y+c.y/ring.length}),{x:0,y:0});
    return {x:cx/(3*crossSum),y:cy/(3*crossSum)};
  };
  const pointOnSegment = (point,a,b,epsilon=1e-6) => {
    const dx=b.x-a.x,dy=b.y-a.y,len2=dx*dx+dy*dy;if(len2<epsilon*epsilon)return Math.hypot(point.x-a.x,point.y-a.y)<=epsilon;
    const t=Math.max(0,Math.min(1,((point.x-a.x)*dx+(point.y-a.y)*dy)/len2));return Math.hypot(point.x-(a.x+t*dx),point.y-(a.y+t*dy))<=epsilon;
  };
  const pointInRing = (point,ring) => {
    let inside=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){
      const a=ring[i],b=ring[j];if(pointOnSegment(point,a,b,1e-5))return true;
      const crosses=(a.y>point.y)!==(b.y>point.y)&&point.x<(b.x-a.x)*(point.y-a.y)/(b.y-a.y)+a.x;if(crosses)inside=!inside;
    }return inside;
  };
  const pointInRings = (point,rings) => {
    let inside=false;for(const ring of rings){if(pointInRing(point,ring))inside=!inside;}return inside;
  };
  const ringDepth = (ring,rings,index) => {
    const sample=ring[0];let depth=0;for(let i=0;i<rings.length;i++)if(i!==index&&pointInRing(sample,rings[i]))depth++;return depth;
  };
  const geometryForRegion = region => {
    const rings=regionRings(region);let area=0,cx=0,cy=0;
    rings.forEach((ring,index)=>{const ringArea=Math.abs(signedRingArea(ring)),sign=ringDepth(ring,rings,index)%2?-1:1,centroid=ringCentroid(ring);area+=sign*ringArea;cx+=sign*ringArea*centroid.x;cy+=sign*ringArea*centroid.y;});
    area=Math.max(0,area);const computedArea=area,fallbackArea=finite(region?.area);if(area<1e-6&&fallbackArea!==null&&fallbackArea>0)area=fallbackArea;
    let centroid=computedArea>1e-6?{x:cx/(computedArea||1),y:cy/(computedArea||1)}:pointFrom(region?.pole)||{x:finite(region?.x)??0,y:finite(region?.y)??0};
    const points=rings.flat();const xs=points.map(p=>p.x),ys=points.map(p=>p.y);const bbox=points.length?{minX:Math.min(...xs),minY:Math.min(...ys),maxX:Math.max(...xs),maxY:Math.max(...ys)}:{minX:centroid.x-1,minY:centroid.y-1,maxX:centroid.x+1,maxY:centroid.y+1};
    if(!Number.isFinite(centroid.x)||!Number.isFinite(centroid.y))centroid={x:finite(region?.x)??0,y:finite(region?.y)??0};
    return {rings,area:area||1,centroid,bbox,pole:pointFrom(region?.pole)};
  };
  const pointKey = point => `${Math.round(point.x*EDGE_PRECISION)},${Math.round(point.y*EDGE_PRECISION)}`;
  const edgeKey = (a,b) => {const first=pointKey(a),second=pointKey(b);return first<second?`${first}|${second}`:`${second}|${first}`;};
  const distanceToSegment = (point,a,b) => {
    const dx=b.x-a.x,dy=b.y-a.y,len2=dx*dx+dy*dy;if(len2===0)return Math.hypot(point.x-a.x,point.y-a.y);
    const t=Math.max(0,Math.min(1,((point.x-a.x)*dx+(point.y-a.y)*dy)/len2));return Math.hypot(point.x-(a.x+t*dx),point.y-(a.y+t*dy));
  };
  const pathSegments = path => parseSvgSubpaths(path).flatMap(points=>points.slice(1).map((point,index)=>[points[index],point]));
  const SEGMENT_BUCKET=64;
  const segmentBucketKey = (x,y) => `${Math.floor(x/SEGMENT_BUCKET)},${Math.floor(y/SEGMENT_BUCKET)}`;
  const makeSegmentIndex = segments => {
    const buckets=new Map();segments.forEach(segment=>{
      const [a,b]=segment,minX=Math.min(a.x,b.x),maxX=Math.max(a.x,b.x),minY=Math.min(a.y,b.y),maxY=Math.max(a.y,b.y);
      for(let x=Math.floor(minX/SEGMENT_BUCKET);x<=Math.floor(maxX/SEGMENT_BUCKET);x++)for(let y=Math.floor(minY/SEGMENT_BUCKET);y<=Math.floor(maxY/SEGMENT_BUCKET);y++){const key=segmentBucketKey(x*SEGMENT_BUCKET,y*SEGMENT_BUCKET),bucket=buckets.get(key)||[];bucket.push(segment);buckets.set(key,bucket);}
    });
    const allPoints=segments.flatMap(([a,b])=>[a,b]);
    return {segments,buckets,minX:allPoints.length?Math.min(...allPoints.map(point=>point.x)):0,maxX:allPoints.length?Math.max(...allPoints.map(point=>point.x)):0,minY:allPoints.length?Math.min(...allPoints.map(point=>point.y)):0,maxY:allPoints.length?Math.max(...allPoints.map(point=>point.y)):0};
  };
  const indexedDistance = (point,index,maxDistance=Infinity) => {
    if(!index.segments.length)return Infinity;const bx=Math.floor(point.x/SEGMENT_BUCKET),by=Math.floor(point.y/SEGMENT_BUCKET),seen=new Set();let nearest=Infinity;
    const maxRadius=Number.isFinite(maxDistance)?Math.max(1,Math.ceil(maxDistance/SEGMENT_BUCKET)+1):Math.max(2,Math.ceil(Math.max(index.maxX-point.x,point.x-index.minX,index.maxY-point.y,point.y-index.minY)/SEGMENT_BUCKET)+2);
    for(let radius=0;radius<=maxRadius;radius++){
      for(let dx=-radius;dx<=radius;dx++)for(let dy=-radius;dy<=radius;dy++)if(Math.max(Math.abs(dx),Math.abs(dy))===radius){const bucket=index.buckets.get(segmentBucketKey((bx+dx)*SEGMENT_BUCKET,(by+dy)*SEGMENT_BUCKET))||[];for(const segment of bucket){if(seen.has(segment))continue;seen.add(segment);const distance=distanceToSegment(point,segment[0],segment[1]);if(distance<nearest)nearest=distance;}}
      if(Number.isFinite(nearest)&&nearest<=(radius-1)*SEGMENT_BUCKET)return nearest;
    }
    if(Number.isFinite(maxDistance))return nearest<=maxDistance?nearest:Infinity;
    return Number.isFinite(nearest)?nearest:Math.min(...index.segments.map(([a,b])=>distanceToSegment(point,a,b)));
  };
  const boundaryNearSharedBorder = (edge,sharedIndex) => {
    if(!sharedIndex.segments.length)return false;const [a,b]=edge,mid={x:(a.x+b.x)/2,y:(a.y+b.y)/2};
    return indexedDistance(a,sharedIndex,BORDER_TOLERANCE)<=BORDER_TOLERANCE&&indexedDistance(b,sharedIndex,BORDER_TOLERANCE)<=BORDER_TOLERANCE&&indexedDistance(mid,sharedIndex,BORDER_TOLERANCE)<=BORDER_TOLERANCE;
  };
  const componentBoundary = (component,geometry,map,borderSegments) => {
    const ids=new Set(component),edges=new Map();
    component.forEach(id=>geometry[id].rings.forEach(ring=>{for(let i=0;i<ring.length;i++){const a=ring[i],b=ring[(i+1)%ring.length],key=edgeKey(a,b);const entry=edges.get(key)||{a,b,count:0};entry.count++;edges.set(key,entry);}}));
    const sharedSegments=[];(map.borders||[]).forEach((border,index)=>{const a=Number(border.a),b=Number(border.b);if(ids.has(a)&&ids.has(b))sharedSegments.push(...(borderSegments?.[index]||pathSegments(border.path)));});
    const sharedKeys=new Set(sharedSegments.map(([a,b])=>edgeKey(a,b))),sharedIndex=makeSegmentIndex(sharedSegments);
    let outer=[...edges.values()].filter(edge=>edge.count===1&&!sharedKeys.has(edgeKey(edge.a,edge.b)));
    // Exact canonical edges cover the generated geography. Only invoke the
    // tolerant border check when a shared path has a different segmentation.
    if(sharedSegments.some(([a,b])=>!edges.has(edgeKey(a,b))))outer=outer.filter(edge=>!boundaryNearSharedBorder([edge.a,edge.b],sharedIndex));
    outer=outer.map(edge=>[edge.a,edge.b]);
    return outer.length?outer:[...edges.values()].filter(edge=>edge.count===1).map(edge=>[edge.a,edge.b]);
  };
  const pointInComponent = (point,component,geometry) => component.some(id=>{const bbox=geometry[id].bbox;if(point.x<bbox.minX-1e-6||point.x>bbox.maxX+1e-6||point.y<bbox.minY-1e-6||point.y>bbox.maxY+1e-6)return false;return pointInRings(point,geometry[id].rings);});
  const componentBounds = (component,geometry) => {
    const points=component.flatMap(id=>geometry[id].rings.flat());if(!points.length)return null;
    return {minX:Math.min(...points.map(p=>p.x)),minY:Math.min(...points.map(p=>p.y)),maxX:Math.max(...points.map(p=>p.x)),maxY:Math.max(...points.map(p=>p.y))};
  };
  const distanceToBoundary = (point,boundaryIndex) => boundaryIndex.segments.length?indexedDistance(point,boundaryIndex):0;
  const visualCenter = (component,geometry,map,borderSegments) => {
    const bounds=componentBounds(component,geometry);if(!bounds)return {x:0,y:0,regionId:component[0]};
    const boundary=componentBoundary(component,geometry,map,borderSegments),boundaryIndex=makeSegmentIndex(boundary);let total=0,cx=0,cy=0;
    component.forEach(id=>{const g=geometry[id],weight=Math.max(g.area,1e-6);total+=weight;cx+=g.centroid.x*weight;cy+=g.centroid.y*weight;});
    const aggregate=total?{x:cx/total,y:cy/total}:{x:(bounds.minX+bounds.maxX)/2,y:(bounds.minY+bounds.maxY)/2};
    const centroidClearance=pointInComponent(aggregate,component,geometry)?distanceToBoundary(aggregate,boundaryIndex):0;
    if(pointInComponent(aggregate,component,geometry)&&(centroidClearance>=CENTROID_SAFE_RADIUS||!boundary.length)){
      const regionId=component.find(id=>pointInRings(aggregate,geometry[id].rings))??component[0];return {x:aggregate.x,y:aggregate.y,regionId,clearance:centroidClearance,safeRadius:Math.min(PORTRAIT_SAFE_RADIUS,centroidClearance)};
    }
    let best=null;const consider=point=>{
      if(!point||!Number.isFinite(point.x)||!Number.isFinite(point.y)||!pointInComponent(point,component,geometry))return;
      const clearance=distanceToBoundary(point,boundaryIndex);if(!best||clearance>best.clearance+1e-6||(Math.abs(clearance-best.clearance)<=1e-6&&Math.hypot(point.x-aggregate.x,point.y-aggregate.y)<Math.hypot(best.x-aggregate.x,best.y-aggregate.y)))best={x:point.x,y:point.y,clearance};
    };
    consider(aggregate);consider({x:(bounds.minX+bounds.maxX)/2,y:(bounds.minY+bounds.maxY)/2});
    component.forEach(id=>{consider(geometry[id].centroid);if(geometry[id].pole)consider(geometry[id].pole);});
    const width=Math.max(bounds.maxX-bounds.minX,1),height=Math.max(bounds.maxY-bounds.minY,1);
    const columns=Math.min(21,Math.max(9,Math.ceil(width/24)+1)),rows=Math.min(21,Math.max(9,Math.ceil(height/24)+1));
    for(let iy=0;iy<rows;iy++)for(let ix=0;ix<columns;ix++)consider({x:bounds.minX+(ix+.5)*width/columns,y:bounds.minY+(iy+.5)*height/rows});
    let center=best?{x:best.x,y:best.y}:aggregate,step=Math.max(width,height)/4;
    for(let round=0;round<6;round++){for(const dx of [-step,0,step])for(const dy of [-step,0,step])consider({x:center.x+dx,y:center.y+dy});if(best)center={x:best.x,y:best.y};step/=2;}
    // In a narrow territory the portrait cannot fit completely anywhere.
    // Keep its area center instead of drifting toward a slightly wider end.
    if(best&&best.clearance<PORTRAIT_SAFE_RADIUS&&centroidClearance>=best.clearance*.5&&pointInComponent(aggregate,component,geometry)){
      center=aggregate;best={...aggregate,clearance:centroidClearance};
    }
    const regionId=component.find(id=>pointInRings(center,geometry[id].rings))??component[0];return {x:center.x,y:center.y,regionId,clearance:best?.clearance??0,safeRadius:Math.min(PORTRAIT_SAFE_RADIUS,best?.clearance??0)};
  };
  const connectedComponents = (ids,map,geometry) => {
    const set=new Set(ids),seen=new Set(),components=[];
    const edgeOwners=new Map();ids.forEach(id=>geometry[id].rings.forEach(ring=>{for(let i=0;i<ring.length;i++){const key=edgeKey(ring[i],ring[(i+1)%ring.length]);const owners=edgeOwners.get(key)||[];owners.push(id);edgeOwners.set(key,owners);}}));
    const links=new Map(ids.map(id=>[id,new Set()]));
    ids.forEach(id=>{(map.regions[id]?.neighbors||[]).forEach(neighbor=>{const n=Number(neighbor);if(set.has(n)){links.get(id).add(n);links.get(n).add(id);}});});
    (map.borders||[]).forEach(border=>{const a=Number(border.a),b=Number(border.b);if(set.has(a)&&set.has(b)){links.get(a).add(b);links.get(b).add(a);}});
    edgeOwners.forEach(owners=>{for(let i=1;i<owners.length;i++){links.get(owners[0]).add(owners[i]);links.get(owners[i]).add(owners[0]);}});
    [...ids].sort((a,b)=>a-b).forEach(seed=>{if(seen.has(seed))return;const component=[],queue=[seed];seen.add(seed);while(queue.length){const id=queue.shift();component.push(id);links.get(id).forEach(next=>{if(!seen.has(next)){seen.add(next);queue.push(next);}});}components.push(component.sort((a,b)=>a-b));});
    return components;
  };
  const ownerLayoutKey = state => state.regions.map((region,index)=>`${index}:${region?.owner??'_'}`).join('|');
  const make = (tag, attrs = {}, parent) => {
    const el = document.createElementNS(NS, tag);
    Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, v));
    if (parent) parent.appendChild(el);
    return el;
  };
  class AtlasView {
    constructor(svg, map, factions, onRegion, onFaction) {
      this.svg = svg; this.factions = Object.fromEntries(factions.map(f => [f.id, f]));
      this.onRegion = onRegion; this.onFaction = onFaction; this.selectedRegion = null; this.selectedFaction = null;
      this.mobile=window.innerWidth<=760;this.destroyed=false;this.panHandlers=null;this.insetWrap=null;
      this.handleResize=()=>{const mobile=window.innerWidth<=760;if(mobile!==this.mobile){this.mobile=mobile;this.base=this.defaultView();this.minZoom=this.minimumZoom();this.reset();}else{this.minZoom=this.minimumZoom();this.applyView();}};
      window.addEventListener('resize',this.handleResize);this.svg.setAttribute('preserveAspectRatio','xMinYMin meet');this.bindPan();this.setMap(map);
    }
    defaultView(){
      const requested=this.map?.initialView?.[this.mobile?'mobile':'desktop'];
      if(this.map?.worldMode&&requested)return {x:requested.x,y:requested.y,w:requested.w||requested.width,h:requested.h||requested.height};
      if(requested&&[requested.x,requested.y,requested.w,requested.h].every(Number.isFinite))return {...requested};
      if(this.map?.id==='central')return this.mobile?{x:300,y:-200,w:670,h:1050}:{x:-8,y:-68,w:1360,h:865};
      const width=Number(this.map?.width)||1000,height=Number(this.map?.height)||780;
      if(this.mobile){const h=Math.max(height*1.18,Math.min(height*1.55,width*1.25));const w=Math.max(width*.9,Math.min(width*1.25,h*.84));return {x:(width-w)/2,y:(height-h)/2,w,h};}
      const w=width*1.14,h=height*1.14;return {x:(width-w)/2,y:(height-h)/2,w,h};
    }
    setMap(map){
      if(this.destroyed||!map)return;
      this.map=map;this.regionGeometry=(map.regions||[]).map(geometryForRegion);this.borderSegments=(map.borders||[]).map(border=>pathSegments(border.path));
      this.ownerLayoutCache=new Map();this.ownerLayoutStateKey=null;this.ownerLayoutState=null;this.markerPoints={};this.selectedRegion=null;this.selectedFaction=null;
      if(this.insetWrap){this.insetWrap.remove();this.insetWrap=null;}
      if(this.islandWrap){this.islandWrap.remove();this.islandWrap=null;}
      this.svg.replaceChildren();this.base=this.defaultView();this.minZoom=this.minimumZoom();this.view={...this.base};this.zoom=1;this.drawBase();this.applyView();
    }
    destroy(){
      if(this.destroyed)return;this.destroyed=true;window.removeEventListener('resize',this.handleResize);const h=this.panHandlers;
      if(h){this.svg.removeEventListener('pointerdown',h.down);this.svg.removeEventListener('pointermove',h.move);this.svg.removeEventListener('pointerleave',h.leave);this.svg.removeEventListener('wheel',h.wheel);this.svg.removeEventListener('dblclick',h.dblclick);window.removeEventListener('pointerup',h.end);}
      if(this.insetWrap){this.insetWrap.remove();this.insetWrap=null;}if(this.islandWrap)this.islandWrap.remove();this.svg.replaceChildren();
    }
    drawBase() {
      const {svg, map} = this;
      const defs = make('defs', {}, svg);
      const paper = make('pattern',{id:'paper-grain',width:800,height:800,patternUnits:'userSpaceOnUse'},defs);make('image',{href:'assets/paper.webp',width:800,height:800,opacity:.12},paper);
      const clip = make('clipPath',{id:'land-clip'},defs); make('path',{d:map.playablePath||map.landPath},clip);
      const backgroundClip = make('clipPath',{id:'background-clip'},defs); make('path',{d:map.backgroundPath||map.playablePath||map.landPath},backgroundClip);
      Object.values(this.factions).forEach(f=>{const marker=make('marker',{id:`arrow-${f.id}`,viewBox:'0 0 10 10',refX:8,refY:5,markerWidth:5,markerHeight:5,orient:'auto-start-reverse'},defs);make('path',{d:'M1 1L9 5L1 9Z',fill:f.color},marker);});
      const canvasFrame=map.backgroundBounds&&map.backgroundBounds.width>0&&map.backgroundBounds.height>0?map.backgroundBounds:{x:-1000,y:-1000,width:4000,height:4000};
      make('rect',{x:canvasFrame.x,y:canvasFrame.y,width:canvasFrame.width,height:canvasFrame.height,fill:'#b5d3db'},svg);
      make('rect',{x:canvasFrame.x,y:canvasFrame.y,width:canvasFrame.width,height:canvasFrame.height,fill:'url(#paper-grain)','pointer-events':'none'},svg);
      const backgroundPath=map.backgroundPath||map.playablePath||map.landPath;const playablePath=map.playablePath||map.landPath;
      if(backgroundPath)make('path',{d:backgroundPath,fill:map.backgroundFill||'#d9dccd',stroke:map.backgroundStroke||'#8fa495','stroke-width':1},svg);
      if(map.contextPath){const context=make('path',{d:map.contextPath,fill:map.contextFill||'#c8d0c1',stroke:'#9da994','stroke-width':.8},svg);make('title',{},context).textContent='未设地盘的边缘陆地';}
      // The extent-aligned relief already paints the campaign land.  Keep the
      // fallback wash for the legacy map, while avoiding a second pale fill
      // and stroke that would expose a synthetic rectangular playable frame.
      const landBase={d:playablePath,class:'land-base'};
      if(map.backgroundImage)landBase.style='fill:transparent;stroke:none';
      make('path',landBase,svg);
      // The accepted central map has a bundled raster wash. Campaign maps
      // carry their own real vector land crop and must never reuse that image.
      if(map.backgroundImage||!map.backgroundPath){const imageBounds=map.backgroundImageBounds||{x:0,y:0,width:map.width,height:map.height};make('image',{href:map.backgroundImage||'assets/terrain.webp',x:imageBounds.x,y:imageBounds.y,width:imageBounds.width,height:imageBounds.height,'clip-path':'url(#background-clip)',preserveAspectRatio:'none',opacity:.68,'pointer-events':'none'},svg);}
      if(map.worldMode&&map.chinaBoundaryPath){const chinaClip=make('clipPath',{id:'china-relief-clip'},defs);make('path',{d:map.chinaBoundaryPath},chinaClip);make('image',{href:'assets/maps/world-china-relief.jpg',x:1225,y:150,width:400,height:300,'clip-path':'url(#china-relief-clip)',preserveAspectRatio:'none',opacity:.7,'pointer-events':'none'},svg);}
      const grid=make('g',{'clip-path':'url(#land-clip)'},svg);
      for(let x=0;x<map.width;x+=125)make('path',{d:`M${x} 0V${map.height}`,class:'grid-line'},grid);
      for(let y=0;y<map.height;y+=130)make('path',{d:`M0 ${y}H${map.width}`,class:'grid-line'},grid);
      const terrain=make('g',{'aria-hidden':'true','pointer-events':'none'},svg);
      (map.terrainRelief||[]).forEach(layer=>{if(layer.path)make('path',{d:layer.path,fill:layer.fill||'#70806d',stroke:layer.stroke||'#70806d','stroke-width':layer.strokeWidth||1,opacity:layer.opacity??.12},terrain);});
      (map.waterLines||[]).forEach(line=>{if(line.path)make('path',{d:line.path,fill:'none',stroke:'#83abb5','stroke-width':line.strokeWidth||1.8,'stroke-linecap':'round',opacity:line.opacity??.24},terrain);});
      this.regionGroup=make('g',{id:'regions-layer'},svg);
      this.paths=map.regions.map(r=>{
        const path=make('path',{d:r.path,class:'region','data-region-id':r.id,tabindex:0,role:'button','aria-label':r.name},this.regionGroup);
        path.addEventListener('click',()=>{if(!this.didDrag)this.onRegion(r.id)});
        path.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();this.onRegion(r.id)}});
        const title=make('title',{},path);title.textContent=r.name;return path;
      });

      if(map.worldMode&&map.chinaBoundaryPath){const boundary=make('g',{'aria-hidden':'true','pointer-events':'none',class:'china-geographic-outline'},svg);make('path',{d:map.chinaBoundaryPath,fill:'none',stroke:'#56694a','stroke-width':1.1,'vector-effect':'non-scaling-stroke',opacity:.85},boundary);if(map.chinaJDPath)make('path',{d:map.chinaJDPath,fill:'#56694a',stroke:'#56694a','stroke-width':.25,opacity:.65},boundary);}
      const geography=make('g',{'aria-hidden':'true',class:'physical-labels'},svg);
      (map.barrierPaths||[]).forEach(barrier=>{make('path',{d:barrier.path,fill:'none',stroke:'#71806c','stroke-width':3,'stroke-linecap':'round','stroke-linejoin':'round',opacity:.35},geography);if(barrier.label){const t=make('text',{x:barrier.label[0],y:barrier.label[1]+18,'text-anchor':'middle',class:'mountain-label'},geography);t.textContent=barrier.name;}});
      (map.mountains||[]).forEach(m=>{const text=make('text',{x:m.x,y:m.y+23,'text-anchor':'middle',class:'mountain-label'},geography);text.textContent=m.name;});
      (map.rivers||[]).forEach((r,i)=>{make('path',{d:r.path,class:'river-halo','stroke-width':i<2?5:3},geography);make('path',{d:r.path,class:'river-line',style:`stroke-width:${i<2?2.8:1.5}px`},geography);});
      (map.rivers||[]).slice(0,5).forEach(r=>{if(!r.label)return;const t=make('text',{x:r.label[0],y:r.label[1]-10,class:'river-label'},geography);t.textContent=r.name;});
      const seas=Array.isArray(map.seaLabels)?map.seaLabels:(map.id==='central'?[{name:'黄海',x:1135,y:470,rotation:9},{name:'渤海',x:1140,y:170,rotation:0}]:[]);
      seas.forEach(sea=>{const transform=sea.rotation?`rotate(${sea.rotation} ${sea.x} ${sea.y})`:undefined;const attrs={x:sea.x,y:sea.y,'text-anchor':'middle',class:'atlas-label'};if(transform)attrs.transform=transform;const text=make('text',attrs,geography);text.textContent=sea.name;});
      this.labelGroup=make('g',{'aria-hidden':'true'},svg);
      this.map.regions.forEach(r=>{
        const row=make('g',{'data-label-region':r.id},this.labelGroup);
        make('circle',{cx:r.x,cy:r.y,r:2.8,class:'city-dot'},row);
        const label=make('text',{x:r.x,y:r.y-8,class:'region-label'},row);label.textContent=r.name;
      });
      this.frontGroup=make('g',{'aria-hidden':'true','pointer-events':'none',class:'territory-fronts'},svg);
      this.fronts=(map.borders||[]).map(b=>make('path',{d:b.path,fill:'none',stroke:'#485945','stroke-width':2.3,'stroke-linecap':'round','stroke-linejoin':'round',opacity:.8},this.frontGroup));
      this.effectGroup=make('g',{'aria-hidden':'true'},svg);
      this.flagGroup=make('g',{id:'faction-portraits'},svg);const avatarClip=make('clipPath',{id:'avatar-clip'},defs);make('circle',{cx:0,cy:0,r:27},avatarClip);
      if(map.worldMode){
        this.worldTextGroup=make('g',{'aria-hidden':'true',class:'world-continents'},svg);
        (map.worldLabels||[]).forEach(item=>{const t=make('text',{x:item.x,y:item.y,'text-anchor':'middle'},this.worldTextGroup);t.textContent=item.name;});
        const routes=make('g',{'aria-hidden':'true',class:'sea-routes'},svg);this.routeGroup=routes;
        (map.seaLinks||[]).forEach(link=>{const p=make('path',{d:link.path,fill:'none'},routes);make('title',{},p).textContent=link.label||'跨海航路';});
        this.chinaOverview=make('g',{role:'button',tabindex:0,'aria-label':'查看中国诸侯',class:'china-overview'},svg);
        make('rect',{x:-55,y:-14,width:110,height:34,rx:4},this.chinaOverview);this.chinaOverviewText=make('text',{x:0,y:7,'text-anchor':'middle'},this.chinaOverview);
        const openChina=()=>this.focusArea(map.focusAreas.china);this.chinaOverview.addEventListener('click',openChina);this.chinaOverview.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();openChina();}});
        if(map.chinaInset)this.drawChinaInset(map.chinaInset);
      }else this.chinaOverview=this.worldTextGroup=this.routeGroup=null;
      // Locator uses a separate fixed SVG so it remains readable while panning.
      if(!map.worldMode&&map.inset?.viewBox&&map.inset?.landPath&&map.inset?.range){const insetWrap=document.createElement('div');insetWrap.className='map-locator';insetWrap.setAttribute('aria-label','所示范围定位');const mini=make('svg',{viewBox:map.inset.viewBox,width:150,height:103});make('path',{d:map.inset.landPath,class:'inset-land'},mini);make('rect',{...map.inset.range,class:'inset-range'},mini);insetWrap.appendChild(mini);const text=document.createElement('span');text.textContent=map.inset.label||`${map.bounds[0]}–${map.bounds[2]}°E · ${map.bounds[1]}–${map.bounds[3]}°N`;insetWrap.appendChild(text);svg.parentElement.after(insetWrap);this.insetWrap=insetWrap;}
      const coordinate=make('text',{x:10,y:map.height+22,class:'map-coordinate'},svg);coordinate.textContent=`${map.name||'战场'}  /  ${map.bounds?.[0]}–${map.bounds?.[2]}°E · ${map.bounds?.[1]}–${map.bounds?.[3]}°N`;
    }
    drawChinaInset(data){
      const wrap=document.createElement('details');wrap.className='china-islands';const summary=document.createElement('summary');summary.textContent='中国 · 重要岛屿';wrap.appendChild(summary);
      const panel=document.createElement('div');panel.className='china-island-panel';const title=document.createElement('h3');title.textContent='中国与重要岛屿';panel.appendChild(title);
      const mini=make('svg',{viewBox:data.viewBox||'0 0 1000 600',role:'img','aria-label':'中国地图及台湾、钓鱼岛、赤尾屿、南海诸岛定位'});
      make('path',{d:data.landPath,fill:'#c0cbae',stroke:'#59715b','stroke-width':2},mini);
      if(data.jdPath)make('path',{d:data.jdPath,fill:'#59715b',stroke:'#59715b','stroke-width':1},mini);
      const landLabel=make('text',{x:490,y:210,'text-anchor':'middle','font-size':38,fill:'#37503d'},mini);landLabel.textContent='中国';
      const list=document.createElement('ol');list.className='china-island-legend';
      (data.islands||[]).forEach((island,i)=>{
        make('circle',{cx:island.x,cy:island.y,r:island.r||4,fill:'#914d37',stroke:'#fff6e3','stroke-width':1.5},mini);
        const li=document.createElement('li');li.textContent=island.name;list.appendChild(li);
        if(['台湾岛','钓鱼岛','赤尾屿','海南岛','南沙群岛'].includes(island.name)){
          const positions={'台湾岛':[825,385],'钓鱼岛':[800,270],'赤尾屿':[900,325],'海南岛':[470,410],'南沙群岛':[700,540]};const [x,y]=positions[island.name];
          make('path',{d:`M${island.x} ${island.y}L${x-8} ${y-10}`,stroke:'#775942','stroke-width':1.5,fill:'none'},mini);const t=make('text',{x,y,'font-size':24,fill:'#433e2f'},mini);t.textContent=island.name;
        }
      });
      panel.appendChild(mini);panel.appendChild(list);const note=document.createElement('p');note.textContent='地理位置示意；小岛以点位放大表示。势力色块是游戏控制区。';panel.appendChild(note);wrap.appendChild(panel);this.svg.parentElement.after(wrap);this.islandWrap=wrap;
    }
    bindPan(){
      let drag=null;const down=e=>{if(e.button!==0)return;this.didDrag=false;drag={x:e.clientX,y:e.clientY,v:{...this.view}};};
      const move=e=>{if(!drag)return;const dx=e.clientX-drag.x,dy=e.clientY-drag.y;if(Math.hypot(dx,dy)>5){this.didDrag=true;this.svg.parentElement.classList.add('dragging');const rect=this.svg.getBoundingClientRect();const ratio=Math.min(rect.width/drag.v.w,rect.height/drag.v.h);this.view.x=drag.v.x-dx/ratio;this.view.y=drag.v.y-dy/ratio;this.applyView();}};
      const end=()=>{drag=null;this.svg.parentElement.classList.remove('dragging');};const leave=end;const wheel=e=>{e.preventDefault();this.zoomBy(e.deltaY<0?1.12:1/1.12,{x:e.clientX,y:e.clientY});};const dblclick=()=>this.reset();
      this.panHandlers={down,move,end,leave,wheel,dblclick};this.svg.addEventListener('pointerdown',down);this.svg.addEventListener('pointermove',move);window.addEventListener('pointerup',end);this.svg.addEventListener('pointerleave',leave);this.svg.addEventListener('wheel',wheel,{passive:false});this.svg.addEventListener('dblclick',dblclick);
    }
    visibleSize(view){
      // xMinYMin meet exposes any aspect-ratio surplus on the right/bottom.
      const rect=this.svg.getBoundingClientRect();
      const ratio=rect.width>0&&rect.height>0?rect.width/rect.height:view.w/view.h;
      return {w:Math.max(view.w,view.h*ratio),h:Math.max(view.h,view.w/ratio)};
    }
    minimumZoom(){
      const frame=this.map?.backgroundBounds;if(!frame||!(frame.width>0&&frame.height>0))return .65;
      const visible=this.visibleSize(this.base);
      return Math.max(.65,visible.w/frame.width,visible.h/frame.height);
    }
    applyView(){
      const frame=this.map.backgroundBounds;
      if(frame&&frame.width>0&&frame.height>0){
        let visible=this.visibleSize(this.view);
        const fit=Math.max(1,visible.w/frame.width,visible.h/frame.height);
        if(fit>1){
          const w=this.view.w/fit,h=this.view.h/fit;
          this.view.x+=(this.view.w-w)/2;this.view.y+=(this.view.h-h)/2;
          this.view.w=w;this.view.h=h;this.zoom*=fit;visible=this.visibleSize(this.view);
        }
        const clamp=(value,size,start,extent)=>Math.max(start,Math.min(start+Math.max(0,extent-size),value));
        this.view.x=clamp(this.view.x,visible.w,frame.x,frame.width);
        this.view.y=clamp(this.view.y,visible.h,frame.y,frame.height);
      }else{
        const keepX=Math.min(this.map.width*.3,this.view.w*.3),keepY=Math.min(this.map.height*.3,this.view.h*.3);
        this.view.x=Math.max(-this.view.w+keepX,Math.min(this.map.width-keepX,this.view.x));
        this.view.y=Math.max(-this.view.h+keepY,Math.min(this.map.height-keepY,this.view.y));
      }
      this.svg.setAttribute('viewBox',`${this.view.x} ${this.view.y} ${this.view.w} ${this.view.h}`);
      this.updateWorldDetail();
    }
    zoomBy(factor,anchor=null){
      if(!Number.isFinite(factor)||factor<=0)return;
      const next=Math.max(this.minZoom||.65,Math.min(this.map.worldMode?18:3.5,this.zoom*factor)),actual=next/this.zoom;
      const rect=this.svg.getBoundingClientRect(),pixel=Math.min(rect.width/this.view.w,rect.height/this.view.h)||1;
      const x=anchor?(anchor.x-rect.left)/pixel:this.view.w/2,y=anchor?(anchor.y-rect.top)/pixel:this.view.h/2;
      this.zoom=next;this.view.x+=x*(1-1/actual);this.view.y+=y*(1-1/actual);this.view.w/=actual;this.view.h/=actual;this.applyView();
    }
    focusArea(area){const box=typeof area==='string'?this.map.focusAreas?.[area]:area;if(!box)return;const w=box.w||box.width,h=box.h||box.height;if(!(w>0&&h>0))return;const rect=this.svg.getBoundingClientRect(),ratio=rect.width/rect.height;let targetW=Math.max(w,h*ratio),targetH=Math.max(h,w/ratio);this.view={x:box.x-(targetW-w)/2,y:box.y-(targetH-h)/2,w:targetW,h:targetH};this.zoom=this.base.w/targetW;this.applyView();}
    updateWorldDetail(){
      if(!this.map?.worldMode||!this.flagGroup)return;
      const rect=this.svg.getBoundingClientRect(),pixel=Math.min(rect.width/this.view.w,rect.height/this.view.h)||1,detail=this.zoom>=2.3;
      this.svg.classList.toggle('world-detail',detail);
      const markerPoints=Object.values(this.markerPoints||{}),labelBoxes=[];
      for(const row of this.labelGroup?.children||[]){const r=this.map.regions[Number(row.getAttribute('data-label-region'))],label=row.querySelector('text'),dot=row.querySelector('circle');let visible=detail&&(r.group!=='china'||this.zoom>=6);const box={x:r.x*pixel-r.name.length*5.6/2,y:r.y*pixel-18,w:r.name.length*5.6,h:12};if(visible){visible=!labelBoxes.some(b=>box.x<b.x+b.w+3&&box.x+box.w+3>b.x&&box.y<b.y+b.h+2&&box.y+box.h+2>b.y)&&!markerPoints.some(p=>Math.abs(p.x*pixel-(box.x+box.w/2))<box.w/2+17&&Math.abs(p.y*pixel-(box.y+box.h/2))<22);if(visible)labelBoxes.push(box);}row.style.display=visible?'':'none';label.style.fontSize=`${11/pixel}px`;label.setAttribute('y',r.y-6/pixel);label.style.strokeWidth=`${2/pixel}px`;dot.setAttribute('r',1.6/pixel);}
      for(const marker of this.flagGroup.children){const id=marker.getAttribute('data-faction'),point=this.markerPoints?.[id];if(!point)continue;const isChina=this.map.regions[point.regionId]?.group==='china';marker.style.display=isChina&&!detail?'none':'';const distance=Math.min(...markerPoints.filter(p=>p!==point).map(p=>Math.hypot(p.x-point.x,p.y-point.y)*pixel));const diameter=detail?Math.min(31,Math.max(13,distance*.88)):27;marker.setAttribute('transform',`translate(${point.x} ${point.y}) scale(${diameter/(59*pixel)})`);marker.querySelector('text').style.display=diameter>=24&&distance>=48||this.selectedFaction===id?'':'none';}
      if(this.chinaOverview){this.chinaOverview.style.display=detail?'none':'';this.chinaOverview.setAttribute('transform',`translate(1365 335) scale(${1/pixel})`);}
      if(this.worldTextGroup)this.worldTextGroup.style.display=detail?'none':'';
      if(this.routeGroup)this.routeGroup.style.display=detail?'':'none';
    }
    reset(){this.zoom=Math.max(1,this.minZoom||.65);this.view={...this.base};if(this.zoom>1){const scale=this.zoom;const w=this.base.w/scale,h=this.base.h/scale;this.view.x=this.base.x+(this.base.w-w)/2;this.view.y=this.base.y+(this.base.h-h)/2;this.view.w=w;this.view.h=h;}this.applyView()}
    setSelection(regionId,factionId){this.selectedRegion=regionId;this.selectedFaction=factionId;}
    ownerLayout(state){
      const key=ownerLayoutKey(state);if(this.ownerLayoutStateKey===key&&this.ownerLayoutState)return this.ownerLayoutState;
      const ownedBy=new Map();state.regions.forEach((region,index)=>{if(!region||region.owner==null)return;const ids=ownedBy.get(region.owner)||[];ids.push(index);ownedBy.set(region.owner,ids);});
      const layout={};Object.values(this.factions).forEach(f=>{
        const ids=ownedBy.get(f.id)||[];if(!ids.length)return;
        const factionKey=`${f.id}:${ids.join(',')}`,cached=this.ownerLayoutCache.get(factionKey);if(cached){layout[f.id]=cached;return;}
        const components=connectedComponents(ids,this.map,this.regionGeometry).map(component=>({ids:component,area:component.reduce((sum,id)=>sum+this.regionGeometry[id].area,0)})).sort((a,b)=>b.area-a.area||a.ids[0]-b.ids[0]);
        layout[f.id]=visualCenter(components[0].ids,this.regionGeometry,this.map,this.borderSegments);this.ownerLayoutCache.set(factionKey,layout[f.id]);
      });
      this.ownerLayoutStateKey=key;this.ownerLayoutState=layout;return layout;
    }
    render(state,animate=false){
      this.campaignPhase=state.campaignPhase||'domestic';
      state.regions.forEach((r,i)=>{
        const f=this.factions[r.owner],path=this.paths[i],china=this.map.regions[i].group==='china',foreignMuted=this.map.worldMode&&!china&&this.campaignPhase!=='world';path.setAttribute('fill',f?f.color:'#ddd7c3');path.style.fill=f?f.color:'#ddd7c3';path.setAttribute('fill-opacity',foreignMuted?.13:f?.43:.1);
        path.classList.toggle('selected-region',r.id===this.selectedRegion);path.classList.toggle('owner-highlight',!!this.selectedFaction&&r.owner===this.selectedFaction);path.classList.toggle('dimmed',!!this.selectedFaction&&r.owner!==this.selectedFaction);
        const title=`${this.map.regions[i].name} · ${f?f.name:'中立'} · 兵力 ${Math.round(r.troops)}`;path.setAttribute('aria-label',title);path.firstChild.textContent=title;
      });
      (this.map.borders||[]).forEach((b,i)=>{const a=state.regions[b.a].owner,c=state.regions[b.b].owner;this.fronts[i].style.display=a!==c&&(a||c)?'':'none';});
      this.flagGroup.replaceChildren();
      const layout=this.ownerLayout(state);this.markerPoints={};
      Object.values(this.factions).forEach(f=>{
        const owned=state.regions.filter(r=>r.owner===f.id);if(!owned.length)return;
        const point=layout[f.id]||{x:this.map.regions[owned[0].id].x,y:this.map.regions[owned[0].id].y,regionId:owned[0].id};this.markerPoints[f.id]=point;
        const r=this.map.regions[point.regionId]||this.map.regions[owned[0].id];
        const g=make('g',{class:'army-label',transform:`translate(${point.x} ${point.y})`,role:'button',tabindex:0,'aria-label':`查看${f.name}势力`,'data-faction':f.id,opacity:this.selectedFaction&&this.selectedFaction!==f.id?.65:1},this.flagGroup);
        make('title',{},g).textContent=`${f.name} · ${r.name} · ${owned.length}块领土`;
        make('line',{x1:0,y1:0,x2:0,y2:0,stroke:f.color,'stroke-width':1.5,opacity:.65,'pointer-events':'none'},g);
        make('circle',{cx:0,cy:0,r:29.5,class:'portrait-rim',stroke:f.color},g);
        make('image',{href:(f.portrait||`assets/portraits/${f.id}.webp`)+'?v=20260912-chronicle',x:-27,y:-27,width:54,height:54,'clip-path':'url(#avatar-clip)',preserveAspectRatio:'xMidYMid slice','pointer-events':'none'},g);
        const t=make('text',{x:0,y:47},g);t.textContent=f.name;
        g.addEventListener('click',e=>{e.stopPropagation();if(!this.didDrag)this.onFaction(f.id)});g.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();this.onFaction(f.id)}});
      });
      if(this.chinaOverviewText){const n=new Set(state.regions.filter(r=>r.owner&&this.map.regions[r.id]?.group==='china').map(r=>r.owner)).size;this.chinaOverviewText.textContent=`中国 · ${n} 家势力 ›`;}
      this.updateWorldDetail();
      if(animate){this.effectGroup.replaceChildren();const combats=state.lastEvents.filter(e=>e.type==='battle'||e.type==='capture');combats.slice(-9).forEach(e=>{const a=this.map.regions[e.from],b=this.map.regions[e.to],f=this.factions[e.actor];if(!a||!b||!f)return;const mx=(a.x+b.x)/2,my=(a.y+b.y)/2-14;make('path',{d:`M${a.x} ${a.y}Q${mx} ${my} ${b.x} ${b.y}`,stroke:f.color,class:'battle-arrow','marker-end':`url(#arrow-${f.id})`},this.effectGroup);if(e.type==='capture')make('circle',{cx:b.x,cy:b.y,r:8,stroke:f.color,class:'capture-ring'},this.effectGroup);});state.lastEvents.filter(e=>e.type==='develop').slice(-4).forEach(e=>{const r=this.map.regions[e.to??e.from];if(r){const t=make('text',{x:r.x+18,y:r.y,class:'develop-mark'},this.effectGroup);t.textContent='＋';}});}
    }
    ensureVisible(id){const p=this.markerPoints?.[id];if(!p)return;if(this.map.worldMode&&this.zoom<5&&this.map.regions[p.regionId]?.group==='china')this.focusArea({x:p.x-115,y:p.y-72,w:230,h:144});const v=this.view;if(p.x<v.x+50||p.x>v.x+v.w-50||p.y<v.y+95||p.y>v.y+v.h-65){this.view.x=p.x-v.w/2;this.view.y=p.y-v.h/2;this.applyView();}}
    clearEffects(){this.effectGroup.replaceChildren()}
  }
  window.AtlasView=AtlasView;
})();
