import {analyticsError,validateVideoId} from './analytics.mjs';
const API='https://www.googleapis.com/youtube/v3/';
const fail=(message,status=400)=>Object.assign(Error(message),{status});
export class YouTubeManager {
  constructor(fetcher){this.fetcher=fetcher;this.pending=new Map()}
  async request(path,params={},options={}){
    const r=await this.fetcher(API+path+'?'+new URLSearchParams(params),{...options,signal:AbortSignal.timeout(20000)}),data=await r.json().catch(()=>({}));
    if(!r.ok){if(r.status===412)throw fail('Video berubah di YouTube. Muat versi terbaru sebelum menyimpan.',409);throw analyticsError(r.status,data,'YouTube Data API v3')}
    return data;
  }
  async ownVideo(channelId,id){validateVideoId(id);const d=await this.request('videos',{part:'snippet,status',id}),video=d.items?.find(v=>v.id===id);if(!video||video.snippet?.channelId!==channelId)throw fail('Video tidak ditemukan pada channel ini.',404);return video}
  async details(channelId,id){const v=await this.ownVideo(channelId,id);return {id,etag:v.etag,title:v.snippet.title,description:v.snippet.description||'',tags:v.snippet.tags||[],privacyStatus:v.status?.privacyStatus||null}}
  async lock(id,fn){const prior=this.pending.get(id)||Promise.resolve(),work=prior.catch(()=>{}).then(fn);this.pending.set(id,work);try{return await work}finally{if(this.pending.get(id)===work)this.pending.delete(id)}}
  save(channelId,id,body){return this.lock(id,async()=>{
    if(!body||typeof body.title!=='string'||!body.title.trim()||body.title.length>100||/[<>]/.test(body.title))throw fail('Judul wajib diisi, maksimal 100 karakter, tanpa tanda < atau >.');
    if(typeof body.description!=='string'||Buffer.byteLength(body.description)>5000||/[<>]/.test(body.description))throw fail('Deskripsi maksimal 5.000 byte, tanpa tanda < atau >.');
    if(!Array.isArray(body.tags)||body.tags.some(t=>typeof t!=='string'||!t.trim()||/[<>]/.test(t)))throw fail('Tag tidak valid');
    const tags=[...new Set(body.tags.map(t=>t.trim()))],count=tags.reduce((n,t,i)=>n+t.length+(t.includes(' ')?2:0)+(i?1:0),0);if(count>500)throw fail('Total tag maksimal 500 karakter.');
    const v=await this.ownVideo(channelId,id);if(!body.etag||v.etag!==body.etag)throw fail('Video berubah. Muat versi terbaru sebelum menyimpan.',409);
    const snippet={title:body.title.trim(),description:body.description,tags,categoryId:v.snippet.categoryId};
    for(const k of ['defaultLanguage','defaultAudioLanguage'])if(v.snippet[k])snippet[k]=v.snippet[k];
    await this.request('videos',{part:'snippet'},{method:'PUT',headers:{'content-type':'application/json','if-match':v.etag},body:JSON.stringify({id,snippet})});
    return {ok:true,snippet};
  })}
  async thumbnail(channelId,id,body){
    const bytes=Buffer.from(typeof body?.base64==='string'?body.base64:'','base64');
    if(!bytes.length||bytes.length>2*1024*1024)throw fail('Thumbnail harus berisi gambar, maksimal 2 MB.');
    const png=bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])),jpg=bytes[0]===255&&bytes[1]===216&&bytes[2]===255;
    if(!png&&!jpg)throw fail('Gunakan gambar PNG atau JPEG yang valid.');await this.ownVideo(channelId,id);
    const r=await this.fetcher('https://www.googleapis.com/upload/youtube/v3/thumbnails/set?videoId='+encodeURIComponent(id),{method:'POST',headers:{'content-type':png?'image/png':'image/jpeg'},body:bytes,signal:AbortSignal.timeout(30000)});
    if(!r.ok)throw analyticsError(r.status,await r.json().catch(()=>({})),'YouTube Data API v3');return {ok:true};
  }
  async comments(channelId,id,pageToken=''){await this.ownVideo(channelId,id);const d=await this.request('commentThreads',{part:'snippet',videoId:id,textFormat:'plainText',maxResults:'20',order:'time',...(pageToken?{pageToken}:{})});return {nextPageToken:d.nextPageToken||'',comments:(d.items||[]).map(item=>{const comment=item.snippet.topLevelComment;return {id:comment.id,author:comment.snippet.authorDisplayName,text:comment.snippet.textOriginal||comment.snippet.textDisplay,publishedAt:comment.snippet.publishedAt,likes:comment.snippet.likeCount,replies:item.snippet.totalReplyCount}})}}
  async reply(channelId,id,body){
    if(typeof body?.parentId!=='string'||!/^[A-Za-z0-9_-]{1,200}$/.test(body.parentId)||typeof body.text!=='string'||!body.text.trim()||body.text.length>10000)throw fail('Isi balasan dan komentar yang valid.');
    await this.ownVideo(channelId,id);const parent=await this.request('comments',{part:'snippet',id:body.parentId});if(!parent.items?.some(c=>c.id===body.parentId&&c.snippet?.videoId===id))throw fail('Komentar bukan milik video ini.',404);
    await this.request('comments',{part:'snippet'},{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({snippet:{parentId:body.parentId,textOriginal:body.text.trim()}})});return {ok:true};
  }
  async ownPlaylist(channelId,id){if(typeof id!=='string'||!/^[A-Za-z0-9_-]{1,100}$/.test(id))throw fail('Playlist tidak valid.');const d=await this.request('playlists',{part:'snippet',id});if(!d.items?.some(p=>p.id===id&&p.snippet?.channelId===channelId))throw fail('Playlist bukan milik channel ini.',404);}
  async playlists(channelId,id){await this.ownVideo(channelId,id);const d=await this.request('playlists',{part:'snippet',mine:'true',maxResults:'50'});return {playlists:(d.items||[]).filter(p=>p.snippet?.channelId===channelId).map(p=>({id:p.id,title:p.snippet.title})),nextPageToken:d.nextPageToken||''}}
  async addPlaylist(channelId,id,body){await this.ownVideo(channelId,id);await this.ownPlaylist(channelId,body?.playlistId);const exists=await this.request('playlistItems',{part:'id',playlistId:body.playlistId,videoId:id,maxResults:'50'});if(exists.items?.length)return {ok:true,alreadyAdded:true};await this.request('playlistItems',{part:'snippet'},{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({snippet:{playlistId:body.playlistId,resourceId:{kind:'youtube#video',videoId:id}}})});return {ok:true}}
}
