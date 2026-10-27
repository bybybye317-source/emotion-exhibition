import {VISUAL_EMOTIONS, visualProfile, createMatterState, advanceMatterState} from './music-visual-math.mjs?v=20261027-emotions';

const vertex = `
precision highp float;
attribute vec2 aUv;
uniform float uTime;uniform float uAspect;uniform vec4 uMood;uniform vec4 uForm;
uniform vec4 uAudio;uniform vec4 uLayers;uniform float uDrive;
varying vec3 vNormal;varying vec3 vPosition;varying vec2 vUv;varying float vCrease;
mat2 rot(float a){return mat2(cos(a),-sin(a),sin(a),cos(a));}
vec3 surface(vec2 uv){
 float a=-.65+uv.x*uForm.w;
 float v=(uv.y-.5)*2.;
 float t=uTime*.22;
 float wave=sin(a*(3.-uMood.x*.65)+v*2.4-t)*(.13+uAudio.y*.048+uLayers.x*.035);
 wave+=sin(a*7.1-v*4.3+t*.61)*(.055+uAudio.y*.026)*(1.-uMood.x*.42);
 wave+=sin(a*13.4+v*7.-t*.32)*(.021+uAudio.z*.014);
 float crease=sin(a*8.4+v*5.2-t*1.6);
 wave+=uMood.z*.12*crease/(.38+abs(crease));
 // Fear is a local tremor in a folded edge, never a global camera shake.
 wave+=uMood.w*.026*uDrive*sin(v*29.+a*17.-t*9.)*exp(-pow(v-.28,2.)*10.);
 // A spectral onset travels through a localized crease, rather than shaking the camera.
 wave+=uAudio.w*.072*sin(a*9.-v*6.-t*4.)*exp(-pow(v-.25*sin(a*2.),2.)*5.);
 float radius=.76+wave+.05*sin(v*4.-t);
 radius*=1.+uAudio.x*(.10+uMood.z*.12)+uLayers.y*.055;
 radius*=1.+uMood.x*.14*sin(a*.5)+uMood.z*.055*uDrive*sin(t*3.-a*2.);
 float h=.63+.17*sin(a*1.4)+.10*sin(a*2.9);
 float y=v*h;
 float curl=pow(abs(v),3.)*(.17+.12*sin(a*2.)+uAudio.z*.04+uMood.w*.16-uMood.x*.07);
 radius+=curl;
 y+=.10*sin(a*3.5+v*3.+t*.6);
 y-=uMood.y*(.10+.30*pow(abs(v),2.)+.10*sin(a*1.2));
 radius*=1.-uMood.w*.24*(.5+.5*sin(a*1.5-t*.65));
 y+=uMood.x*(.12+.20*(1.-v*v)*sin(a*.8));
 vec3 p=vec3(cos(a)*radius,y,sin(a)*radius);
 p.z+=uMood.z*.16*(1.-v*v);
 p.xz=rot(y*(.58+uLayers.w*.12+uMood.w*.52)+.17*sin(y*2.-t*.3))*p.xz;
 p.yz=rot(.24)*p.yz;
 p.xz=rot(-.52+.065*sin(t*.37))*p.xz;
 p.x*=uForm.x;
 p.y*=uForm.y;
 p.x+=uMood.w*.16*v*v;
 p.xy=rot(uForm.z)*p.xy;
 p.y+=uMood.x*.02+uMood.y*.22;
 p.x+=.07;
 return p;
}
void main(){
 vec3 p=surface(aUv);
 vec3 du=surface(aUv+vec2(.001,0.))-p;
 vec3 dv=surface(aUv+vec2(0.,.001))-p;
 vNormal=normalize(cross(du,dv));vPosition=p;vUv=aUv;
 vCrease=.5+.5*sin(aUv.x*31.+aUv.y*13.-uTime*.22);
 float z=3.5-p.z;
 // Fit the broadest folded sheet in portrait as well as landscape; keep the
 // heading and transport clear even when real audio expands the membrane.
 float fit=min(1.,uAspect/1.15);
 gl_Position=vec4(p.x*1.46*fit/uAspect,p.y*1.46*fit+.025*z,1.01*z-.2,z);
}`;

