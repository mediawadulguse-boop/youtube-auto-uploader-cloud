const metric=value=>value!==undefined&&value!==null&&/^\d+$/.test(String(value))&&Number.isSafeInteger(Number(value))&&Number(value)>=0?Number(value):null;
const median=values=>{const sorted=values.toSorted((a,b)=>a-b),n=sorted.length;return n?(n%2?sorted[(n-1)/2]:(sorted[n/2-1]+sorted[n/2])/2):null;};
function benchmark(c,data,channel,channelId,now){
 const video=channel.videos?.[c.youtubeVideoId],views=metric(video?.statistics?.viewCount),captured=Date.parse(video?.dataUpdatedAt||''),published=Date.parse(video?.snippet?.publishedAt||''),age=(captured-published)/3600000;
 if(!['long','shorts','live'].includes(c.format)||video?.snippet?.channelId!==channelId||views===null||!Number.isFinite(age)||age<0||age>30*24||now-captured>86400000||captured>now)return {peers:0,median:null,ratio:null};
 const seen=new Set([c.youtubeVideoId]),peers=[];
 for(const other of data.contents||[]){const v=channel.videos?.[other.youtubeVideoId],at=Date.parse(v?.dataUpdatedAt||''),oldAge=(at-Date.parse(v?.snippet?.publishedAt||''))/3600000,count=metric(v?.statistics?.viewCount);if(seen.has(other.youtubeVideoId)||other.format!==c.format||v?.snippet?.channelId!==channelId||count===null||!Number.isFinite(oldAge)||oldAge<0||Math.abs(at-captured)>86400000||now-at>86400000||at>now||Math.abs(oldAge-age)>Math.max(1,Math.min(48,age*.25)))continue;seen.add(other.youtubeVideoId);peers.push(count);}
 const baseline=peers.length>=3?median(peers):null;return {peers:peers.length,median:baseline,ratio:baseline>0?Math.round(views/baseline*100)/100:null,ageHours:Math.round(age*10)/10,format:c.format,note:'Median konten channel sendiri pada format dan usia sebanding, dari cache yang diperiksa dalam 24 jam. Tidak membuktikan sebab-akibat.'};
}
export function buildRadarPerformance(data,channel,{channelId='',now=Date.now()}={}){
 const contents=data.contents||[],issues=data.radar?.issues||[];
 const items=issues.filter(i=>i.contentIds.length).map(issue=>({id:issue.id,title:issue.title,contents:issue.contentIds.flatMap(id=>{
  const c=contents.find(c=>c.id===id);if(!c)return [];const video=channel.videos?.[c.youtubeVideoId],owned=!!channelId&&video?.snippet?.channelId===channelId,dated=Number.isFinite(Date.parse(video?.dataUpdatedAt||''));
  return [{id:c.id,title:c.title,format:c.format,videoId:c.youtubeVideoId||'',state:!c.youtubeVideoId?'unlinked':!owned?'unavailable':!dated?'unavailable':now-Date.parse(video.dataUpdatedAt)>30*86400000?'stale':'cached',capturedAt:owned&&dated?video.dataUpdatedAt:null,metrics:owned&&dated?{views:metric(video.statistics?.viewCount),likes:metric(video.statistics?.likeCount),comments:metric(video.statistics?.commentCount)}:null,benchmark:benchmark(c,data,channel,channelId,now)}];
 })}));
 return {items,usesAI:false,note:'Hubungan isu → konten → video dari tautan tersimpan. Angka publik adalah total sepanjang umur video dan memiliki tanggal pengambilan; format, usia video dan distribusi berbeda. Ini tidak membuktikan sebab-akibat atau efektivitas prompt. CTR/retention dapat dibuka pada Analytics jika akses tersedia.'};
}
