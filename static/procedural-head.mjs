// Original parametric sculpture for the public website. No scan or third-party
// character mesh is embedded. Coordinates intentionally retain the collage's
// four alignment anchors so a photograph can deform with the surface.
export const HEAD_ANCHORS = {
  left_eye: [-.328974, .261213], right_eye: [.328926, .261213],
  nose: [0, -.044264], mouth: [0, -.3785],
};
export const HEAD_MORPHS = [
  'jawOpen', 'browInnerUp', 'mouthFunnel', 'mouthShrugLower',
  ...['mouthSmile', 'mouthFrown', 'eyeSquint', 'cheekSquint', 'eyeBlink',
    'browOuterUp', 'eyeWide', 'browDown', 'mouthPress', 'mouthStretch',
    'noseSneer', 'mouthUpperUp', 'mouthDimple'].flatMap(name => [`${name}_L`, `${name}_R`]),
];
const clamp = x => Math.max(0, Math.min(1, x));
const smooth = (a,b,x) => { const t=clamp((x-a)/(b-a)); return t*t*(3-2*t); };
const g = (x,y,cx,cy,sx,sy) => Math.exp(-.5*((x-cx)/sx)**2-.5*((y-cy)/sy)**2);
const width = y => .83*(1-.17*(1-smooth(-.92,-.14,y)));

export function faceRelief(x,y) {
  return .15*g(x,y,0,.11,.105,.31) + .245*g(x,y,0,-.043,.14,.115)
    + .055*(g(x,y,-.12,-.12,.09,.06)+g(x,y,.12,-.12,.09,.06))
    + .075*(g(x,y,-.43,-.11,.21,.24)+g(x,y,.43,-.11,.21,.24))
    - .145*(g(x,y,-.329,.261,.17,.10)+g(x,y,.329,.261,.17,.10))
    + .045*(g(x,y,-.32,.435,.21,.065)+g(x,y,.32,.435,.21,.065))
    - .065*g(x,y,0,-.379,.30,.095)
    + .025*g(x,y,0,-.309,.25,.033) + .032*g(x,y,0,-.448,.25,.048)
    - .018*g(x,y,0,-.237,.035,.075) + .045*g(x,y,0,-.72,.28,.16);
}

export function faceSurface(x,y) {
  const ring=Math.max(0,1-((y-.20)/1.15)**2);
  const z=.75*Math.sqrt(Math.max(0,ring-(x/width(y))**2))-.20;
  return z+faceRelief(x,y);
}

export function headMorphDelta(name,x,y,z) {
  // No expression moves the back of the head or the pole vertices.
  const gate=smooth(-.08,.30,z)*smooth(-.96,-.74,y)*(1-smooth(.80,1.13,y));
  if(!gate)return [0,0,0];
  const side=name.endsWith('_L')?-1:1;
  const eye=g(x,y,side*.329,.261,.20,.13);
  const cheek=g(x,y,side*.40,-.14,.22,.22);
  const corner=g(x,y,side*.245,-.379,.15,.12);
  const brow=g(x,y,side*.33,.44,.23,.12);
  let dx=0,dy=0,dz=0;
  if(name==='jawOpen') {
    const jaw=(1-smooth(-.60,-.24,y))*g(x,y,0,-.58,.62,.5);
    dy=-.20*jaw; dz=-.045*jaw;
  } else if(name==='browInnerUp')dy=.15*g(x,y,0,.43,.23,.13);
  else if(name==='mouthFunnel') {const w=g(x,y,0,-.38,.36,.16);dx=-x*.25*w;dz=.075*w;}
  else if(name==='mouthShrugLower')dy=.055*g(x,y,0,-.49,.33,.10);
  else if(name.startsWith('mouthSmile')) {dy=.145*corner+.035*cheek;dx=side*.025*corner;dz=.014*corner;}
  else if(name.startsWith('mouthFrown'))dy=-.13*corner;
  else if(name.startsWith('eyeSquint')) {dy=-(y-.261)*.30*eye;dz=.018*eye;}
  else if(name.startsWith('cheekSquint')) {dy=.055*cheek;dz=.026*cheek;}
  else if(name.startsWith('eyeBlink'))dy=-(y-.261)*.65*eye;
  else if(name.startsWith('browOuterUp'))dy=.13*g(x,y,side*.48,.44,.16,.12);
  else if(name.startsWith('eyeWide'))dy=(y-.261)*.28*eye;
  else if(name.startsWith('browDown')) {dy=-.11*brow;dz=.018*brow;}
  else if(name.startsWith('mouthPress'))dy=-(y+.379)*.25*g(x,y,side*.16,-.38,.24,.10);
  else if(name.startsWith('mouthStretch'))dx=side*.07*corner;
  else if(name.startsWith('noseSneer')) {dy=.075*g(x,y,side*.14,-.09,.12,.16);dz=.035*cheek;}
  else if(name.startsWith('mouthUpperUp'))dy=.08*g(x,y,side*.12,-.29,.18,.08);
  else if(name.startsWith('mouthDimple')) {dx=side*.025*corner;dz=-.025*corner;}
  return [dx*gate,dy*gate,dz*gate];
}

