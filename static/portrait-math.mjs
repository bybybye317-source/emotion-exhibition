// Artistic expression mapping: these are animation choices, not measured AUs.
export const LABELS = {happiness:'快乐', neutral:'中性', sadness:'悲伤', surprise:'惊讶', anger:'愤怒', fear:'恐惧', disgust:'厌恶', contempt:'轻蔑'};

const pair = (name, value) => ({[`${name}_L`]: value, [`${name}_R`]: value});
export const POSES = {
  neutral: {},
  happiness: {...pair('mouthSmile', .92), ...pair('eyeSquint', .20), ...pair('cheekSquint', .35), jawOpen:.12},
  sadness: {browInnerUp:.72, ...pair('mouthFrown', .82), ...pair('eyeBlink', .12), mouthShrugLower:.12},
  surprise: {jawOpen:.68, browInnerUp:.70, ...pair('browOuterUp', .70), ...pair('eyeWide', .82), mouthFunnel:.12},
  anger: {...pair('browDown', .90), ...pair('eyeSquint', .40), ...pair('mouthPress', .65), ...pair('mouthFrown', .25)},
  fear: {browInnerUp:.65, ...pair('browOuterUp', .40), ...pair('eyeWide', .78), ...pair('mouthStretch', .50), jawOpen:.36},
  disgust: {...pair('noseSneer', .90), ...pair('mouthUpperUp', .65), ...pair('browDown', .25)},
  contempt: {mouthSmile_L:.58, mouthDimple_L:.65, mouthPress_R:.38, browOuterUp_L:.20},
};

export function normalizeScores(scores) {
  const out = Object.fromEntries(Object.keys(LABELS).map(key => [key, Number.isFinite(scores?.[key]) ? Math.max(0, scores[key]) : 0]));
  const sum = Object.values(out).reduce((a,b) => a+b, 0);
  return sum > 0 ? Object.fromEntries(Object.entries(out).map(([key,value]) => [key,value/sum])) : {};
}

export function morphWeights(scores) {
  const result = {};
  for (const [emotion, weight] of Object.entries(normalizeScores(scores))) {
    for (const [name, value] of Object.entries(POSES[emotion])) result[name] = Math.min(1, (result[name] || 0) + value * weight);
  }
  return result;
}

// Return Canvas2D's [a,b,c,d,e,f], mapping three source points to targets.
export function affineFromTriangles(source, target) {
  if (![...source, ...target].every(p => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite))) return null;
  const [[x0,y0],[x1,y1],[x2,y2]] = source;
  const det = (x1-x0)*(y2-y0) - (x2-x0)*(y1-y0);
  if (Math.abs(det) < 1e-8) return null;
  const solve = values => {
    const a = ((values[1]-values[0])*(y2-y0) - (values[2]-values[0])*(y1-y0))/det;
    const c = ((x1-x0)*(values[2]-values[0]) - (x2-x0)*(values[1]-values[0]))/det;
    return [a,c,values[0]-a*x0-c*y0];
  };
  const [a,c,e] = solve(target.map(p => p[0]));
  const [b,d,f] = solve(target.map(p => p[1]));
  return [a,b,c,d,e,f];
}

// Fixed anatomical regions sit inside the face's visible projection rather
// than in unused atlas corners. Their borders never move as people arrive.
export const PATCH_SEEDS = [
  [.32,.16],[.50,.14],[.68,.16],
  [.23,.34],[.37,.34],[.63,.34],[.77,.34],
  [.23,.52],[.37,.51],[.50,.50],[.63,.51],[.77,.52],
  [.25,.68],[.39,.67],[.51,.70],[.63,.67],[.75,.68],
  [.36,.84],[.51,.86],[.66,.84],
];

// Start on a recognisable eye/cheek/forehead, then spread contributions across
// the face. A new cycle replaces just the oldest contribution's region.
export const FRAGMENT_SLOT_ORDER = Object.freeze([4,10,1,8,5,14,9,0,16,7,2,13,6,18,3,15,11,17,12,19]);

const validSlotCount = count => Number.isInteger(count) && count > 0 && count <= PATCH_SEEDS.length;

export function fragmentSlot(sequence, slotCount=PATCH_SEEDS.length) {
  if(!Number.isSafeInteger(sequence) || sequence<0) throw new RangeError('Invalid fragment sequence');
  if(!validSlotCount(slotCount)) throw new RangeError('Invalid fragment slot count');
  const order=FRAGMENT_SLOT_ORDER.filter(slot=>slot<slotCount);
  return order[sequence%slotCount];
}

/**
 * Plan one fixed region per participant. Records are oldest first, and a
 * stored slot survives removal, failed photo loads and arrival of others.
 * The newest record wins duplicate IDs/slots; unoccupied slots retain seeds.
 * Index-based slots are only a compatibility path for older session records.
 */
