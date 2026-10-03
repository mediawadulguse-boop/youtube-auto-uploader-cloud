// Deterministic public-metric analysis. No provider calls and no inferred private analytics.
export const CHANNEL_ENGINE_VERSION=1;
export const CHANNEL_RETENTION_DAYS=30;
export const CHANNEL_SNAPSHOT_LIMIT=800;
const HOUR=3600000,DAY=24*HOUR;
const time=v=>Date.parse(v||'');
const count=v=>Number.isSafeInteger(v)&&v>=0?v:null;
const round=v=>Math.round(v*10)/10;
const median=a=>{const s=a.toSorted((a,b)=>a-b),m=Math.floor(s.length/2);return s.length?(s.length%2?s[m]:(s[m-1]+s[m])/2):null;};
const num=v=>new Intl.NumberFormat('id-ID',{maximumFractionDigits:1}).format(v);
export function durationSeconds(value){const m=/^PT(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?$/.exec(value||'');return m&&m.slice(1).some(Boolean)?Number(m[1]||0)*3600+Number(m[2]||0)*60+Number(m[3]||0):null;}
function comparable(a,b){const x=durationSeconds(a.duration),y=durationSeconds(b.duration);return x>0&&y>0&&(x<=180)===(y<=180)&&Math.max(x,y)/Math.min(x,y)<=1.5;}
function observations(channel,id,now){return (channel.snapshots||[]).filter(s=>time(s.at)>=now-CHANNEL_RETENTION_DAYS*DAY&&time(s.at)<=now&&count(s.values?.[id]?.viewCount)!==null).map(s=>({at:s.at,atMs:time(s.at),views:s.values[id].viewCount})).toSorted((a,b)=>a.atMs-b.atMs).filter((s,i,a)=>!i||s.atMs!==a[i-1].atMs);}
function closestObservation(history,published,age,tolerance){
 if(!Number.isFinite(published))return null;
 const target=published+age*HOUR;let low=0,high=history.length;
 while(low<high){const middle=(low+high)>>>1;if(history[middle].atMs<target)low=middle+1;else high=middle;}
 return [history[low-1],history[low]].filter(o=>o&&o.atMs>=published&&Math.abs(o.atMs-target)<=tolerance*HOUR).toSorted((a,b)=>Math.abs(a.atMs-target)-Math.abs(b.atMs-target)||a.atMs-b.atMs)[0]||null;
}
export function retainChannelHistory(channel,mapped,snapshot,now){
 const cutoff=now-CHANNEL_RETENTION_DAYS*DAY,byId=new Map();
 for(const v of [...(channel.historyVideos||[]),...(channel.videos||[])]){const seen=v.lastObservedAt||channel.lastSyncAt;if(time(seen)>=cutoff&&time(seen)<=now)byId.set(v.id,{...v,lastObservedAt:seen});}
 for(const v of mapped)byId.set(v.id,{...v,lastObservedAt:snapshot.at});
 channel.historyVideos=[...byId.values()].toSorted((a,b)=>time(b.lastObservedAt)-time(a.lastObservedAt)||a.id.localeCompare(b.id)).slice(0,200);
 const ids=new Set(channel.historyVideos.map(v=>v.id));
 channel.snapshots=[...(channel.snapshots||[]),snapshot].filter(s=>time(s.at)>=cutoff&&time(s.at)<=now).toSorted((a,b)=>time(a.at)-time(b.at)).filter((s,i,a)=>!i||s.at!==a[i-1].at).slice(-CHANNEL_SNAPSHOT_LIMIT).map(s=>({at:s.at,values:Object.fromEntries(Object.entries(s.values||{}).filter(([id])=>ids.has(id)))}));
 // Feedback is bounded with the retained metadata, and sync never overwrites choices.
 if(channel.videoFeedback)channel.videoFeedback=Object.fromEntries(Object.entries(channel.videoFeedback).filter(([id])=>ids.has(id)));
}
function matches(video,topics){const hay=(video.title+' '+(video.description||'')).toLocaleLowerCase('id');return topics.filter(t=>t.enabled&&t.sources.includes('youtube')&&t.keywords.some(k=>hay.includes(k.toLocaleLowerCase('id')))&&!t.exclusions.some(k=>hay.includes(k.toLocaleLowerCase('id'))));}
export function analyzeChannel(channel,topics=[],issues=[],now=Date.now()){
 const all=[...new Map([...(channel.historyVideos||[]),...(channel.videos||[])].map(v=>[v.id,v])).values()];
 const histories=new Map(all.map(v=>[v.id,observations(channel,v.id,now)])),issueByUrl=new Map();
 for(const issue of issues)for(const source of issue.sources){const linked=issueByUrl.get(source.url)||[];if(!linked.includes(issue))linked.push(issue);issueByUrl.set(source.url,linked);}
 const videos=all.map(v=>{
  const obs=histories.get(v.id),last=obs.at(-1),prev=last&&obs.findLast(s=>last.atMs-s.atMs>=HOUR/2),before=prev&&obs.findLast(s=>prev.atMs-s.atMs>=HOUR/2);
  const hours=prev?(last.atMs-prev.atMs)/HOUR:null,delta=prev?last.views-prev.views:null,corrected=delta!==null&&delta<0,stale=!last||count(v.viewCount)===null||now-last.atMs>DAY;
  const rate=hours&&!corrected?delta/hours:null,oldRate=before?(prev.views-before.views)/((prev.atMs-before.atMs)/HOUR):null;
  const accelerating=!stale&&rate>0&&oldRate>0&&rate>=oldRate*1.2;
  const age=last?(last.atMs-time(v.publishedAt))/HOUR:null,peers=[];
  if(age>=0&&age<=30*24&&comparable(v,v))for(const other of all){if(other.id===v.id||!comparable(v,other))continue;const published=time(other.publishedAt),tolerance=Math.max(1,Math.min(age*.25,age<=168?6:72));const closest=closestObservation(histories.get(other.id),published,age,tolerance);if(closest)peers.push(closest.views);}
  const baseline=peers.length>=3?median(peers):null,ratio=baseline>0&&last?last.views/baseline:null,matched=matches(v,topics);
  const linked=issueByUrl.get(v.url)||[];
  const feedback=channel.videoFeedback?.[v.id]?.choice||'',discussed=feedback==='discussed'||linked.some(i=>i.status==='discussed');
  const hasDraft=linked.some(i=>i.contentIds?.length),reasons=[],needs=[];
  if(corrected){reasons.push('Jumlah views berkurang; kemungkinan koreksi metrik. Laju pertumbuhan tidak dihitung.');needs.push('Periksa pengamatan berikutnya.');}
  else if(rate!==null)reasons.push(`Views ${delta>0?'bertambah':'tidak bertambah'} ${num(delta)} dalam ${num(hours)} jam (${num(rate)} views/jam).`);
  else reasons.push('Belum ada dua pengamatan views yang berjarak minimal 30 menit.');
  if(ratio!==null)reasons.push(`${num(ratio)}× median ${peers.length} video channel ini, dengan durasi dan usia publikasi sebanding.`);
  else needs.push(peers.length<3?'Belum ada minimal 3 video pembanding pada usia dan durasi sebanding.':'Median views pembanding nol; rasio tidak dihitung.');
  if(matched.length)reasons.push('Cocok dengan topik: '+matched.map(t=>t.name).join(', ')+'.');
  else {reasons.push('Belum cocok dengan keyword topik aktif; dapat dipilih sebagai referensi.');needs.push('Periksa kecocokan topik sebelum menyusun naskah.');}
  if(stale)needs.push('Data views belum tersedia atau lebih dari 24 jam; sinkronkan untuk memperbarui.');
  if(!v.description)needs.push('Bahan judul saja; tambahkan deskripsi, transkrip atau sumber primer.');
  if(!linked.some(i=>new Set(i.sources.map(s=>s.publisher)).size>1))needs.push('Cari sumber pembanding dari penerbit lain.');
  const ageNow=(now-time(v.publishedAt))/HOUR;
  const components={relevance:matched.length?35:0,recency:ageNow>=0?Math.max(0,20*(1-ageNow/168)):0,growth:!stale&&rate>0?Math.min(25,Math.log10(1+rate)*8):0,baseline:!stale&&ratio!==null?Math.min(20,Math.max(0,(ratio-1)*10)):0};
  const score=Math.round(Math.max(0,Math.min(100,Object.values(components).reduce((a,b)=>a+b,0)+(feedback==='relevant'?10:feedback==='less'?-25:0))));
  const status=discussed?'Sudah dibuat':hasDraft?'Sudah ada draft':feedback==='less'?'Kurang relevan':stale?'Data belum mutakhir':corrected?'Metrik perlu diperiksa':accelerating?'Pertumbuhan meningkat':ratio>=1.5?'Di atas pembanding':rate>0?'Views bertambah':matched.length?'Referensi relevan':'Mengumpulkan data';
  return {...v,lastObservedAt:v.lastObservedAt||channel.lastSyncAt,analysis:{usesAI:false,version:CHANNEL_ENGINE_VERSION,score,components,status,feedback,discussed,hasDraft,stale,observationCount:obs.length,growth:prev?{from:prev.at,to:last.at,hours:round(hours),delta,perHour:rate===null?null:round(rate),accelerating,corrected}:null,baseline:{peers:peers.length,median:baseline,ratio:ratio===null?null:round(ratio)},topicIds:matched.map(t=>t.id),reasons:reasons.slice(0,3),needs,issueIds:linked.map(i=>i.id),researchQuestion:'Apa bukti primer, kronologi dan insentif yang menjelaskan isu ini, serta bagaimana dampaknya pada orang yang terlibat?'}};
 }).toSorted((a,b)=>b.analysis.score-a.analysis.score||time(b.publishedAt)-time(a.publishedAt)||a.id.localeCompare(b.id));
 const repeating=topics.filter(t=>t.enabled&&t.sources.includes('youtube')).map(t=>({id:t.id,name:t.name,videos:videos.filter(v=>v.analysis.topicIds.includes(t.id)).length})).filter(t=>t.videos>=2).toSorted((a,b)=>b.videos-a.videos).slice(0,3);
 const periods=[1,7].map(days=>{const cutoff=now-days*DAY;let delta=0,measured=0;const rising=[];for(const v of videos){const obs=histories.get(v.id).filter(o=>o.atMs>=cutoff),first=obs[0],last=obs.at(-1);if(!first||last.atMs-first.atMs<HOUR/2||last.views<first.views)continue;const change=last.views-first.views;measured++;delta+=change;rising.push({id:v.id,title:v.title,delta:change,from:first.at,to:last.at});}return {days,measuredVideos:measured,observedViewIncrease:delta,newUploads:videos.filter(v=>time(v.publishedAt)>=cutoff&&time(v.publishedAt)<=now).length,rising:rising.toSorted((a,b)=>b.delta-a.delta).slice(0,3)};});
 return {...channel,videos,analysis:{usesAI:false,version:CHANNEL_ENGINE_VERSION,retentionDays:CHANNEL_RETENTION_DAYS,snapshotLimit:CHANNEL_SNAPSHOT_LIMIT,observedVideos:videos.length,measuredVideos:videos.filter(v=>v.analysis.growth&&!v.analysis.growth.corrected&&!v.analysis.stale).length,repeatingTopics:repeating,periods,note:'Peringkat adalah prioritas riset, bukan prediksi viral atau penyebab kesuksesan. Riwayat maksimal 30 hari, 800 pengamatan dan 200 video per channel; sinkronisasi sangat sering dapat memendekkan cakupan. Durasi ≤3 menit tidak otomatis berarti Shorts. Ringkasan perubahan hanya mencakup interval yang benar-benar diamati.'}};
}
