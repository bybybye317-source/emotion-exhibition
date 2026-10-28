import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {createAlignedPhoto, paintCollage} from './portrait-collage.mjs?v=20261028-real';
import {ARRIVAL_SECONDS, FragmentArrival, blendCoveredPixels} from './portrait-arrival.mjs?v=20261028-real';
import {LABELS, morphWeights, normalizeScores, organicFragmentCells, planPatchAssignments} from './portrait-math.mjs?v=20261028-real';

import {calibratedProjection} from './portrait-features.mjs?v=20261028-real';
import {ContributionGuide} from './portrait-contribution.mjs?v=20261028-real';

const $ = id => document.getElementById(id);
const SIZE = 1024;
const BASE_COLOR = '#aeb0ae';
import {PORTRAIT_REGION_COUNT, REGION_NAMES} from './portrait-regions.mjs?v=20261028-real';
import {PortraitSources, createSourceThumbnail, sourceLabel} from './portrait-sources.mjs?v=20261028-real';
const photoKey = record => JSON.stringify([record.id,record.image_url,record.photo_anchors]);
const MODEL_URL = new URL('./models/sculpture-head.glb', import.meta.url);
const clamp01 = value => Math.min(1,Math.max(0,value));
const smooth = (a,b,x) => {const t=clamp01((x-a)/(b-a));return t*t*(3-2*t);};
const canvas = () => Object.assign(document.createElement('canvas'), {width:SIZE,height:SIZE});

