import http from 'node:http';
import https from 'node:https';
import dns from 'node:dns/promises';
import net from 'node:net';
import {parseDocument,DomUtils} from 'htmlparser2';
import {fail,canonicalUrl} from './radar-store.mjs';
import {publicAddress} from './radar-sync.mjs';
import {transcriptText} from './radar-workspace.mjs';

// Validate every redirect, reject mixed/private DNS answers, and pin the selected address.
export async function safeArticle(url,{lookup=dns.lookup,requestFor=u=>u.protocol==='https:'?https:http,deadline=Date.now()+20000,redirects=0}={}){
 const u=new URL(canonicalUrl(url)),host=u.hostname.replace(/^\[|\]$/g,'');
 if(u.port&&!['80','443'].includes(u.port))throw fail('Port sumber harus 80/443.');
 const remaining=deadline-Date.now();if(remaining<=0)throw fail('Pengambilan artikel melewati batas waktu.',504);
 let timer;const addresses=await Promise.race([net.isIP(host)?Promise.resolve([{address:host,family:net.isIP(host)}]):lookup(host,{all:true}),new Promise((_,reject)=>{timer=setTimeout(()=>reject(fail('DNS sumber terlalu lama.',504)),remaining);})]).finally(()=>clearTimeout(timer));
 if(!addresses.length||addresses.some(a=>!publicAddress(a.address)||/^2002:/i.test(a.address)))throw fail('Sumber harus memakai alamat server publik.');
 if(Date.now()>=deadline)throw fail('Pengambilan artikel melewati batas waktu.',504);
 return new Promise((resolve,reject)=>{
  const request=requestFor(u).get(u,{headers:{'user-agent':'ContentHub-Radar/4.21 (+source research)','accept':'text/html, text/plain;q=0.9','accept-encoding':'identity'},lookup:(hostname,opts,callback)=>opts.all?callback(null,[addresses[0]]):callback(null,addresses[0].address,addresses[0].family)},response=>{
   if([301,302,303,307,308].includes(response.statusCode)){response.resume();if(redirects>=3)return reject(fail('Terlalu banyak redirect sumber.'));try{safeArticle(new URL(response.headers.location,u).href,{lookup,requestFor,deadline,redirects:redirects+1}).then(resolve,reject);}catch(e){reject(e);}return;}
   if(response.statusCode!==200){response.resume();return reject(fail('Artikel tidak dapat diakses (HTTP '+response.statusCode+'). Gunakan impor manual.',422));}
   const type=String(response.headers['content-type']||'').toLowerCase();if(!/^(text\/html|application\/xhtml\+xml|text\/plain)(?:;|$)/.test(type)||response.headers['content-encoding']&&response.headers['content-encoding']!=='identity'){response.resume();return reject(fail('Format artikel tidak didukung. Gunakan impor teks.',422));}
   if(Number(response.headers['content-length'])>512*1024){response.resume();return reject(fail('Artikel melebihi batas 512 KB.',422));}
   let size=0;const parts=[];response.on('data',part=>{size+=part.length;if(size>512*1024)return request.destroy(fail('Artikel melebihi batas 512 KB.',422));parts.push(part);});response.on('error',reject);response.on('aborted',()=>reject(fail('Artikel terputus.',502)));response.on('end',()=>resolve({body:Buffer.concat(parts).toString('utf8'),type,url:u.href}));
  });
  const timeout=setTimeout(()=>request.destroy(fail('Pengambilan artikel melewati batas waktu.',504)),Math.max(1,deadline-Date.now()));request.on('close',()=>clearTimeout(timeout));request.setTimeout(12000,()=>request.destroy(fail('Sumber terlalu lama merespons.',504)));request.on('error',reject);
 });
}
export function extractArticle(body,type='text/html'){
 let text;if(type.startsWith('text/plain'))text=body;else{
  const root=parseDocument(body,{decodeEntities:true});
  const hidden=DomUtils.findAll(n=>['script','style','nav','footer','header','aside','form','noscript','svg','iframe'].includes(n.name)||n.attribs&&(n.attribs.hidden!==undefined||n.attribs['aria-hidden']==='true'||/display\s*:\s*none|visibility\s*:\s*hidden/i.test(n.attribs.style||'')),root.children);
  for(const n of hidden)DomUtils.removeElement(n);
  const articles=DomUtils.findAll(n=>n.name==='article',root.children),mains=DomUtils.findAll(n=>n.name==='main',root.children),containers=articles.length?articles:mains.length?mains:[root];
  const groups=containers.map(container=>DomUtils.findAll(n=>['p','h1','h2','h3','li'].includes(n.name),container.children).filter(n=>!n.parent||!['p','li'].includes(n.parent.name)).map(n=>DomUtils.textContent(n).replace(/\s+/g,' ').trim()).filter(s=>s.length>=15&&!/^(baca juga|subscribe|ikuti kami|copyright|hak cipta|iklan|advertisement|bagikan|sign in|log in|berlangganan untuk)/i.test(s)));
  text=groups.sort((a,b)=>b.join('\n').length-a.join('\n').length)[0]?.join('\n')||'';
 }
 text=text.replace(/\r/g,'').split('\n').map(s=>s.replace(/\s+/g,' ').trim()).filter(Boolean).join('\n');
 if(text.length<150||/^(?:just a moment|access denied|verify you are human|checking your browser)/i.test(text))throw fail('Teks artikel belum cukup atau akses dibatasi. Impor bahan yang Anda berhak gunakan.',422);
 const truncated=text.length>50000;if(truncated){text=text.slice(0,50000);const end=text.search(/[^.!?]*$/);text=text.slice(0,end).trim();}
 if(!text)throw fail('Artikel tidak memiliki kalimat lengkap.',422);return {text,truncated};
}
export async function acquireCaptions(source,{youtube,channelId}){
 const videoId=new URL(source.url).searchParams.get('v');
 if(!/^[\w-]{11}$/.test(videoId||''))throw fail('ID video tidak valid.');
 if(!channelId)throw fail('Hubungkan channel pemilik video dahulu atau impor transkrip manual.',422);
 const read=async url=>{const response=await youtube(url,{signal:AbortSignal.timeout(20000)});if(!response.ok)throw fail('YouTube tidak memberikan akses transkrip (HTTP '+response.status+'). Impor TXT/SRT/VTT yang berhak Anda gunakan.',422);return response;};
 const metadata=await (await read('https://www.googleapis.com/youtube/v3/videos?part=snippet&id='+videoId)).json();
 if(metadata.items?.[0]?.snippet?.channelId!==channelId)throw fail('Transkrip otomatis hanya untuk video milik channel terhubung. Video channel lain memerlukan impor manual.',422);
 const tracks=await (await read('https://www.googleapis.com/youtube/v3/captions?part=snippet&videoId='+videoId)).json();
 const available=(tracks.items||[]).filter(t=>t.snippet?.status==='serving'&&!t.snippet?.isDraft),track=available.find(t=>t.snippet.language==='id')||available.find(t=>t.snippet.language==='en')||available[0];
 if(!track)throw fail('Belum ada caption yang dapat diunduh. Impor transkrip manual.',422);
 const response=await read('https://www.googleapis.com/youtube/v3/captions/'+encodeURIComponent(track.id)+'?tfmt=vtt'),reader=response.body.getReader();let size=0;const chunks=[];
 try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>200000)throw fail('Transkrip terlalu besar. Impor bagian relevan secara manual.',422);chunks.push(Buffer.from(value));}}finally{await reader.cancel().catch(()=>{});}
 const raw=Buffer.concat(chunks).toString('utf8');return {text:transcriptText(raw,'vtt'),format:'txt',language:track.snippet.language,origin:'youtube-captions'};
}
export class RadarAcquire{
 constructor(store,{article=safeArticle,captions,now=()=>Date.now()}={}){this.store=store;this.article=article;this.captions=captions;this.now=now;this.busy=new Set();}
 async acquire(id,body){
  if(!body||typeof body!=='object'||Array.isArray(body)||body.replace!==undefined&&typeof body.replace!=='boolean')throw fail('Pilihan pengambilan bahan tidak valid.');
  const issue=(await this.store.read()).issues.find(i=>i.id===id);if(!issue)throw fail('Isu tidak ditemukan.',404);
  if(body.revision!==issue.revision)throw fail('Bahan berubah. Muat riset terbaru.',409);
  const source=issue.sources.find(s=>s.id===body.sourceId);if(!source)throw fail('Sumber tidak ditemukan.',404);
  const field=source.platform==='YouTube'?'transcript':'article';
  if(source[field]&&!body.replace)return {issue,cached:true,status:'ready',note:'Bahan tersimpan dipakai ulang; tidak ada permintaan jaringan.'};
  if(this.busy.has(source.id))throw fail('Pengambilan bahan sumber ini sedang berjalan.',409);
  if(this.now()-Date.parse(source.acquisition?.attemptedAt||0)<60000)throw fail('Tunggu satu menit sebelum mengambil sumber yang sama lagi.',429);
  const snapshot=JSON.stringify(source);this.busy.add(source.id);let material,error;
  try{
   try{if(field==='transcript'){if(!this.captions)throw fail('Pengambilan caption belum tersedia. Gunakan impor manual.',422);material=await this.captions(source);}else if(source.platform==='Berita / Web'){const result=await this.article(source.url);material={...extractArticle(result.body,result.type),url:result.url,origin:'public-article'};}else throw fail('Platform ini memerlukan impor teks manual.',422);}catch(e){error=e;}
   const changed=await this.store.mutate(r=>{
    const current=r.issues.find(i=>i.id===id),target=current?.sources.find(s=>s.id===source.id);
    if(!target||current.revision!==issue.revision||JSON.stringify(target)!==snapshot)throw fail('Sumber berubah selama pengambilan. Bahan baru tidak menimpa perubahan Anda.',409);
    const at=new Date(this.now()).toISOString();target.acquisition={status:error?'unavailable':'ready',attemptedAt:at,message:error?'Bahan tidak dapat diambil. Gunakan impor manual; '+error.message.slice(0,300):'Bahan tersimpan; belum otomatis terverifikasi.'};
    if(!error){const bytes=r.issues.flatMap(i=>i.sources).reduce((n,s)=>n+Buffer.byteLength(s.transcript?.text||'')+Buffer.byteLength(s.article?.text||''),0)-Buffer.byteLength(target[field]?.text||'')+Buffer.byteLength(material.text);if(bytes>10*1024*1024)throw fail('Kapasitas bahan sumber 10 MB tercapai.');target[field]={...material,importedAt:at};target.verification='unchecked';current.groupingLocked=true;}
    current.revision++;return current;
   });
   return {issue:changed,cached:false,status:error?'unavailable':'ready',note:error?'Akses bahan belum tersedia; tidak ada pembatasan akses yang dilewati. Impor teks manual.':'Bahan sumber diambil tanpa permintaan AI.'};
  }finally{this.busy.delete(source.id);}
 }
}
