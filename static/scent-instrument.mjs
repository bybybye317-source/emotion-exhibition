import {ART, GEOMETRY} from './generated/scent-instrument-art.mjs?v=20261027-atelier';

const KEYS=Object.keys(GEOMETRY.channels);
const ACTIVE_PHASES=new Set(['mixing','releasing','purging']);
const clamp=(value,min=0,max=1)=>Math.max(min,Math.min(max,Number.isFinite(value)?value:0));
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
    this.snapshot={phase:'stopped',progress:0,outputs:{},purge:0,recipe:null,targetRecipe:null,pending:false,selectedKey:null,enabled:false};
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
    }]));
    this.purgeFlows=[...this.svg.querySelectorAll('[data-flow="purge"]')];
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
      refs.liquid.setAttribute('d',`M${cx-radius} ${surface}A${radius} ${ellipse} 0 0 0 ${cx+radius} ${surface}L${cx+radius} ${bottom}A${radius} ${ellipse} 0 0 1 ${cx-radius} ${bottom}Z`);
      refs.liquid.style.opacity=ratio>0?'.32':'0';
      refs.meniscus.setAttribute('cy',geometry.bottom-height);
      refs.meniscus.style.opacity=ratio>0?'.45':'0';
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
    const s=this.snapshot,t=this.time;
    const releasing=Boolean(s.enabled&&s.phase==='releasing');
    const mixing=Boolean(s.enabled&&s.phase==='mixing');
    const purge=Boolean(s.enabled&&s.phase==='purging'&&s.purge>0);
    const progress=clamp(s.progress);
    let total=0;
    for(const key of KEYS){
      const output=releasing?clamp(s.outputs?.[key],0,100):0;
      total+=output;
      // Dosing is internal transfer into the chamber; it never opens the outlet.
      // Released channels remain exclusively driven by the simulator's outputs.
      const dose=mixing?clamp(s.recipe?.percentages?.[key],0,100):0;
      const internal=output||dose;
      this.refs.get(key).flows.forEach((flow,index)=>{
        flow.dataset.flowState=output>0?'output':dose>0?'dosing':'closed';
        flow.style.opacity=internal>0?String((mixing?.10:.16)+(mixing?.30:.58)*Math.sqrt(internal/100)):'0';
        flow.style.strokeDashoffset=String(-(t*((mixing?2.5:4)+internal*.12)+index*23)%100);
      });
    }
    this.purgeFlows.forEach((flow,index)=>{
      flow.style.opacity=purge?'.6':'0';
      flow.style.strokeDashoffset=String(-(t*8+index*23)%100);
    });
    const activeOutput=releasing&&total>0;
    const chamber=mixing?.22+.42*progress:activeOutput?.65:purge?.22:0;
    this.glow.style.opacity=String(chamber);
    this.vortex.forEach((path,index)=>{
      path.style.strokeOpacity=String(chamber*(.35+index*.12));
      path.style.stroke=purge?'#aec6c9':'#cbbb9a';
      path.style.strokeDashoffset=String(-(t*(mixing?3.4:2.3)+index*22)%100);
    });
    // Only a true release can illuminate the scent outlet or show scent mist.
    this.outlet.style.opacity=activeOutput?'.75':'0';
    this.mist.forEach((cloud,index)=>{
      if(!activeOutput){cloud.style.opacity='0';return;}
      const u=(t*.075+index/this.mist.length)%1;
      const envelope=Math.sin(Math.PI*u)**2;
      cloud.setAttribute('cx',GEOMETRY.outlet.x+Math.sin(u*5.5+index)*u*22);
      cloud.setAttribute('cy',GEOMETRY.outlet.y-8-u*65);
      cloud.setAttribute('rx',2+u*23);
      cloud.setAttribute('ry',2+u*12);
      cloud.style.opacity=String(envelope*.065*Math.min(1,total/100));
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
