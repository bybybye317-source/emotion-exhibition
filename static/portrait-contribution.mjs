import * as THREE from 'three';
import {microFragmentCells,fragmentsForOwner,microFragmentBounds,fragmentCenter} from './portrait-fragments.mjs?v=20261028-gallery192';
import {contributionMotion} from './portrait-arrival.mjs?v=20261028-gallery192';
const NS='http://www.w3.org/2000/svg';
export class ContributionGuide {
 constructor(stage){
  this.stage=stage;this.card=document.getElementById('portrait-piece-card');this.box=document.getElementById('portrait-piece-image');
  this.svg=document.getElementById('portrait-piece-guide');this.vector=new THREE.Vector3();this.pieces=[];
 }
 show({image,slot,head,location,replay=false}){
  this.clear();if(!image||!head)return;this.head=head;
  const cells=microFragmentCells(),uv=head.geometry.attributes.uv,position=head.geometry.attributes.position;
  const originals=head.parent.children.filter(o=>o===head||o.isMesh&&o.name.startsWith('Eye'));
  this.svg.replaceChildren();
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
   const line=document.createElementNS(NS,'path'),dot=document.createElementNS(NS,'circle');dot.setAttribute('r','2.5');this.svg.append(line,dot);
   return {id,ordinal,b,pixels,texture,material,meshes,travel,rect,vertex,line,dot};
  });
  document.getElementById('portrait-piece-title').textContent=replay?'这位观众贡献的 6 片':'你的 6 片，正在融入';
  document.getElementById('portrait-piece-location').textContent=location;
  this.stage.dataset.contributionFragments=this.pieces.map(p=>p.id).join(',');
 }
 update(arrival,camera,reduced){
  this.stage.dataset.contributionStage=this.pieces.length?(reduced?'still':contributionMotion(arrival.elapsed,{active:arrival.active}).stage):'settled';
  if(!this.pieces.length||(!arrival.active&&!reduced)){this.hide();return;}
  this.card.hidden=false;this.svg.removeAttribute('hidden');
  const stage=this.stage.getBoundingClientRect(),r=this.box.getBoundingClientRect();if(stage.width<1||stage.height<1)return;
  this.svg.setAttribute('viewBox',`0 0 ${stage.width} ${stage.height}`);this.head.updateWorldMatrix(true,false);
  const lineOpacity=reduced?1:Math.max(0,Math.min(1,(3.2-arrival.elapsed)/.4));this.card.style.opacity=String(lineOpacity);
  this.pieces.forEach(p=>{
   // Successive trajectories remain legible; reduced motion shows six static pointers.
   const motion=reduced?{travel:0,opacity:1}:contributionMotion(Math.max(0,arrival.elapsed-p.ordinal*.12),{active:arrival.active});
   p.meshes.forEach(mesh=>mesh.visible=motion.opacity>.001);p.material.opacity=motion.opacity;p.travel.value=motion.travel;
   const col=p.ordinal%3,row=Math.floor(p.ordinal/3),cw=r.width/3,ch=r.height/2;
   const ratio=(p.b.right-p.b.left)/(p.b.bottom-p.b.top),w=Math.min(cw*.76,ch*.76*ratio),h=w/ratio;
   const x=r.left-stage.left+cw*(col+.5),y=r.top-stage.top+ch*(row+.5);
   p.rect.value.set(x/stage.width*2-1,1-y/stage.height*2,w/stage.width*2,h/stage.height*2);
   this.head.getVertexPosition(p.vertex,this.vector);this.head.localToWorld(this.vector);this.vector.project(camera);
   const tx=(this.vector.x+1)*stage.width/2,ty=(1-this.vector.y)*stage.height/2;
   p.line.setAttribute('d',`M ${x} ${y} C ${x+32} ${y},${tx-20} ${ty},${tx} ${ty}`);
   p.dot.setAttribute('cx',tx);p.dot.setAttribute('cy',ty);
   p.line.style.opacity=String(lineOpacity*.45);p.dot.style.opacity=String(lineOpacity);
  });
 }
 hide(){this.card.hidden=true;this.svg.setAttribute('hidden','');this.pieces.forEach(p=>p.meshes.forEach(mesh=>mesh.visible=false));}
 clear(){this.hide();for(const p of this.pieces){p.meshes.forEach(m=>m.removeFromParent());p.material.dispose();p.texture.dispose();p.pixels.width=p.pixels.height=1;}this.pieces=[];this.svg.replaceChildren();this.stage.dataset.contributionFragments='';}
 dispose(){this.clear();}
}
