const fail=(message,status=400)=>Object.assign(Error(message),{status});
export function videoIdFromInput(value){
 if(typeof value!=='string')throw fail('Masukkan tautan atau ID video YouTube.');
 const text=value.trim();if(/^[A-Za-z0-9_-]{11}$/.test(text))return text;
 try{const u=new URL(text);if(u.protocol!=='https:'&&u.protocol!=='http:')throw 0;const host=u.hostname.toLowerCase();let id='';if(host==='youtu.be')id=u.pathname.split('/')[1];else if(['youtube.com','www.youtube.com','m.youtube.com','studio.youtube.com'].includes(host))id=u.searchParams.get('v')||u.pathname.match(/^\/(?:shorts|live|embed|video)\/([A-Za-z0-9_-]{11})(?:\/|$)/)?.[1];if(/^[A-Za-z0-9_-]{11}$/.test(id||''))return id;}catch{}
 throw fail('Tautan atau ID video YouTube tidak valid.');
}
export function publicationFromVideo(video,now=new Date().toISOString()){
 const s=video.status||{},privacy=s.privacyStatus||null;
 const status=['failed','rejected'].includes(s.uploadStatus)?'failed':s.uploadStatus==='deleted'?'deleted':s.uploadStatus&&s.uploadStatus!=='processed'?'processing_youtube':privacy==='public'?'published':privacy==='unlisted'?'unlisted_youtube':privacy==='private'&&s.publishAt?'scheduled_youtube':privacy==='private'?'private_youtube':'linked_youtube';
 return {videoId:video.id,channelId:video.snippet?.channelId||null,status,privacyStatus:privacy,uploadStatus:s.uploadStatus||null,scheduledAt:s.publishAt||null,publishedAt:privacy==='public'?video.snippet?.publishedAt||null:null,checkedAt:now};
}
export function authRequiredError(){return Object.assign(Error('Izin Google/YouTube kedaluwarsa atau dicabut. Hubungkan ulang YouTube untuk melanjutkan; naskah dan file antrean tetap tersimpan.'),{status:401,code:'youtube_auth_required'});}
export const isYouTubeAuthError=error=>error?.code==='youtube_auth_required'||error?.code==='invalid_grant'||/Token has been expired or revoked|invalid_grant/i.test(String(error?.message||''));

export async function syncLinkedPublications({store,fetcher,channelId,guard=()=>{},now=Date.now()}){
 const data=await store.read(),items=data.contents.filter(c=>!c.archived&&c.youtubeVideoId&&(!c.youtubePublication?.channelId||c.youtubePublication.channelId===channelId)&&(!c.youtubePublication?.checkedAt||now-Date.parse(c.youtubePublication.checkedAt)>=15*60000)).sort((a,b)=>(Date.parse(a.youtubePublication?.checkedAt)||0)-(Date.parse(b.youtubePublication?.checkedAt)||0)).slice(0,50);
 if(!items.length)return {updated:0};
 const response=await fetcher('https://www.googleapis.com/youtube/v3/videos?'+new URLSearchParams({part:'snippet,status',id:items.map(c=>c.youtubeVideoId).join(',')}),{signal:AbortSignal.timeout(20000)});
 const payload=await response.json();if(!response.ok)throw Object.assign(Error('Gagal memeriksa status video YouTube.'),{status:response.status});
 let updated=0;
 for(const item of items){
  const video=payload.items?.find(v=>v.id===item.youtubeVideoId&&v.snippet?.channelId===channelId);if(!video)continue;
  try{await store.recordPublication(item.id,item.revision,video,guard);updated++;}catch(error){if(error.status!==409)throw error;}
 }
 return {updated};
}
