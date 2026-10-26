import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {headGeometryData, HEAD_ANCHORS, faceSurface, expressionDetails} from './procedural-head.mjs';
import {LABELS, morphWeights, normalizeScores, voronoiCells, affineFromTriangles, photoTriangle} from './portrait-math.mjs';

const $ = id => document.getElementById(id);
const SIZE = 1024;
const BOUNDS = {left:-.90, right:.90, top:1.26, bottom:-.95};
const project = (x,y) => [(x-BOUNDS.left)/(BOUNDS.right-BOUNDS.left)*SIZE, (BOUNDS.top-y)/(BOUNDS.top-BOUNDS.bottom)*SIZE];
const TARGET = Object.fromEntries(Object.entries(HEAD_ANCHORS).map(([key,point])=>[key,project(...point)]));
const BASE_COLOR = '#dce2df';
const clamp01 = value => Math.min(1,Math.max(0,value));
const smooth = (a,b,x) => {const t=clamp01((x-a)/(b-a));return t*t*(3-2*t);};
const canvas = () => Object.assign(document.createElement('canvas'), {width:SIZE,height:SIZE});

function path(ctx, points) {
  ctx.beginPath();
  points.forEach(([x,y],i) => i ? ctx.lineTo(x,y) : ctx.moveTo(x,y));
  ctx.closePath();
}

function alignedPhoto(image, anchors) {
  const output=canvas(), ctx=output.getContext('2d');
  const source=photoTriangle(anchors,image.width,image.height);
  const target=[TARGET.left_eye,TARGET.right_eye,TARGET.mouth];
  const transform=affineFromTriangles(source,target);
  if(!transform) return output;
  ctx.fillStyle=BASE_COLOR;ctx.fillRect(0,0,SIZE,SIZE);
  // The base affine aligns both eyes and mouth. Four-point piecewise warping
  // also aligns the nose without requiring reconstruction of an individual's head.
  const inverse=affineFromTriangles(target,source);
  const corners=[[0,0],[SIZE,0],[SIZE,SIZE],[0,SIZE]];
  const toSource=([x,y]) => [inverse[0]*x+inverse[2]*y+inverse[4],inverse[1]*x+inverse[3]*y+inverse[5]];
  const nose=anchors?.nose;
  const validNose=Array.isArray(nose) && nose.length===2 && nose.every(v=>Number.isFinite(v)&&v>=0&&v<=1);
  if(!validNose) {
    ctx.setTransform(...transform);ctx.drawImage(image,0,0);return output;
  }
  const src=[...corners.map(toSource),source[0],source[1],[nose[0]*image.width,nose[1]*image.height],source[2]];
  const dst=[...corners,target[0],target[1],TARGET.nose,target[2]];
  const triangles=[[0,1,5],[0,5,4],[0,4,3],[1,2,5],[2,7,5],[2,3,7],[3,4,7],[4,5,6],[5,7,6],[7,4,6]];
  for(const triangle of triangles) {
    const matrix=affineFromTriangles(triangle.map(i=>src[i]),triangle.map(i=>dst[i]));
    if(!matrix) continue;
    ctx.save();path(ctx,triangle.map(i=>dst[i]));ctx.clip();
    ctx.setTransform(...matrix);ctx.drawImage(image,0,0);ctx.restore();
  }
  return output;
}

