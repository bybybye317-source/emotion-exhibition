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

// A fixed layout keeps the seams stationary while photographs and poses change.
export const PATCH_SEEDS = [
  [.28,.13],[.51,.10],[.73,.14], [.16,.29],[.36,.29],[.62,.28],[.84,.31],
  [.15,.48],[.34,.46],[.51,.40],[.68,.47],[.86,.49],
  [.20,.65],[.40,.61],[.59,.62],[.80,.65], [.30,.80],[.51,.76],[.70,.81],[.51,.94],
];

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

export function photoTriangle(anchors, width, height) {
  const names=['left_eye','right_eye','mouth'];
  const fallback=[[.31,.38],[.69,.38],[.50,.73]];
  const points=names.map((name,index) => {
    const p=anchors?.[name];
    return Array.isArray(p) && p.length===2 && p.every(v => Number.isFinite(v) && v>=0 && v<=1) ? p : fallback[index];
  });
  return points.map(([x,y]) => [x*width,y*height]);
}
