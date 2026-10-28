// Anatomical patches. Every curved seam is built once and used
// in reverse by its neighbour, including the outline of the complete lips.
const N={
 A0:[0,0],A1:[.37,0],A2:[.63,0],A3:[1,0],
 B0:[0,.22],B1:[.15,.24],B2:[.465,.25],B3:[.535,.25],B4:[.85,.24],B5:[1,.22],
 C0:[0,.45],C1:[.15,.46],C2:[.445,.455],C3:[.555,.455],C4:[.85,.46],C5:[1,.45],
 D0:[0,.67],D1:[.23,.62],D2:[.40,.62],D3:[.60,.62],D4:[.77,.62],D5:[1,.67],
 L:[.325,.718],R:[.68,.72],
 E0:[0,.88],E1:[.22,.82],E2:[.40,.82],E3:[.60,.82],E4:[.78,.82],E5:[1,.88],
 F0:[0,1],F1:[.36,1],F2:[.64,1],F3:[1,1],
};
const FACES=[
 ['A0','A1','B2','B1','B0'],['A1','A2','B3','B2'],['A2','A3','B5','B4','B3'],
 ['B0','B1','C1','C0'],['B1','B2','C2','C1'],['B3','B4','C4','C3'],['B4','B5','C5','C4'],
 ['C0','C1','D1','D0'],['C1','C2','D2','D1'],['B2','B3','C3','D3','D2','C2'],['C3','C4','D4','D3'],['C4','C5','D5','D4'],
 ['D0','D1','E1','E0'],['D1','D2','L','E2','E1'],['D2','D3','R','E3','E2','L'],['D3','D4','E4','E3','R'],['D4','D5','E5','E4'],
 ['E0','E1','E2','F1','F0'],['E2','E3','F2','F1'],['E3','E4','E5','F3','F2'],
];
const HANDLES={
 'B1:B2':[[.23,.175],[.39,.18]], 'B3:B4':[[.61,.18],[.77,.175]],
 'C1:C2':[[.24,.49],[.36,.49]], 'C3:C4':[[.64,.49],[.76,.49]],
 'B1:C1':[[.13,.31],[.13,.40]],'B4:C4':[[.87,.31],[.87,.40]],
 'B2:C2':[[.46,.32],[.46,.40]],'B3:C3':[[.54,.32],[.54,.40]],
 'C2:D2':[[.43,.52],[.41,.58]],'C3:D3':[[.57,.52],[.59,.58]],
 'D2:D3':[[.46,.645],[.54,.645]],
 'D2:L':[[.36,.64],[.325,.68]],'D3:R':[[.64,.64],[.68,.68]],
 'E2:L':[[.36,.80],[.325,.76]],'E3:R':[[.64,.80],[.68,.76]],
 'E2:E3':[[.46,.835],[.54,.835]],
};
function buildCells(){
 const seams=new Map();
 return FACES.map(face=>face.flatMap((name,i)=>{
  const next=face[(i+1)%face.length],forward=name<next,aName=forward?name:next,bName=forward?next:name,key=`${aName}:${bName}`;
  if(!seams.has(key)){
   const a=N[aName],b=N[bName],frame=(a[0]===b[0]&&(a[0]===0||a[0]===1))||(a[1]===b[1]&&(a[1]===0||a[1]===1));
   const dx=b[0]-a[0],dy=b[1]-a[1],bend=frame?0:Math.sin((a[0]+b[0])*9+(a[1]+b[1])*5)*.025;
   const [c,d]=HANDLES[key]||[[a[0]+dx/3-dy*bend,a[1]+dy/3+dx*bend],[a[0]+2*dx/3-dy*bend,a[1]+2*dy/3+dx*bend]];
   const steps=Math.max(2,Math.ceil(Math.hypot(dx,dy)/.009));
   seams.set(key,Array.from({length:steps+1},(_,j)=>{
    if(j===0)return a;if(j===steps)return b;
    const t=j/steps,s=1-t;
    return [0,1].map(k=>Math.round(Math.max(0,Math.min(1,s*s*s*a[k]+3*s*s*t*c[k]+3*s*t*t*d[k]+t*t*t*b[k]))*1e12)/1e12);
   }));
  }
  const seam=seams.get(key),directed=forward?seam:[...seam].reverse();
  return directed.slice(0,-1).map(p=>p.slice());
 }));
}
const rounded=p=>p.map(v=>Math.round(v*1e12)/1e12);
const same=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1])<1e-10;
function splitRegion(cells,slot,slope){
 const cell=cells[slot],xs=cell.map(p=>p[0]),ys=cell.map(p=>p[1]);
 const cx=(Math.min(...xs)+Math.max(...xs))/2,cy=(Math.min(...ys)+Math.max(...ys))/2;
 const side=p=>p[1]-cy-slope*(p[0]-cx),cuts=[];
 for(let i=0;i<cell.length;i++){
  const a=cell[i],b=cell[(i+1)%cell.length],u=side(a),v=side(b);
  if(u*v<0){const t=u/(u-v);cuts.push(rounded(a.map((n,k)=>n+t*(b[k]-n))));}
 }
 if(cuts.length!==2)throw new Error('Anatomical split must have two boundary crossings');
 // Insert the same endpoints into both neighbouring masks before splitting.
 for(let n=0;n<cells.length;n++)cells[n]=cells[n].flatMap((a,i,polygon)=>{
  const b=polygon[(i+1)%polygon.length],dx=b[0]-a[0],dy=b[1]-a[1],length=dx*dx+dy*dy;
  const on=cuts.filter(p=>!same(p,a)&&!same(p,b)&&Math.abs(dx*(p[1]-a[1])-dy*(p[0]-a[0]))<1e-11
    &&(p[0]-a[0])*dx+(p[1]-a[1])*dy>0&&(p[0]-a[0])*dx+(p[1]-a[1])*dy<length);
  on.sort((p,q)=>(p[0]-q[0])*dx+(p[1]-q[1])*dy);return [a,...on];
 });
 const polygon=cells[slot],a=polygon.findIndex(p=>same(p,cuts[0])),b=polygon.findIndex(p=>same(p,cuts[1]));
 const [start,end]=[Math.min(a,b),Math.max(a,b)],p=polygon[start],q=polygon[end];
 const length=Math.hypot(q[0]-p[0],q[1]-p[1]),steps=Math.max(3,Math.ceil(length/.009));
 const seam=Array.from({length:steps+1},(_,i)=>{
  if(!i)return p;if(i===steps)return q;
  const t=i/steps,bend=Math.sin(Math.PI*t)*Math.min(.005,length*.025);
  return rounded([p[0]+(q[0]-p[0])*t-(q[1]-p[1])/length*bend,p[1]+(q[1]-p[1])*t+(q[0]-p[0])/length*bend]);
 });
 cells[slot]=[...polygon.slice(start,end+1),...seam.slice(1,-1).reverse()];
 cells.push([...polygon.slice(end),...polygon.slice(0,start+1),...seam.slice(1,-1)]);
}
const CELLS=buildCells();
// Keep complete eyes/brows, nose and lips. Smaller skin fragments surround
// these recognisable features rather than cutting an iris or lip in half.
for(const [slot,slope] of [[0,.22],[1,-.25],[2,-.18],[3,.3],[6,-.3],[7,-.25],[8,.25],[10,-.25],[11,.25],[12,.2],[16,-.2],[18,.18]])splitRegion(CELLS,slot,slope);
export const PORTRAIT_REGION_COUNT=CELLS.length;
export const REGION_NAMES=Object.freeze(['左侧额头上部','额头中央上部','右侧额头上部','左侧太阳穴上部','左侧眉眼','右侧眉眼','右侧太阳穴上部','左侧颧骨外缘','左侧上颊','鼻梁与鼻翼','右侧上颊','右侧颧骨外缘','左侧下颊上部','左侧嘴角','完整唇部','右侧嘴角','右侧下颊上部','左侧下颌','下巴上部','右侧下颌','左侧额头下部','额头中央下部','右侧额头下部','左侧太阳穴下部','右侧太阳穴下部','左侧面颊外缘','左侧下颊','右侧下颊','右侧面颊外缘','左侧下颊下部','右侧下颊下部','下巴下部']);
export const anatomicalFragmentCells=()=>CELLS.map(cell=>cell.map(p=>p.slice()));
export function fragmentBounds(slot){
 const cell=CELLS[slot];if(!cell)return null;
 const xs=cell.map(p=>p[0]),ys=cell.map(p=>p[1]);
 return {left:Math.min(...xs),top:Math.min(...ys),right:Math.max(...xs),bottom:Math.max(...ys)};
}
