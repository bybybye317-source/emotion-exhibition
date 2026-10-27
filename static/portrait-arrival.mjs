const clamp01 = value => Math.max(0, Math.min(1, value));
const smootherstep = value => {const x=clamp01(value);return x*x*x*(x*(x*6-15)+10);};
const REVEAL_SECONDS=4.8, ARRIVAL_SECONDS=6.2, REDUCED_SECONDS=.65;

/** A visible-time clock: callers can suspend it while the face is out of view. */
export class FragmentArrival {
  constructor() {this.clear();}

  clear() {
    this._slots=[];this._mix=1;this._glow=0;this._elapsed=0;this._active=false;
    this._reduced=false;this._reducedAt=0;this._reducedFrom=0;
    return this.snapshot();
  }

  begin(slots,{reducedMotion=false}={}) {
    this.clear();
    this._slots=[...new Set((Array.isArray(slots)?slots:[]).filter(slot=>Number.isInteger(slot)&&slot>=0&&slot<20))];
    if(!this._slots.length)return this.snapshot();
    this._mix=0;this._active=true;this._reduced=Boolean(reducedMotion);
    return this.snapshot();
  }

  advance(delta,{visible=true,reducedMotion=false}={}) {
    if(!this._active)return this.snapshot();
    // Once requested, reduced motion remains in effect for this arrival.
    // Continue from the current mix instead of replaying its beginning.
    if(reducedMotion&&!this._reduced) {
      this._reduced=true;this._reducedAt=this._elapsed;this._reducedFrom=this._mix;
      this._glow=0;
      if(this._mix===1)this._active=false;
    }
    if(!this._active||!visible)return this.snapshot();
    const step=Number.isFinite(delta)&&delta>0?delta:0;
    const end=this._reduced?this._reducedAt+REDUCED_SECONDS:ARRIVAL_SECONDS;
    this._elapsed=Math.min(end,this._elapsed+step);
    if(this._reduced) {
      const progress=smootherstep((this._elapsed-this._reducedAt)/REDUCED_SECONDS);
      this._mix=this._reducedFrom+(1-this._reducedFrom)*progress;
      this._glow=0;
    } else {
      this._mix=smootherstep(this._elapsed/REVEAL_SECONDS);
      this._glow=smootherstep(this._elapsed/.7)*(1-smootherstep((this._elapsed-3.8)/2.4));
    }
    if(this._elapsed>=end) {this._mix=1;this._glow=0;this._active=false;}
    return this.snapshot();
  }

  snapshot() {
    return {slots:this._slots.slice(),mix:this._mix,glow:this._glow,active:this._active,
      elapsed:this._elapsed,phase:!this._active?'idle':this._elapsed===0?'waiting':this._mix<1?'revealing':'settling'};
  }
}

const srgbToLinear=Float64Array.from({length:256},(_,index)=>{
  const channel=index/255;
  return channel<=.04045?channel/12.92:((channel+.055)/1.055)**2.4;
});
const linearToSrgb=Uint8Array.from({length:65536},(_,index)=>{
  const channel=index/65535;
  return Math.round(255*(channel<=.0031308?channel*12.92:1.055*channel**(1/2.4)-.055));
});

/**
 * Snapshot a GPU-style linear-light blend into an opaque 8-bit sRGB atlas.
 * Called only when an arrival is interrupted, not on every animation frame.
 * The optional output may be the same buffer as either input.
 */
export function blendLinearPixels(fromRGBA,toRGBA,mix,outRGBA) {
  const length=fromRGBA?.length;
  if(!Number.isInteger(length)||length<0||length%4||toRGBA?.length!==length||
    (outRGBA!==undefined&&outRGBA?.length!==length))throw new RangeError('Portrait RGBA buffers must have equal lengths divisible by four');
  const output=outRGBA??new Uint8ClampedArray(length);
  const weight=Number.isFinite(mix)?clamp01(mix):0;
  if(weight===0||weight===1) {
    const source=weight===0?fromRGBA:toRGBA;
    for(let i=0;i<length;i+=4) {
      output[i]=source[i];output[i+1]=source[i+1];output[i+2]=source[i+2];output[i+3]=255;
    }
    return output;
  }
  for(let i=0;i<length;i+=4) {
    for(let channel=0;channel<3;channel++) {
      const linear=srgbToLinear[fromRGBA[i+channel]]*(1-weight)+srgbToLinear[toRGBA[i+channel]]*weight;
      output[i+channel]=linearToSrgb[Math.round(linear*65535)];
    }
    output[i+3]=255;
  }
  return output;
}
