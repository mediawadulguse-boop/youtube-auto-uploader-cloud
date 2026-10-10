import {plainSource} from './radar-engine.mjs';
import {displayHeadline,sourceMaterialKey,publisherKey} from './radar-methodology.mjs';
import {matchesTopic,canonicalUrl,fail} from './radar-store.mjs';
import {focusAllows} from './radar-focus.mjs';
const HOUR=3600000;
const STOP=new Set('di ke dari pada dalam dengan dan atau untuk yang ini itu tersebut oleh sebagai adalah akan sudah telah juga para ia mereka kami kita kamu saya nya namun tetapi karena agar jika saat ketika setelah sebelum tentang atas hingga lalu masih lebih paling sangat jadi menjadi bisa dapat punya memiliki ada tidak tak bukan belum hari minggu bulan tahun jam terbaru update breaking news video foto live shorts youtube subscribe like share berita politik ekonomi kebijakan kontroversi kontroversial polemik sebut menyebut disebut kata ujar mengatakan kritik mengkritik dikritik dipersoalkan dipertanyakan mempertanyakan bantah membantah dibantah bantahan tuduhan diduga dugaan menilai dinilai menolak ditolak penolakan wacana rencana ungkap mengungkapkan menurut soal terkait mengenai tanggapi tanggapan baca juga selengkapnya simak begini berikut kini kembali minta meminta beri memberi jadi bikin pak bu bapak ibu hal secara tengah terus resmi indonesia nasional'.split(' '));
const normalize=value=>String(value||'').normalize('NFKD').replace(/\p{M}/gu,'').toLocaleLowerCase('id-ID');
function words(text){return (normalize(plainSource(text)).match(/[\p{L}\p{N}]+/gu)||[]).filter(word=>word.length>=3&&!STOP.has(word)&&!/^[\p{N}]+$/u.test(word));}
function sourceTerms(source){
 const title=words(displayHeadline(source.title||'',source.publisher||'')),terms=new Map();
 // Co-occurring title terms are labels, not reconstructed sentences or search queries.
 for(const word of new Set([...title,...words(source.excerpt||'')]))terms.set(word,{key:word,label:word,words:[word],kind:'word',headline:title.includes(word)});
 for(let i=0;i<title.length;i++)for(let j=i+1;j<Math.min(title.length,i+5);j++){
  if(title[i]===title[j])continue;
  const pair=[title[i],title[j]].sort(),key=pair.join(' · ');
  terms.set(key,{key,label:key,words:pair,kind:'pair',headline:true});
 }
 return terms;
}
export function buildRadarTrends(data,{period=24,topic='',platform='',now=Date.now()}={}){
 if(![24,168].includes(Number(period)))throw fail('Pilih tren 24 jam atau 7 hari.');period=Number(period);
 const active=(data.topics||[]).filter(t=>t.enabled),selected=topic?active.find(t=>t.id===topic):null;
 if(topic&&!selected)throw fail('Topik tren tidak aktif atau tidak ditemukan.',404);
 if(platform&&!['YouTube','Berita / Web'].includes(platform))throw fail('Platform tren tidak valid.');
 const start=now-period*HOUR,previousStart=start-period*HOUR,seenUrls=new Set(),seenMaterial=new Set(),documents=[];
 let undated=0,future=0,reposts=0,duplicates=0;
 const sources=(data.issues||[]).filter(issue=>issue.status!=='ignored'&&issue.stats?.relevant!==false).flatMap(issue=>(issue.sources||[]).map(source=>({source,issue})));
 // Oldest publication wins when the same source is attached to more than one issue.
 sources.sort((a,b)=>(Date.parse(a.source.publishedAt)||Infinity)-(Date.parse(b.source.publishedAt)||Infinity)||String(a.source.url).localeCompare(String(b.source.url)));
 for(const {source,issue} of sources){
  if(platform&&source.platform!==platform)continue;
  if(!(selected?[selected]:active).some(t=>t.sources?.includes(source.platform==='YouTube'?'youtube':'news')&&matchesTopic(source,t))||!focusAllows(source,data.focus))continue;
  const at=Date.parse(source.publishedAt||'');
  if(!Number.isFinite(at)){undated++;continue;}if(at>now){future++;continue;}if(at<previousStart)continue;
  if(source.repost){reposts++;continue;}
  let url;try{url=canonicalUrl(source.url);}catch{continue;}
  const material=sourceMaterialKey(source);
  if(seenUrls.has(url)||material.trim()&&seenMaterial.has(material)){duplicates++;continue;}
  seenUrls.add(url);if(material.trim())seenMaterial.add(material);
  documents.push({at,url,source,issue,terms:sourceTerms(source),current:at>=start});
 }
 const current=documents.filter(d=>d.current),previous=documents.filter(d=>!d.current),items=new Map();
 for(const doc of current)for(const term of doc.terms.values()){
  if(!items.has(term.key))items.set(term.key,{...term,headlineMentions:0,docs:[]});const item=items.get(term.key);item.docs.push(doc);if(term.headline)item.headlineMentions++;
 }
 const sorted=[...items.values()].filter(item=>item.headlineMentions>0&&(item.kind==='word'||item.docs.length>=2)).sort((a,b)=>b.docs.length-a.docs.length||Number(b.kind==='pair')-Number(a.kind==='pair')||a.key.localeCompare(b.key,'id'));
 const chosen=[];
 for(const item of sorted){
  // Avoid repeating a single word when a pair covers exactly the same documents.
  if(item.kind==='word'&&chosen.some(pair=>pair.kind==='pair'&&pair.words.includes(item.key)&&pair.docs.length===item.docs.length))continue;
  if(item.kind==='pair'&&chosen.filter(x=>x.kind==='pair').length>=6)continue;
  chosen.push(item);if(chosen.length===10)break;
 }
 const step=period===24?HOUR:24*HOUR,count=period===24?24:7;
 const keywords=chosen.map(item=>{
  const before=previous.filter(doc=>doc.terms.has(item.key)).length;
  const buckets=Array.from({length:count},(_,i)=>({startAt:new Date(start+i*step).toISOString(),endAt:new Date(start+(i+1)*step).toISOString(),count:0}));
  for(const doc of item.docs)buckets[Math.min(count-1,Math.floor((doc.at-start)/step))].count++;
  return {key:item.key,label:item.label,kind:item.kind,count:item.docs.length,previousCount:before,delta:item.docs.length-before,share:Math.round(item.docs.length/Math.max(1,current.length)*100),publishers:new Set(item.docs.map(d=>publisherKey(d.source)).filter(Boolean)).size,buckets,
   sources:item.docs.toSorted((a,b)=>b.at-a.at).slice(0,5).map(d=>({issueId:d.issue.id,title:d.source.title,url:d.url,publisher:d.source.publisher,platform:d.source.platform,publishedAt:d.source.publishedAt}))};
 });
 const platforms={};for(const doc of current)platforms[doc.source.platform]=(platforms[doc.source.platform]||0)+1;
 return {version:1,usesAI:false,metric:'source-frequency',period,topic,platform,generatedAt:new Date(now).toISOString(),startAt:new Date(start).toISOString(),endAt:new Date(now).toISOString(),previousStartAt:new Date(previousStart).toISOString(),timeZone:'Asia/Jakarta',sourceCount:current.length,previousSourceCount:previous.length,publishers:new Set(current.map(d=>publisherKey(d.source)).filter(Boolean)).size,platforms,excluded:{undated,future,reposts,duplicates},keywords,
  note:'Kata kunci ditemukan pada judul; frekuensi dihitung dari judul dan cuplikan/deskripsi dari sumber Radar tersimpan, sekali per sumber. Tanda · berarti dua kata muncul bersama pada judul, bukan pernyataan fakta. Perbandingan memakai rentang sebelumnya dengan durasi yang sama; kelengkapan dipengaruhi sumber, sinkronisasi dan retensi. Ini bukan volume pencarian Google Trends atau ukuran seluruh percakapan publik.'};
}