const fragment = `
precision highp float;
varying vec3 vNormal;varying vec3 vPosition;varying vec2 vUv;varying float vCrease;
uniform vec3 uColorA;uniform vec3 uColorB;uniform float uTime;uniform vec4 uMood;uniform vec4 uMaterial;
uniform vec4 uAudio;uniform vec4 uLayers;uniform float uDrive;
void main(){
 vec3 N=normalize(vNormal);if(!gl_FrontFacing)N=-N;
 vec3 V=normalize(vec3(0.,0.,3.5)-vPosition);
 vec3 R=reflect(-V,N);
 vec3 L=normalize(vec3(-1.3,1.5,1.7));
 float facing=clamp(abs(dot(N,V)),0.,1.);
 float fresnel=pow(1.-facing,2.6);
 float front=max(0.,dot(N,L));
 float back=max(0.,dot(-N,L));
 float key=pow(max(0.,dot(R,normalize(vec3(-.4,.85,1.0)))),mix(28.,8.,uMaterial.x));
 float strip=pow(max(0.,1.-abs(dot(R,normalize(vec3(.42,.9,-.1))))),mix(80.,28.,uMaterial.x));
 strip*=smoothstep(-.4,.8,R.z);
 float blue=pow(max(0.,dot(R,normalize(vec3(.7,-.35,1.)))),10.);
 float micro=sin(vUv.x*1800.+sin(vUv.y*45.)*2.4)*.5+.5;
 float fiber=pow(micro,14.);
 float crossFiber=pow(.5+.5*sin(vUv.y*800.+sin(vUv.x*90.)),22.);
 float wrinkle=.5+.5*sin(vUv.x*88.+sin(vUv.y*19.)*2.1+uTime*.05);
 float edge=pow(abs(vUv.y-.5)*2.,10.);
 float ao=.40+.60*smoothstep(.12,.85,vCrease);
 float thickness=.28+.72*(1.-edge);
 vec3 pigment=mix(uColorA*.055,uColorB*.11,front*.4+wrinkle*.25);
 vec3 color=pigment*(.18+front*.4)*ao;
 color+=uColorA*uMaterial.z*(.12+front*.35)*ao;
 color+=uColorB*(key*.85+strip*(.70+uAudio.z*.34+uLayers.z*.30))*(.66+fiber*.25+crossFiber*.09)*ao;
 color+=uColorA*(blue*(.43+uMaterial.w*.45)+fresnel*(.16+uMaterial.y*.18+uAudio.z*.26))*(.6+.4*wrinkle);
 color+=mix(uColorA,uColorB,edge*.8)*(edge*(uMaterial.y*.40+uLayers.z*.28)+back*.04)*(1.-thickness*.4);
 color+=uColorA*.14*pow(1.-thickness,2.)*(.5+.5*sin(vUv.x*14.));
 // Pressure glows inside the compressed creases, not across the whole screen.
 color+=uColorB*uMood.z*pow(1.-smoothstep(.15,.8,vCrease),3.)*(.07+uAudio.x*.13);
 color*=.88+uDrive*.25;
 gl_FragColor=vec4(color,1.);
}`;
const postVertex = `precision highp float;attribute vec2 aPosition;varying vec2 vUv;void main(){vUv=aPosition*.5+.5;gl_Position=vec4(aPosition,0.,1.);}`;
const postFragment = `precision highp float;varying vec2 vUv;uniform sampler2D uImage;uniform vec2 uSize;
float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
void main(){
 vec2 p=1./uSize;vec3 raw=texture2D(uImage,vUv).rgb;vec3 bloom=vec3(0.);
 for(int i=0;i<8;i++){float a=float(i)*.785398;vec2 d=vec2(cos(a),sin(a));bloom+=texture2D(uImage,vUv+d*p*3.).rgb*.07;bloom+=texture2D(uImage,vUv+d*p*9.).rgb*.035;}
 vec3 bg=vec3(.006,.008,.014)+vec3(.008,.012,.019)*exp(-dot(vUv-.5,vUv-.5)*9.);
 vec3 color=bg+raw+bloom*.25;
 color=vec3(1.)-exp(-color*2.4);color=pow(color,vec3(.88));
 color+=(hash(gl_FragCoord.xy)-.5)*.013;
 gl_FragColor=vec4(color,1.);
}`;

