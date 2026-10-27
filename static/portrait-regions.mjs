// Twenty fixed anatomical patches. Every curved seam is built once and used
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
const CELLS=buildCells();
export const anatomicalFragmentCells=()=>CELLS.map(cell=>cell.map(p=>p.slice()));
export function fragmentBounds(slot){
 const cell=CELLS[slot];if(!cell)return null;
 const xs=cell.map(p=>p[0]),ys=cell.map(p=>p[1]);
 return {left:Math.min(...xs),top:Math.min(...ys),right:Math.max(...xs),bottom:Math.max(...ys)};
}
