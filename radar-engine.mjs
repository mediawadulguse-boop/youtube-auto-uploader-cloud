import crypto from 'node:crypto';
import {enrichResearch} from './radar-research.mjs';
import {Parser} from 'htmlparser2';
import {publisherKey,displayHeadline} from './radar-methodology.mjs';

export const ENGINE_VERSION=6;
const cache=new Map();
const normalize=s=>String(s).normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase().replace(/[^\p{L}\p{N}%]+/gu,' ').trim();
const numberPattern=/(?<![\p{L}\p{N}])(?:Rp\.?\s*)?\d+(?:[.,]\d+)*(?:\s*(?:%|persen|ribu|juta|miliar|triliun|orang|pekerja|sekolah|desa|hari|tahun))?/giu;
const numbers=text=>[...text.matchAll(numberPattern)].map(m=>m[0].toLowerCase());
const opinion=/\b(menilai|berpendapat|berpandangan|seharusnya|semestinya|diduga|dugaan|diperkirakan|memperkirakan|perkiraan|prediksi|memprediksi|diyakini|mungkin|berpotensi|diharapkan|harapannya|mengkhawatirkan|terbaik|terburuk|lebih baik|tidak adil|optimistis|pesimistis)\b|[?!]/i;
const attributed=/\b(menurut|mengatakan|menyebut|mengklaim|klaim|ujar|kata|tutur|ungkap|mengungkapkan|menegaskan|menyatakan)\b|[“”"«»]/i;
export function classifyClaimText(text){const values=numbers(text);return {kind:opinion.test(text)?'opinions':values.length?'data':'facts',numbers:values,attributed:attributed.test(text)};}
const boiler=/^(?:subscribe|like(?: dan|,| &)? share|follow|baca juga|selengkapnya|hak cipta|copyright|klik (?:link|tautan)|jangan lupa|tonton video|https?:\/\/|www\.|#)/i;
const blocks=new Set(['p','div','li','br','h1','h2','h3','h4','tr','section','article']);
export function plainSource(value){
 let text='',hidden=0;
 const parser=new Parser({onopentag(name){if(['script','style'].includes(name))hidden++;if(!hidden&&blocks.has(name))text+='\n';},ontext(value){if(!hidden)text+=value;},onclosetag(name){if(['script','style'].includes(name))hidden=Math.max(0,hidden-1);if(!hidden&&blocks.has(name))text+='\n';}},{decodeEntities:true});
 parser.write(String(value||''));parser.end();
 return text.replace(/\r/g,'').split('\n').map(line=>line.replace(/\s+/g,' ').trim()).filter(Boolean).join('\n');
}
export function sentenceParts(text){
 const parts=[];let start=0;
 for(const match of text.matchAll(/[.!?](?:[”"»])?\s+(?=[\p{L}\p{N}“"'«])/gu)){
  const end=match.index+match[0].trimEnd().length,prefix=text.slice(start,end);
  // Titles, personal initials and abbreviated currency do not end a sentence.
  if(match[0][0]==='.'&&/(?:\b(?:dr|drs|prof|rp|pt|cv|no|jl|sdr|mr|mrs|ms|s\.pd|m\.pd|s\.h|m\.h|s\.e|m\.m|m\.si|s\.kom|s\.sos)|\b[A-Z])\.$/i.test(prefix))continue;
  if(/[”"»]/.test(match[0])&&/^(?:kata|ujar|tutur|ungkap|menurut)\b/i.test(text.slice(match.index+match[0].length)))continue;
  parts.push(prefix.trim());start=match.index+match[0].length;
 }
 if(text.slice(start).trim())parts.push(text.slice(start).trim());return parts;
}
export const materialText=source=>source.transcript?.text||source.article?.text||source.excerpt||'';
// Keep whole sentences and spread selection across the entire material, not just its opening.
export function selectSourceText(source,max=3000,query=''){
 const items=sentences(source,400).items,tokens=new Set(normalize(query||source.title||'').split(' ').filter(w=>w.length>3));
 const ranked=items.map((text,index)=>({text,index,zone:Math.min(3,Math.floor(index*4/Math.max(1,items.length))),score:normalize(text).split(' ').filter(w=>tokens.has(w)).length+Number(numbers(text).length>0)+Number(!!query&&query.includes(text))*10000}));
 const chosen=[],seen=new Set();let size=0;
 const add=item=>{if(item&&!seen.has(item.index)&&size+item.text.length+(chosen.length?1:0)<=max){chosen.push(item);seen.add(item.index);size+=item.text.length+(chosen.length>1?1:0);}};
 for(let zone=0;zone<4;zone++)add(ranked.filter(x=>x.zone===zone).sort((a,b)=>b.score-a.score||a.index-b.index)[0]);
 for(const item of ranked.sort((a,b)=>b.score-a.score||a.index-b.index))add(item);
 return chosen.sort((a,b)=>a.index-b.index).map(x=>x.text).join('\n');
}
export function sentences(source,limit=18){
 const excerpt=plainSource(materialText(source)),title=displayHeadline(plainSource(source.title),source.publisher),key=normalize(excerpt);
 const repeatedTitle=key===normalize(title)||key===normalize(title+' '+source.publisher);
 const headlineOnly=!excerpt||repeatedTitle,raw=headlineOnly?title:excerpt;
 let parts=raw.split('\n').flatMap(sentenceParts),truncated=false;
 if(!headlineOnly&&parts.length){const last=parts.at(-1);truncated=/\.{3}$|…$/.test(last)||!source.transcript&&!source.article&&String(source.excerpt||'').length>=3000&&!/[.!?][”"»]?$/.test(last);if(truncated)parts.pop();}
 if(!headlineOnly&&parts.some(x=>/\.{3}$|…$/.test(x)))truncated=true;
 const eligible=[...new Set(parts.filter(x=>x.length>=15&&!boiler.test(x)&&(headlineOnly||!/\.{3}$|…$/.test(x))))];
 const selected=eligible.length<=limit?eligible:Array.from({length:limit},(_,n)=>eligible[limit===1?0:Math.floor(n*(eligible.length-1)/(limit-1))]);
 if(selected.length)return {items:selected,headlineOnly,truncated};
 return {items:title.length>=15&&!boiler.test(title)?[title]:[],headlineOnly:true,truncated};
}
function evidence(source,number){return {number,id:source.id,url:source.url,title:source.title,publisher:source.publisher,publisherUrl:source.publisherUrl||'',platform:source.platform,publishedAt:source.publishedAt||null,coverage:source.coverage||'headline',verification:source.verification||'unchecked',repost:!!source.repost,hasTranscript:!!source.transcript,hasArticle:!!source.article};}
function collect(issue){
 const sources=[...new Map((issue.sources||[]).map(s=>[s.url,s])).values()].sort((a,b)=>String(a.url).localeCompare(String(b.url)));
 const references=sources.map((s,n)=>evidence(s,n+1)),buckets={data:[],facts:[],opinions:[]},exact=new Map();
 const material=sources.map(s=>sentences(s));
 for(const [index,source] of sources.entries())for(const text of material[index].items){
  // Predictions remain opinions; reported numbers retain attribution and source references.
  const {numbers:values,kind}=classifyClaimText(text);
  // Deduplicate literal claims only: fuzzy similarity can erase names or temporal qualifiers.
  const exactKey=kind+JSON.stringify(values)+normalize(text),existing=exact.get(exactKey);
  if(existing){if(!existing.sourceNumbers.includes(index+1))existing.sourceNumbers.push(index+1);existing.headlineOnly&&=material[index].headlineOnly;existing.attributed||=attributed.test(text);continue;}
  const entry={text,sourceNumbers:[index+1],attributed:attributed.test(text),headlineOnly:material[index].headlineOnly,numbers:values};
  buckets[kind].push(entry);exact.set(exactKey,entry);
 }
 for(const items of Object.values(buckets))for(const item of items){
  const support=item.sourceNumbers.map(n=>sources[n-1]);
  item.publishers=new Set(support.filter(s=>!s.repost).map(publisherKey).filter(Boolean)).size;
  item.sourceVerified=support.some(s=>s.verification==='verified');
  item.status=item.headlineOnly?'headline_only':item.attributed?'attributed_claim':'source_statement';
  const topicWords=new Set(normalize(issue.title||'').split(' ').filter(w=>w.length>3));item.relevance=normalize(item.text).split(' ').filter(w=>topicWords.has(w)).length;
 }
 for(const items of Object.values(buckets))items.sort((a,b)=>b.publishers-a.publishers||Number(a.headlineOnly)-Number(b.headlineOnly)||b.relevance-a.relevance||a.sourceNumbers[0]-b.sourceNumbers[0]);
 const skeleton=text=>{
  const dates=[...text.matchAll(/\b\d{1,2}\s+(?:januari|februari|maret|april|mei|juni|juli|agustus|september|oktober|november|desember)\s+(?:19|20)\d{2}\b|\b(?:19|20)\d{2}[-/]\d{1,2}[-/]\d{1,2}\b|\b\d{1,2}[-/]\d{1,2}[-/](?:19|20)\d{2}\b/gi)];
  return normalize(text.replace(numberPattern,(match,offset)=>/^(?:19|20)\d{2}$/.test(match.trim())||dates.some(d=>offset>=d.index&&offset<d.index+d[0].length)?match:match.replace(/\d+(?:[.,]\d+)*/,' angka ')));
 };
 const conflicts=[],numeric=buckets.data.slice(0,60);
 const comparison=new Map(numeric.map(item=>[item,skeleton(item.text)]));
 for(let a=0;a<numeric.length;a++)for(let b=a+1;b<numeric.length;b++){
  const left=numeric[a],right=numeric[b];if(JSON.stringify(left.numbers)===JSON.stringify(right.numbers))continue;
  if(comparison.get(left).split(' ').length>=4&&comparison.get(left)===comparison.get(right)&&conflicts.length<4)conflicts.push({left,right,note:'Angka berbeda dalam kalimat dengan konteks dan satuan serupa. Periksa sumber dan periode; engine tidak memilih angka yang benar.'});
 }
 const lead=[...buckets.data,...buckets.facts].filter(x=>!x.headlineOnly).sort((a,b)=>b.publishers-a.publishers||b.relevance-a.relevance||a.sourceNumbers[0]-b.sourceNumbers[0]).slice(0,3);
 const selected=lead.length?lead:[...buckets.data,...buckets.facts,...buckets.opinions].slice(0,2);
 const limitations=[];
 if(issue.groupingReview)limitations.push('Pengelompokan perlu ditinjau: bahan cocok dengan beberapa kelompok yang pernah dipisahkan.');
 if(material.some(s=>s.headlineOnly))limitations.push('Sebagian sumber hanya memiliki judul yang dapat diekstrak, sehingga konteks klaim belum lengkap.');
 if(material.some(s=>s.truncated))limitations.push('Akhir cuplikan yang terpotong tidak dimasukkan sebagai klaim lengkap.');
 if(material.some(s=>!s.items.length))limitations.push('Ada sumber tanpa kalimat yang cukup untuk dirangkum.');
 if(sources.some(s=>s.platform==='YouTube'&&!s.transcript))limitations.push('Video dirangkum dari judul/deskripsi yang tersedia; bukan transkrip atau isi video.');
 if(sources.some(s=>s.coverage==='snippet'&&!s.article&&!s.transcript))limitations.push('Cuplikan RSS/deskripsi tidak sama dengan artikel lengkap.');
 if(sources.some(s=>s.verification==='compare'))limitations.push('Ada sumber yang ditandai perlu pembanding.');
 if(sources.some(s=>!s.publishedAt))limitations.push('Ada sumber tanpa tanggal publikasi.');
 const shown=Object.fromEntries(Object.entries(buckets).map(([key,items])=>[key,items.slice(0,6)]));
 const report={engine:'extractive-rules',version:ENGINE_VERSION,usesAI:false,issueId:issue.id,title:issue.title,sourceCount:sources.length,
  summary:selected.map(x=>({...x})),...shown,totals:Object.fromEntries(Object.entries(buckets).map(([key,items])=>[key,items.length])),conflicts,sources:references,limitations,
  quality:{transcriptSources:sources.filter(s=>s.transcript).length,extractedSources:material.filter(s=>s.items.length).length,headlineOnlySources:material.filter(s=>s.headlineOnly&&s.items.length).length,excerptSources:material.filter(s=>!s.headlineOnly&&s.items.length).length,truncatedSources:material.filter(s=>s.truncated).length,emptySources:material.filter(s=>!s.items.length).length},
  note:'Ekstraksi otomatis dari sumber tersimpan, tanpa permintaan AI. Data/fakta adalah klaim yang dilaporkan sumber, bukan verifikasi otomatis. Opini dan atribusi dipilah dengan pola bahasa; periksa sumber asli. Maksimal 18 kalimat per sumber dan 6 butir per kategori ditampilkan.'};
 Object.assign(report,enrichResearch(issue,references,Object.values(buckets).flat()));
 const cite=item=>item.text+' ['+item.sourceNumbers.join(', ')+']';
 report.text=[issue.title,'RANGKUMAN TANPA AI',`${report.quality.excerptSources} sumber dengan cuplikan · ${report.quality.headlineOnlySources} sumber judul saja · ${report.quality.truncatedSources} cuplikan terpotong`,...report.summary.map(cite),...Object.entries(shown).flatMap(([kind,items])=>[{'data':'DATA & ANGKA','facts':'KLAIM FAKTUAL','opinions':'OPINI / DUGAAN'}[kind],...(items.length?items.map(cite):['Belum ada bahan yang dapat diekstrak.'])]),...conflicts.flatMap(c=>['ANGKA PERLU DIBANDINGKAN',cite(c.left),cite(c.right),c.note]),'KRONOLOGI PUBLIKASI',report.chronologyNote,...report.chronology.map(c=>c.at+' — '+cite(c)),'NAMA DI SUMBER',...report.actors.map(c=>c.name+' — '+cite(c)),'ANGKA PENTING',...report.importantNumbers.map(c=>c.value+' — '+cite(c)),...report.differences.flatMap(c=>['PERNYATAAN BERBEDA',cite(c.left),cite(c.right),c.note]),'KEBUTUHAN RISET',...report.researchGaps,'BATASAN',report.note,...limitations,'SUMBER',...references.map(s=>'['+s.number+'] '+s.publisher+' — '+s.title+'\n'+s.url)].join('\n\n');
 return report;
}
export function buildIssueReport(issue){
 const key=crypto.createHash('sha256').update(JSON.stringify({version:ENGINE_VERSION,id:issue.id,title:issue.title,eventDate:issue.eventDate,sources:issue.sources,groupingReview:!!issue.groupingReview})).digest('hex');
 if(cache.has(key))return structuredClone(cache.get(key));
 const report=collect(issue);cache.set(key,report);if(cache.size>200)cache.delete(cache.keys().next().value);return structuredClone(report);
}
