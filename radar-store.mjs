import {analyzeChannel} from './radar-channels.mjs';
import crypto from 'node:crypto';
import {createIssueMatcher,rateIssue,RADAR_METHOD,displayHeadline} from './radar-methodology.mjs';
import {selectIssue,groupingProvenance} from './radar-grouping.mjs';
export const LENSES=[{id:'system',name:'The System & Capital',color:'#6b55d8',role:'Bedah struktur, uang, kekuasaan, dan kebijakan.'},{id:'history',name:'The Hidden History & Mechanics',color:'#22799a',role:'Sejarah, arsip, kronologi, dan data sebagai bukti.'},{id:'human',name:'The Human Mirror',color:'#b26930',role:'Dampak sehari-hari, empati, dan pergeseran perspektif.'}];
export const fail=(message,status=400)=>Object.assign(new Error(message),{status});
const txt=(v,max,required=false)=>{if(typeof v!=='string'||v.length>max||(required&&!v.trim()))throw fail('Teks wajib diisi dan tidak boleh melebihi batas.');return v.trim()};
const list=(v,max=30)=>{if(!Array.isArray(v)||v.length>max)throw fail('Daftar tidak valid.');return [...new Set(v.map(x=>txt(x,150,true)))];};
const when=v=>{if(!v)return null;if(!Number.isFinite(Date.parse(v)))throw fail('Tanggal tidak valid.');return new Date(v).toISOString()};
export function canonicalUrl(value){let u;try{u=new URL(txt(value,2048,true))}catch{throw fail('Masukkan link http/https yang valid.')}if(!['https:','http:'].includes(u.protocol)||u.username||u.password)throw fail('Link harus http/https tanpa kredensial.');u.hash='';u.hostname=u.hostname.toLowerCase();for(const key of [...u.searchParams.keys()])if(/^(utm_|fbclid$|gclid$)/i.test(key))u.searchParams.delete(key);if(/(^|\.)youtu(be\.com|\.be)$/.test(u.hostname)){const id=u.hostname==='youtu.be'?u.pathname.slice(1).split('/')[0]:u.searchParams.get('v')||u.pathname.match(/^\/(shorts|embed)\/([^/]+)/)?.[2];if(id&&/^[\w-]{11}$/.test(id))return 'https://www.youtube.com/watch?v='+id;}if(u.hostname==='twitter.com'||u.hostname==='www.twitter.com')u.hostname='x.com';u.searchParams.sort();return u.href;}
export function platform(url){const h=new URL(url).hostname;return /(^|\.)youtube\.com$|^youtu\.be$/.test(h)?'YouTube':/(^|\.)(x|twitter)\.com$/.test(h)?'X':/(^|\.)instagram\.com$/.test(h)?'Instagram':/(^|\.)tiktok\.com$/.test(h)?'TikTok':'Berita / Web';}
const defaults=()=>({version:1,clusteringVersion:RADAR_METHOD.version,topics:[['system','Struktur & kebijakan',['pajak','subsidi','kebijakan publik','monopoli','ketenagakerjaan','ekonomi politik','regulasi','birokrasi']],['history','Sejarah & data',['arsip sejarah','krisis komoditas','tata kota','rekam jejak perusahaan','kronologi','data empiris']],['human','Realitas manusia',['biaya hidup','kelas menengah','meritokrasi','burnout','alienasi','ilusi pilihan']]].map(([lens,name,keywords])=>({id:'default-'+lens,name,keywords,exclusions:[],lenses:[lens],language:'id',region:'ID',sources:['news','youtube'],enabled:true,revision:1})),feeds:[],channels:[],issues:[],sync:{},aiUsage:{}});
export function radarData(db){return db.radar||defaults()}
function writable(db){return db.radar||=defaults()}
const find=(arr,id)=>{const v=arr.find(x=>x.id===id);if(!v)throw fail('Data Radar tidak ditemukan.',404);return v};
const revision=(old,body)=>{if(old&&body.revision!==old.revision)throw fail('Data berubah di tab lain. Muat Radar terbaru.',409)};
function videoMetadata(video){
 if(!video||typeof video!=='object'||Array.isArray(video))throw fail('Metadata video tidak valid.');
 return {thumbnail:typeof video.thumbnail==='string'&&/^https:\/\/i\.ytimg\.com\//.test(video.thumbnail)?video.thumbnail.slice(0,2048):'',duration:typeof video.duration==='string'&&/^PT[0-9HMS.]+$/.test(video.duration)?video.duration.slice(0,60):'',viewCount:Number.isSafeInteger(video.viewCount)&&video.viewCount>=0?video.viewCount:null};
}
export const issueStats=rateIssue;
export function matchesTopic(source,topic){const hay=(source.title+' '+(source.excerpt||'')).toLocaleLowerCase('id');return topic.enabled&&topic.keywords.some(x=>hay.includes(x.toLowerCase()))&&!topic.exclusions.some(x=>hay.includes(x.toLowerCase()));}
export class RadarStore{
 constructor(contentStore,{now=()=>Date.now()}={}){this.contentStore=contentStore;this.now=now}
 async read(){
  const db=await this.contentStore.read(),r=radarData(db),now=this.now();
  const issues=r.issues.map(i=>{
   const stats=issueStats(i,now),matched=r.topics.filter(t=>t.enabled&&i.sources.some(source=>t.sources.includes(source.platform==='YouTube'?'youtube':'news')&&matchesTopic(source,t))),relevant=matched.length>0;
   stats.relevant=relevant;
   if(i.groupingReview){stats.isHot=false;stats.reason+=' Pengelompokan sumber perlu ditinjau.';}
   if(!relevant){stats.isHot=false;stats.reason+=' Tidak cocok dengan topik aktif.';}
   return {...i,topicIds:[...new Set([...i.topicIds,...matched.map(t=>t.id)])],stats};
  });
  const hotIssues=issues.filter(i=>i.stats.isHot&&!['ignored','discussed'].includes(i.status)).sort((a,b)=>b.stats.score-a.stats.score||Date.parse(b.stats.latestPublishedAt)-Date.parse(a.stats.latestPublishedAt)||a.id.localeCompare(b.id));
  const rankedIssues=issues.filter(i=>i.stats.relevant&&!['ignored','discussed'].includes(i.status)).sort((a,b)=>b.stats.score-a.stats.score||Date.parse(b.stats.latestPublishedAt||0)-Date.parse(a.stats.latestPublishedAt||0)||a.id.localeCompare(b.id));
  const {reportArchive,aiCache,aiHistory,promptLibrary,...visible}=r;
  return {...visible,channels:r.channels.map(c=>analyzeChannel(c,r.topics,issues,now)),lenses:LENSES,issues,hotIssues,rankedIssueIds:rankedIssues.map(i=>i.id),methodology:RADAR_METHOD,
   radarSummary:{groups:issues.length,ranked:rankedIssues.length,hot:hotIssues.length,belowThreshold:issues.filter(i=>!i.stats.isHot).length,ratedAt:new Date(now).toISOString()},
   linkedContents:db.contents.map(c=>({id:c.id,title:c.title,format:c.format})),
   coverage:{YouTube:(r.sync.youtubeAt||r.channels.some(c=>c.enabled&&c.lastSyncAt))?'Dipantau':'Belum dipantau','Berita / Web':r.sync.newsAt?'Dipantau':'Belum dipantau',X:'Belum dipantau',Instagram:'Belum dipantau',TikTok:'Belum dipantau'}};
 }
 // Re-group only untouched machine imports. Editorial choices and IDs of saved/linked groups stay intact.
 async recluster(){
  const db=await this.contentStore.read();if(!db.radar||db.radar.clusteringVersion===RADAR_METHOD.version)return {skipped:true};
  return this.mutate(r=>{
   if(r.clusteringVersion===RADAR_METHOD.version)return {skipped:true};
   const match=createIssueMatcher(),eligible=i=>i.status==='new'&&!i.groupingLocked&&!i.groupPartition&&!i.groupingReview&&!i.eventDate&&!i.contentIds.length&&i.sources.length>0&&[i.sources[0].title,displayHeadline(i.sources[0].title,i.sources[0].publisher)].some(title=>title.toLowerCase()===i.title.toLowerCase())&&i.sources.every(s=>s.coverage!=='manual'&&s.verification==='unchecked'&&!s.repost);
   const groups=[],before=r.issues.length;
   for(const item of [...r.issues].sort((a,b)=>Date.parse(a.createdAt)-Date.parse(b.createdAt)||a.id.localeCompare(b.id))){
    let target=null,best=0;
    if(eligible(item))for(const group of groups){
     if(!eligible(group)||group.sources.length+item.sources.length>100)continue;
     const scores=item.sources.map(source=>match(group,source)),score=Math.min(...scores);
     if(score>best){target=group;best=score;}
    }
    if(!target){groups.push(item);continue;}
    target.sources.push(...item.sources.filter(source=>!target.sources.some(s=>s.url===source.url)));
    for(const key of ['topicIds','lenses','contentIds'])target[key]=[...new Set([...target[key],...item[key]])];
    target.revision++;target.groupRevision=(target.groupRevision||1)+1;target.observations=[];target.updatedAt=[target.updatedAt,item.updatedAt].sort().at(-1);
   }
   r.issues=groups.sort((a,b)=>Date.parse(b.updatedAt)-Date.parse(a.updatedAt));r.clusteringVersion=RADAR_METHOD.version;
   return {before,after:groups.length,merged:before-groups.length,version:RADAR_METHOD.version};
  });
 }

 mutate(fn){return this.contentStore.mutate(db=>fn(writable(db),db))}
 saveTopic(body,id){return this.mutate(r=>{const old=id?find(r.topics,id):null;revision(old,body);const name=txt(body.name,100,true),keywords=list(body.keywords),exclusions=list(body.exclusions||[]),lenses=list(body.lenses,3),sources=list(body.sources,2);if(!keywords.length||!lenses.length||lenses.some(x=>!LENSES.some(l=>l.id===x))||!sources.length||sources.some(x=>!['news','youtube'].includes(x)))throw fail('Isi keyword, lensa, dan sumber pemantauan.');if(!/^[a-z]{2}$/.test(body.language)||!/^[A-Z]{2}$/.test(body.region)||typeof body.enabled!=='boolean')throw fail('Bahasa, wilayah, atau status tidak valid.');if(!old&&r.topics.length>=60)throw fail('Maksimal 60 topik.');const item={id:old?.id||crypto.randomUUID(),name,keywords,exclusions,lenses,sources,language:body.language,region:body.region,enabled:body.enabled,revision:(old?.revision||0)+1};if(old)r.topics[r.topics.indexOf(old)]=item;else r.topics.push(item);return item;});}
 remove(kind,id,body){return this.mutate(r=>{if(!['topics','feeds','channels'].includes(kind))throw fail('Jenis data tidak valid.');const item=find(r[kind],id);revision(item,body);r[kind]=r[kind].filter(x=>x.id!==id);return {ok:true};});}
 saveFeed(body,id){return this.mutate(r=>{const old=id?find(r.feeds,id):null;revision(old,body);const url=canonicalUrl(body.url);if(!old&&r.feeds.length>=15)throw fail('Maksimal 15 RSS.');const item={id:old?.id||crypto.randomUUID(),name:txt(body.name,100,true),url,enabled:body.enabled!==false,revision:(old?.revision||0)+1};if(old)r.feeds[r.feeds.indexOf(old)]=item;else r.feeds.push(item);return item;});}
 setVideoFeedback(id,body){if(!body||typeof body!=='object'||Array.isArray(body))throw fail('Pilihan video tidak valid.');return this.mutate(r=>{const channel=find(r.channels,id);revision(channel,body);if(!['relevant','less','discussed',''].includes(body.choice))throw fail('Pilihan video tidak valid.');if(![...(channel.videos||[]),...(channel.historyVideos||[])].some(v=>v.id===body.videoId))throw fail('Video tidak ditemukan.',404);channel.videoFeedback||={};if(body.choice)channel.videoFeedback[body.videoId]={choice:body.choice,at:new Date(this.now()).toISOString()};else delete channel.videoFeedback[body.videoId];channel.revision++;return {revision:channel.revision};});}
 saveChannel(body){return this.mutate(r=>{const url=canonicalUrl(body.url),u=new URL(url);if(!/(^|\.)youtube\.com$/.test(u.hostname)||!/^\/(channel\/UC[\w-]{22}|@[\w.%-]+)\/?$/.test(u.pathname))throw fail('Gunakan URL YouTube /@handle atau /channel/UC…');if(!['inspiration','competitor','reference'].includes(body.role))throw fail('Peran channel tidak valid.');if(r.channels.some(c=>c.url===url))throw fail('Channel sudah dipantau.',409);if(r.channels.length>=20)throw fail('Maksimal 20 channel.');const item={id:crypto.randomUUID(),url,role:body.role,enabled:true,revision:1,videos:[],snapshots:[]};r.channels.push(item);return item;});}
 async addSources(inputs,topicIds=[],issueId=null){
 if(!Array.isArray(inputs)||!inputs.length||inputs.length>100||inputs.some(x=>!x||typeof x!=='object'||Array.isArray(x)))throw fail('Daftar sumber Radar tidak valid.');
 return this.mutate(r=>{
  const added=[],match=createIssueMatcher();let addedCount=0;
  for(const input of inputs){
   const url=canonicalUrl(input.url),existing=r.issues.find(i=>i.sources.some(s=>s.url===url));
   const topicMatches=topicIds.length?topicIds:r.topics.filter(t=>matchesTopic(input,t)).map(t=>t.id);
   if(existing){
    if(issueId&&issueId!==existing.id)throw fail('Link ini sudah ada di isu lain. Gunakan Gabungkan isu.',409);
    const old=existing.sources.find(s=>s.url===url);
    if(platform(url)==='YouTube'&&input.video){old.video=videoMetadata(input.video);existing.revision++;}
    if(old.coverage!=='manual'&&input.excerpt&&!old.excerpt){old.excerpt=txt(input.excerpt,3000);old.coverage='snippet';existing.revision++;}
    if(old.coverage!=='manual' && !old.publisherUrl && input.publisherUrl){old.publisherUrl=canonicalUrl(input.publisherUrl);existing.revision++;}
    const ids=[...new Set([...existing.topicIds,...topicMatches])];
    if(ids.length!==existing.topicIds.length){existing.topicIds=ids;existing.revision++;}
    if(input.coverage==='manual'&&existing.status==='new'){existing.status='saved';existing.revision++;}
    added.push(existing.id);continue;
   }
   if(r.issues.reduce((n,i)=>n+i.sources.length,0)>=2000)throw fail('Radar penuh (2.000 sumber). Hapus isu yang tidak diperlukan.');
   const title=txt(input.title,300,true),now=new Date(this.now()).toISOString();
   const source={id:crypto.randomUUID(),url,title,publisher:txt(input.publisher||new URL(url).hostname,160,true),
    ...(input.publisherUrl?{publisherUrl:canonicalUrl(input.publisherUrl)}:{}),platform:platform(url),...(platform(url)==='YouTube'&&input.video?{video:videoMetadata(input.video)}:{}),publishedAt:when(input.publishedAt),discoveredAt:now,
    excerpt:txt(input.excerpt||'',3000),coverage:input.coverage==='snippet'?'snippet':input.coverage==='manual'?'manual':'headline',verification:'unchecked',repost:input.repost===true};
   const selection=issueId?null:selectIssue(r.issues,source,match);
   let issue=issueId?find(r.issues,issueId):selection.issue;
   source.grouping=groupingProvenance(issueId?'manual_add':selection.ambiguousPartition?'needs_review':selection.match?.basis==='manual_rule'?'manual_rule':issue?'automatic':'anchor',now,selection?.match);
   if(!issue){
    if(r.issues.length>=800)throw fail('Radar penuh (800 isu). Gabungkan atau hapus isu yang tidak diperlukan.');
    issue={id:crypto.randomUUID(),title:displayHeadline(title,source.publisher),status:source.coverage==='manual'?'saved':'new',topicIds:[],lenses:[],sources:[],contentIds:[],eventDate:null,createdAt:now,updatedAt:now,revision:1,...(selection?.ambiguousPartition?{groupPartition:selection.ambiguousPartition,groupingLocked:true,groupingReview:true}:{})};r.issues.unshift(issue);
   }else issue.revision++;
   if(issue.sources.length>=100)throw fail('Maksimal 100 sumber per isu.');
   if(issueId)issue.groupingLocked=true;
   if(source.coverage==='manual'&&issue.status==='new')issue.status='saved';
   issue.sources.push(source);issue.topicIds=[...new Set([...issue.topicIds,...topicMatches.filter(id=>r.topics.some(t=>t.id===id))])];
   issue.lenses=[...new Set([...issue.lenses,...r.topics.filter(t=>issue.topicIds.includes(t.id)).flatMap(t=>t.lenses)])];
   issue.updatedAt=now;added.push(issue.id);addedCount++;
  }
  return {issueIds:[...new Set(added)],addedCount};
 });}

 changeIssue(id,body){return this.mutate((r,db)=>{const issue=find(r.issues,id);revision(issue,body);if('groupingReview'in body){if(body.groupingReview!==false)throw fail('Gunakan penanda kelompok sudah diperiksa.');issue.groupingReview=false;issue.groupingLocked=true;issue.groupingHistory=[...(issue.groupingHistory||[]),{action:'reviewed',at:new Date(this.now()).toISOString()}].slice(-20);}if('status'in body){if(!['new','saved','ignored','discussed'].includes(body.status))throw fail('Status tidak valid.');issue.status=body.status;}if('title'in body){issue.title=txt(body.title,300,true);issue.groupingLocked=true;}if('eventDate'in body){issue.eventDate=when(body.eventDate);issue.groupingLocked=true;}if('lenses'in body){issue.groupingLocked=true;const lenses=list(body.lenses,3);if(lenses.some(x=>!LENSES.some(l=>l.id===x)))throw fail('Lensa tidak valid.');issue.lenses=lenses;}if(body.sourceId){const s=find(issue.sources,body.sourceId);if(!['unchecked','verified','compare'].includes(body.verification)||typeof body.repost!=='boolean')throw fail('Verifikasi sumber tidak valid.');s.verification=body.verification;if(s.repost!==body.repost){issue.groupRevision=(issue.groupRevision||1)+1;issue.observations=[];}s.repost=body.repost;}if(body.contentId){if(!db.contents.some(c=>c.id===body.contentId))throw fail('Konten tidak ditemukan.',404);issue.contentIds=[...new Set([...issue.contentIds,body.contentId])];}issue.revision++;return issue;});}
 merge(id,body){return this.mutate(r=>{const target=find(r.issues,id),source=find(r.issues,body.fromId);revision(target,body);if(target.id===source.id||body.fromRevision!==source.revision)throw fail('Isu berubah atau tujuan sama.',409);if(target.sources.length+source.sources.length>100)throw fail('Gabungan melebihi 100 sumber.');
  const partition=target.groupPartition||source.groupPartition;if(partition){for(const issue of r.issues)if(source.groupPartition&&issue.id!==source.id&&issue.groupPartition===source.groupPartition&&issue.groupPartition!==partition){issue.groupPartition=partition;issue.revision++;}target.groupPartition=partition;}
  const at=new Date(this.now()).toISOString(),history=[...(target.groupingHistory||[]),...(source.groupingHistory||[]),{action:'merge',at,fromIssueId:source.id,sourceIds:source.sources.map(s=>s.id)}];target.groupingHistory=[...new Map(history.map(h=>[JSON.stringify(h),h])).values()].sort((a,b)=>String(a.at||'').localeCompare(String(b.at||''))).slice(-20);target.groupingReview=false;
  if(source.research){const a=target.research||{notes:'',checklist:[]},b=source.research,notes=[a.notes,b.notes].filter(Boolean).join('\n\n'),checklist=[...a.checklist,...b.checklist];if(notes.length>20000||checklist.length>60)throw fail('Gabungan catatan riset terlalu panjang; ringkas dahulu.');target.research={notes,checklist};}
  target.sources.push(...source.sources.filter(s=>!target.sources.some(x=>x.url===s.url)));for(const k of ['topicIds','lenses','contentIds'])target[k]=[...new Set([...target[k],...source[k]])];target.groupingLocked=true;target.groupRevision=(target.groupRevision||1)+1;target.observations=[];target.revision++;target.updatedAt=at;r.issues=r.issues.filter(i=>i.id!==source.id);return target;});}
 split(id,body){return this.mutate(r=>{
  const original=find(r.issues,id);revision(original,body);
  const sourceIds=list(body.sourceIds,100);
  if(!sourceIds.length||sourceIds.length>=original.sources.length||sourceIds.some(sid=>!original.sources.some(source=>source.id===sid)))throw fail('Pilih sebagian sumber untuk dipisahkan; sisakan minimal satu sumber.');
  if(r.issues.length>=800)throw fail('Radar penuh (800 isu). Hapus isu yang tidak diperlukan sebelum memisahkan.');
  const selected=original.sources.filter(source=>sourceIds.includes(source.id)),now=new Date(this.now()).toISOString();
  const title=txt(body.title,300,true);
  const partition=original.groupPartition||crypto.randomUUID();original.groupPartition=partition;original.groupingReview=false;
  const created={id:crypto.randomUUID(),title,status:original.status,topicIds:[...original.topicIds],lenses:[...original.lenses],sources:selected,contentIds:[],eventDate:original.eventDate,createdAt:now,updatedAt:now,revision:1,groupingLocked:true,groupPartition:partition,groupingReview:false,groupRevision:1,observations:[]};
  const correction={action:'split',at:now,originalId:original.id,createdId:created.id,sourceIds};original.groupingHistory=[...(original.groupingHistory||[]),correction].slice(-20);created.groupingHistory=[correction];
  original.sources=original.sources.filter(source=>!sourceIds.includes(source.id));original.revision++;original.groupingLocked=true;original.groupRevision=(original.groupRevision||1)+1;original.observations=[];original.updatedAt=now;
  r.issues.unshift(created);return {issueId:created.id,originalId:original.id};
 });}
 observe(){return this.mutate(r=>{
  const now=this.now(),at=new Date(now).toISOString();let recorded=0;
  for(const issue of r.issues){
   const history=issue.observations||[],previous=history.at(-1);
   if(previous&&now-Date.parse(previous.at)<30*60000)continue;
   const stats=issueStats(issue,now);
   issue.observations=[...history,{at,publishers24h:stats.publishers24h,groupRevision:issue.groupRevision||1}].slice(-48);recorded++;
  }
  return {recorded,at};
 });}
 deleteIssue(id,body){return this.mutate(r=>{const issue=find(r.issues,id);revision(issue,body);if(issue.contentIds.length)throw fail('Isu terhubung ke konten; gunakan Abaikan agar referensi terjaga.');r.issues=r.issues.filter(i=>i.id!==id);return {ok:true};});}
}
