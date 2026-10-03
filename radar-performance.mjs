const metric=value=>value!==undefined&&value!==null&&/^\d+$/.test(String(value))&&Number.isSafeInteger(Number(value))&&Number(value)>=0?Number(value):null;
export function buildRadarPerformance(data,channel,{channelId='',now=Date.now()}={}){
 const contents=data.contents||[],issues=data.radar?.issues||[];
 const items=issues.filter(i=>i.contentIds.length).map(issue=>({id:issue.id,title:issue.title,contents:issue.contentIds.flatMap(id=>{
  const c=contents.find(c=>c.id===id);if(!c)return [];const video=channel.videos?.[c.youtubeVideoId],owned=!!channelId&&video?.snippet?.channelId===channelId,dated=Number.isFinite(Date.parse(video?.dataUpdatedAt||''));
  return [{id:c.id,title:c.title,format:c.format,videoId:c.youtubeVideoId||'',state:!c.youtubeVideoId?'unlinked':!owned?'unavailable':!dated?'unavailable':now-Date.parse(video.dataUpdatedAt)>30*86400000?'stale':'cached',capturedAt:owned&&dated?video.dataUpdatedAt:null,metrics:owned&&dated?{views:metric(video.statistics?.viewCount),likes:metric(video.statistics?.likeCount),comments:metric(video.statistics?.commentCount)}:null}];
 })}));
 return {items,usesAI:false,note:'Hubungan isu → konten → video dari tautan tersimpan. Angka publik adalah total sepanjang umur video dan memiliki tanggal pengambilan; format, usia video dan distribusi berbeda. Ini tidak membuktikan sebab-akibat atau efektivitas prompt. CTR/retention dapat dibuka pada Analytics jika akses tersedia.'};
}
