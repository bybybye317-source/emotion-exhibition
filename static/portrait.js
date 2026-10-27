import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {createAlignedPhoto, paintCollage} from './portrait-collage.mjs?v=20261027-collage';
import {LABELS, morphWeights, normalizeScores} from './portrait-math.mjs?v=20261027-collage';

const $ = id => document.getElementById(id);
const SIZE = 1024;
const BASE_COLOR = '#aeb0ae';
const SEED_URL = new URL('./portrait-seeds/manifest.json', import.meta.url);
const photoKey = record => JSON.stringify([record.id,record.image_url,record.photo_anchors]);
const MODEL_URL = new URL('./models/sculpture-head.glb', import.meta.url);
const clamp01 = value => Math.min(1,Math.max(0,value));
const smooth = (a,b,x) => {const t=clamp01((x-a)/(b-a));return t*t*(3-2*t);};
const canvas = () => Object.assign(document.createElement('canvas'), {width:SIZE,height:SIZE});

class GroupPortrait {
  constructor(stage) {
    this.stage=stage;this.connected=false;this.records=[];this.scores={};this.preview='group';
    this.photoCache=new Map();this.seedAtlas=null;this.seedLoading=false;this.seedFailure=null;
    this.generation=0;this.signature=null;this.loadedCount=0;this.loadingPhotos=false;
    this.targetMorphs={};this.morphMeshes=[];this.autoRotate=false;this.ready=false;this.failure=null;
    this.abort=null;this.disposed=false;this.lastFrame=performance.now();this.lastStats=0;this.blend=0;
    this.atlas=canvas();this.atlasContext=this.atlas.getContext('2d');this.clearAtlas();
    this.texture=new THREE.CanvasTexture(this.atlas);this.texture.colorSpace=THREE.SRGBColorSpace;
    this.texture.anisotropy=4;this.texture.flipY=true;
    this.photoUniform={value:0};
    this.reducedMotion=matchMedia('(prefers-reduced-motion: reduce)');
    this.scene=new THREE.Scene();
    this.scene.background=new THREE.Color(getComputedStyle(stage).getPropertyValue('--portrait-stage-bg').trim() || '#080a0d');
    this.camera=new THREE.PerspectiveCamera(32,1,.05,60);
    this.renderer=new THREE.WebGLRenderer({antialias:true,alpha:false,powerPreference:'high-performance'});
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,1.7));
    this.renderer.outputColorSpace=THREE.SRGBColorSpace;
    this.renderer.toneMapping=THREE.ACESFilmicToneMapping;this.renderer.toneMappingExposure=1.0;
    this.renderer.domElement.setAttribute('aria-label','由不同面孔的小片段拼成的三维群体脸，可拖动旋转');
    this.renderer.domElement.setAttribute('role','img');this.stage.append(this.renderer.domElement);
    this.renderer.domElement.addEventListener('webglcontextlost',event=>{event.preventDefault();this.failure='图形显示中断，请刷新页面恢复';this.updateStatus();});
    this.renderer.domElement.addEventListener('webglcontextrestored',()=>location.reload());
    this.controls=new OrbitControls(this.camera,this.renderer.domElement);
    this.controls.enableDamping=true;this.controls.dampingFactor=.08;this.controls.enablePan=false;
    this.controls.minDistance=3.8;this.controls.maxDistance=11;
    this.controls.minPolarAngle=1.12;this.controls.maxPolarAngle=1.97;
    this.controls.minAzimuthAngle=-.85;this.controls.maxAzimuthAngle=.85;
    this.controls.autoRotateSpeed=.30;
    this.scene.add(new THREE.HemisphereLight(0xe8e5de,0x151922,.32));
    for(const [color,intensity,position] of [[0xf1ede4,2.9,[-4,3,4]],[0xbecddd,.48,[3,.5,3]],[0xdce7f4,2.2,[3,2,-2]]]) {
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

  async loadModel() {
    if(this.modelLoading||this.ready||this.disposed)return;
    this.modelLoading=true;this.failure=null;this.stage.dataset.model='loading';this.updateStatus();
    $('portrait-retry-model').hidden=true;
    let candidate=null;
    try {
      const gltf=await new GLTFLoader().loadAsync(MODEL_URL.href);
      if(this.disposed){gltf.scene.traverse(o=>{o.geometry?.dispose();o.material?.dispose();});return;}
      candidate=gltf.scene;
      this.projection=candidate.userData;
      // Projection is calibrated from the neutral asset, and remains attached
      // to vertices during expression morphing instead of sliding over the face.
      if(!this.projection.bounds||!this.projection.landmarks)throw new Error('缺少脸模的照片校准数据');
      this.morphMeshes=[];
      candidate.traverse(mesh=>{
        if(!mesh.isMesh)return;
        const geometry=mesh.geometry;
        const points=geometry.attributes.position;
        const uv=new Float32Array(points.count*2),weights=new Float32Array(points.count);
        const {left,right,top,bottom}=this.projection.bounds;
        for(let i=0;i<points.count;i++) {
          const x=points.getX(i),y=points.getY(i);
          const u=(x-left)/(right-left),v=(y-bottom)/(top-bottom);
          uv[i*2]=u;uv[i*2+1]=v;
          weights[i]=smooth(.02,.17,u)*(1-smooth(.83,.98,u))*smooth(.015,.13,v)*(1-smooth(.85,.99,v));
        }
        geometry.setAttribute('uv',new THREE.BufferAttribute(uv,2));
        geometry.setAttribute('portraitWeight',new THREE.BufferAttribute(weights,1));
        mesh.material?.dispose();
        geometry.computeBoundingBox();
        mesh.material=this.sculptureMaterial(mesh.name.startsWith('Eye')?geometry.boundingBox.getCenter(new THREE.Vector3()):null);
        mesh.frustumCulled=false;
        if(mesh.morphTargetDictionary&&Object.keys(mesh.morphTargetDictionary).length){this.morphMeshes.push(mesh);this.head=mesh;}
      });
      this.model=candidate;candidate=null;
      this.scene.add(this.model);this.ready=true;
      this.stage.dataset.model='ready';this.stage.dataset.geometry='sculpted-expression-mask';
      this.loadSeedPhotos();this.loadPhotos(this.records);this.updateStatus();
    } catch(error) {
      candidate?.traverse(o=>{o.geometry?.dispose();o.material?.dispose();});
      this.morphMeshes=[];this.head=null;
      this.failure=`三维肖像暂未加载成功：${error.message}`;
      this.stage.dataset.model='error';$('portrait-retry-model').hidden=false;this.updateStatus();
    } finally {this.modelLoading=false;}
  }

  sculptureMaterial(eyeCenter=null) {
    const material=new THREE.MeshStandardMaterial({color:0xffffff,map:this.texture,roughness:.72,metalness:.035,side:THREE.DoubleSide});
    material.onBeforeCompile=shader=>{
      shader.uniforms.portraitPhotoMix=this.photoUniform;
      shader.uniforms.portraitEyeCenter={value:eyeCenter||new THREE.Vector3(10,10,10)};
      shader.uniforms.portraitBaseColor={value:new THREE.Color(BASE_COLOR)};
      shader.vertexShader='attribute float portraitWeight;\nvarying float vPortraitWeight;\nvarying vec3 vSculpturePosition;\n'+shader.vertexShader;
      shader.vertexShader=shader.vertexShader.replace('#include <uv_vertex>','#include <uv_vertex>\nvPortraitWeight = portraitWeight;\nvSculpturePosition = position;');
      shader.fragmentShader='uniform vec3 portraitEyeCenter;\nuniform float portraitPhotoMix;\nuniform vec3 portraitBaseColor;\nvarying float vPortraitWeight;\nvarying vec3 vSculpturePosition;\n'+shader.fragmentShader;
      shader.fragmentShader=shader.fragmentShader.replace('#include <map_fragment>',`
        vec3 photograph = texture2D(map, vMapUv).rgb;
        // Quiet mineral variation, evaluated in object space so it stays on the sculpture.
        float grain = fract(sin(dot(floor(vSculpturePosition * 380.0), vec3(12.9898,78.233,39.425))) * 43758.5453);
        vec3 stone = portraitBaseColor * (0.975 + grain * 0.05);
        float eyeRadius = length(vSculpturePosition.xy - portraitEyeCenter.xy);
        float iris = 1.0-smoothstep(0.050,0.060,eyeRadius);
        float pupil = 1.0-smoothstep(0.018,0.026,eyeRadius);
        stone *= 1.0 - iris*0.24 - pupil*0.32;
        diffuseColor.rgb *= mix(stone, photograph, vPortraitWeight * portraitPhotoMix * 0.98);
      `);
    };
    material.customProgramCacheKey=()=> 'sculpted-portrait-collage-v4';
    return material;
  }

  bindControls() {
    $('portrait-retry-seeds').addEventListener('click',()=>this.loadSeedPhotos());
    $('portrait-retry-model').addEventListener('click',()=>this.loadModel());
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
    this.camera.aspect=width/height;
    const fit=Math.max(5.45,4.25/this.camera.aspect);
    if(fit!==(this.fitDistance||5.45)) {
      const offset=this.camera.position.clone().sub(this.controls.target).multiplyScalar(fit/(this.fitDistance||5.45));
      this.camera.position.copy(this.controls.target).add(offset);
    }
    this.fitDistance=fit;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width,height,false);
  }

  resetView() {
    this.controls.target.set(0,-.04,0);this.camera.position.set(.40,.09,this.fitDistance||5.45);this.controls.update();
  }

  setState(state,connected) {
    if(!state?.session)return;
    const reconnected=connected&&!this.connected;
    this.connected=connected;
    this.records=(state.session.participants||[]).slice(-20);
    this.scores=normalizeScores(state.session.group_scores);
    const signature=JSON.stringify(this.records.map(p=>[p.id,p.slot,p.image_url,p.photo_anchors]));
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
    // Relax the source mask's downturned rest face. Let expressive poses take
    // over rather than adding a permanent smile to sadness or anger.
    const repose=Object.keys(scores).length?(scores.neutral||0):1;
    this.targetMorphs.browInnerUp=(this.targetMorphs.browInnerUp||0)+repose*.12;
    this.targetMorphs.mouthSmile_L=(this.targetMorphs.mouthSmile_L||0)+repose*.16;
    this.targetMorphs.mouthSmile_R=(this.targetMorphs.mouthSmile_R||0)+repose*.16;
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
    let status=this.records.length?'每个人的一部分，成为共同的脸':'一张已经相遇的脸';
    let detail=this.seedAtlas?'空位由 20 张 AI 虚构面孔的片段填充，不计入观众或情绪数据。':'初始拼脸正在准备。';
    if(this.records.length) detail=`${this.loadedCount} 块观众片段 · ${20-this.loadedCount} 块${this.seedAtlas?'示例片段':'待填充区域'}。每次采集只替换一块，其余位置保持不变。`;
    if(this.loadingPhotos) status='正在将新片段拼入肖像…';
    else if(this.loadedCount<this.records.length) status=`已拼入 ${this.loadedCount}/${this.records.length} 块；部分照片不可用`;
    if(this.seedLoading&&!this.records.length)status='正在拼合初始面孔…';
    if(this.seedFailure)detail='初始素材暂未加载。可以重试，或直接采集观众片段。';
    if(this.preview!=='group') status=`预览：${LABELS[this.preview]} · 不改变采集数据`;
    if(!this.connected) status='正在准备本地体验';
    if(!this.ready) status='正在加载三维人脸…';
    if(this.failure)status=this.failure;
    $('portrait-status').textContent=status;
    $('portrait-empty-hint').textContent=detail;
    $('portrait-empty-hint').hidden=false;
    $('portrait-retry-seeds').hidden=!this.seedFailure;
    this.stage.dataset.participants=String(this.records.length);
    this.stage.dataset.photos=String(this.loadedCount);
    this.stage.dataset.seeds=this.seedAtlas?'20':'0';
    this.stage.dataset.seedStatus=this.seedLoading?'loading':this.seedFailure?'error':this.seedAtlas?'ready':'waiting';
    this.stage.dataset.connected=String(this.connected);
  }

  async loadSeedPhotos() {
    if(!this.ready||this.disposed||this.seedLoading||this.seedAtlas)return;
    this.seedLoading=true;this.seedFailure=null;this.updateStatus();
    this.seedAbort=new AbortController();
    const timeout=setTimeout(()=>this.seedAbort.abort(),20000);
    let image=null,assembled=null;
    const aligned=[];
    try {
      const response=await fetch(SEED_URL,{signal:this.seedAbort.signal});
      if(!response.ok)throw new Error('初始面孔清单不可用');
      const manifest=await response.json();
      if(manifest.faces?.length!==20)throw new Error('初始面孔数量不完整');
      const imageUrl=new URL(manifest.image,SEED_URL);
      if(imageUrl.origin!==location.origin)throw new Error('初始素材来源无效');
      const photo=await fetch(imageUrl,{signal:this.seedAbort.signal});
      if(!photo.ok)throw new Error('初始面孔素材不可用');
      image=await createImageBitmap(await photo.blob());
      if(this.disposed)return;
      for(const face of manifest.faces) {
        const [x,y,width,height]=face.rect;
        const tile=Object.assign(document.createElement('canvas'),{width,height});
        tile.getContext('2d').drawImage(image,x,y,width,height,0,0,width,height);
        try {aligned.push(createAlignedPhoto(tile,face.photo_anchors,{size:SIZE,...this.projection,baseColor:BASE_COLOR}));}
        finally {tile.width=tile.height=1;}
      }
      assembled=canvas();
      paintCollage(assembled.getContext('2d'),[],SIZE,BASE_COLOR,{records:[],seedImages:aligned});
      this.seedAtlas=assembled;assembled=null;
      this.repaintPhotos();
    } catch(error) {
      if(!this.disposed)this.seedFailure=error.message;
    } finally {
      clearTimeout(timeout);image?.close();
      aligned.forEach(photo=>{photo.width=photo.height=1;});
      if(assembled)assembled.width=assembled.height=1;
      this.seedLoading=false;
      if(!this.disposed)this.updateStatus();
    }
  }

  repaintPhotos() {
    if(this.disposed||!this.ready)return;
    const aligned=this.records.map(record=>this.photoCache.get(photoKey(record))||null);
    this.loadedCount=aligned.filter(Boolean).length;
    // A single assembled seed texture keeps the baseline at 4 MB instead of
    // retaining twenty full-size aligned photographs. Each cell samples only
    // its own corresponding location from that baseline.
    const seedImages=this.seedAtlas?Array(20).fill(this.seedAtlas):[];
    paintCollage(this.atlasContext,aligned,SIZE,BASE_COLOR,{records:this.records,seedImages});
    this.texture.needsUpdate=true;
  }

  async loadPhotos(records) {
    if(!this.ready){this.loadingPhotos=records.length>0;return;}
    const generation=++this.generation;
    clearTimeout(this.photoRetryTimer);
    this.abort?.abort();this.abort=new AbortController();
    const controller=this.abort;
    const keys=new Set(records.map(photoKey));
    // Keep unchanged participants in place while a new fragment loads. Remove
    // evicted/deleted photos immediately, including their backing pixel stores.
    for(const [key,photo] of this.photoCache)if(!keys.has(key)) {
      photo.width=photo.height=1;this.photoCache.delete(key);
    }
    const missing=records.filter(record=>!this.photoCache.has(photoKey(record)));
    this.loadingPhotos=missing.length>0;this.repaintPhotos();this.updateStatus();
    if(!missing.length)return;
    const timeout=setTimeout(()=>controller.abort(),10000);
    const results=await Promise.allSettled(missing.map(async record=>{
      const url=new URL(record.image_url,location.origin);
      if(url.protocol!=='blob:' || url.origin!==location.origin)throw new Error('仅接受本浏览器生成的照片');
      const response=await fetch(url,{signal:controller.signal,cache:'no-store'});
      if(!response.ok)throw new Error('照片不可用');
      return await createImageBitmap(await response.blob());
    }));
    clearTimeout(timeout);
    const images=results.map(result=>result.status==='fulfilled'?result.value:null);
    if(this.disposed||generation!==this.generation){images.forEach(image=>image?.close());return;}
    for(const [i,image] of images.entries()) {
      if(!image)continue;
      try {
        const aligned=createAlignedPhoto(image,missing[i].photo_anchors,{size:SIZE,...this.projection,baseColor:BASE_COLOR});
        this.photoCache.set(photoKey(missing[i]),aligned);
      } catch { /* Only this participant falls back to its seed fragment. */ }
      finally {image.close();}
    }
    this.repaintPhotos();this.loadingPhotos=false;this.updateStatus();
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
    const alpha=1-Math.exp(-delta/(this.reducedMotion.matches?.45:1.8));
    for(const mesh of this.morphMeshes)for(const [name,index] of Object.entries(mesh.morphTargetDictionary)) {
      const step=((this.targetMorphs[name]||0)-mesh.morphTargetInfluences[index])*alpha;
      mesh.morphTargetInfluences[index]+=step;
    }
    if(this.head) this.stage.dataset.jawOpen=(this.head.morphTargetInfluences[this.head.morphTargetDictionary.jawOpen]||0).toFixed(3);
    this.photoUniform.value+=((this.loadedCount||this.seedAtlas?1:0)-this.photoUniform.value)*alpha;
    // A gentle oscillation keeps the open sculptural mask facing the viewer.
    this.controls.autoRotate=false;
    if(this.model) {
      const target=this.autoRotate&&!this.reducedMotion.matches?Math.sin(time*.00016)*.20:0;
      this.model.rotation.y+=(target-this.model.rotation.y)*(1-Math.exp(-delta/1.4));
    }
    this.controls.update(delta);
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
    this.disposed=true;++this.generation;this.abort?.abort();this.seedAbort?.abort();
    for(const photo of this.photoCache.values())photo.width=photo.height=1;
    this.photoCache.clear();if(this.seedAtlas)this.seedAtlas.width=this.seedAtlas.height=1;cancelAnimationFrame(this.frameId);
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