function createProgram(gl, vert, frag) {
  const program = gl.createProgram(), shaders = [], attached = [];
  let linked = false;
  if (!program) throw new Error('图形程序未能创建。');
  try {
    for (const [type, source] of [[gl.VERTEX_SHADER, vert], [gl.FRAGMENT_SHADER, frag]]) {
      const shader = gl.createShader(type);
      if (!shader) throw new Error('图形程序未能创建。');
      shaders.push(shader); gl.shaderSource(shader, source); gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(`画面材质编译失败：${gl.getShaderInfoLog(shader) || 'unknown'}`);
      gl.attachShader(program, shader);
      attached.push(shader);
    }
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(`画面程序连接失败：${gl.getProgramInfoLog(program) || 'unknown'}`);
    linked = true; return program;
  } finally {
    for (const shader of attached) gl.detachShader(program, shader);
    for (const shader of shaders) gl.deleteShader(shader);
    if (!linked) gl.deleteProgram(program);
  }
}

export class MusicMatterVisual {
  constructor(canvas, {onError = () => {}} = {}) {
    this.canvas = canvas; this._onError = onError; this._disposed = false; this._lost = false;
    this.status = 'initializing'; this.available = false; this._resources = [];
    this._profile = visualProfile(null); this._state = createMatterState(this._profile);
    this._scoreValues = [];
    this._firstFrame = true; this._frames = 0; this._needsResize = true;
    this._audioUniform = new Float32Array(4); this._layerUniform = new Float32Array(4);
    this._lossHandler = event => {
      event.preventDefault(); this._lost = true; this.available = false;
      this.status = 'lost'; this.canvas.dataset.status = 'lost'; this._notify(new Error('画面暂时中断，正在等待图形恢复；声音仍可播放。'));
    };
    this._restoreHandler = () => {
      if (this._disposed) return;
      this._lost = false; this._resources = []; this._initialize();
    };
    canvas.addEventListener('webglcontextlost', this._lossHandler);
    canvas.addEventListener('webglcontextrestored', this._restoreHandler);
    if (typeof ResizeObserver === 'function') {
      this._observer = new ResizeObserver(() => { this._needsResize = true; }); this._observer.observe(canvas);
    }
    this._initialize();
  }
  _notify(error) { try { this._onError(error); } catch { /* A status UI cannot break music. */ } }
  _own(kind, object) {
    if (!object) throw new Error('图形资源暂时不足。');
    this._resources.push([kind, object]); return object;
  }
  _initialize() {
    try {
      const gl = this.canvas.getContext('webgl', {alpha:false, antialias:false, preserveDrawingBuffer:true, powerPreference:'low-power'});
      if (!gl) throw new Error('当前浏览器不支持这幅动态画面；声音仍可播放。');
      this.gl = gl;
      const precision = gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER, gl.HIGH_FLOAT);
      const adapt = source => precision?.precision ? source : source.replace('precision highp float;', 'precision mediump float;').replace('color+=(hash(gl_FragCoord.xy)-.5)*.013;', '');
      this.mesh = this._own('Program', createProgram(gl, adapt(vertex), adapt(fragment)));
      this.post = this._own('Program', createProgram(gl, adapt(postVertex), adapt(postFragment)));
      const nx = 192, ny = 120, uv = new Float32Array((nx+1)*(ny+1)*2), indices = new Uint16Array(nx*ny*6);
      let cursor = 0;
      for (let y=0;y<=ny;y++) for (let x=0;x<=nx;x++) { uv[cursor++]=x/nx; uv[cursor++]=y/ny; }
      cursor=0;
      for (let y=0;y<ny;y++) for (let x=0;x<nx;x++) { const a=y*(nx+1)+x,b=a+nx+1; indices.set([a,b,a+1,a+1,b,b+1],cursor);cursor+=6; }
      this._count = indices.length;
      this.vertices=this._own('Buffer', gl.createBuffer());gl.bindBuffer(gl.ARRAY_BUFFER,this.vertices);gl.bufferData(gl.ARRAY_BUFFER,uv,gl.STATIC_DRAW);
      this.indices=this._own('Buffer', gl.createBuffer());gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,this.indices);gl.bufferData(gl.ELEMENT_ARRAY_BUFFER,indices,gl.STATIC_DRAW);
      this.quad=this._own('Buffer', gl.createBuffer());gl.bindBuffer(gl.ARRAY_BUFFER,this.quad);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]),gl.STATIC_DRAW);
      this.meshAttr=gl.getAttribLocation(this.mesh,'aUv');this.postAttr=gl.getAttribLocation(this.post,'aPosition');
      this.uniforms={};for(const name of ['uTime','uAspect','uMood','uForm','uMaterial','uColorA','uColorB','uAudio','uLayers','uDrive'])this.uniforms[name]=gl.getUniformLocation(this.mesh,name);
      this.imageLocation=gl.getUniformLocation(this.post,'uImage');this.sizeLocation=gl.getUniformLocation(this.post,'uSize');
      this.target=this._own('Framebuffer',gl.createFramebuffer());this.texture=this._own('Texture',gl.createTexture());this.depth=this._own('Renderbuffer',gl.createRenderbuffer());
      gl.bindTexture(gl.TEXTURE_2D,this.texture);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
      this._sizeLimit = Math.min(1440, gl.getParameter(gl.MAX_TEXTURE_SIZE), gl.getParameter(gl.MAX_RENDERBUFFER_SIZE));
      this._allocated=false;this._needsResize=true;this.available=true;this.status='ready';
      this.canvas.dataset.renderer='webgl';this.canvas.dataset.status='ready';this._notify(null);
    } catch (error) {
      this._release();this.available=false;this.status='unavailable';this.canvas.dataset.status='unavailable';this._notify(error);
    }
  }
  resize() {
    if (!this.available || this._disposed || this._lost) return false;
    const r=this.canvas.getBoundingClientRect();
    if (!(r.width>0 && r.height>0)) return false;
    const dpr=Math.min(globalThis.devicePixelRatio||1,1.5);
    const ratio=Math.min(dpr,this._sizeLimit/r.width,this._sizeLimit/r.height,Math.sqrt(900000/(r.width*r.height)));
    const width=Math.max(1,Math.round(r.width*ratio)),height=Math.max(1,Math.round(r.height*ratio));
    this._lastDpr=globalThis.devicePixelRatio||1;this._needsResize=false;
    if (this._allocated && this.canvas.width===width && this.canvas.height===height) return true;
    const gl=this.gl;
    try {
      this.canvas.width=width;this.canvas.height=height;
      gl.bindTexture(gl.TEXTURE_2D,this.texture);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,width,height,0,gl.RGBA,gl.UNSIGNED_BYTE,null);
      gl.bindRenderbuffer(gl.RENDERBUFFER,this.depth);gl.renderbufferStorage(gl.RENDERBUFFER,gl.DEPTH_COMPONENT16,width,height);
      gl.bindFramebuffer(gl.FRAMEBUFFER,this.target);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,this.texture,0);gl.framebufferRenderbuffer(gl.FRAMEBUFFER,gl.DEPTH_ATTACHMENT,gl.RENDERBUFFER,this.depth);
      if(gl.checkFramebufferStatus(gl.FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE)throw new Error('动态画面的缓冲区未能建立；声音仍可播放。');
      this._allocated=true;return true;
    } catch(error) {this.available=false;this.status='unavailable';this.canvas.dataset.status='unavailable';this._release();this._notify(error);return false;}
  }
  render({dt=0,audio=null,scores=null,parameters={},reducedMotion=false}={}) {
    if (!this.available || this._disposed || this._lost || this.gl.isContextLost()) return false;
    if (this._needsResize || !this._allocated || this._lastDpr!==(globalThis.devicePixelRatio||1)) { if(!this.resize())return false; }
    // Scores may be updated in place by a host; identity alone is not enough.
    if (this._firstFrame || VISUAL_EMOTIONS.some((key, i) => !Object.is(scores?.[key], this._scoreValues[i]))) {
      this._scoreValues = VISUAL_EMOTIONS.map(key => scores?.[key]); this._profile=visualProfile(scores);
    }
    if(this._firstFrame){this._state=createMatterState(this._profile);this._firstFrame=false;}
    const s=advanceMatterState(this._state,this._profile,audio,dt,reducedMotion,Boolean(parameters?.idle));
    const gl=this.gl,u=this.uniforms;
    this._audioUniform.set([s.bass,s.mid,s.treble,s.flux]);this._layerUniform.set([s.strings,s.brass,s.melody,s.synth]);
    gl.viewport(0,0,this.canvas.width,this.canvas.height);gl.bindFramebuffer(gl.FRAMEBUFFER,this.target);gl.enable(gl.DEPTH_TEST);gl.clearColor(0,0,0,1);gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);gl.useProgram(this.mesh);
    gl.bindBuffer(gl.ARRAY_BUFFER,this.vertices);gl.enableVertexAttribArray(this.meshAttr);gl.vertexAttribPointer(this.meshAttr,2,gl.FLOAT,false,0,0);gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,this.indices);
    gl.uniform1f(u.uTime,s.phase);gl.uniform1f(u.uAspect,this.canvas.width/this.canvas.height);gl.uniform4fv(u.uMood,s.shape);gl.uniform4fv(u.uForm,s.form);gl.uniform4fv(u.uMaterial,s.material);gl.uniform3fv(u.uColorA,s.colorA);gl.uniform3fv(u.uColorB,s.colorB);gl.uniform4fv(u.uAudio,this._audioUniform);gl.uniform4fv(u.uLayers,this._layerUniform);gl.uniform1f(u.uDrive,s.drive);
    gl.drawElements(gl.TRIANGLES,this._count,gl.UNSIGNED_SHORT,0);
    gl.bindFramebuffer(gl.FRAMEBUFFER,null);gl.disable(gl.DEPTH_TEST);gl.useProgram(this.post);gl.bindBuffer(gl.ARRAY_BUFFER,this.quad);gl.enableVertexAttribArray(this.postAttr);gl.vertexAttribPointer(this.postAttr,2,gl.FLOAT,false,0,0);gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,this.texture);gl.uniform1i(this.imageLocation,0);gl.uniform2f(this.sizeLocation,this.canvas.width,this.canvas.height);gl.drawArrays(gl.TRIANGLES,0,6);
    this.canvas.dataset.emotion=this._profile.dominant;this.canvas.dataset.drive=s.drive.toFixed(4);this.canvas.dataset.phase=s.phase.toFixed(4);this.canvas.dataset.frame=String(++this._frames);
    return true;
  }
  _release() {
    if(this.gl && !this.gl.isContextLost())for(const [kind,value] of this._resources)this.gl[`delete${kind}`](value);
    this._resources=[];this._allocated=false;
  }
  dispose() {
    if(this._disposed)return;
    this._disposed=true;this._observer?.disconnect();this.canvas.removeEventListener('webglcontextlost',this._lossHandler);this.canvas.removeEventListener('webglcontextrestored',this._restoreHandler);this._release();this.available=false;this.status='disposed';this.canvas.dataset.status='disposed';
  }
}
