import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {createAlignedPhoto, paintCollage} from './portrait-collage.mjs?v=20261028-light';
import {ARRIVAL_SECONDS, FragmentArrival, blendLinearPixels} from './portrait-arrival.mjs?v=20261028-anatomy';
import {LABELS, morphWeights, normalizeScores, organicFragmentCells, planPatchAssignments} from './portrait-math.mjs?v=20261028-anatomy';

import {calibratedProjection} from './portrait-features.mjs?v=20261028-anatomy';
import {ContributionGuide} from './portrait-contribution.mjs?v=20261028-anatomy';

const $ = id => document.getElementById(id);
const SIZE = 1024;
const BASE_COLOR = '#aeb0ae';
const SEED_URL = new URL('./portrait-seeds/manifest.json', import.meta.url);
const photoKey = record => JSON.stringify([record.id,record.image_url,record.photo_anchors]);
const REGION_NAMES=['左侧额头','额头中央','右侧额头','左侧太阳穴','左侧眉眼','右侧眉眼','右侧太阳穴','左侧脸颊外缘','左侧脸颊','鼻梁与鼻翼','右侧脸颊','右侧脸颊外缘','左侧下颊','左侧嘴角','完整唇部','右侧嘴角','右侧下颊','左侧下颌','下巴中央','右侧下颌'];
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
    this.arrival=new FragmentArrival();this.arrivalUniform={value:1};this.glowUniform={value:0};
    this.presentedKeys=new Map();this.presentedSeed=null;this.presentationReady=false;this.lastArrivalSlots=[];
    this.fromAtlas=canvas();this.fromContext=this.fromAtlas.getContext('2d',{willReadFrequently:true});
    this.fromContext.drawImage(this.atlas,0,0);
    this.fromTexture=new THREE.CanvasTexture(this.fromAtlas);this.fromTexture.colorSpace=THREE.SRGBColorSpace;
    this.fromTexture.flipY=true;this.fromTexture.anisotropy=4;
    this.arrivalMask=canvas();this.arrivalMaskContext=this.arrivalMask.getContext('2d');
    this.arrivalMaskTexture=new THREE.CanvasTexture(this.arrivalMask);
    this.arrivalMaskTexture.flipY=true;this.arrivalMaskTexture.generateMipmaps=false;
    this.arrivalMaskTexture.minFilter=THREE.LinearFilter;
    this.arrivalPhase='idle';this.contribution=new ContributionGuide(stage);
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
    this.scene.add(new THREE.HemisphereLight(0xe8e5de,0x1c1a19,.55));
    for(const [color,intensity,position] of [[0xf1ede4,2.4,[-3,3,5]],[0xe4e6e8,.85,[3,.5,4]],[0xe8e4df,.60,[3,2,-2]]]) {
      const light=new THREE.DirectionalLight(color,intensity);light.position.set(...position);this.scene.add(light);
    }
    this.resetView();
    this.resizeObserver=new ResizeObserver(()=>this.resize());this.resizeObserver.observe(stage);
    this.resize();this.bindControls();
    this.listener=event=>this.setState(event.detail.state,event.detail.connected);
    window.addEventListener('emotion:state',this.listener);
    window.dispatchEvent(new Event('emotion:state-request'));
    this.revealListener=()=>this.resetView();
    window.addEventListener('portrait:reveal',this.revealListener);
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
      const geometry=candidate.getObjectByName('SculptureHead').geometry;
      const positions=geometry.attributes.position;
      this.projection=calibratedProjection(candidate.userData,i=>[positions.getX(i),positions.getY(i),positions.getZ(i)]);
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
    const material=new THREE.MeshStandardMaterial({color:0xffffff,map:this.texture,roughness:.82,metalness:0,side:THREE.DoubleSide});
    material.onBeforeCompile=shader=>{
      shader.uniforms.portraitPhotoMix=this.photoUniform;
      shader.uniforms.portraitPreviousMap={value:this.fromTexture};
      shader.uniforms.portraitArrivalMask={value:this.arrivalMaskTexture};
      shader.uniforms.portraitArrivalMix=this.arrivalUniform;
      shader.uniforms.portraitArrivalGlow=this.glowUniform;
      shader.uniforms.portraitEyeCenter={value:eyeCenter||new THREE.Vector3(10,10,10)};
      shader.uniforms.portraitBaseColor={value:new THREE.Color(BASE_COLOR)};
      shader.vertexShader='attribute float portraitWeight;\nvarying float vPortraitWeight;\nvarying vec3 vSculpturePosition;\n'+shader.vertexShader;
      shader.vertexShader=shader.vertexShader.replace('#include <uv_vertex>','#include <uv_vertex>\nvPortraitWeight = portraitWeight;\nvSculpturePosition = position;');
      shader.fragmentShader='uniform sampler2D portraitPreviousMap;\nuniform sampler2D portraitArrivalMask;\nuniform float portraitArrivalMix;\nuniform float portraitArrivalGlow;\nuniform vec3 portraitEyeCenter;\nuniform float portraitPhotoMix;\nuniform vec3 portraitBaseColor;\nvarying float vPortraitWeight;\nvarying vec3 vSculpturePosition;\n'+shader.fragmentShader;
      shader.fragmentShader=shader.fragmentShader.replace('#include <map_fragment>',`
        vec3 photograph = mix(texture2D(portraitPreviousMap, vMapUv).rgb, texture2D(map, vMapUv).rgb, portraitArrivalMix);
        // Continue nearby skin over the outer mask instead of revealing a
        // grey rim. Sample inside the face so hair/background cannot stretch
        // across the silhouette; the same arrival mix keeps joins continuous.
        vec2 edgeUv = clamp(vMapUv, vec2(0.17, 0.13), vec2(0.83, 0.85));
        // Coarser mip levels carry colour, not stretched eyebrows or pores,
        // around the side of the mask when the viewer rotates it.
        float edgeLod = mix(7.0, 3.0, vPortraitWeight);
        vec3 edgeSkin = mix(
          textureLod(portraitPreviousMap, edgeUv, edgeLod).rgb,
          textureLod(map, edgeUv, edgeLod).rgb,
          portraitArrivalMix
        );
        vec3 surface = mix(edgeSkin * 0.72, photograph, vPortraitWeight);
        // Quiet mineral variation, evaluated in object space so it stays on the sculpture.
        float grain = fract(sin(dot(floor(vSculpturePosition * 380.0), vec3(12.9898,78.233,39.425))) * 43758.5453);
        vec3 stone = portraitBaseColor * (0.975 + grain * 0.05);
        float eyeRadius = length(vSculpturePosition.xy - portraitEyeCenter.xy);
        float iris = 1.0-smoothstep(0.050,0.060,eyeRadius);
        float pupil = 1.0-smoothstep(0.018,0.026,eyeRadius);
        stone *= 1.0 - iris*0.24 - pupil*0.32;
        diffuseColor.rgb *= mix(stone, surface, portraitPhotoMix);
      `);
      shader.fragmentShader=shader.fragmentShader.replace('#include <emissivemap_fragment>', `
        #include <emissivemap_fragment>
        vec4 arrivalMask = texture2D(portraitArrivalMask, vMapUv);
        float arrivalLight = (arrivalMask.r * 0.16 + arrivalMask.g * 0.022) * arrivalMask.a;
        totalEmissiveRadiance += vec3(0.95, 0.72, 0.40) * arrivalLight * portraitArrivalGlow * vPortraitWeight;
      `);
    };
    material.customProgramCacheKey=()=> 'sculpted-portrait-collage-v6';
    return material;
  }

  bindControls() {
    $('portrait-retry-seeds').addEventListener('click',()=>this.loadSeedPhotos());
    $('portrait-retry-model').addEventListener('click',()=>this.loadModel());
    $('portrait-show-piece').addEventListener('click',()=>this.replayContribution());
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
    const arrival=this.arrival.snapshot();
    if(this.lastArrivalSlots.length&&this.loadedCount)detail+=` 最近融入：${this.arrivalLocation()}。`;
    if(arrival.active){status='你的片段正在融入';detail=`${this.arrivalLocation()}正在慢慢浮现，柔光会在融入后散去。`;}
    if(this.loadingPhotos) status='正在将新片段拼入肖像…';
    else if(this.loadedCount<this.records.length) status=`已拼入 ${this.loadedCount}/${this.records.length} 块；部分照片不可用`;
    if(this.seedLoading&&!this.records.length)status='正在拼合初始面孔…';
    if(this.seedFailure)detail='初始素材暂未加载。可以重试，或直接采集观众片段。';
    if(this.preview!=='group') status=`预览：${LABELS[this.preview]} · 不改变采集数据`;
    if(!this.connected) status='正在准备本地体验';
    if(!this.ready) status='正在加载三维人脸…';
    if(this.failure)status=this.failure;
    if($('portrait-status').textContent!==status)$('portrait-status').textContent=status;
    if($('portrait-empty-hint').textContent!==detail)$('portrait-empty-hint').textContent=detail;
    $('portrait-empty-hint').hidden=false;
    $('portrait-retry-seeds').hidden=!this.seedFailure;
    $('portrait-show-piece').disabled=arrival.active||!this.records.some(record=>this.photoCache.has(photoKey(record)));
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
      const response=await fetch(new URL('./portrait-seeds/manifest.json?v=20261028-anatomy',import.meta.url),{signal:this.seedAbort.signal});
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
      if(!this.presentedKeys.size) {
        // A pending first visitor still starts from the complete seed face.
        this.atlasContext.clearRect(0,0,SIZE,SIZE);this.atlasContext.drawImage(this.seedAtlas,0,0);
        this.texture.needsUpdate=true;this.arrivalUniform.value=1;this.snapshotAppearance();
        this.presentationReady=true;
      }
    } catch(error) {
      if(!this.disposed)this.seedFailure=error.message;
    } finally {
      clearTimeout(timeout);image?.close();
      aligned.forEach(photo=>{photo.width=photo.height=1;});
      if(assembled)assembled.width=assembled.height=1;
      this.seedLoading=false;
      if(!this.disposed){this.repaintPhotos();this.updateStatus();}
    }
  }

  arrivalLocation() {
    return this.lastArrivalSlots.length===1?`画面${REGION_NAMES[this.lastArrivalSlots[0]]}`:`${this.lastArrivalSlots.length} 处新片段`;
  }

  paintArrivalMask(slots) {
    const ctx=this.arrivalMaskContext;
    ctx.clearRect(0,0,SIZE,SIZE);
    const cells=organicFragmentCells();
    for(const slot of slots) {
      ctx.beginPath();cells[slot].forEach(([x,y],i)=>i?ctx.lineTo(x*SIZE,y*SIZE):ctx.moveTo(x*SIZE,y*SIZE));ctx.closePath();
      ctx.filter='blur(5px)';ctx.fillStyle='#00ff00';ctx.fill();
      ctx.lineWidth=7;ctx.strokeStyle='#ff0000';ctx.lineJoin='round';ctx.stroke();ctx.filter='none';
    }
    this.arrivalMaskTexture.needsUpdate=true;
  }

  snapshotAppearance() {
    const mix=this.arrivalUniform.value;
    if(mix>=1) {
      this.fromContext.clearRect(0,0,SIZE,SIZE);this.fromContext.drawImage(this.atlas,0,0);
    } else if(mix>0) {
      const from=this.fromContext.getImageData(0,0,SIZE,SIZE);
      const to=this.atlasContext.getImageData(0,0,SIZE,SIZE);
      blendLinearPixels(from.data,to.data,mix,from.data);this.fromContext.putImageData(from,0,0);
    }
    this.fromTexture.needsUpdate=true;
  }

  repaintPhotos({immediate=false}={}) {
    if(this.disposed||!this.ready)return;
    const aligned=this.records.map(record=>this.photoCache.get(photoKey(record))||null);
    this.loadedCount=aligned.filter(Boolean).length;
    // Wait for the initial seed attempt so a first visitor emerges from the
    // assembled face, even when their photo finishes loading before the atlas.
    if(this.seedLoading&&!this.seedAtlas&&this.records.length)return;
    const seedImages=this.seedAtlas?Array(20).fill(this.seedAtlas):[];
    if(!this.presentationReady) {
      paintCollage(this.atlasContext,[],SIZE,BASE_COLOR,{records:[],seedImages});
      this.arrivalUniform.value=1;this.presentationReady=true;
    }
    const nextKeys=new Map(planPatchAssignments(this.records).filter(p=>p.recordIndex!==null&&aligned[p.recordIndex]).map(p=>[p.slot,photoKey(this.records[p.recordIndex])]));
    const arrivals=[...nextKeys].filter(([slot,key])=>this.presentedKeys.get(slot)!==key).map(([slot])=>slot);
    const removed=[...this.presentedKeys.keys()].some(slot=>!nextKeys.has(slot));
    const seedChanged=this.presentedSeed!==this.seedAtlas;
    // A failed image retry must not fast-forward another person's active fade.
    if(!immediate&&!arrivals.length&&!removed&&!seedChanged)return;
    const activeArrival=this.arrival.snapshot();
    const revealSlots=arrivals.length?arrivals:seedChanged&&activeArrival.active?activeArrival.slots:[];
    // An interrupted fade starts from the currently visible colour, not its
    // old source or destination. Only two atlas textures are uploaded per join.
    this.snapshotAppearance();
    paintCollage(this.atlasContext,aligned,SIZE,BASE_COLOR,{records:this.records,seedImages});
    this.texture.needsUpdate=true;this.presentedKeys=nextKeys;this.presentedSeed=this.seedAtlas;
    if(!immediate&&!removed&&revealSlots.length) {
      this.lastArrivalSlots=revealSlots;
      this.arrival.begin(revealSlots,{reducedMotion:this.reducedMotion.matches});
      this.paintArrivalMask(revealSlots);this.arrivalUniform.value=0;this.glowUniform.value=0;
      this.photoUniform.value=1;this.prepareContribution(revealSlots.at(-1));
    } else {
      this.arrival.clear();this.contribution.clear();this.arrivalUniform.value=1;this.glowUniform.value=0;
      this.snapshotAppearance();this.paintArrivalMask([]);
      if(!this.records.length)this.lastArrivalSlots=[];
    }
    this.syncArrivalDisplay(this.arrival.snapshot());
  }

  prepareContribution(slot,replay=false) {
    const patch=planPatchAssignments(this.records)[slot],record=this.records[patch?.recordIndex];
    this.contribution.show({image:record&&this.photoCache.get(photoKey(record)),slot,head:this.head,location:`画面${REGION_NAMES[slot]}`,replay});
  }

  replayContribution() {
    const record=[...this.records].reverse().find(record=>this.photoCache.has(photoKey(record)));
    if(!record||!this.ready)return;
    this.snapshotAppearance();this.lastArrivalSlots=[record.slot];this.resetView();
    this.arrival.begin([record.slot],{reducedMotion:this.reducedMotion.matches});this.paintArrivalMask([record.slot]);
    // Replay is a guide only: both atlases hold the already settled face.
    this.fromContext.clearRect(0,0,SIZE,SIZE);this.fromContext.drawImage(this.atlas,0,0);this.fromTexture.needsUpdate=true;
    this.prepareContribution(record.slot,true);this.syncArrivalDisplay(this.arrival.snapshot());
    $('portrait-workspace').scrollIntoView({behavior:'instant',block:'center'});
  }

  syncArrivalDisplay(arrival) {
    this.arrivalUniform.value=arrival.mix;this.glowUniform.value=arrival.glow;
    const note=$('portrait-arrival-note');note.hidden=!arrival.active;
    if(arrival.active) {
      const location=this.arrivalLocation();
      if($('portrait-arrival-location').textContent!==location)$('portrait-arrival-location').textContent=location;
      note.style.opacity=String(this.reducedMotion.matches?1:Math.min(1,(ARRIVAL_SECONDS-arrival.elapsed)/.5));
    }
    this.stage.dataset.arrivalPhase=arrival.phase;
    this.stage.dataset.arrivalMix=arrival.mix.toFixed(3);
    this.stage.dataset.arrivalGlow=arrival.glow.toFixed(3);
    this.stage.dataset.arrivalElapsed=arrival.elapsed.toFixed(3);
    this.stage.dataset.arrivalSlots=arrival.active?arrival.slots.join(','):'';
    if(arrival.phase!==this.arrivalPhase){this.arrivalPhase=arrival.phase;this.updateStatus();}
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
    this.loadingPhotos=missing.length>0;
    this.loadedCount=records.length-missing.length;this.updateStatus();
    if(!records.length){this.repaintPhotos({immediate:true});this.updateStatus();return;}
    if(!missing.length){this.repaintPhotos();this.updateStatus();return;}
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
    const rect=this.stage.getBoundingClientRect();
    const visible=!document.hidden&&rect.width>0&&Math.min(rect.bottom,innerHeight)-Math.max(rect.top,0)>Math.min(180,rect.height*.35);
    const wasActive=this.arrival.snapshot().active;
    const arrival=this.arrival.advance(delta,{visible,reducedMotion:this.reducedMotion.matches});
    if(wasActive||arrival.active)this.syncArrivalDisplay(arrival);
    if(wasActive&&!arrival.active){this.snapshotAppearance();this.paintArrivalMask([]);if(!this.reducedMotion.matches)this.contribution.clear();}
    if(document.hidden||rect.width<1)return;
    const alpha=1-Math.exp(-delta/(this.reducedMotion.matches?.45:.65));
    for(const mesh of this.morphMeshes)for(const [name,index] of Object.entries(mesh.morphTargetDictionary)) {
      const step=((this.targetMorphs[name]||0)-mesh.morphTargetInfluences[index])*alpha;
      mesh.morphTargetInfluences[index]+=step;
    }
    if(this.head) this.stage.dataset.jawOpen=(this.head.morphTargetInfluences[this.head.morphTargetDictionary.jawOpen]||0).toFixed(3);
    this.photoUniform.value+=((this.loadedCount||this.seedAtlas?1:0)-this.photoUniform.value)*alpha;
    // A gentle oscillation keeps the open sculptural mask facing the viewer.
    this.controls.autoRotate=false;
    if(this.model) {
      const target=this.autoRotate&&!this.reducedMotion.matches&&!arrival.active?Math.sin(time*.00016)*.20:0;
      this.model.rotation.y+=(target-this.model.rotation.y)*(1-Math.exp(-delta/1.4));
    }
    this.controls.update(delta);
    this.contribution.update(arrival,this.camera,this.reducedMotion.matches);
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
    this.arrival.clear();this.contribution.dispose();this.fromTexture.dispose();this.arrivalMaskTexture.dispose();
    this.fromAtlas.width=this.fromAtlas.height=this.arrivalMask.width=this.arrivalMask.height=1;
    this.resizeObserver.disconnect();this.controls.dispose();this.texture.dispose();this.clearAtlas();
    this.scene.traverse(o=>{o.geometry?.dispose();o.material?.dispose();});this.renderer.dispose();
    window.removeEventListener('emotion:state',this.listener);
    window.removeEventListener('portrait:reveal',this.revealListener);
  }
}

const stage=$('portrait-stage');
if(stage) {
  try {new GroupPortrait(stage);}
  catch(error) {$('portrait-status').textContent=`无法启动三维显示：${error.message}。采集功能仍可使用。`;stage.dataset.model='error';}
}
