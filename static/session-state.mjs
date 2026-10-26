export const EMOTION_KEYS = ['happiness','neutral','sadness','surprise','anger','fear','disgust','contempt'];
export function normalizedScores(scores) {
  const values=EMOTION_KEYS.map(key=>Number.isFinite(scores?.[key])?Math.max(0,scores[key]):0);
  const max=Math.max(...values); if(!max) return null;
  const sum=values.reduce((s,v)=>s+v/max,0);
  return Object.fromEntries(EMOTION_KEYS.map((key,i)=>[key,values[i]/max/sum]));
}
export class LocalSession {
  constructor({limit=20,onRelease=()=>{}}={}) {this.limit=Math.max(1,Math.min(20,Math.floor(limit)||20));this.onRelease=onRelease;this.records=[];}
  add({scores,photoUrl,anchors,time=new Date().toISOString()}) {
    const normalized=normalizedScores(scores);
    if(!normalized || typeof photoUrl!=='string' || !photoUrl.startsWith('blob:')) throw new Error('需要有效的表情结果和浏览器本地照片。');
    const record={id:crypto.randomUUID(),time,scores:normalized,emotion:EMOTION_KEYS.reduce((a,b)=>normalized[a]>=normalized[b]?a:b),image_url:photoUrl,photo_anchors:structuredClone(anchors||{})};
    this.records.push(record);
    while(this.records.length>this.limit) this.onRelease(this.records.shift().image_url);
    return record.id;
  }
  reset() {for(const record of this.records)this.onRelease(record.image_url);this.records=[];}
  snapshot() {
    const scores=this.records.length?Object.fromEntries(EMOTION_KEYS.map(key=>[key,this.records.reduce((s,p)=>s+p.scores[key],0)/this.records.length])):{};
    return {participants:structuredClone(this.records),participant_count:this.records.length,group_scores:scores};
  }
}