class GroupPortrait {
  constructor(stage) {
    this.stage=stage;this.connected=false;this.records=[];this.scores={};this.preview='group';
    this.photoCache=new Map();this.sourceCache=new Map();this.sources=new PortraitSources(id=>this.replayContribution(id));
    this.generation=0;this.signature=null;this.loadedCount=0;this.loadingPhotos=false;
    this.targetMorphs={};this.morphMeshes=[];this.autoRotate=false;this.ready=false;this.failure=null;
    this.abort=null;this.disposed=false;this.lastFrame=performance.now();this.lastStats=0;this.blend=0;
    this.atlas=canvas();this.atlasContext=this.atlas.getContext('2d');this.clearAtlas();
    this.texture=new THREE.CanvasTexture(this.atlas);this.texture.colorSpace=THREE.SRGBColorSpace;
    this.texture.anisotropy=4;this.texture.flipY=true;
    this.photoUniform={value:0};
    this.arrival=new FragmentArrival();this.arrivalUniform={value:1};this.glowUniform={value:0};
    this.presentedKeys=new Map();this.presentationReady=false;this.lastArrivalSlots=[];
    this.fromAtlas=canvas();this.fromContext=this.fromAtlas.getContext('2d',{willReadFrequently:true});
    this.fromContext.drawImage(this.atlas,0,0);
    this.fromTexture=new THREE.CanvasTexture(this.fromAtlas);this.fromTexture.colorSpace=THREE.SRGBColorSpace;
    this.fromTexture.flipY=true;this.fromTexture.anisotropy=4;
    this.coverage=canvas();this.coverageContext=this.coverage.getContext('2d',{willReadFrequently:true});
    this.fromCoverage=canvas();this.fromCoverageContext=this.fromCoverage.getContext('2d',{willReadFrequently:true});
    this.coverageTexture=new THREE.CanvasTexture(this.coverage);this.fromCoverageTexture=new THREE.CanvasTexture(this.fromCoverage);
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
      this.loadPhotos(this.records);this.updateStatus();
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
      shader.uniforms.portraitCoverage={value:this.coverageTexture};
      shader.uniforms.portraitPreviousCoverage={value:this.fromCoverageTexture};
      shader.uniforms.portraitArrivalMask={value:this.arrivalMaskTexture};
      shader.uniforms.portraitArrivalMix=this.arrivalUniform;
      shader.uniforms.portraitArrivalGlow=this.glowUniform;
      shader.uniforms.portraitEyeCenter={value:eyeCenter||new THREE.Vector3(10,10,10)};
      shader.uniforms.portraitBaseColor={value:new THREE.Color(BASE_COLOR)};
      shader.vertexShader='attribute float portraitWeight;\nvarying float vPortraitWeight;\nvarying vec3 vSculpturePosition;\n'+shader.vertexShader;
      shader.vertexShader=shader.vertexShader.replace('#include <uv_vertex>','#include <uv_vertex>\nvPortraitWeight = portraitWeight;\nvSculpturePosition = position;');
      shader.fragmentShader='uniform sampler2D portraitCoverage;\nuniform sampler2D portraitPreviousCoverage;\nuniform sampler2D portraitPreviousMap;\nuniform sampler2D portraitArrivalMask;\nuniform float portraitArrivalMix;\nuniform float portraitArrivalGlow;\nuniform vec3 portraitEyeCenter;\nuniform float portraitPhotoMix;\nuniform vec3 portraitBaseColor;\nvarying float vPortraitWeight;\nvarying vec3 vSculpturePosition;\n'+shader.fragmentShader;
      shader.fragmentShader=shader.fragmentShader.replace('#include <map_fragment>',`
        float beforeCoverage=texture2D(portraitPreviousCoverage,vMapUv).r*(1.0-portraitArrivalMix);
        float afterCoverage=texture2D(portraitCoverage,vMapUv).r*portraitArrivalMix;
        float coverage=beforeCoverage+afterCoverage;
        vec3 photograph=(texture2D(portraitPreviousMap,vMapUv).rgb*beforeCoverage+texture2D(map,vMapUv).rgb*afterCoverage)/max(coverage,0.00001);
        float photoPresence=coverage*portraitPhotoMix;
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
          afterCoverage/max(coverage,0.00001)
        );
        float edgeCoverage=mix(textureLod(portraitPreviousCoverage,edgeUv,edgeLod).r,textureLod(portraitCoverage,edgeUv,edgeLod).r,portraitArrivalMix);
        vec3 localEdge=mix(textureLod(portraitPreviousMap,vMapUv,edgeLod).rgb,textureLod(map,vMapUv,edgeLod).rgb,afterCoverage/max(coverage,0.00001));
        edgeSkin=mix(localEdge,edgeSkin,smoothstep(0.35,0.92,edgeCoverage));
        vec3 surface = mix(edgeSkin * 0.72, photograph, vPortraitWeight);
        // Quiet mineral variation, evaluated in object space so it stays on the sculpture.
        float grain = fract(sin(dot(floor(vSculpturePosition * 380.0), vec3(12.9898,78.233,39.425))) * 43758.5453);
        vec3 stone = portraitBaseColor * (0.975 + grain * 0.05);
        float eyeRadius = length(vSculpturePosition.xy - portraitEyeCenter.xy);
        float iris = 1.0-smoothstep(0.050,0.060,eyeRadius);
        float pupil = 1.0-smoothstep(0.018,0.026,eyeRadius);
        stone *= 1.0 - iris*0.24 - pupil*0.32;
        diffuseColor.rgb *= mix(stone, surface * 0.30, photoPresence);
      `);
      shader.fragmentShader=shader.fragmentShader.replace('#include <emissivemap_fragment>', `
        #include <emissivemap_fragment>
        // Preserve the photographed details and illumination; a smaller lit
        // component still follows the sculpture instead of double-lighting skin.
        totalEmissiveRadiance += surface * 0.70 * photoPresence;
        vec4 arrivalMask = texture2D(portraitArrivalMask, vMapUv);
        float arrivalLight = (arrivalMask.r * 0.16 + arrivalMask.g * 0.022) * arrivalMask.a;
        totalEmissiveRadiance += vec3(0.95, 0.72, 0.40) * arrivalLight * portraitArrivalGlow * vPortraitWeight;
      `);
    };
    material.customProgramCacheKey=()=> 'sculpted-portrait-collage-v7';
    return material;
  }

  bindControls() {
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
    this.records=(state.session.participants||[]).slice(-PORTRAIT_REGION_COUNT);
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
    let status=this.records.length?'每一块照片，都有自己的来处':'等待第一张真实面孔';
    let detail=`空白模型上的 ${PORTRAIT_REGION_COUNT} 处细分区域，等待观众逐一填入。眉眼、鼻子与嘴唇保留完整。`;
    if(this.records.length)detail=`${this.loadedCount} 块观众照片 · ${PORTRAIT_REGION_COUNT-this.loadedCount} 处空白。点击下方观众照片，查看他贡献的位置。`;
    const arrival=this.arrival.snapshot();
    if(this.lastArrivalSlots.length&&this.loadedCount)detail+=` 当前定位：${this.arrivalLocation()}。`;
    if(arrival.active){status='你的片段正在融入';detail=`${this.arrivalLocation()}正在慢慢浮现，柔光会在融入后散去。`;}
    if(this.loadingPhotos) status='正在将新片段拼入肖像…';
    else if(this.loadedCount<this.records.length) status=`已拼入 ${this.loadedCount}/${this.records.length} 块；部分照片不可用`;
    if(this.preview!=='group') status=`预览：${LABELS[this.preview]} · 不改变采集数据`;
    if(!this.connected) status='正在准备本地体验';
    if(!this.ready) status='正在加载三维人脸…';
    if(this.failure)status=this.failure;
    if($('portrait-status').textContent!==status)$('portrait-status').textContent=status;
    if($('portrait-empty-hint').textContent!==detail)$('portrait-empty-hint').textContent=detail;
    $('portrait-empty-hint').hidden=false;
    $('portrait-show-piece').disabled=arrival.active||!this.records.some(record=>this.photoCache.has(photoKey(record)));
    this.stage.dataset.participants=String(this.records.length);
    this.stage.dataset.photos=String(this.loadedCount);
    this.stage.dataset.seeds='0';this.stage.dataset.regions=String(PORTRAIT_REGION_COUNT);
    this.sources.update(this.records,this.sourceCache,{busy:arrival.active});
    this.stage.dataset.connected=String(this.connected);
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
      this.fromCoverageContext.clearRect(0,0,SIZE,SIZE);this.fromCoverageContext.drawImage(this.coverage,0,0);
    } else if(mix>0) {
      const from=this.fromContext.getImageData(0,0,SIZE,SIZE);
      const to=this.atlasContext.getImageData(0,0,SIZE,SIZE);
      const oldMask=this.fromCoverageContext.getImageData(0,0,SIZE,SIZE),newMask=this.coverageContext.getImageData(0,0,SIZE,SIZE);
      blendCoveredPixels(from.data,to.data,oldMask.data,newMask.data,mix);this.fromContext.putImageData(from,0,0);this.fromCoverageContext.putImageData(oldMask,0,0);
    }
    this.fromTexture.needsUpdate=true;this.fromCoverageTexture.needsUpdate=true;
  }

  repaintPhotos({immediate=false}={}) {
    if(this.disposed||!this.ready)return;
    const aligned=this.records.map(record=>this.photoCache.get(photoKey(record))||null);
    this.loadedCount=aligned.filter(Boolean).length;
    if(!this.presentationReady) {
      paintCollage(this.atlasContext,[],SIZE,BASE_COLOR,{records:[],coverageContext:this.coverageContext});
      this.arrivalUniform.value=1;this.presentationReady=true;
    }
    const nextKeys=new Map(planPatchAssignments(this.records).filter(p=>p.recordIndex!==null&&aligned[p.recordIndex]).map(p=>[p.slot,photoKey(this.records[p.recordIndex])]));
    const arrivals=[...nextKeys].filter(([slot,key])=>this.presentedKeys.get(slot)!==key).map(([slot])=>slot);
    const removed=[...this.presentedKeys.keys()].some(slot=>!nextKeys.has(slot));
    // A failed image retry must not fast-forward another person's active fade.
    if(!immediate&&!arrivals.length&&!removed)return;
    const revealSlots=arrivals;
    // An interrupted fade starts from the currently visible colour, not its
    // old source or destination. Colour and coverage move together per join.
    this.snapshotAppearance();
    paintCollage(this.atlasContext,aligned,SIZE,BASE_COLOR,{records:this.records,coverageContext:this.coverageContext});
    this.texture.needsUpdate=true;this.coverageTexture.needsUpdate=true;this.presentedKeys=nextKeys;
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
    if(record)this.sources.select(record.id);
    this.contribution.show({image:record&&this.photoCache.get(photoKey(record)),slot,head:this.head,location:`${sourceLabel(record,this.records.indexOf(record))} · 画面${REGION_NAMES[slot]}`,replay});
  }

  replayContribution(id) {
    const record=[...this.records].reverse().find(record=>(!id||record.id===id)&&this.photoCache.has(photoKey(record)));
    if(!record||!this.ready)return;
    this.snapshotAppearance();this.lastArrivalSlots=[record.slot];this.resetView();
    this.arrival.begin([record.slot],{reducedMotion:this.reducedMotion.matches});this.paintArrivalMask([record.slot]);
    // Replay is a guide only: both atlases hold the already settled face.
    this.fromContext.clearRect(0,0,SIZE,SIZE);this.fromContext.drawImage(this.atlas,0,0);this.fromTexture.needsUpdate=true;
    this.fromCoverageContext.clearRect(0,0,SIZE,SIZE);this.fromCoverageContext.drawImage(this.coverage,0,0);this.fromCoverageTexture.needsUpdate=true;
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
      const source=this.sourceCache.get(key);if(source)source.width=source.height=1;this.sourceCache.delete(key);
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
        this.sourceCache.set(photoKey(missing[i]),createSourceThumbnail(image,missing[i].photo_anchors));
      } catch { /* Only this participant stays blank. */ }
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
    this.photoUniform.value+=((this.loadedCount?1:0)-this.photoUniform.value)*alpha;
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
    this.disposed=true;++this.generation;this.abort?.abort();
    for(const photo of this.photoCache.values())photo.width=photo.height=1;
    this.photoCache.clear();for(const source of this.sourceCache.values())source.width=source.height=1;this.sourceCache.clear();this.sources.dispose();cancelAnimationFrame(this.frameId);
    clearTimeout(this.photoRetryTimer);
    this.arrival.clear();this.contribution.dispose();this.fromTexture.dispose();this.arrivalMaskTexture.dispose();
    this.coverageTexture.dispose();this.fromCoverageTexture.dispose();
    this.coverage.width=this.coverage.height=this.fromCoverage.width=this.fromCoverage.height=1;
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