class GroupPortrait {
  constructor(stage) {
    this.stage=stage;this.connected=false;this.records=[];this.scores={};this.preview='group';
    this.generation=0;this.signature=null;this.loadedCount=0;this.loadingPhotos=false;
    this.targetMorphs={};this.morphMeshes=[];this.autoRotate=false;this.ready=false;this.failure=null;
    this.abort=null;this.disposed=false;this.lastFrame=performance.now();this.lastStats=0;this.blend=0;
    this.atlas=canvas();this.atlasContext=this.atlas.getContext('2d');this.clearAtlas();
    this.texture=new THREE.CanvasTexture(this.atlas);this.texture.colorSpace=THREE.SRGBColorSpace;
    this.texture.anisotropy=4;this.texture.flipY=true;
    this.photoUniform={value:0};
    this.scene=new THREE.Scene();this.scene.background=new THREE.Color('#d9dfe3');
    this.camera=new THREE.PerspectiveCamera(35,1,.05,60);
    this.renderer=new THREE.WebGLRenderer({antialias:true,alpha:false,powerPreference:'high-performance'});
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,1.7));
    this.renderer.outputColorSpace=THREE.SRGBColorSpace;
    this.renderer.toneMapping=THREE.ACESFilmicToneMapping;this.renderer.toneMappingExposure=1.12;
    this.renderer.domElement.setAttribute('aria-label','由观众照片构成的三维群体脸，可拖动旋转');
    this.renderer.domElement.setAttribute('role','img');this.stage.append(this.renderer.domElement);
    this.renderer.domElement.addEventListener('webglcontextlost',event=>{event.preventDefault();this.failure='图形显示中断，请刷新页面恢复';this.updateStatus();});
    this.renderer.domElement.addEventListener('webglcontextrestored',()=>location.reload());
    this.controls=new OrbitControls(this.camera,this.renderer.domElement);
    this.controls.enableDamping=true;this.controls.dampingFactor=.08;this.controls.enablePan=false;
    this.controls.minDistance=3.5;this.controls.maxDistance=10;
    this.controls.minPolarAngle=.45;this.controls.maxPolarAngle=Math.PI-.65;
    this.controls.autoRotateSpeed=.65;
    this.scene.add(new THREE.HemisphereLight(0xffffff,0x9bada6,2.0));
    for(const [color,intensity,position] of [[0xfff7e9,2.7,[-3,4,5]],[0xd8eeee,1.0,[3,1,3]],[0xffffff,1.8,[-1,3,-4]]]) {
      const light=new THREE.DirectionalLight(color,intensity);light.position.set(...position);this.scene.add(light);
    }
    this.resetView();
    this.resizeObserver=new ResizeObserver(()=>this.resize());this.resizeObserver.observe(stage);
    this.resize();this.bindControls();
    this.listener=event=>this.setState(event.detail.state,event.detail.connected);
    window.addEventListener('emotion:state',this.listener);
    window.dispatchEvent(new Event('emotion:state-request'));
    this.loadModel();
    this.frameId=requestAnimationFrame(time=>this.animate(time));
  }

  clearAtlas() {this.atlasContext.fillStyle=BASE_COLOR;this.atlasContext.fillRect(0,0,SIZE,SIZE);}

  loadModel() {
    try {
      this.model=new THREE.Group();
      this.model.name='original-parametric-group-portrait';
      const data=headGeometryData();
      const geometry=new THREE.BufferGeometry();
      geometry.setAttribute('position',new THREE.BufferAttribute(data.positions,3));
      geometry.setAttribute('uv',new THREE.BufferAttribute(data.uv,2));
      geometry.setIndex(new THREE.BufferAttribute(data.indices,1));
      geometry.computeVertexNormals();
      geometry.morphTargetsRelative=true;
      geometry.morphAttributes.position=Object.entries(data.morphs).map(([name,values])=>{
        const attribute=new THREE.BufferAttribute(values,3);attribute.name=name;return attribute;
      });
      const weights=new Float32Array(data.positions.length/3);
      for(let i=0;i<weights.length;i++) {
        const [x,y,z]=data.positions.subarray(i*3,i*3+3);
        weights[i]=smooth(-.12,.22,z)*(1-smooth(.66,.83,Math.abs(x)))*smooth(-1.0,-.84,y)*(1-smooth(1.15,1.38,y));
      }
      geometry.setAttribute('portraitWeight',new THREE.BufferAttribute(weights,1));
      const material=new THREE.MeshStandardMaterial({color:0xffffff,map:this.texture,roughness:.86,metalness:0});
      material.onBeforeCompile=shader=>{
        shader.uniforms.portraitPhotoMix=this.photoUniform;
        shader.uniforms.portraitBaseColor={value:new THREE.Color(BASE_COLOR)};
        shader.vertexShader='attribute float portraitWeight;\nvarying float vPortraitWeight;\n'+shader.vertexShader;
        shader.vertexShader=shader.vertexShader.replace('#include <uv_vertex>','#include <uv_vertex>\nvPortraitWeight = portraitWeight;');
        shader.fragmentShader='uniform float portraitPhotoMix;\nuniform vec3 portraitBaseColor;\nvarying float vPortraitWeight;\n'+shader.fragmentShader;
        shader.fragmentShader=shader.fragmentShader.replace('#include <map_fragment>','vec4 portraitSample = texture2D(map, vMapUv);\ndiffuseColor.rgb *= mix(portraitBaseColor, portraitSample.rgb, vPortraitWeight * portraitPhotoMix);');
      };
      material.customProgramCacheKey=()=> 'original-parametric-collage-v1';
      this.head=new THREE.Mesh(geometry,material);this.head.name='parametric-face';
      this.head.frustumCulled=false;this.morphMeshes=[this.head];this.model.add(this.head);
      this.buildDetails();
      this.scene.add(this.model);this.ready=true;
      this.stage.dataset.model='ready';this.stage.dataset.geometry='original-parametric';this.updateStatus();
    } catch(error) {
      this.failure=`三维模型加载失败：${error.message}`;this.stage.dataset.model='error';this.updateStatus();
    }
  }

  // Small original surfaces establish the eyes, lids, mouth and ears. Their
  // geometry is updated in place, with the same eased weights as the head.
  buildDetails() {
    const clay=new THREE.MeshStandardMaterial({color:BASE_COLOR,roughness:.86});
    const crease=new THREE.MeshStandardMaterial({color:0x89988f,roughness:.95});
    const lidMaterial=new THREE.MeshStandardMaterial({color:0xc8d1ca,roughness:.88});
    const globeMaterial=new THREE.MeshStandardMaterial({color:0xe4e8dd,roughness:.55});
    const irisMaterial=new THREE.MeshStandardMaterial({color:0x687f76,roughness:.62});
    const pupilMaterial=new THREE.MeshStandardMaterial({color:0x263b34,roughness:.6});
    const sphere=(material,position,scale)=>{
      const mesh=new THREE.Mesh(new THREE.SphereGeometry(1,32,20),material);
      mesh.position.set(...position);mesh.scale.set(...scale);this.model.add(mesh);return mesh;
    };
    this.eyeDetails=[];this.curves=[];
    const curve=(material,radius=.012)=>{
      const steps=32,sides=6,positions=new Float32Array((steps+1)*sides*3),normals=new Float32Array(positions.length),indices=[];
      for(let i=0;i<steps;i++)for(let j=0;j<sides;j++) {
        const a=i*sides+j,b=i*sides+(j+1)%sides,c=b+sides,d=a+sides;
        indices.push(a,b,d,b,c,d);
      }
      const geometry=new THREE.BufferGeometry();
      geometry.setAttribute('position',new THREE.BufferAttribute(positions,3).setUsage(THREE.DynamicDrawUsage));
      geometry.setAttribute('normal',new THREE.BufferAttribute(normals,3).setUsage(THREE.DynamicDrawUsage));
      geometry.setIndex(indices);
      const mesh=new THREE.Mesh(geometry,material);mesh.frustumCulled=false;this.model.add(mesh);
      const detail={mesh,steps,sides,radius,positions,normals};this.curves.push(detail);return detail;
    };
    for(const side of [-1,1]) {
      sphere(clay,[side*.79,.11,-.19],[.105,.23,.125]);
      sphere(lidMaterial,[side*.815,.10,-.078],[.041,.13,.018]);
      const x=side*.329,y=.261213,z=faceSurface(x,y)+.025;
      const globe=sphere(globeMaterial,[x,y,z],[.145,.087,.076]);
      const iris=sphere(irisMaterial,[x,y,z+.070],[.052,.052,.008]);
      const pupil=sphere(pupilMaterial,[x,y,z+.078],[.023,.023,.004]);
      this.eyeDetails.push({side,x,y,z,globe,iris,pupil,upper:curve(lidMaterial,.012),lower:curve(lidMaterial,.009),brow:curve(crease,.016)});
      sphere(crease,[side*.083,-.137,faceSurface(side*.083,-.137)+.003],[.020,.010,.008]);
    }
    const mouthGeometry=new THREE.BufferGeometry(),mouthIndices=[];
    mouthGeometry.setAttribute('position',new THREE.BufferAttribute(new Float32Array(33*2*3),3).setUsage(THREE.DynamicDrawUsage));
    for(let i=0;i<32;i++) {const a=i*2;mouthIndices.push(a,a+1,a+2,a+1,a+3,a+2);}
    mouthGeometry.setIndex(mouthIndices);
    this.mouthInterior=new THREE.Mesh(mouthGeometry,new THREE.MeshStandardMaterial({color:0x46584f,roughness:1,side:THREE.DoubleSide}));
    this.mouthInterior.frustumCulled=false;this.model.add(this.mouthInterior);
    this.upperLip=curve(lidMaterial,.016);this.lowerLip=curve(lidMaterial,.019);
    this.facialMaterials=[crease,lidMaterial,globeMaterial,irisMaterial,pupilMaterial,this.mouthInterior.material];
    for(const material of this.facialMaterials) {material.transparent=true;material.depthWrite=false;}
    this.updateDetails();
  }

  updateCurve(curve,point) {
    const {steps,sides,radius,positions,normals}=curve;
    for(let i=0;i<=steps;i++) {
      const t=i/steps,p=point(t),a=point(Math.max(0,t-.002)),b=point(Math.min(1,t+.002));
      const dx=b[0]-a[0],dy=b[1]-a[1],length=Math.max(1e-8,Math.hypot(dx,dy));
      for(let j=0;j<sides;j++) {
        const angle=j/sides*Math.PI*2,nx=-dy/length*Math.sin(angle),ny=dx/length*Math.sin(angle),nz=Math.cos(angle);
        const index=(i*sides+j)*3;
        positions[index]=p[0]+nx*radius;positions[index+1]=p[1]+ny*radius;positions[index+2]=p[2]+nz*radius;
        normals[index]=nx;normals[index+1]=ny;normals[index+2]=nz;
      }
    }
    curve.mesh.geometry.attributes.position.needsUpdate=true;
    curve.mesh.geometry.attributes.normal.needsUpdate=true;
  }

  updateDetails() {
    const weights=Object.fromEntries(Object.entries(this.head.morphTargetDictionary).map(([name,index])=>[name,this.head.morphTargetInfluences[index]]));
    const expression=expressionDetails(weights);
    for(let i=0;i<this.eyeDetails.length;i++) {
      const eye=this.eyeDetails[i],p=expression.sides[i],halfWidth=.148,halfHeight=.068*p.eye;
      eye.globe.scale.y=.087*p.eye;
      // The iris remains round while lids narrow; the spherical surface itself
      // is clipped visually by the lids and the recessed eye socket.
      eye.iris.scale.y=.052*Math.min(1,p.eye);eye.pupil.scale.y=.023*Math.min(1,p.eye);
      const lidPoint=(t,sign)=>{
        const x=eye.x+(2*t-1)*halfWidth,y=eye.y+sign*halfHeight*Math.sin(Math.PI*t);
        const z=eye.z+.025+.05*Math.sin(Math.PI*t);
        return [x,y,z];
      };
      this.updateCurve(eye.upper,t=>lidPoint(t,1));this.updateCurve(eye.lower,t=>lidPoint(t,-1));
      this.updateCurve(eye.brow,t=>{
        const x=eye.side*(.16+.34*t),baseY=.425+.025*Math.sin(Math.PI*t),y=baseY+p.browInner*(1-t)+p.browOuter*t;
        return [x,y,faceSurface(x,baseY)+.030];
      });
    }
    const {mouthWidth:width,mouthHeight:height,mouthY:y,jaw,funnel}=expression;
    const lipPoint=(t,upper)=>{
      const x=(2*t-1)*width,side=t<.5?expression.sides[0]:expression.sides[1];
      const corner=Math.abs(2*t-1)**1.7*(.13*side.smile-.115*side.frown);
      const arch=Math.sin(Math.PI*t);
      const lipY=y+corner+(upper?1:-1)*height*arch+(upper?.024*side.upper*arch:0);
      const z=faceSurface(x,-.379)+.033+.025*funnel-.015*jaw;
      return [x,lipY,z];
    };
    this.updateCurve(this.upperLip,t=>lipPoint(t,true));this.updateCurve(this.lowerLip,t=>lipPoint(t,false));
    const opening=this.mouthInterior.geometry.attributes.position;
    for(let i=0;i<=32;i++)for(let side=0;side<2;side++) {
      const point=lipPoint(i/32,side===0);point[2]-=.006;
      opening.setXYZ(i*2+side,...point);
    }
    opening.needsUpdate=true;this.mouthInterior.geometry.computeVertexNormals();
    this.stage.dataset.jawOpen=expression.jaw.toFixed(3);
  }

  bindControls() {
    $('portrait-reset-view').addEventListener('click',()=>this.resetView());
    $('portrait-rotate').addEventListener('click',()=>{
      this.autoRotate=!this.autoRotate;
      $('portrait-rotate').setAttribute('aria-pressed',String(this.autoRotate));
      $('portrait-rotate').querySelector('span').textContent=this.autoRotate?'停止旋转':'自动旋转';
      this.stage.dataset.rotating=String(this.autoRotate);
    });
    $('portrait-preview').addEventListener('change',event=>{
      this.preview=event.target.value;this.updateEmotion();this.updateStatus();
    });
    $('portrait-fullscreen').addEventListener('click',async()=>{
      try {
        if(document.fullscreenElement) await document.exitFullscreen();
        else await $('portrait-workspace').requestFullscreen();
      } catch {this.failure='当前浏览器未能进入全屏，仍可在页面中旋转查看';this.updateStatus();}
    });
    document.addEventListener('fullscreenchange',()=>{
      $('portrait-fullscreen').querySelector('span').textContent=document.fullscreenElement?'退出全屏':'全屏';this.resize();
    });
    window.addEventListener('pagehide',event=>{if(!event.persisted)this.dispose();});
  }

  resize() {
    const {width,height}=this.stage.getBoundingClientRect();
    if(width<1||height<1) return;
    this.camera.aspect=width/height;this.camera.updateProjectionMatrix();
    this.renderer.setSize(width,height,false);
  }

  resetView() {
    this.camera.position.set(.12,.24,6.1);this.controls.target.set(0,.12,-.05);this.controls.update();
  }

  setState(state,connected) {
    if(!state?.session)return;
    const reconnected=connected&&!this.connected;
    this.connected=connected;
    this.records=(state.session.participants||[]).slice(-20);
    this.scores=normalizeScores(state.session.group_scores);
    const signature=JSON.stringify(this.records.map(p=>[p.id,p.image_url,p.photo_anchors]));
    if(signature!==this.signature) {
      this.signature=signature;this.photoRetries=0;this.loadPhotos(this.records);
    } else if(reconnected&&!this.loadingPhotos&&this.loadedCount<this.records.length) {
      this.photoRetries=0;this.loadPhotos(this.records);
    }
    this.updateEmotion();this.updateStatus();
  }

  updateEmotion() {
    const scores=this.preview==='group'?this.scores:{[this.preview]:1};
    const signature=JSON.stringify([this.preview,scores]);
    if(signature===this.emotionSignature)return;
    this.emotionSignature=signature;
    this.targetMorphs=morphWeights(scores);
    const rows=$('portrait-emotions');rows.replaceChildren();
    $('portrait-emotions-title').textContent=this.preview==='group'?'群体表情':'预览表情';
    if(!Object.keys(scores).length) {
      const empty=document.createElement('p');empty.className='portrait-no-data';
      empty.textContent='暂无数据';
      const hint=document.createElement('span');hint.textContent='完成一次采集后，这里将显示群体的表情倾向。';
      empty.append(hint);rows.append(empty);
    }
    for(const [key,label] of Object.entries(LABELS)) {
      if(!Object.keys(scores).length) break;
      const row=document.createElement('div');row.className='score-row';
      const name=document.createElement('span');name.className='score-label';name.textContent=label;
      const track=document.createElement('div');track.className='score-track';
      const fill=document.createElement('div');fill.className='score-fill';fill.style.width=`${(scores[key]||0)*100}%`;track.append(fill);
      const value=document.createElement('span');value.className='score-number';value.textContent=Object.keys(scores).length?`${((scores[key]||0)*100).toFixed(1)}%`:'—';
      row.append(name,track,value);rows.append(row);
    }
    this.stage.dataset.expression=this.preview;
  }

  updateStatus() {
    $('portrait-count').textContent=`${this.records.length} 位观众`;
    let status=this.records.length?'表情跟随群体，照片已融入肖像':'等待第一位观众';
    if(this.loadingPhotos) status='正在将观众照片拼入肖像…';
    else if(this.loadedCount<this.records.length) status=`已拼入 ${this.loadedCount}/${this.records.length} 张照片；部分照片不可用`;
    if(this.preview!=='group') status=`预览：${LABELS[this.preview]} · 不改变采集数据`;
    if(!this.connected) status='正在准备本地体验';
    if(!this.ready) status='正在加载三维人脸…';
    if(this.failure)status=this.failure;
    $('portrait-status').textContent=status;
    $('portrait-empty-hint').hidden=this.records.length>0;
    this.stage.dataset.participants=String(this.records.length);
    this.stage.dataset.photos=String(this.loadedCount);
    this.stage.dataset.connected=String(this.connected);
  }

  async loadPhotos(records) {
    const generation=++this.generation;
    clearTimeout(this.photoRetryTimer);
    this.abort?.abort();this.abort=new AbortController();
    const controller=this.abort;
    this.loadedCount=0;this.loadingPhotos=records.length>0;
    // Clear immediately: a late response from a previous session must never
    // paint a deleted participant back onto the head.
    this.clearAtlas();this.texture.needsUpdate=true;this.photoUniform.value=0;
    if(!records.length){this.loadingPhotos=false;this.updateStatus();return;}
    const timeout=setTimeout(()=>controller.abort(),10000);
    const results=await Promise.allSettled(records.map(async record=>{
      const url=new URL(record.image_url,location.origin);
      if(url.protocol!=='blob:' || url.origin!==location.origin)throw new Error('仅接受本浏览器生成的照片');
      const response=await fetch(url,{signal:controller.signal,cache:'no-store'});
      if(!response.ok)throw new Error('照片不可用');
      return await createImageBitmap(await response.blob());
    }));
    clearTimeout(timeout);
    const images=results.map(result=>result.status==='fulfilled'?result.value:null);
    if(this.disposed||generation!==this.generation){images.forEach(image=>image?.close());return;}
    const aligned=images.map((image,i)=>image?alignedPhoto(image,records[i].photo_anchors):null);
    this.loadedCount=images.filter(Boolean).length;
    const cells=voronoiCells();
    const ctx=this.atlasContext;
    cells.forEach((cell,index)=>{
      const points=cell.map(([x,y])=>[x*SIZE,y*SIZE]);
      ctx.save();path(ctx,points);ctx.clip();
      const photo=aligned[index%records.length];
      if(photo)ctx.drawImage(photo,0,0);
      ctx.restore();
      if(records.length>1){path(ctx,points);ctx.strokeStyle='rgba(229,236,231,.80)';ctx.lineWidth=2.6;ctx.stroke();}
    });
    images.forEach(image=>image?.close());
    this.texture.needsUpdate=true;this.loadingPhotos=false;this.updateStatus();
    if(this.loadedCount<records.length && (this.photoRetries||0)<2) {
      this.photoRetries=(this.photoRetries||0)+1;
      this.photoRetryTimer=setTimeout(()=>{
        if(generation===this.generation&&this.connected&&!this.disposed)this.loadPhotos(records);
      },this.photoRetries*1500);
    }
  }

  animate(time) {
    if(this.disposed)return;
    this.frameId=requestAnimationFrame(now=>this.animate(now));
    const delta=Math.min(.1,(time-this.lastFrame)/1000);this.lastFrame=time;
    if(document.hidden||this.stage.getBoundingClientRect().width<1)return;
    const alpha=1-Math.exp(-delta/0.48);
    let moving=false;
    for(const mesh of this.morphMeshes)for(const [name,index] of Object.entries(mesh.morphTargetDictionary)) {
      const step=((this.targetMorphs[name]||0)-mesh.morphTargetInfluences[index])*alpha;
      mesh.morphTargetInfluences[index]+=step;moving=moving||Math.abs(step)>.00001;
    }
    if(this.ready&&moving)this.updateDetails();
    this.photoUniform.value+=((this.loadedCount?1:0)-this.photoUniform.value)*alpha;
    // The sculpture supplies features while empty. Once photos arrive their
    // own eyes and lips remain visible instead of painted-on artificial eyes.
    for(const material of this.facialMaterials||[])material.opacity=Math.max(0,1-this.photoUniform.value*1.05);
    this.controls.autoRotate=this.autoRotate;this.controls.update(delta);
    this.renderer.render(this.scene,this.camera);
    if(time-this.lastStats>500) {
      this.lastStats=time;
      // Observable render state is useful for accessibility-adjacent diagnostics
      // and tests; no photos or identifying landmarks are placed in the DOM.
      this.stage.dataset.morphActivity=String(Object.values(this.targetMorphs).reduce((a,b)=>a+b,0).toFixed(3));
      this.stage.dataset.rendered=String(this.renderer.info.render.frame);
    }
  }

  dispose() {
    this.disposed=true;++this.generation;this.abort?.abort();cancelAnimationFrame(this.frameId);
    clearTimeout(this.photoRetryTimer);
    this.resizeObserver.disconnect();this.controls.dispose();this.texture.dispose();this.clearAtlas();
    this.scene.traverse(o=>{o.geometry?.dispose();o.material?.dispose();});this.renderer.dispose();
    window.removeEventListener('emotion:state',this.listener);
  }
}

const stage=$('portrait-stage');
if(stage) {
  try {new GroupPortrait(stage);}
  catch(error) {$('portrait-status').textContent=`无法启动三维显示：${error.message}。采集功能仍可使用。`;stage.dataset.model='error';}
}
