import crypto from 'node:crypto';
import {publisherKey,headline} from './radar-methodology.mjs';

export const ENGINE_VERSION=1;
const cache=new Map();
const normalize=s=>String(s).normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase().replace(/[^\p{L}\p{N}%]+/gu,' ').trim();
const numberPattern=/(?<![\p{L}\p{N}])(?:Rp\s*)?\d+(?:[.,]\d+)*(?:\s*(?:%|persen|ribu|juta|miliar|triliun|orang|pekerja|sekolah|desa|hari|tahun))?/giu;
const numbers=text=>[...text.matchAll(numberPattern)].map(m=>m[0].toLowerCase());
const opinion=/\b(menurut|menilai|berpendapat|berpandangan|seharusnya|semestinya|diduga|dugaan|diperkirakan|prediksi|mungkin|berpotensi|diharapkan|harapannya|mengkhawatirkan|terbaik|terburuk|mengklaim|klaim)\b|[?!]/i;
const attributed=/\b(mengatakan|menyebut|mengklaim|klaim|ujar|kata|tutur|ungkap|mengungkapkan|menegaskan|menyatakan)\b|[“”"«»]/i;
const boiler=/subscribe|like dan share|follow|baca juga|selengkapnya|hak cipta|copyright|klik link|jangan lupa|tonton video|https?:\/\/|www\./i;
const words=text=>headline(text).tokens;
function sentences(source){
 const excerpt=String(source.excerpt||'').replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim();
 const text=excerpt||String(source.title||'');
 return [...new Set(text.split(/(?<=[.!?])\s+(?=[\p{Lu}\d“"'])/u).map(x=>x.trim()).filter(x=>x.length>=15&&x.length<=1200&&!boiler.test(x)))].slice(0,18);
}
function evidence(source,number){return {number,id:source.id,url:source.url,title:source.title,publisher:source.publisher,publisherUrl:source.publisherUrl||'',platform:source.platform,publishedAt:source.publishedAt||null,coverage:source.coverage||'headline',verification:source.verification||'unchecked',repost:!!source.repost};}
function collect(issue){
 const sources=[...new Map((issue.sources||[]).map(s=>[s.url,s])).values()].sort((a,b)=>String(a.url).localeCompare(String(b.url)));
 const references=sources.map((s,n)=>evidence(s,n+1)),buckets={data:[],facts:[],opinions:[]},exact=new Map();
 for(const [index,source] of sources.entries())for(const text of sentences(source)){
  // Predictions remain opinions; reported numbers retain attribution and source references.
  const values=numbers(text),kind=opinion.test(text)?'opinions':values.length?'data':'facts';
  // Deduplicate literal claims only: fuzzy similarity can erase names or temporal qualifiers.
  const exactKey=kind+JSON.stringify(values)+normalize(text),existing=exact.get(exactKey);
  if(existing){if(!existing.sourceNumbers.includes(index+1))existing.sourceNumbers.push(index+1);existing.headlineOnly&&=!source.excerpt;existing.attributed||=attributed.test(text);continue;}
  const entry={text,sourceNumbers:[index+1],attributed:attributed.test(text),headlineOnly:!source.excerpt,numbers:values};
  buckets[kind].push(entry);exact.set(exactKey,entry);
 }
 for(const items of Object.values(buckets))for(const item of items){
  const support=item.sourceNumbers.map(n=>sources[n-1]);
  item.publishers=new Set(support.filter(s=>!s.repost).map(publisherKey).filter(Boolean)).size;
  item.sourceVerified=support.some(s=>s.verification==='verified');
  item.status=item.headlineOnly?'headline_only':item.attributed?'attributed_claim':'source_statement';
 }
 for(const items of Object.values(buckets))items.sort((a,b)=>b.publishers-a.publishers||Number(a.headlineOnly)-Number(b.headlineOnly)||a.sourceNumbers[0]-b.sourceNumbers[0]);
 const conflicts=[],numeric=buckets.data.slice(0,60).map(item=>({...item,skeleton:headline(item.text.replace(numberPattern,' angka '))}));
 for(let a=0;a<numeric.length;a++)for(let b=a+1;b<numeric.length;b++){
  const left=numeric[a],right=numeric[b];if(JSON.stringify(left.numbers)===JSON.stringify(right.numbers))continue;
  const shared=[...left.skeleton.tokens].filter(t=>right.skeleton.tokens.has(t)).length;
  if(left.skeleton.tokens.size>=4&&left.skeleton.negative===right.skeleton.negative&&2*shared/(left.skeleton.tokens.size+right.skeleton.tokens.size)>=.9&&conflicts.length<4){const {skeleton:ls,...l}=left,{skeleton:rs,...r}=right;conflicts.push({left:l,right:r,note:'Angka berbeda dalam kalimat serupa. Periksa periode, satuan dan konteks; engine tidak memilih angka yang benar.'});}
 }
 const lead=[...buckets.data,...buckets.facts].filter(x=>!x.headlineOnly).sort((a,b)=>b.publishers-a.publishers||a.sourceNumbers[0]-b.sourceNumbers[0]).slice(0,3);
 const selected=lead.length?lead:[...buckets.data,...buckets.facts,...buckets.opinions].slice(0,2);
 const limitations=[];
 if(sources.some(s=>!s.excerpt))limitations.push('Sebagian sumber hanya memiliki judul, sehingga konteks klaim belum lengkap.');
 if(sources.some(s=>s.platform==='YouTube'))limitations.push('Video dirangkum dari judul/deskripsi yang tersedia; bukan transkrip atau isi video.');
 if(sources.some(s=>s.coverage==='snippet'))limitations.push('Cuplikan RSS/deskripsi tidak sama dengan artikel lengkap.');
 if(sources.some(s=>s.verification==='compare'))limitations.push('Ada sumber yang ditandai perlu pembanding.');
 if(sources.some(s=>!s.publishedAt))limitations.push('Ada sumber tanpa tanggal publikasi.');
 const shown=Object.fromEntries(Object.entries(buckets).map(([key,items])=>[key,items.slice(0,6)]));
 const report={engine:'extractive-rules',version:ENGINE_VERSION,usesAI:false,issueId:issue.id,title:issue.title,sourceCount:sources.length,
  summary:selected.map(x=>({text:x.text,sourceNumbers:x.sourceNumbers})),...shown,totals:Object.fromEntries(Object.entries(buckets).map(([key,items])=>[key,items.length])),conflicts,sources:references,limitations,
  note:'Ekstraksi otomatis dari sumber tersimpan, tanpa permintaan AI. Data/fakta adalah klaim yang dilaporkan sumber, bukan verifikasi otomatis. Opini dan atribusi dipilah dengan pola bahasa; periksa sumber asli. Maksimal 18 kalimat per sumber dan 6 butir per kategori ditampilkan.'};
 const cite=item=>item.text+' ['+item.sourceNumbers.join(', ')+']';
 report.text=[issue.title,'RANGKUMAN TANPA AI',...report.summary.map(cite),...Object.entries(shown).flatMap(([kind,items])=>[{'data':'DATA & ANGKA','facts':'KLAIM FAKTUAL','opinions':'OPINI / DUGAAN'}[kind],...(items.length?items.map(cite):['Belum ada bahan yang dapat diekstrak.'])]),...conflicts.flatMap(c=>['ANGKA PERLU DIBANDINGKAN',cite(c.left),cite(c.right),c.note]),'BATASAN',report.note,...limitations,'SUMBER',...references.map(s=>'['+s.number+'] '+s.publisher+' — '+s.title+'\n'+s.url)].join('\n\n');
 return report;
}
export function buildIssueReport(issue){
 const key=crypto.createHash('sha256').update(JSON.stringify({version:ENGINE_VERSION,id:issue.id,title:issue.title,sources:issue.sources})).digest('hex');
 if(cache.has(key))return structuredClone(cache.get(key));
 const report=collect(issue);cache.set(key,report);if(cache.size>200)cache.delete(cache.keys().next().value);return structuredClone(report);
}
