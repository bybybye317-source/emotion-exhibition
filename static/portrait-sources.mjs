import {REGION_NAMES} from './portrait-regions.mjs?v=20261028-real';
const key=record=>JSON.stringify([record.id,record.image_url,record.photo_anchors]);
export const sourceLabel=(record,index=0)=>`观众 ${String(record?.number||index+1).padStart(2,'0')}`;

// A small, unretouched reference crop; separate from the warped artwork.
export function createSourceThumbnail(image,anchors){
 const canvas=document.createElement('canvas');canvas.width=160;canvas.height=196;
 const le=anchors?.left_eye||[.35,.4],re=anchors?.right_eye||[.65,.4],mouth=anchors?.mouth||[.5,.7];
 const span=Math.max(image.width*.10,Math.hypot((re[0]-le[0])*image.width,(re[1]-le[1])*image.height));
 const width=Math.min(image.width,image.height*160/196,span*2.3),height=width*196/160;
 const cx=(le[0]+re[0])/2*image.width,cy=((le[1]+re[1])/4+mouth[1]/2)*image.height;
 const x=Math.max(0,Math.min(image.width-width,cx-width/2)),y=Math.max(0,Math.min(image.height-height,cy-height*.5));
 canvas.getContext('2d').drawImage(image,x,y,width,height,0,0,160,196);return canvas;
}

export class PortraitSources{
 constructor(onSelect){this.host=document.getElementById('portrait-sources');this.list=document.getElementById('portrait-source-list');this.reference=document.getElementById('portrait-source-reference');this.onSelect=onSelect;this.buttons=new Map();}
 update(records,images,{busy=false}={}){
  this.records=records;this.images=images;this.host.hidden=!records.length;
  const live=new Set(records.map(r=>r.id));
  for(const [id,button] of this.buttons)if(!live.has(id)){button.querySelector('canvas').width=button.querySelector('canvas').height=1;button.remove();this.buttons.delete(id);}
  for(const [index,record] of records.entries()){
   let button=this.buttons.get(record.id);const source=images.get(key(record));
   if(!button){button=document.createElement('button');button.type='button';button.className='portrait-source';button.append(document.createElement('canvas'),document.createElement('span'));button.addEventListener('click',()=>this.onSelect(record.id));this.buttons.set(record.id,button);this.list.append(button);}
   button.disabled=busy||!source;button.setAttribute('aria-label',`${sourceLabel(record,index)}，画面${REGION_NAMES[record.slot]}，查看贡献`);
   button.querySelector('span').textContent=sourceLabel(record,index);
   if(source&&button.source!==source){const c=button.querySelector('canvas');c.width=80;c.height=98;c.getContext('2d').drawImage(source,0,0,80,98);button.source=source;}
  }
  if(!live.has(this.selected))this.selected=records.at(-1)?.id;
  this.select(this.selected);
 }
 select(id){
  this.selected=id;const index=this.records?.findIndex(r=>r.id===id),record=this.records?.[index],image=record&&this.images.get(key(record));
  for(const [key,button] of this.buttons)button.setAttribute('aria-pressed',String(key===id));
  this.reference.hidden=!image;const c=document.getElementById('portrait-source-photo');
  if(image){c.width=160;c.height=196;c.getContext('2d').drawImage(image,0,0);document.getElementById('portrait-source-name').textContent=sourceLabel(record,index);document.getElementById('portrait-source-location').textContent=`贡献位置 · 画面${REGION_NAMES[record.slot]}`;}
  else{c.width=c.height=1;}
 }
 dispose(){this.update([],new Map());}
}
