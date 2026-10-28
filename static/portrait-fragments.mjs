import {organicFragmentCells} from './portrait-math.mjs?v=20261028-gallery192';

export const FRAGMENT_COUNT=192;
export const FRAGMENTS_PER_PERSON=6;
export const OWNER_COUNT=32;
// A deterministic, gently curved Voronoi mosaic. Ownership is interleaved
// across six zones, independently of the face landmark warp and session slots.
// Row insets follow the shipped head's frontal silhouette, so all six
// contribution centres land on visible skin rather than unused atlas corners.
const rowInsets=[.16,.14,.13,.13,.13,.13,.13,.13,.14,.15,.16,.17,.19,.21,.24,.29];
const seeds=Array.from({length:FRAGMENT_COUNT},(_,i)=>{
 const col=i%12,row=Math.floor(i/12);
 return [rowInsets[row]+(1-2*rowInsets[row])*(col+.5+.23*Math.sin(i*12.9898+4))/12,.04+.92*(row+.5+.23*Math.sin(i*7.321+9))/16];
});
const cells=organicFragmentCells(seeds);
const owners=Array.from({length:OWNER_COUNT},()=>[]);
for(let i=0;i<FRAGMENT_COUNT;i++){
 const col=i%12,row=Math.floor(i/12),zone=Math.floor(col/4)+3*Math.floor(row/8);
 const local=(row%8)*4+col%4;
 // Multiplication by 5 permutes all 32 slots; adjacent zones offset that permutation.
 const owner=((local-zone*11)*5%32+32)%32;
 owners[owner].push(i);
}
export const microFragmentCells=()=>cells.map(cell=>cell.map(p=>p.slice()));
export const fragmentsForOwner=slot=>Number.isInteger(slot)&&slot>=0&&slot<OWNER_COUNT?owners[slot].slice():[];
export const fragmentCenter=id=>seeds[id]?.slice()??null;
export function microFragmentBounds(id){
 const cell=cells[id];if(!cell)return null;
 const xs=cell.map(p=>p[0]),ys=cell.map(p=>p[1]);return {left:Math.min(...xs),right:Math.max(...xs),top:Math.min(...ys),bottom:Math.max(...ys)};
}
export function contributionDescription(slot){
 return fragmentsForOwner(slot).length?'6 片 · 分散在脸部不同位置':'等待贡献';
}
// Shared by shader and CPU snapshots, so a second arrival cannot cause a jump.
export function fragmentReveal(mix,ordinal){
 const t=Math.max(0,Math.min(1,(mix-ordinal*.075)/.625));return t*t*(3-2*t);
}