export function planPatchAssignments(records=[], slotCount=PATCH_SEEDS.length) {
  if(!validSlotCount(slotCount)) throw new RangeError('Invalid fragment slot count');
  const plan=Array.from({length:slotCount},(_,slot)=>({slot,recordIndex:null,participantId:null,seedIndex:slot}));
  const seen=new Set();
  for(let index=(Array.isArray(records)?records.length:0)-1;index>=0;index--) {
    const record=records[index];
    if(!record || typeof record!=='object') continue;
    const id=record.id ?? null;
    if(id!==null && seen.has(id)) continue;
    if(id!==null) seen.add(id);
    const slot=record.slot===undefined?fragmentSlot(index,slotCount):record.slot;
    if(!Number.isInteger(slot) || slot<0 || slot>=slotCount || plan[slot].recordIndex!==null) continue;
    plan[slot]={slot,recordIndex:index,participantId:id,seedIndex:slot};
  }
  return plan;
}

export function voronoiCells(seeds = PATCH_SEEDS) {
  return seeds.map((seed,index) => {
    let polygon = [[0,0],[1,0],[1,1],[0,1]];
    for (let j=0;j<seeds.length && polygon.length;j++) {
      if (j===index) continue;
      const other = seeds[j];
      const nx=other[0]-seed[0], ny=other[1]-seed[1];
      const k=(other[0]**2+other[1]**2-seed[0]**2-seed[1]**2)/2;
      const clipped=[];
      for(let i=0;i<polygon.length;i++) {
        const a=polygon[i], b=polygon[(i+1)%polygon.length];
        const da=a[0]*nx+a[1]*ny-k, db=b[0]*nx+b[1]*ny-k;
        if(da<=1e-10) clipped.push(a);
        if((da<=0)!==(db<=0)) {
          const t=da/(da-db);
          clipped.push([a[0]+t*(b[0]-a[0]),a[1]+t*(b[1]-a[1])]);
        }
      }
      polygon=clipped;
    }
    return polygon;
  });
}

/**
 * A gently curved version of the fixed partition, without changing ownership.
 * Build every shared edge once in canonical direction: neighbouring masks use
 * precisely the same points in reverse, so the bends cannot open hairline gaps.
 * A static, low-amplitude field moves only mask edges, never facial landmarks.
 */
export function organicFragmentCells(seeds = PATCH_SEEDS) {
  const precision=1e12;
  const canonical=point=>point.map(value=>Math.round(Math.max(0,Math.min(1,value))*precision)/precision);
  const key=point=>point.join(',');
  const curves=new Map();
  const bend=([x,y])=>{
    if(x===0||x===1||y===0||y===1)return [x,y];
    // The outer frame stays fixed. The vector displacement is at most 3.6 px
    // in a 1024 px atlas; low spatial frequency keeps the field orientation.
    const amplitude=(3.6/1024/Math.SQRT2)*16*x*(1-x)*y*(1-y);
    return [x+amplitude*Math.sin(2*Math.PI*(2.1*x+.8*y)+.35),
      y+amplitude*Math.sin(2*Math.PI*(.6*x+2.3*y)+1.2)];
  };
  return voronoiCells(seeds).map(cell=>{
    const vertices=cell.map(canonical).filter((point,i,all)=>key(point)!==key(all[(i+all.length-1)%all.length]));
    const polygon=[];
    for(let i=0;i<vertices.length;i++) {
      const a=vertices[i],b=vertices[(i+1)%vertices.length];
      const forward=key(a)<key(b),start=forward?a:b,end=forward?b:a;
      const edgeKey=`${key(start)}|${key(end)}`;
      if(!curves.has(edgeKey)) {
        const steps=Math.max(1,Math.ceil(Math.hypot(end[0]-start[0],end[1]-start[1])/.012));
        curves.set(edgeKey,Array.from({length:steps+1},(_,step)=>{
          const t=step/steps;
          return bend(step===0?start:step===steps?end:
            [start[0]+t*(end[0]-start[0]),start[1]+t*(end[1]-start[1])]);
        }));
      }
      const curve=curves.get(edgeKey);
      const directed=forward?curve:[...curve].reverse();
      polygon.push(...directed.slice(0,-1).map(point=>point.slice()));
    }
    return polygon;
  });
}

export function photoTriangle(anchors, width, height) {
  const names=['left_eye','right_eye','mouth'];
  const fallback=[[.31,.38],[.69,.38],[.50,.73]];
  const points=names.map((name,index) => {
    const p=anchors?.[name];
    return Array.isArray(p) && p.length===2 && p.every(v => Number.isFinite(v) && v>=0 && v<=1) ? p : fallback[index];
  });
  return points.map(([x,y]) => [x*width,y*height]);
}
