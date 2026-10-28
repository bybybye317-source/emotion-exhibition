import {CHANNELS,PHASE_DURATIONS} from './scent-math.mjs?v=20261028-fast';
import {deriveFluidState} from './scent-fluid.mjs?v=20261028-fast';
// Compact exhibition view of the SAME simulator snapshot. No independent batch clock.
export class ScentRibbon{
 constructor(host,{onSelect}={}){
  this.host=host;this.snapshot={};this.disposed=false;this.frame=0;this.visible=false;
  host.innerHTML=`<svg viewBox="0 0 1260 228" role="group" aria-label="八支原料流向混合舱与释放口">
   <defs><linearGradient id="sr-metal"><stop stop-color="#1a1e24"/><stop offset=".32" stop-color="#686a69"/><stop offset=".46" stop-color="#262b31"/><stop offset="1" stop-color="#111419"/></linearGradient><linearGradient id="sr-glass"><stop stop-color="#b8c6cf" stop-opacity=".12"/><stop offset=".35" stop-color="#b8c6cf" stop-opacity=".02"/><stop offset="1" stop-color="#b8c6cf" stop-opacity=".10"/></linearGradient><clipPath id="sr-chamber-clip"><rect x="914" y="66" width="102" height="120" rx="30"/></clipPath></defs>
   <path d="M22 192H1226" stroke="#292d34"/>
   ${CHANNELS.map((c,i)=>{const x=48+i*96,y=12+i*7;return `<g class="sr-feed" data-key="${c.key}">
    <path class="sr-pipe" d="M${x+23} 100V${y+8}Q${x+23} ${y} ${x+31} ${y}H${824+i*6}Q${836+i*6} ${y} ${836+i*6} ${y+12}V${91+i*10}H915"/>
    <path class="sr-stream" stroke="${c.color}" d="M${x+23} 100V${y+8}Q${x+23} ${y} ${x+31} ${y}H${824+i*6}Q${836+i*6} ${y} ${836+i*6} ${y+12}V${91+i*10}H915"/>
    <g class="sr-reservoir" role="button" tabindex="0" aria-label="${c.label}，查看情绪来源" data-ingredient="${c.key}">
    <rect x="${x}" y="98" width="46" height="88" rx="7" fill="url(#sr-glass)" stroke="#626970" stroke-width=".8"/>
    <rect class="sr-liquid" x="${x+4}" y="179" width="38" height="0" rx="3" fill="${c.color}" fill-opacity=".5"/>
    <path d="M${x+7} 110V174" stroke="#b9c4ce" stroke-opacity=".35"/>
    <rect x="${x-3}" y="94" width="52" height="9" rx="2" fill="url(#sr-metal)"/><rect x="${x-3}" y="180" width="52" height="9" rx="2" fill="url(#sr-metal)"/>
    <text x="${x+23}" y="210" text-anchor="middle">${c.label}</text><text class="sr-ratio" x="${x+23}" y="158" text-anchor="middle">—</text>
    </g></g>`;}).join('')}
   <rect x="910" y="62" width="110" height="126" rx="32" fill="url(#sr-glass)" stroke="#84888d" stroke-width="1"/>
   <g clip-path="url(#sr-chamber-clip)"><rect class="sr-mix-liquid" x="912" y="186" width="106" height="0"/>${CHANNELS.map(c=>`<path class="sr-swirl" data-key="${c.key}" fill="none" stroke="${c.color}" stroke-width="3"/>`).join('')}</g>
   <rect x="928" y="54" width="74" height="10" rx="2" fill="url(#sr-metal)"/><rect x="928" y="183" width="74" height="9" rx="2" fill="url(#sr-metal)"/>
   <path d="M1021 114H1080V127H1118" fill="none" stroke="url(#sr-metal)" stroke-width="10"/>
   <rect x="1114" y="116" width="8" height="22" rx="2" fill="url(#sr-metal)"/>
   ${Array.from({length:6},(_,i)=>`<path class="sr-mist" data-i="${i}" fill="none" stroke="#b9c3d6" stroke-width="${2+i*.8}" stroke-linecap="round"/>`).join('')}
   <text x="965" y="210" text-anchor="middle">混合舱</text><text x="1162" y="210" text-anchor="middle">释放口</text>
  </svg><p class="sr-explanation"><strong id="sr-selected">佛手柑</strong><span id="sr-reason">点击原料仓，查看它为何出现在配方里。</span></p>`;
  this.feeds=CHANNELS.map(c=>{const g=host.querySelector(`.sr-feed[data-key="${c.key}"]`);const stream=g.querySelector('.sr-stream');return {channel:c,g,stream,length:stream.getTotalLength(),liquid:g.querySelector('.sr-liquid'),ratio:g.querySelector('.sr-ratio'),button:g.querySelector('[role="button"]')};});
  this.handle=e=>{const el=e.target.closest('[data-ingredient]');if(el)onSelect?.(el.dataset.ingredient);};
  host.addEventListener('click',this.handle);host.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();this.handle(e);}});
  this.motion=matchMedia('(prefers-reduced-motion: reduce)');
  this.observer=new IntersectionObserver(entries=>{this.visible=entries.some(e=>e.isIntersecting);this.sync();});this.observer.observe(host);
  this.onVisibility=()=>this.sync();document.addEventListener('visibilitychange',this.onVisibility);this.motion.addEventListener('change',this.onVisibility);
 }
 update(snapshot){
  this.snapshot=snapshot;this.updatedAt=performance.now();
  for(const f of this.feeds){const ratio=snapshot.recipe?.percentages?.[f.channel.key];f.ratio.textContent=Number.isFinite(ratio)?`${ratio}%`:'—';f.liquid.setAttribute('height',Math.max(0,(ratio||0)*.72));f.liquid.setAttribute('y',180-Math.max(0,(ratio||0)*.72));f.button.setAttribute('aria-pressed',String(snapshot.selectedKey===f.channel.key));f.button.setAttribute('aria-label',`${f.channel.label}，${ratio??0}%，查看情绪来源`);}
  const c=CHANNELS.find(c=>c.key===snapshot.selectedKey)||CHANNELS[0];
  this.host.querySelector('#sr-selected').textContent=c.label;
  // Use the already-rendered ingredient explanation, which distinguishes locked batch/target.
  this.host.querySelector('#sr-reason').textContent=document.getElementById('scent-rationale').textContent;
  this.paint();this.sync();
 }
 sync(){
  const animate=this.visible&&!document.hidden&&!this.motion.matches&&this.snapshot.enabled&&['mixing','releasing','purging'].includes(this.snapshot.phase);
  if(!animate){cancelAnimationFrame(this.frame);this.frame=0;this.paint();return;}
  if(!this.frame){const tick=now=>{if(this.disposed)return;this.paint(now);this.frame=requestAnimationFrame(tick);};this.frame=requestAnimationFrame(tick);}
 }
 paint(now=performance.now()){
  const s=this.snapshot,progress=Math.min(1,(s.progress||0)+(s.enabled&&!document.hidden?(now-this.updatedAt)/(PHASE_DURATIONS[s.phase]||1):0));
  const f=deriveFluidState({...s,progress});this.host.dataset.fluidStage=f.stage;this.host.dataset.fill=f.fill.toFixed(3);this.host.dataset.blend=f.blend.toFixed(3);
  const t=this.motion.matches?0:now/1000;
  for(const feed of this.feeds){const weight=f.ingredients[feed.channel.key]?.weight||0;feed.stream.style.opacity=String(f.stage==='dosing'&&weight>0?f.inflow*.85:f.stage==='blending'?weight*(1-f.blend):0);const length=f.front*feed.length;feed.stream.style.strokeDasharray=length<feed.length?`${length} ${feed.length}`:'6 15';feed.stream.style.strokeDashoffset=length<feed.length?'0':String(-t*22);}
  const liquid=this.host.querySelector('.sr-mix-liquid');liquid.setAttribute('height',f.fill*120);liquid.setAttribute('y',186-f.fill*120);liquid.setAttribute('fill',f.color);liquid.setAttribute('opacity',String(.1+.4*f.blend));
  this.host.querySelectorAll('.sr-swirl').forEach((path,i)=>{const weight=f.ingredients[path.dataset.key]?.weight||0;path.setAttribute('d',Array.from({length:40},(_,n)=>{const u=n/39,a=u*Math.PI*2.5+t*.55+i*.8;return `${n?'L':'M'}${965+Math.sin(a)*43} ${186-f.fill*120*u}`;}).join(''));path.style.opacity=String(weight>0&&f.fill>0?(.25+Math.sqrt(weight))*(1-.8*f.blend):0);path.style.stroke=f.blend>.9?f.color:CHANNELS[i].color;});
  this.host.querySelectorAll('.sr-mist').forEach((path,i)=>{const dy=Math.sin(t*.7+i)*18;path.setAttribute('d',`M1122 127 C1150 ${110+dy} 1170 ${146-dy} 1236 ${90+i*14+dy}`);path.style.opacity=String(f.release*(.16+i*.025)+f.purge*.08);});
 }
 dispose(){this.disposed=true;cancelAnimationFrame(this.frame);this.observer.disconnect();document.removeEventListener('visibilitychange',this.onVisibility);this.motion.removeEventListener('change',this.onVisibility);}
}
