import * as THREE from 'three';
import {microFragmentCells,fragmentsForOwner,microFragmentBounds,fragmentCenter} from './portrait-fragments.mjs?v=20261028-gallery192';
import {ARRIVAL_SECONDS, contributionMotion} from './portrait-arrival.mjs?v=20261029-contribution';
const NS='http://www.w3.org/2000/svg';
export class ContributionGuide {
 constructor(stage,onDismiss=()=>{}){
  this.stage=stage;this.card=document.getElementById('portrait-piece-card');this.box=document.getElementById('portrait-piece-image');
  this.onDismiss=onDismiss;this.pinned=false;
  if(!document.getElementById('portrait-contribution-style')){const link=document.createElement('link');link.id='portrait-contribution-style';link.rel='stylesheet';link.href=new URL('./portrait-contribution.css?v=20261029-contribution',import.meta.url).href;document.head.append(link);}
  this.card.classList.add('portrait-contribution-card');this.card.removeAttribute('aria-hidden');
  this.map=document.createElement('canvas');this.map.width=this.map.height=384;this.map.className='portrait-contribution-map';this.map.setAttribute('role','img');this.map.setAttribute('aria-label','配准后照片上的六个真实贡献位置');this.box.replaceChildren(this.map);
  this.caption=document.createElement('small');this.caption.className='portrait-contribution-caption';this.caption.textContent='配准后照片 · 编号对应大脸';this.card.append(this.caption);
  this.close=document.createElement('button');this.close.type='button';this.close.className='portrait-contribution-close';this.close.textContent='收起定位';this.close.addEventListener('click',()=>{this.clear();this.onDismiss();});this.card.append(this.close);
  this.svg=document.getElementById('portrait-piece-guide');this.vector=new THREE.Vector3();this.pieces=[];
 }
 show({image,slot,head,location,participantId,replay=false}){
  this.clear();if(!image||!head)return;this.head=head;this.pinned=replay;this.participantId=participantId;
  const cells=microFragmentCells(),uv=head.geometry.attributes.uv,position=head.geometry.attributes.position;
  const originals=head.parent.children.filter(o=>o===head||o.isMesh&&o.name.startsWith('Eye'));
  this.svg.replaceChildren();
  const map=this.map.getContext('2d');map.clearRect(0,0,384,384);map.drawImage(image,0,0,384,384);map.fillStyle='#080a0dcc';map.fillRect(0,0,384,384);
  for(const [ordinal,id] of fragmentsForOwner(slot).entries()){
   map.save();map.beginPath();cells[id].forEach(([x,y],i)=>i?map.lineTo(x*384,y*384):map.moveTo(x*384,y*384));map.closePath();map.clip();map.drawImage(image,0,0,384,384);map.restore();map.strokeStyle='#d6c29a';map.lineWidth=2;map.stroke();
   const [cx,cy]=fragmentCenter(id);map.beginPath();map.arc(cx*384,cy*384,21,0,Math.PI*2);map.fillStyle='#17191e';map.fill();map.fillStyle='#f2e8d3';map.font='bold 32px Arial';map.textAlign='center';map.textBaseline='middle';map.fillText(String(ordinal+1),cx*384,cy*384);
  }
  this.pieces=fragmentsForOwner(slot).map((id,ordinal)=>{
   const b=microFragmentBounds(id),cell=cells[id],pixels=document.createElement('canvas');pixels.width=pixels.height=512;
   const ctx=pixels.getContext('2d');ctx.beginPath();cell.forEach(([x,y],i)=>i?ctx.lineTo(x*512,y*512):ctx.moveTo(x*512,y*512));ctx.closePath();ctx.clip();ctx.drawImage(image,0,0,512,512);
   const texture=new THREE.CanvasTexture(pixels);texture.colorSpace=THREE.SRGBColorSpace;
   const travel={value:0},rect={value:new THREE.Vector4()};
   const material=new THREE.MeshBasicMaterial({map:texture,transparent:true,depthTest:false,depthWrite:false,side:THREE.FrontSide,toneMapped:false});
   material.onBeforeCompile=shader=>{
    shader.uniforms.pieceTravel=travel;shader.uniforms.pieceRect=rect;
    shader.uniforms.pieceUV={value:new THREE.Vector4(b.left,1-b.bottom,b.right-b.left,b.bottom-b.top)};
    shader.vertexShader='uniform float pieceTravel;\nuniform vec4 pieceRect;\nuniform vec4 pieceUV;\n'+shader.vertexShader;
    shader.vertexShader=shader.vertexShader.replace('#include <project_vertex>',`#include <project_vertex>
     vec2 localPiece=(uv-pieceUV.xy)/pieceUV.zw;
     vec2 sourceNDC=pieceRect.xy+(localPiece-0.5)*pieceRect.zw;
     gl_Position.xy=mix(sourceNDC*gl_Position.w,gl_Position.xy,pieceTravel);`);
   };
   material.customProgramCacheKey=()=> 'six-fragment-flight-v1';
   const meshes=originals.map(original=>{
    const piece=new THREE.Mesh(original.geometry,material);piece.morphTargetInfluences=original.morphTargetInfluences;
    piece.position.copy(original.position);piece.quaternion.copy(original.quaternion);piece.scale.copy(original.scale);
    piece.frustumCulled=false;piece.renderOrder=10;head.parent.add(piece);return piece;
   });
   const [cx,cy]=fragmentCenter(id);let best=Infinity,vertex=0;
   for(let i=0;i<uv.count;i++){const d=(uv.getX(i)-cx)**2+(uv.getY(i)-(1-cy))**2;if(position.getZ(i)>0&&d<best){best=d;vertex=i;}}
   const line=document.createElementNS(NS,'path'),dot=document.createElementNS(NS,'circle'),number=document.createElementNS(NS,'text');dot.setAttribute('r','8');dot.setAttribute('class','portrait-piece-target');number.setAttribute('class','portrait-piece-number');number.textContent=String(ordinal+1);this.svg.append(line,dot,number);
   return {id,ordinal,b,pixels,texture,material,meshes,travel,rect,vertex,line,dot,number};
  });
  document.getElementById('portrait-piece-title').textContent=replay?'这位观众的六个位置':'六个碎片 · 一张共同的脸';
  document.getElementById('portrait-piece-location').textContent=location;
  this.stage.dataset.contributionFragments=this.pieces.map(p=>p.id).join(',');
 }
 update(arrival,camera,reduced){
  this.stage.dataset.contributionStage=this.pieces.length?(reduced?'still':contributionMotion(arrival.elapsed,{active:arrival.active}).stage):'settled';this.stage.dataset.contributionPinned=String(this.pinned);
  if(!this.pieces.length||(!arrival.active&&!reduced&&!this.pinned)){this.hide();return;}
  this.card.hidden=false;this.svg.removeAttribute('hidden');
  const stage=this.stage.getBoundingClientRect(),r=this.box.getBoundingClientRect();if(stage.width<1||stage.height<1)return;
  this.svg.setAttribute('viewBox',`0 0 ${stage.width} ${stage.height}`);this.head.updateWorldMatrix(true,false);
  const lineOpacity=reduced||this.pinned?1:Math.max(0,Math.min(1,(ARRIVAL_SECONDS-arrival.elapsed)/.8));this.card.style.opacity=String(lineOpacity);
  this.pieces.forEach(p=>{
   // Successive trajectories remain legible; reduced motion shows six static pointers.
   const motion=reduced?{travel:1,opacity:0}:contributionMotion(Math.max(0,arrival.elapsed-p.ordinal*.12),{active:arrival.active});
   p.meshes.forEach(mesh=>mesh.visible=motion.opacity>.001);p.material.opacity=motion.opacity;p.travel.value=motion.travel;
   // Source rectangles use the actual fragment bounds in the aligned photo,
   // rather than a decorative grid that loses the relationship to facial features.
   const w=(p.b.right-p.b.left)*r.width,h=(p.b.bottom-p.b.top)*r.height;
   const x=r.left-stage.left+(p.b.left+p.b.right)/2*r.width,y=r.top-stage.top+(p.b.top+p.b.bottom)/2*r.height;
   p.rect.value.set(x/stage.width*2-1,1-y/stage.height*2,w/stage.width*2,h/stage.height*2);
   this.head.getVertexPosition(p.vertex,this.vector);this.head.localToWorld(this.vector);this.vector.project(camera);
   const tx=(this.vector.x+1)*stage.width/2,ty=(1-this.vector.y)*stage.height/2;
   p.line.setAttribute('d',`M ${x} ${y} C ${x+32} ${y},${tx-20} ${ty},${tx} ${ty}`);
   // Keep the numbered badge beside the target, leaving the small photograph
   // itself unobscured so viewers can inspect what they actually contributed.
   p.dot.setAttribute('cx',tx+11);p.dot.setAttribute('cy',ty-12);p.number.setAttribute('x',tx+11);p.number.setAttribute('y',ty-12);p.number.style.opacity=String(lineOpacity);
   p.line.style.opacity=String(lineOpacity*.45);p.dot.style.opacity=String(lineOpacity);
  });
 }
 hide(){this.card.hidden=true;this.svg.setAttribute('hidden','');this.pieces.forEach(p=>p.meshes.forEach(mesh=>mesh.visible=false));}
 clear(){this.pinned=false;this.participantId=null;this.hide();this.map?.getContext('2d').clearRect(0,0,384,384);for(const p of this.pieces){p.meshes.forEach(m=>m.removeFromParent());p.material.dispose();p.texture.dispose();p.pixels.width=p.pixels.height=1;}this.pieces=[];this.svg.replaceChildren();this.stage.dataset.contributionFragments='';}
 dispose(){this.clear();}
}
