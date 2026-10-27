import {ART, GEOMETRY} from './generated/scent-instrument-art.mjs?v=20261028-flow';
import {deriveFluidState} from './scent-fluid.mjs?v=20261028-flow';
import {PHASE_DURATIONS} from './scent-math.mjs?v=20261028-flow';

const KEYS=Object.keys(GEOMETRY.channels);
const ACTIVE_PHASES=new Set(['mixing','releasing','purging']);
const clamp=(value,min=0,max=1)=>Math.max(min,Math.min(max,Number.isFinite(value)?value:0));
const mixColor=(from,to,amount)=>'#'+[1,3,5].map(offset=>Math.round(parseInt(from.slice(offset,offset+2),16)*(1-amount)+parseInt(to.slice(offset,offset+2),16)*amount).toString(16).padStart(2,'0')).join('');
const liquidPath=(cx,bottom,radius,ellipse,surface)=>`M${cx-radius} ${surface}A${radius} ${ellipse} 0 0 0 ${cx+radius} ${surface}L${cx+radius} ${bottom}A${radius} ${ellipse} 0 0 1 ${cx-radius} ${bottom}Z`;
let instanceId=0;

/** Stateful visual adapter. The simulator, not animation time, owns the cycle. */
export class ScentInstrument {
  constructor(container,{onSelect=()=>{}}={}) {
    if(!container) throw new Error('ScentInstrument requires a container');
    this.container=container;
    this.onSelect=onSelect;
    this.disposed=false;
    this.visible=true;
    this.frame=0;
    this.time=0;
    this.lastTime=null;
    this.updatedAt=performance.now();
    this.snapshot={phase:'stopped',progress:0,outputs:{},purge:0,recipe:null,activeRecipe:null,targetRecipe:null,pending:false,selectedKey:null,enabled:false};
    // Local SVG IDs allow more than one instance without cross-document clips.
    const prefix=`si${++instanceId}-`;
    container.classList.add('scent-instrument-mount');
    container.style.setProperty('--si-glass-url',`url(#${prefix}glass-sheen)`);
    container.style.setProperty('--si-chamber-url',`url(#${prefix}chamber-glow)`);
    container.style.setProperty('--si-soft-url',`url(#${prefix}soft)`);
    container.innerHTML=ART.replaceAll('id="si-','id="'+prefix).replaceAll('url(#si-','url(#'+prefix);
    this.svg=container.querySelector('svg');
    this.buttons=new Map(KEYS.map(key=>[key,this.svg.querySelector(`[data-ingredient="${key}"]`)]));
    this.refs=new Map(KEYS.map(key=>[key,{
      liquid:this.svg.querySelector(`[data-liquid="${key}"]`),
      meniscus:this.svg.querySelector(`[data-meniscus="${key}"]`),
      percent:this.svg.querySelector(`[data-percent="${key}"]`),
      valve:this.svg.querySelector(`[data-valve="${key}"]`),
      pending:this.svg.querySelector(`[data-pending="${key}"]`),
      pipes:[...this.svg.querySelectorAll(`[data-channel-pipe="${key}"]`)],
      flows:[...this.svg.querySelectorAll(`[data-flow="${key}"]`)],
      tracks:[...this.svg.querySelectorAll(`[data-flow-track="${key}"]`)],
      inlet:this.svg.querySelector(`[data-chamber-inlet="${key}"]`),
      ribbon:this.svg.querySelector(`[data-chamber-ribbon="${key}"]`),
      cloud:this.svg.querySelector(`[data-chamber-cloud="${key}"]`),
    }]));
    this.purgeFlows=[...this.svg.querySelectorAll('[data-flow="purge"]')];
    this.purgeTracks=[...this.svg.querySelectorAll('[data-flow-track="purge"]')];
    this.chamberFill=this.svg.querySelector('[data-chamber-fill]');
    this.chamberSurface=this.svg.querySelector('[data-chamber-surface]');
    this.vortex=[...this.svg.querySelectorAll('[data-vortex]')];
    this.mist=[...this.svg.querySelectorAll('[data-mist]')];
    this.glow=this.svg.querySelector('.si-chamber-light');
    this.outlet=this.svg.querySelector('[data-outlet-ring]');
    this.handleClick=event=>{
      const el=event.target.closest('[data-ingredient]');
      if(el&&this.svg.contains(el)) this.onSelect(el.dataset.ingredient);
    };
    this.handleKey=event=>{
      if(event.key!=='Enter'&&event.key!==' ')return;
      const el=event.target.closest('[data-ingredient]');
      if(el){event.preventDefault();this.onSelect(el.dataset.ingredient);}
    };
    this.handleVisibility=()=>this.syncLoop();
    this.svg.addEventListener('click',this.handleClick);
    this.svg.addEventListener('keydown',this.handleKey);
    document.addEventListener('visibilitychange',this.handleVisibility);
    this.motion=matchMedia('(prefers-reduced-motion: reduce)');
    this.motion.addEventListener('change',this.handleVisibility);
    if('IntersectionObserver' in window){
      this.observer=new IntersectionObserver(entries=>{
        this.visible=entries.some(entry=>entry.isIntersecting);
        this.syncLoop();
      },{threshold:0});
      this.observer.observe(container);
    }
    this.tick=now=>{
      this.frame=0;
      if(!this.shouldAnimate())return;
      this.time+=this.lastTime===null?0:Math.min(64,now-this.lastTime)/1000;
      this.lastTime=now;
      this.renderMotion();
      this.frame=requestAnimationFrame(this.tick);
    };
    this.update(this.snapshot);
  }
  update(snapshot={}) {
    if(this.disposed)return;
    this.snapshot={...this.snapshot,...snapshot,outputs:{...(snapshot.outputs||{})}};
    const s=this.snapshot;
    this.updatedAt=performance.now();
    this.container.dataset.phase=s.phase;
    this.container.dataset.enabled=String(Boolean(s.enabled));
    this.container.dataset.pending=String(Boolean(s.pending));
    for(const key of KEYS){
      const refs=this.refs.get(key), geometry=GEOMETRY.channels[key];
      const raw=s.recipe?.percentages?.[key];
      const ratio=clamp(raw,0,100);
      const height=geometry.fillHeight*ratio/100;
      // A clipping mask and matching projected meniscus keep liquid in glass.
      const {x:cx,rx:radius,ry:ellipse,bottom}=geometry;
      const surface=bottom-height;
      refs.liquid.setAttribute('d',liquidPath(cx,bottom,radius,ellipse,surface));
      refs.liquid.style.opacity=ratio>0?'.53':'0';
      refs.meniscus.setAttribute('cy',geometry.bottom-height);
      refs.meniscus.style.opacity=ratio>0?'.72':'0';
      refs.percent.textContent=Number.isFinite(raw)?`${Math.round(ratio)}%`:'—';
      const {x,y,rx,ry}=geometry.valve;
      const angle=(-150+ratio*3)*Math.PI/180;
      refs.valve.setAttribute('d',`M${x} ${y}L${x+Math.cos(angle)*rx} ${y+Math.sin(angle)*ry}`);
      const selected=key===s.selectedKey;
      const button=this.buttons.get(key);
      button.setAttribute('aria-pressed',String(selected));
      button.setAttribute('aria-label',`${geometry.label}，${Number.isFinite(raw)?Math.round(ratio)+'%':'暂无配方'}，查看原料和情绪原因`);
      refs.pipes.forEach(pipe=>pipe.dataset.selected=String(selected));
      const delta=Math.abs((s.targetRecipe?.percentages?.[key]??ratio)-ratio);
      refs.pending.style.opacity=s.pending&&delta>=1?'.62':'0';
    }
    this.renderMotion();
    this.syncLoop();
  }
  shouldAnimate(){
    return !this.disposed&&this.visible&&!document.hidden&&!this.motion.matches&&this.snapshot.enabled&&ACTIVE_PHASES.has(this.snapshot.phase);
  }
  syncLoop(){
    if(this.disposed)return;
    const animate=this.shouldAnimate();
    this.container.dataset.motion=animate?'running':'still';
    if(animate&&!this.frame){this.lastTime=null;this.frame=requestAnimationFrame(this.tick);}
    else if(!animate&&this.frame){cancelAnimationFrame(this.frame);this.frame=0;this.lastTime=null;}
    this.renderMotion();
  }
  renderMotion(){
    const s=this.snapshot;
    const moving=this.shouldAnimate();
    const elapsed=moving?Math.max(0,performance.now()-this.updatedAt):0;
    const progress=clamp(s.progress+elapsed/(PHASE_DURATIONS[s.phase]||1));
    const fluid=deriveFluidState({...s,progress});
    const t=this.motion.matches?0:this.time;
    const dosing=fluid.stage==='dosing';
    const mixing=dosing||fluid.stage==='blending';
    const releasing=fluid.stage==='releasing';
    const visibleFill=fluid.fill>.0001;
    this.container.dataset.fluidStage=fluid.stage;
    this.container.dataset.fill=fluid.fill.toFixed(3);
    this.container.dataset.blend=fluid.blend.toFixed(3);

    // Segments use cumulative real path lengths: pulses keep their direction
    // and phase through elbows, valves, and depth-sorted pieces of one feed.
    for(const [index,key] of KEYS.entries()){
      const refs=this.refs.get(key),g=GEOMETRY.channels[key];
      const ingredient=fluid.ingredients[key];
      const weight=ingredient?.weight||0;
      const color=ingredient?.color||g.color;
      const isDosing=dosing&&weight>0;
      const trackOpacity=mixing&&weight>0?.42*(1-fluid.blend):0;
      refs.tracks.forEach(track=>{
        const length=Number(track.dataset.flowLength),distance=Number(track.dataset.flowDistance);
        const reached=clamp(fluid.front*g.flowLength-distance,0,length);
        track.style.stroke=color;
        track.style.strokeDasharray=`${reached} ${length+1}`;
        track.style.opacity=String(reached>0?trackOpacity:0);
      });
      refs.flows.forEach(flow=>{
        const length=Number(flow.dataset.flowLength),distance=Number(flow.dataset.flowDistance);
        const reached=clamp(fluid.front*g.flowLength-distance,0,length);
        flow.dataset.flowState=isDosing?'dosing':'closed';
        flow.style.stroke=mixColor(color,'#ffffff',.18);
        flow.style.opacity=isDosing&&reached>0?String(fluid.inflow*(.62+.34*Math.sqrt(weight))):'0';
        if(reached<length-.1){
          flow.style.strokeDasharray=`${reached} ${length+1}`;
          flow.style.strokeDashoffset='0';
        } else {
          flow.style.strokeDasharray='6 16';
          flow.style.strokeDashoffset=String((distance-t*(20+18*Math.sqrt(weight)))%22);
        }
      });
      const entry=GEOMETRY.chamber.inletPoints[key];
      refs.inlet.style.opacity=String(isDosing&&fluid.front>.99?fluid.inflow*(.5+.35*Math.sqrt(weight)):0);
      refs.inlet.style.stroke=color;
      refs.inlet.style.strokeDashoffset=String(-t*19%18);
      const ch=GEOMETRY.chamber;
      const h=ch.fillHeight*fluid.fill;
      const phase=index*Math.PI/4+t*(.5+fluid.blend*.2);
      const blend=releasing?1:fluid.blend;
      const tint=mixColor(color,fluid.color,blend);
      // Fine colored ribbons enter from real manifold openings, then coil
      // inside the filled glass. Their separate colors dissolve into one tint.
      const points=Array.from({length:34},(_,i)=>{
        const u=i/33, angle=phase+u*Math.PI*(2.3+blend);
        const radius=ch.rx*(.2+.56*Math.sin(u*Math.PI/2));
        const blendIn=Math.min(1,u*5);
        const x=entry.x*(1-blendIn)+(ch.x+Math.sin(angle)*radius)*blendIn;
        const y=entry.y*(1-blendIn)+(ch.bottom-h*u+Math.cos(angle)*ch.ry*.36)*blendIn;
        return `${i?'L':'M'}${x.toFixed(2)} ${y.toFixed(2)}`;
      }).join('');
      refs.ribbon.setAttribute('d',points);
      refs.ribbon.style.stroke=tint;
      refs.ribbon.style.strokeOpacity=String(visibleFill&&weight>0?(.4+.5*Math.sqrt(weight))*(1-.78*blend)*Math.min(1,fluid.fill*8):0);
      refs.ribbon.style.strokeWidth=String(1.1+Math.sqrt(weight)*2.4);
      refs.ribbon.style.opacity='1';
      refs.ribbon.style.strokeDashoffset=String(-t*(7+index*.3)%100);
      refs.cloud.setAttribute('cx',ch.x+Math.sin(phase)*ch.rx*(.62-.3*blend));
      refs.cloud.setAttribute('cy',ch.bottom-h*(.38+.18*Math.sin(phase*.7+index)));
      refs.cloud.setAttribute('rx',ch.rx*(.26+.17*Math.sqrt(weight)+.2*blend));
      refs.cloud.setAttribute('ry',Math.max(1,h*(.20+.16*blend)));
      refs.cloud.style.fill=tint;
      refs.cloud.style.opacity=String(visibleFill&&weight>0?(.18+.24*Math.sqrt(weight))*(1-.75*blend)*Math.min(1,fluid.fill*10):0);
    }

    const ch=GEOMETRY.chamber,surface=ch.bottom-ch.fillHeight*fluid.fill;
    this.chamberFill.setAttribute('d',liquidPath(ch.x,ch.bottom,ch.rx,ch.ry,surface));
    this.chamberFill.style.fill=fluid.color;
    this.chamberFill.style.opacity=String(visibleFill?.12+.32*fluid.blend:0);
    this.chamberSurface.setAttribute('cy',surface);
    this.chamberSurface.style.fill=mixColor(fluid.color,'#ffffff',.18);
    this.chamberSurface.style.opacity=String(visibleFill?.26+.29*fluid.blend:0);
    this.glow.style.fill=fluid.purge>0?'#a6c3c3':fluid.color;
    this.glow.style.opacity=String(visibleFill?.05+.09*fluid.fill:fluid.purge*.08);
    this.vortex.forEach((path,index)=>{
      path.style.strokeOpacity=String(fluid.purge*(.25+index*.04));
      path.style.stroke='#aec6c9';
      path.style.strokeDashoffset=String(-(t*8+index*22)%100);
    });
    this.purgeTracks.forEach(track=>{
      track.style.strokeDasharray='none';
      track.style.opacity=String(fluid.purge*.22);
    });
    this.purgeFlows.forEach(flow=>{
      flow.dataset.flowState=fluid.purge>0?'purging':'closed';
      flow.style.opacity=String(fluid.purge*.75);
      flow.style.strokeDasharray='5 13';
      flow.style.strokeDashoffset=String((Number(flow.dataset.flowDistance)-t*21)%18);
    });

    // The output is already mixed. Its hue and diminishing level belong to
    // the locked batch, even if a new emotion arrives while it is releasing.
    this.outlet.style.stroke=fluid.color;
    this.outlet.style.opacity=String(fluid.release*.9);
    this.mist.forEach((cloud,index)=>{
      const age=progress*(PHASE_DURATIONS.releasing/1000)-index*.44;
      const u=this.motion.matches?.12+index*.11:clamp(age/4.4);
      const envelope=this.motion.matches?Math.sin(Math.PI*u)**1.25:age>0&&age<4.4?Math.sin(Math.PI*u)**1.25:0;
      cloud.setAttribute('cx',GEOMETRY.outlet.x+Math.sin(u*5+index*.7)*u*16);
      cloud.setAttribute('cy',GEOMETRY.outlet.y-3-u*70);
      cloud.setAttribute('rx',2+u*23);
      cloud.setAttribute('ry',2+u*15);
      cloud.style.fill=mixColor(fluid.color,'#e9eee8',.35);
      cloud.style.opacity=String(releasing?envelope*.24*fluid.release:0);
    });
  }
  dispose(){
    if(this.disposed)return;
    this.disposed=true;
    cancelAnimationFrame(this.frame);
    this.observer?.disconnect();
    document.removeEventListener('visibilitychange',this.handleVisibility);
    this.motion.removeEventListener('change',this.handleVisibility);
    this.svg.removeEventListener('click',this.handleClick);
    this.svg.removeEventListener('keydown',this.handleKey);
    this.container.replaceChildren();
  }
}
