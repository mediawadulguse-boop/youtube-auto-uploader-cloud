import {trendText,extractTrendKeywords,trendKeywordMention} from './radar-keywords.mjs';
import {sourceMaterialKey,publisherKey} from './radar-methodology.mjs';
import {matchesTopic,canonicalUrl,fail} from './radar-store.mjs';
import {focusAllows} from './radar-focus.mjs';
const HOUR=3600000;
function documentIndex(documents){
 const index=new Map();
 for(const doc of documents)for(const word of new Set(doc.text.all.flatMap(segment=>segment.map(token=>token.word)))){
  if(!index.has(word))index.set(word,new Set());index.get(word).add(doc);
 }
 return index;
}
function matchingDocuments(term,index){
 const pool=term.words.map(word=>index.get(word)||new Set()).sort((a,b)=>a.size-b.size)[0];
 return [...(pool||[])].filter(doc=>trendKeywordMention(doc.text,term));
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
  documents.push({at,url,source,issue,text:trendText(source),current:at>=start});
 }
 const current=documents.filter(d=>d.current),previous=documents.filter(d=>!d.current),items=new Map(),currentIndex=documentIndex(current),previousIndex=documentIndex(previous);
 for(const doc of current){doc.keywords=extractTrendKeywords(doc.source,doc.text);for(const term of doc.keywords.values())if(!items.has(term.key))items.set(term.key,term);}
 const sorted=[...items.values()].map(term=>({...term,docs:matchingDocuments(term,currentIndex)})).filter(term=>term.docs.length).sort((a,b)=>b.docs.length-a.docs.length||b.specificity-a.specificity||a.key.localeCompare(b.key,'id'));
 const chosen=[];
 for(const item of sorted){
  // Suppress a less specific phrase only when exactly the same sources support both.
  if(chosen.some(other=>item.words.every(word=>other.words.includes(word))&&item.docs.length===other.docs.length&&item.docs.every(doc=>other.docs.includes(doc))))continue;
  chosen.push(item);if(chosen.length===10)break;
 }
 const step=period===24?HOUR:24*HOUR,count=period===24?24:7;
 const keywords=chosen.map(item=>{
  const before=matchingDocuments(item,previousIndex).length;
  const contextDoc=item.docs.filter(doc=>doc.keywords.has(item.key)).toSorted((a,b)=>b.at-a.at)[0]||item.docs[0];
  const buckets=Array.from({length:count},(_,i)=>({startAt:new Date(start+i*step).toISOString(),endAt:new Date(start+(i+1)*step).toISOString(),count:0}));
  for(const doc of item.docs)buckets[Math.min(count-1,Math.floor((doc.at-start)/step))].count++;
  return {key:item.key,label:item.label,kind:item.kind,context:{title:contextDoc.source.title,url:contextDoc.url,publisher:contextDoc.source.publisher},count:item.docs.length,previousCount:before,delta:item.docs.length-before,share:Math.round(item.docs.length/Math.max(1,current.length)*100),publishers:new Set(item.docs.map(d=>publisherKey(d.source)).filter(Boolean)).size,buckets,
   sources:item.docs.toSorted((a,b)=>b.at-a.at).slice(0,5).map(d=>({issueId:d.issue.id,title:d.source.title,url:d.url,publisher:d.source.publisher,platform:d.source.platform,publishedAt:d.source.publishedAt}))};
 });
 const platforms={};for(const doc of current)platforms[doc.source.platform]=(platforms[doc.source.platform]||0)+1;
 return {version:2,usesAI:false,metric:'source-frequency',period,topic,platform,generatedAt:new Date(now).toISOString(),startAt:new Date(start).toISOString(),endAt:new Date(now).toISOString(),previousStartAt:new Date(previousStart).toISOString(),timeZone:'Asia/Jakarta',sourceCount:current.length,previousSourceCount:previous.length,publishers:new Set(current.map(d=>publisherKey(d.source)).filter(Boolean)).size,platforms,excluded:{undated,future,reposts,duplicates},keywords,
  note:'Frasa isu ditemukan pada judul sumber, termasuk tokoh/lembaga yang muncul dekat pokok masalah. Hitungan memakai judul dan cuplikan/deskripsi dari sumber Radar tersimpan, sekali per sumber. Tanda · menghubungkan unsur topik dalam kalimat yang sama, bukan membentuk klaim baru. Judul asli menjadi konteks; kata umum dan nama tunggal tidak dijadikan keyword. Perbandingan memakai rentang sebelumnya dengan durasi yang sama; kelengkapan dipengaruhi sumber, sinkronisasi dan retensi. Ini bukan volume pencarian Google Trends atau ukuran seluruh percakapan publik.'};
}
