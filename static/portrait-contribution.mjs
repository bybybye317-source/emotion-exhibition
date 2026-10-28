import * as THREE from 'three';
import {anatomicalFragmentCells,fragmentBounds} from './portrait-regions.mjs?v=20261028-real';
import {contributionMotion} from './portrait-arrival.mjs?v=20261028-real';
export class ContributionGuide {
 constructor(stage){
  this.stage=stage;this.card=document.getElementById('portrait-piece-card');
  this.box=document.getElementById('portrait-piece-image');this.line=document.getElementById('portrait-piece-line');
  this.dot=document.getElementById('portrait-piece-dot');this.svg=document.getElementById('portrait-piece-guide');
  this.travel={value:0};this.rect={value:new THREE.Vector4()};this.vector=new THREE.Vector3();
 }
 show({image,slot,head,location,replay=false}){
  this.clear();this.slot=slot;this.head=head;
  const cell=anatomicalFragmentCells()[slot],b=fragmentBounds(slot);if(!image||!cell||!head)return;
  this.bounds=b;
  const pixels=document.createElement('canvas');pixels.width=pixels.height=1024;
  const ctx=pixels.getContext('2d');ctx.beginPath();cell.forEach(([x,y],i)=>i?ctx.lineTo(x*1024,y*1024):ctx.moveTo(x*1024,y*1024));ctx.closePath();ctx.clip();ctx.drawImage(image,0,0,1024,1024);
  this.pixels=pixels;this.texture=new THREE.CanvasTexture(pixels);this.texture.colorSpace=THREE.SRGBColorSpace;
  const material=new THREE.MeshBasicMaterial({map:this.texture,transparent:true,depthTest:false,depthWrite:false,side:THREE.FrontSide,toneMapped:false});
  material.onBeforeCompile=shader=>{
   shader.uniforms.pieceTravel=this.travel;shader.uniforms.pieceRect=this.rect;
   shader.uniforms.pieceUV={value:new THREE.Vector4(b.left,1-b.bottom,b.right-b.left,b.bottom-b.top)};
   shader.vertexShader='uniform float pieceTravel;\nuniform vec4 pieceRect;\nuniform vec4 pieceUV;\n'+shader.vertexShader;
   shader.vertexShader=shader.vertexShader.replace('#include <project_vertex>',`#include <project_vertex>
    vec2 localPiece=(uv-pieceUV.xy)/pieceUV.zw;
    vec2 sourceNDC=pieceRect.xy+(localPiece-0.5)*pieceRect.zw;
    gl_Position.xy=mix(sourceNDC*gl_Position.w,gl_Position.xy,pieceTravel);`);
  };
  material.customProgramCacheKey=()=> 'contribution-flight-v1';
  const originals=head.parent.children.filter(o=>o===head||o.isMesh&&o.name.startsWith('Eye'));
  this.meshes=originals.map(original=>{
    const piece=new THREE.Mesh(original.geometry,material);piece.morphTargetInfluences=original.morphTargetInfluences;
    piece.position.copy(original.position);piece.quaternion.copy(original.quaternion);piece.scale.copy(original.scale);
    piece.frustumCulled=false;piece.renderOrder=10;head.parent.add(piece);return piece;
  });this.mesh=this.meshes[0];
  const uv=head.geometry.attributes.uv,position=head.geometry.attributes.position;
  const cx=(b.left+b.right)/2,cy=1-(b.top+b.bottom)/2;let best=Infinity;
  for(let i=0;i<uv.count;i++){
   const distance=(uv.getX(i)-cx)**2+(uv.getY(i)-cy)**2;
   if(position.getZ(i)>0&&distance<best){best=distance;this.vertex=i;}
  }
  document.getElementById('portrait-piece-title').textContent=replay?'正在定位这位观众':'这是你贡献的片段';
  document.getElementById('portrait-piece-location').textContent=location;
 }
 update(arrival,camera,reduced){
  const motion=reduced?{travel:0,opacity:1,line:1,stage:'still'}:contributionMotion(arrival.elapsed,{active:arrival.active});
  this.stage.dataset.contributionStage=this.mesh?motion.stage:'settled';
  if(!this.mesh||(!arrival.active&&!reduced)){this.hide();return;}
  const show=motion.opacity>.001;this.card.hidden=false;this.svg.toggleAttribute('hidden',motion.line<=.001);
  this.meshes.forEach(mesh=>mesh.visible=show);this.mesh.material.opacity=motion.opacity;this.travel.value=motion.travel;
  this.card.style.opacity=String(motion.line);
  const stage=this.stage.getBoundingClientRect(),r=this.box.getBoundingClientRect();
  if(stage.width<1||stage.height<1)return;
  const ratio=(this.bounds.right-this.bounds.left)/(this.bounds.bottom-this.bounds.top);
  const w=Math.min(r.width,r.height*ratio),h=w/ratio,x=r.left-stage.left+r.width/2,y=r.top-stage.top+r.height/2;
  this.rect.value.set(x/stage.width*2-1,1-y/stage.height*2,w/stage.width*2,h/stage.height*2);
  this.head.updateWorldMatrix(true,false);this.head.getVertexPosition(this.vertex,this.vector);this.head.localToWorld(this.vector);this.vector.project(camera);
  const tx=(this.vector.x+1)*stage.width/2,ty=(1-this.vector.y)*stage.height/2;
  this.svg.setAttribute('viewBox',`0 0 ${stage.width} ${stage.height}`);
  this.line.setAttribute('d',`M ${x} ${y} C ${x+60} ${y},${tx-40} ${ty},${tx} ${ty}`);
  this.dot.setAttribute('cx',tx);this.dot.setAttribute('cy',ty);this.svg.style.opacity=String(motion.line*.65);
 }
 hide(){this.card.hidden=true;this.svg.setAttribute('hidden','');this.meshes?.forEach(mesh=>mesh.visible=false);}
 clear(){
  this.hide();if(this.mesh){this.meshes.forEach(mesh=>mesh.removeFromParent());this.mesh.material.dispose();this.mesh=null;this.meshes=[];}
  this.texture?.dispose();this.texture=null;if(this.pixels)this.pixels.width=this.pixels.height=1;this.pixels=null;
 }
 dispose(){this.clear();}
}
