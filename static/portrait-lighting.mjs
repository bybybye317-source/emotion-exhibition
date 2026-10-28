// Correct only broad illumination within one face. There is deliberately no
// shared skin average, white balance target, or histogram matching across people.
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const median=values=>{const a=values.slice().sort((x,y)=>x-y),m=a.length>>1;return a.length?(a.length%2?a[m]:(a[m-1]+a[m])/2):null;};
const linear=Float64Array.from({length:256},(_,i)=>{const v=i/255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;});
const encoded=Uint8ClampedArray.from({length:8193},(_,i)=>{const v=i/8192;return 255*(v<=.0031308?v*12.92:1.055*v**(1/2.4)-.055);});
const identity=()=>({x:0,y:0,cx:.5,cy:.5,samples:0});

/** Skin-only sampling windows in an already aligned atlas, away from brows,
 * eyes, nose, lips and outer hair/background. Coordinates are normalized. */
export function illuminationWindows(target,width,height){
  if(!['left_eye','right_eye','nose','mouth'].every(k=>Array.isArray(target?.[k])&&target[k].length===2&&target[k].every(Number.isFinite)))return [];
  const [lx,ly]=target.left_eye,[rx,ry]=target.right_eye,span=rx-lx;
  if(span<=0)return [];
  const eyeY=(ly+ry)/2;
  const rows=[
    [lx+span*.12,rx-span*.12,eyeY-span*.46],
    [lx-span*.04,rx+span*.04,target.nose[1]-span*.08],
    [lx-span*.04,rx+span*.04,target.mouth[1]-span*.12],
  ];
  return rows.flatMap(([left,right,y],row)=>[left,right].map((x,side)=>({
    x:x/width,y:y/height,rx:span*.065/width,ry:span*.045/height,row,side,
  })));
}

/** Robust paired medians suppress pores and isolated highlights. A plane is
 * intentionally too smooth to change wrinkles or remove the collage texture. */
export function estimateIllumination(data,width,height,target){
  if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||data?.length!==width*height*4)return identity();
  const windows=illuminationWindows(target,width,height),samples=[];
  for(const w of windows){
    const values=[],step=Math.max(1,Math.floor(width/400));
    const x0=Math.max(0,Math.ceil((w.x-w.rx)*width)),x1=Math.min(width-1,Math.floor((w.x+w.rx)*width));
    const y0=Math.max(0,Math.ceil((w.y-w.ry)*height)),y1=Math.min(height-1,Math.floor((w.y+w.ry)*height));
    for(let y=y0;y<=y1;y+=step)for(let x=x0;x<=x1;x+=step){
      const i=(y*width+x)*4;if(data[i+3]<240)continue;
      const l=.2126*linear[data[i]]+.7152*linear[data[i+1]]+.0722*linear[data[i+2]];
      if(l>.006&&l<.94)values.push(Math.log(l));
    }
    if(values.length>=9)samples.push({...w,l:median(values)});
  }
  // Missing skin samples cannot justify an inferred lighting correction.
  if(samples.length<6)return identity();
  const horizontal=[];
  for(let row=0;row<3;row++){
    const pair=samples.filter(s=>s.row===row);
    horizontal.push((pair[1].l-pair[0].l)/(pair[1].x-pair[0].x));
  }
  const x=median(horizontal),vertical=[];
  for(let side=0;side<2;side++){
    const column=samples.filter(s=>s.side===side);
    for(const b of column.slice(1)){
      const a=column[0];if(b.y-a.y>.02)vertical.push((b.l-a.l-x*(b.x-a.x))/(b.y-a.y));
    }
  }
  const cx=samples.reduce((s,p)=>s+p.x,0)/samples.length,cy=samples.reduce((s,p)=>s+p.y,0)/samples.length;
  // Remove 60% of the estimated gradient; never exceed a modest local gain.
  return {x:clamp(-x*.6,-1.4,1.4),y:clamp(-(median(vertical)||0)*.6,-1.4,1.4),cx,cy,samples:samples.length};
}

export function illuminationGain(field,x,y){
  if(![field?.x,field?.y,field?.cx,field?.cy,x,y].every(Number.isFinite))return 1;
  return Math.exp(clamp(field.x*(x-field.cx)+field.y*(y-field.cy),-Math.log(1.32),Math.log(1.32)));
}

/** In-place scalar gains in linear RGB preserve colour ratios. The output LUT
 * avoids three pow() calls per pixel on every 1024px live camera photograph. */
export function balancePhotoLighting(data,width,height,target){
  const field=estimateIllumination(data,width,height,target);
  if(Math.abs(field.x)+Math.abs(field.y)<.015)return field;
  const columns=Float64Array.from({length:width},(_,x)=>Math.exp(field.x*(x/width-field.cx)));
  const minGain=1/1.32,maxGain=1.32;
  for(let y=0;y<height;y++){
    const row=Math.exp(field.y*(y/height-field.cy));
    for(let x=0;x<width;x++){
      const i=(y*width+x)*4;if(!data[i+3])continue;
      const r=linear[data[i]],g=linear[data[i+1]],b=linear[data[i+2]];
      // Use common highlight headroom rather than clipping each channel and
      // shifting warm skin towards white. Alpha is never changed.
      const gain=Math.min(clamp(columns[x]*row,minGain,maxGain),1/Math.max(r,g,b,1e-8));
      data[i]=encoded[Math.round(r*gain*8192)];
      data[i+1]=encoded[Math.round(g*gain*8192)];
      data[i+2]=encoded[Math.round(b*gain*8192)];
    }
  }
  return field;
}
