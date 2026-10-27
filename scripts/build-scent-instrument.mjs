/**
 * Emotion perfumery — a Figure, built from real solids in millimetre-like units.
 *
 * Parts before geometry (69 solids, with 17 routed feed segments):
 * Base: 4 feet, 2 bevelled deck plates, 1 recessed nameplate (7).
 * Subject: 8 feet, 8 dosing bases, 8 glass barrels, 8 threaded caps (32).
 * Mechanism: 8 valve stands, 8 valve housings with ratio pointers (16).
 * Mixing: manifold, bottom flange, glass vessel, top flange, 4 tie rods (8).
 * Air: filter pedestal, filter body, cap (3).
 * Outlet: neck, collar, nozzle (3).
 * Plumbing: 8 inlet pipes, 8 metered feeds and 1 separate clean-air line.
 * Small features: deck screws, flange bolts, knurls, glass scales and inlays.
 *
 * The glass heights denote recipe proportions, not tank stock. Valve pointers
 * show the active recipe only. Flow and mist are provided-state animations.
 * Rebuild: node scripts/build-scent-instrument.mjs [--audit]
 */
import {writeFileSync, mkdirSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import * as k from './vendor/anatomy/iso-kit.mjs';
import * as G from './vendor/anatomy/lathe.mjs';
import * as A from './vendor/anatomy/audit.mjs';
import {tubePieces, tubeSvg} from './vendor/anatomy/tube.mjs';
import {CHANNELS} from '../static/scent-math.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const W = 1040, H = 570;
const BASE = {x:-280,y:-96,w:560,d:200,r:12};
const P = k.fitProjection([...k.boxCorners(BASE,-20,0), [0,20,197]], W,H,{pad:45,azimuth:82,elevation:32});
const at = p => k.iso(p,P), S=(d,o={})=>k.solidSvg(d,{tone:'mid',...o}), L=(d,o={})=>k.lineSvg(d,o);
const R=A.recorder(P);
const defs=[];
const placements=[[-238,35,135],[-185,17,165],[-132,-1,195],[-79,-19,225],
 [79,-19,315],[132,-1,345],[185,17,15],[238,35,45]];
// Label and color have a single authored source, shared with recipe explanations.
const channels=CHANNELS.map(({key,label,color},index)=>{
 const [x,routeY,inletAngle]=placements[index];
 return {key,label,color,x,y:-65,routeY,inletAngle};
});
const metadata={width:W,height:H,channels:{},chamber:null};
const flowDistances=new Map();
let solidCount=0;

function put(name, center, svg, shape, extra={}) {
  const shapes=shape?[R.solid({...shape,name})]:[];
  if(shape) solidCount++;
  R.put({name,piece:name,at:center,svg,shapes,...extra});
}
function slab(name,plan,z,height,{tone='mid',extra='',ground=false}={}){
  put(name,[plan.x+plan.w/2,plan.y+plan.d/2,z+height/2],S(k.slabOf(plan,z,height,P,8,0.8),{tone})+extra,A.slab(plan,z,height,{ground}));
}
function round(name,x,y,r,z,h,{tone='mid',extra='',className=''}={}){
  const F=G.frameAlong([x,y,0],[0,0,1]);
  const profile=[[z,r],[z+h,r]];
  put(name,[x,y,z+h/2],S(G.solidOf(profile,F,P,{steps:56,bevel:0.5}),{tone,className})+extra,A.solid(F,profile));
}
function screws(x,y,r,z,n=8){
 const F=G.frameAlong([x,y,0],[0,0,1]);
 return k.dotsSvg(G.dotsOf(F,z,r,n,P,{all:true}),{size:0.65,tone:'hi'});
}
function pipe(name,control,r,{key=null,className='',tone='mid'}={}){
  const route=G.fillet(control,12,12,{P,tube:r});
  R.route(name,route,r);
  const chunks=tubePieces(route,r,P,{maxLength:24,caps:true});
  chunks.forEach((chunk,index)=>{
    // pathOf writes one decimal place. Measure that same polyline, so rendered
    // SVG length and phase offsets agree at every depth-sorted chunk boundary.
    const points=chunk.points.map(at).map(p=>p.map(v=>Math.round(v*10)/10));
    const path=k.pathOf(points);
    const length=points.reduce((sum,p,i)=>i?sum+Math.hypot(p[0]-points[i-1][0],p[1]-points[i-1][1]):sum,0);
    const distance=flowDistances.get(key)||0;
    const color=channels.find(channel=>channel.key===key)?.color||'#aec6c9';
    const measures=`data-flow-distance="${distance.toFixed(4)}" data-flow-length="${length.toFixed(4)}"`;
    const flow=key?`<path class="si-flow-track" data-flow-track="${key}" ${measures} d="${path}" fill="none" stroke="${color}" opacity="0"/><path class="si-flow" data-flow="${key}" ${measures} d="${path}" stroke="${color}"/>`:'';
    if(key) flowDistances.set(key,distance+length);
    R.put({name:`${name}:${index}`,piece:name,at:chunk.mid,route:name,chunk:index,shapes:[A.tube(chunk.points,chunk.radii)],svg:`<g class="si-pipe ${className}"${key?` data-channel-pipe="${key}"`:''}>${tubeSvg(chunk,{tone})}${flow}</g>`});
  });
  if(key&&metadata.channels[key]) metadata.channels[key].flowLength=flowDistances.get(key);
  if(key==='purge') metadata.purge={flowLength:flowDistances.get(key)};
  return route;
}
function glass(name,x,y,r,z0,z1,key=null){
 const paths=k.cylinder(x,y,r,z0,z1-z0,P,72);
 const top=at([x,y,z1]),bottom=at([x,y,z0]);
 const radius=k.cameraOf(P).k*r, ry=radius*k.cameraOf(P).sinE;
 const fluidRadius=key?r:r-1.2;
 const interior=key?paths:k.cylinder(x,y,fluidRadius,z0,z1-z0,P,72);
 const innerClip=`<clipPath id="si-clip-${name}"><path d="${interior.fill}"/></clipPath>`;
 defs.push(innerClip);
 const ticks=Array.from({length:11},(_,i)=>{
   const p0=at([x+r*0.75,y+r*0.6614,z0+(z1-z0)*i/10]);
   const p1=[p0[0]+(i%5===0?7:3.5),p0[1]];
   return `<path d="${k.pathOf([p0,p1])}" class="si-scale iso-line"/>`;
 }).join('')+`<path d="${k.segment([x+r*.75,y+r*.6614,z0],[x+r*.75,y+r*.6614,z1],P)}" class="si-scale iso-line"/>`;
 let inner='';
 if(key){
   inner=`<g clip-path="url(#si-clip-${name})"><path data-liquid="${key}" class="si-liquid" d="" fill="currentColor"/><ellipse data-meniscus="${key}" cx="${bottom[0]}" cy="${bottom[1]}" rx="${radius}" ry="${ry}" fill="currentColor" class="si-meniscus"/></g>`;
   metadata.channels[key]={x:bottom[0],bottom:bottom[1],top:top[1],rx:radius,ry,fillHeight:bottom[1]-top[1]};
 } else {
   const fluidRx=k.cameraOf(P).k*fluidRadius,fluidRy=fluidRx*k.cameraOf(P).sinE;
   const inletPoints={};
   const inlets=channels.map(channel=>{
     // The manifold feeds hidden passages in the bottom flange. Each visible
     // stream starts flush on that floor, never at a floating point in glass.
     const angle=channel.inletAngle*Math.PI/180;
     const ix=x+Math.cos(angle)*fluidRadius*.62;
     const iy=y+Math.sin(angle)*fluidRadius*.62;
     const point=at([ix,iy,z0]);
     const tip=at([ix,iy,z0+8]);
     inletPoints[channel.key]={x:point[0],y:point[1],tipX:tip[0],tipY:tip[1]};
     return `<path class="si-chamber-inlet" data-chamber-inlet="${channel.key}" d="${k.pathOf([point,tip])}" fill="none" stroke="${channel.color}" opacity="0"/>`;
   }).join('');
   const clouds=channels.map(channel=>{
     const point=inletPoints[channel.key];
     return `<ellipse class="si-chamber-cloud" data-chamber-cloud="${channel.key}" cx="${point.x}" cy="${point.y}" rx="0" ry="0" fill="${channel.color}" opacity="0"/>`;
   }).join('');
   const ribbons=channels.map(channel=>`<path class="si-chamber-ribbon" data-chamber-ribbon="${channel.key}" d="" fill="none" stroke="${channel.color}" opacity="0"/>`).join('');
   const curves=Array.from({length:4},(_,i)=>{
     const points=Array.from({length:85},(_,j)=>{
       const t=j/84, angle=t*Math.PI*3.3+i*Math.PI/2;
       return at([x+Math.cos(angle)*r*0.74,y+Math.sin(angle)*r*0.74,z0+8+t*(z1-z0-16)]);
     });
     return `<path class="si-vortex" data-vortex="${i}" d="${k.pathOf(points)}" pathLength="100"/>`;
   }).join('');
   inner=`<g clip-path="url(#si-clip-${name})" aria-hidden="true"><path class="si-chamber-light" d="${interior.fill}"/><path class="si-chamber-fill" data-chamber-fill d="" fill="#c8b693" opacity="0"/>${clouds}${inlets}${ribbons}<ellipse class="si-chamber-surface" data-chamber-surface cx="${bottom[0]}" cy="${bottom[1]}" rx="${fluidRx}" ry="${fluidRy}" fill="#c8b693" opacity="0"/>${curves}</g>`;
   metadata.chamber={x:bottom[0],y:bottom[1],bottom:bottom[1],top:top[1],rx:fluidRx,ry:fluidRy,fillHeight:bottom[1]-top[1],inletPoints};
 }
 const svg=`<g class="si-glass"${key?` data-vial="${key}" style="color:${channels.find(c=>c.key===key).color}"`:''}><path class="si-glass-back" d="${paths.fill}"/>${inner}<path class="si-glass-surface" d="${paths.fill}"/><path class="si-glass-edge" d="${paths.outline}"/><path class="si-glass-rim" d="${k.ring(x,y,r,z0,P,72)+k.ring(x,y,r,z1,P,72)}"/>${ticks}<path class="si-glass-reflection" d="${k.segment([x-r*.66,y+r*.20,z0+3],[x-r*.66,y+r*.20,z1-3],P)}"/></g>`;
 put(name,[x,y,(z0+z1)/2],svg,A.ring(G.frameAlong([x,y,0],[0,0,1]),z0,z1,r-0.8,r));
}

// Deck: feet support the lower plate; the upper plate is a flush inset.
for(const [i,[x,y]] of k.corners(BASE,28).entries()) round(`stand.foot.${i}`,x,y,11,-20,7,{tone:'lo'});
slab('stand.lower',BASE,-13,10,{tone:'lo',ground:true});
slab('stand.deck',k.insetPlan(BASE,2),-3,3,{tone:'mid',extra:L(k.planOutline(k.insetPlan(BASE,9),0,P),{tone:'lo'})+k.dotsSvg(k.corners(BASE,15).map(([x,y])=>at([x,y,0])),{size:1,tone:'hi'})});
const plaque={x:-42,y:76,w:84,d:16,r:2};
slab('deck.plaque',plaque,0,0.8,{tone:'lo',extra:k.faceTextSvg(k.topMatrix([0,86],0.9,P),'AFFECT / ATELIER',{size:3.6,tone:'hi',anchor:'middle'})});
// Closed vent slots resolve on the deck, along the rear cooling rail.
const vents=Array.from({length:25},(_,i)=>k.planOutline({x:-65+i*5,y:-88,w:2,d:10,r:1},0.1,P,4)).join('');
R.items.find(item=>item.name==='stand.deck').svg += L(vents,{tone:'faint'});

// One common grounded manifold; all eight pipes terminate on its side faces.
slab('mixer.manifold',{x:-40,y:-42,w:80,d:96,r:3},0,35,{tone:'mid'});
round('mixer.bottom',0,8,36,35,7,{tone:'hi',extra:screws(0,8,32,42,12)});
glass('mixer.glass',0,8,30,42,144);
round('mixer.top',0,8,36,144,7,{tone:'hi',extra:screws(0,8,32,151,12)});
// Thin external tie rods meet the two flanges, clear of the glass.
for(const [i,angle] of [45,135,225,315].entries()){
 const a=angle*Math.PI/180,x=Math.cos(a)*33,y=8+Math.sin(a)*33;
 round(`mixer.tie.${i}`,x,y,1.6,42,102,{tone:'lo'});
}

for(const [index,c] of channels.entries()){
 const {x,y,key,label}=c;
 round(`${key}.foot`,x,y,20,0,7,{tone:'lo',extra:screws(x,y,17,7,6)});
 round(`${key}.dosing-base`,x,y,17,7,25,{tone:'mid',extra:L(k.sideArc(x,y,17,15,P,36),{tone:'lo'})});
 glass(`${key}.glass`,x,y,15.5,32,116,key);
 round(`${key}.lid`,x,y,17.5,116,7,{tone:'hi',extra:L(k.knurl(x,y,17.5,117,122,36,P),{tone:'lo'})});
 const cap=at([x,y,123]);
 const labelAt=at([x,y,139]);
 const meta=metadata.channels[key];
 Object.assign(meta,{label,labelX:labelAt[0],labelY:labelAt[1],color:c.color});
 // Labels live on accessible transparent controls, outside mechanical surfaces.
 const labelMarkup=`<g class="si-reservoir-button" data-ingredient="${key}" role="button" tabindex="0" aria-label="${label}，查看原料和情绪原因" aria-pressed="false"><rect class="si-hit" x="${cap[0]-29}" y="${labelAt[1]-21}" width="58" height="${meta.bottom-labelAt[1]+33}" rx="10"/><rect class="si-label-bg" x="${labelAt[0]-27}" y="${labelAt[1]-18}" width="54" height="39" rx="3"/><text class="si-label" x="${labelAt[0]}" y="${labelAt[1]-3}" text-anchor="middle">${label}</text><text class="si-percent" data-percent="${key}" x="${labelAt[0]}" y="${labelAt[1]+13}" text-anchor="middle">—</text><path class="si-pending-mark" data-pending="${key}" d="M${labelAt[0]-21} ${labelAt[1]+24}H${labelAt[0]+21}"/></g>`;
 meta.labelMarkup=labelMarkup;
 // Valve at the first vertical leg, seated on the deck. Pointer is ratio only.
 const vy=c.routeY;
 const valveX=x;
 round(`${key}.valve-foot`,valveX,vy,8,0,20,{tone:'lo'});
 const pivot=at([valveX,vy,30]);
 meta.valve={x:pivot[0],y:pivot[1],rx:6*k.cameraOf(P).k,ry:6*k.cameraOf(P).k*k.cameraOf(P).sinE};
 const vp=L(k.radialTicks(valveX,vy,6.5,24,6,30,[1,2],P).minor,{tone:'lo'})+`<path data-valve="${key}" class="si-valve-pointer" d="M${pivot[0]} ${pivot[1]}l-5 0"/>`;
 // pointer and ticks are surface decoration, not a second intersecting solid.
 round(`${key}.valve`,valveX,vy,8,20,10,{tone:'mid',extra:vp});
 // Inlet ends at the rear face of the valve; outlet begins at its inner face.
 pipe(`${key}.inlet`,[[x,-48,18],[x,vy-8,18]],1.4,{key});
 pipe(`${key}.feed`,[[x+(x<0?8:-8),vy,25],[(x<0?-40:40),vy,25]],1.4,{key});
}

// Clean-air intake is isolated behind the central manifold, not a ninth scent.
round('clean.foot',0,-72,12,0,8,{tone:'lo'});
round('clean.filter',0,-72,9,8,39,{tone:'mid',extra:L([14,19,24,29,34,39].map(z=>k.sideArc(0,-72,9,z,P,24)).join(''),{tone:'lo'})});
round('clean.cap',0,-72,11,47,4,{tone:'mid'});
pipe('clean.feed',[[0,-63,23],[0,-42,23]],1.5,{key:'purge',className:'si-purge'});

// Outlet is coaxial with the chamber: no apparent pipe penetrations.
round('outlet.neck',0,8,9,151,14,{tone:'mid'});
round('outlet.collar',0,8,13,165,4,{tone:'hi',extra:L(k.knurl(0,8,13,165,169,36,P),{tone:'lo'})});
round('outlet.head',0,8,10.5,169,5,{tone:'hi'});
const outlet=at([0,8,174]);
const aperture=k.ring(0,8,6.5,174.1,P,40);
R.items.find(item=>item.name==='outlet.head').svg += `<path class="si-aperture" d="${aperture}"/><path data-outlet-ring class="si-outlet-ring" d="${aperture}"/>`;
metadata.outlet={x:outlet[0],y:outlet[1]};

// Geometry-derived order. Decorations without volume ride their mounting face.
console.log(`scent instrument: ${solidCount} solids, ${R.routes.length} routed feeds; settling geometry…`);
A.settle(R,P,{step:0.65});
const groups=R.items.sort((a,b)=>a.key-b.key).map(item=>`<g data-part="${item.name}">${item.svg}</g>`).join('');
const mist=Array.from({length:7},(_,i)=>`<ellipse class="si-mist" data-mist="${i}" cx="${outlet[0]}" cy="${outlet[1]}" rx="1" ry="1"/>`).join('');
const svg=`<svg xmlns="http://www.w3.org/2000/svg" class="si-svg" viewBox="0 0 ${W} ${H}" role="group" aria-label="情绪调香仪：八种原料经计量阀汇入中央混合舱"><defs><linearGradient id="si-glass-sheen" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#d7e0e0" stop-opacity=".12"/><stop offset=".16" stop-color="#dce5df" stop-opacity=".02"/><stop offset=".48" stop-color="#dce5df" stop-opacity=".015"/><stop offset=".76" stop-color="#edf0e4" stop-opacity=".10"/><stop offset="1" stop-color="#d7e0e0" stop-opacity=".03"/></linearGradient><radialGradient id="si-chamber-glow"><stop stop-color="#c8b693" stop-opacity=".16"/><stop offset="1" stop-color="#c8b693" stop-opacity="0"/></radialGradient><filter id="si-soft"><feGaussianBlur stdDeviation="3.6"/></filter>${defs.join('')}</defs><path class="si-shadow" d="${k.haloOf(BASE,-20,20,P)}"/>${groups}<g class="si-mist-layer" aria-hidden="true">${mist}</g><g class="si-labels">${channels.map(c=>metadata.channels[c.key].labelMarkup).join('')}</g></svg>`;
for(const data of Object.values(metadata.channels)) delete data.labelMarkup;
mkdirSync(resolve(ROOT,'static/generated'),{recursive:true});
writeFileSync(resolve(ROOT,'static/generated/scent-instrument-art.mjs'),`// Generated by scripts/build-scent-instrument.mjs; do not edit.\nexport const ART = ${JSON.stringify(svg)};\nexport const GEOMETRY = ${JSON.stringify(metadata)};\n`);
writeFileSync(resolve(ROOT,'static/generated/scent-instrument.svg'),svg);
console.log(`wrote scent instrument: ${(svg.length/1024).toFixed(0)} KB, ${R.items.length} depth-sorted items`);
A.auditOrExit(R,P);