export function headGeometryData(columns=96,rows=88) {
  if(!Number.isInteger(columns)||!Number.isInteger(rows)||columns<12||rows<12||columns>160||rows>160)
    throw new RangeError('Head tessellation must be 12–160');
  const count=(columns+1)*(rows+1);
  const positions=new Float32Array(count*3), uv=new Float32Array(count*2);
  for(let row=0;row<=rows;row++) {
    const theta=Math.PI*row/rows, y=.20+1.15*Math.cos(theta), ring=Math.sin(theta);
    for(let col=0;col<=columns;col++) {
      const phi=2*Math.PI*col/columns, front=Math.cos(phi), i=row*(columns+1)+col;
      const x=width(y)*ring*Math.sin(phi);
      const z=.75*ring*front-.20+faceRelief(x,y)*smooth(.0,.55,front);
      positions.set([x,y,z],i*3);
      uv.set([(x+.9)/1.8,(y+.95)/2.21],i*2);
    }
  }
  const indices=[];
  for(let row=0;row<rows;row++)for(let col=0;col<columns;col++) {
    const a=row*(columns+1)+col,b=a+1,c=a+columns+2,d=a+columns+1;
    if(row>0)indices.push(a,d,b);
    if(row<rows-1)indices.push(b,d,c);
  }
  const morphs=Object.fromEntries(HEAD_MORPHS.map(name=>{
    const data=new Float32Array(count*3);
    for(let i=0;i<count;i++)data.set(headMorphDelta(name,...positions.subarray(i*3,i*3+3)),i*3);
    return [name,data];
  }));
  return {positions,uv,indices:Uint16Array.from(indices),morphs};
}

// Surface detail uses these same weights, keeping eyeballs, lids and lips
// attached to the sculpture rather than floating as it changes expression.
export function expressionDetails(weights={}) {
  const at=name=>Number.isFinite(weights[name])?clamp(weights[name]):0;
  const jaw=at('jawOpen'), funnel=at('mouthFunnel');
  const sides=['L','R'].map(side=>({
    smile:at(`mouthSmile_${side}`), frown:at(`mouthFrown_${side}`),
    press:at(`mouthPress_${side}`), stretch:at(`mouthStretch_${side}`),
    upper:at(`mouthUpperUp_${side}`),
    eye:Math.max(.16,1+.35*at(`eyeWide_${side}`)-.45*at(`eyeSquint_${side}`)-.70*at(`eyeBlink_${side}`)),
    browInner:.12*at('browInnerUp')-.075*at(`browDown_${side}`),
    browOuter:.11*at(`browOuterUp_${side}`)-.035*at(`browDown_${side}`),
  }));
  return {jaw,funnel,sides,mouthY:HEAD_ANCHORS.mouth[1]-.065*jaw,
    mouthHeight:.013+.12*jaw+.014*funnel,
    mouthWidth:.258*(1-.20*funnel)+.035*(sides[0].stretch+sides[1].stretch)};
}
