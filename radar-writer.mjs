import crypto from 'node:crypto';
import {fail} from './radar-store.mjs';
import {buildIssueReport,sentences,plainSource} from './radar-engine.mjs';

export const WRITER_VERSION=1;
const cache=new Map();
const key=text=>text.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
const words=text=>text.trim().split(/\s+/).filter(Boolean).length;
const opinion=/\b(menilai|berpendapat|seharusnya|diduga|diperkirakan|mungkin|berpotensi|diharapkan|prediksi|memperkirakan|terbaik|terburuk)\b|[?!]/i;
const themes={system:/\b(aturan|kebijakan|pemerintah|subsidi|pajak|anggaran|insentif|perusahaan|regulasi|kementerian|sistem)\b/i,human:/\b(warga|pekerja|keluarga|masyarakat|siswa|anak|penduduk|rumah tangga|biaya|penghasilan|kehidupan)\b/i};
function candidates(issue,report){
 const items=[],seen=new Map();
 const topicWords=new Set(key(issue.title).split(' ').filter(w=>w.length>3));
 for(const ref of report.sources){const source=issue.sources.find(s=>s.id===ref.id),material=sentences(source,300);if(material.headlineOnly)continue;
  for(const [index,text] of material.items.entries()){
   const normalized=key(text);if(seen.has(normalized)){const previous=seen.get(normalized);if(!previous.refs.includes(ref.number))previous.refs.push(ref.number);continue;}
   const item={text,refs:[ref.number],publisher:plainSource(source.publisher||'sumber tersimpan').replace(/\s+/g,' '),index,kind:opinion.test(text)?'opinion':/\d/.test(text)?'data':'fact',full:!!(source.transcript||source.article)};
   item.theme=themes.human.test(text)?'human':themes.system.test(text)?'system':'data';item.relevance=normalized.split(' ').filter(w=>topicWords.has(w)).length;items.push(item);seen.set(normalized,item);
  }
 }
 // Prioritize complete materials, then distribute evidence over sources and material positions.
 return items.sort((a,b)=>Number(b.full)-Number(a.full)||b.relevance-a.relevance||a.index-b.index||a.refs[0]-b.refs[0]);
}
export function writeEngineScript(issue,body={}){
 if(!body||typeof body!=='object'||Array.isArray(body))throw fail('Aturan engine tidak valid.');
 const format=body.format||'long',minutes=body.minutes??(format==='long'?5:1),style=body.style||'conversational',rules=body.rules||'';
 if(!['long','shorts','threeShorts'].includes(format)||!Number.isFinite(minutes)||minutes<0.5||minutes>(format==='long'?20:3)||!['conversational','report','reflective'].includes(style)||typeof rules!=='string')throw fail('Pilih format, durasi, gaya dan catatan yang valid.');
 if(body.revision!==undefined&&body.revision!==issue.revision)throw fail('Bahan berubah. Muat riset terbaru.',409);
 const hash=crypto.createHash('sha256').update(JSON.stringify({version:WRITER_VERSION,issue,format,minutes,style,rules})).digest('hex');
 if(cache.has(hash))return {...structuredClone(cache.get(hash)),cached:true};
 const report=buildIssueReport(issue),items=candidates(issue,report);
 if(!items.length)throw fail('Belum cukup bahan untuk naskah. Ambil artikel/transkrip atau impor teks; judul saja tidak dipakai sebagai bukti.',422);
 const variants=format==='threeShorts'?[['data','Data dan konteks'],['system','Aturan dan sistem'],['human','Dampak manusia']]:[[null,'Bukti → konteks → refleksi']];
 const drafts=variants.map(([theme,angle],variant)=>{
  const budget=Math.floor(minutes*140),title=plainSource(issue.title).replace(/\s+/g,' '),hook=style==='report'?'Mari kita lihat informasi yang tersedia tentang '+title+'.':style==='reflective'?'Apa yang sudah kita ketahui tentang '+title+'?':'Sebenarnya, apa yang sudah jelas tentang '+title+'?';
  const close='Sebelum menarik kesimpulan, periksa kembali konteks dan sumbernya.',comparison=report.conflicts.length||report.differences.length?'Ada perbedaan informasi di antara sumber yang tersedia. Perbedaannya perlu diperiksa; draft ini tidak menetapkan sumber mana yang benar.':'',selected=[],usedRefs=new Set();let count=words(hook)+words(close)+words(comparison),used=new Set();
  const ordered=theme?[...items.filter(x=>x.theme===theme),...items.filter(x=>x.theme!==theme)]:['data','system','human'].flatMap(t=>items.filter(x=>x.theme===t));
  const render=(item,n)=>{
   const lead=item.kind==='opinion'?['Untuk pandangan yang dilaporkan, menurut','Sementara itu, ada penilaian dari','Berikut pandangan yang masih perlu dibedakan dari fakta, menurut'][(n+variant)%3]:['Dalam laporan','Informasi berikut juga berasal dari','Sebagai konteks tambahan, menurut'][(n+variant)%3];
   return lead+' '+item.publisher+': '+item.text+' ['+item.refs.join('][')+']';
  };
  for(const candidate of ordered){if(used.has(key(candidate.text)))continue;const refs=[...candidate.refs.filter(n=>usedRefs.has(n)),...candidate.refs.filter(n=>!usedRefs.has(n)).slice(0,30-usedRefs.size)].sort((a,b)=>a-b);if(!refs.length)continue;const item={...candidate,refs},paragraph=render(item,selected.length);if(count+words(paragraph)>budget)continue;selected.push({item,paragraph});used.add(key(item.text));refs.forEach(n=>usedRefs.add(n));count+=words(paragraph);if(format!=='long'&&selected.length>=5)break;}
  if(!selected.length)throw fail('Kalimat sumber terlalu panjang untuk durasi tersebut. Tambahkan durasi atau bahan yang lebih ringkas.',422);
  const blocks=[];let previous='';for(const s of selected){if(format==='long'&&s.item.theme!==previous){blocks.push({data:'BUKTI DAN KONTEKS',system:'ATURAN DAN SISTEM',human:'DAMPAK YANG DILAPORKAN'}[s.item.theme]);previous=s.item.theme;}blocks.push(s.paragraph);}
  const warnings=[...report.researchGaps,...report.conflicts.map(c=>c.note),...report.differences.map(c=>c.note)];
  if(count<budget*0.7)warnings.unshift('Bahan tidak cukup untuk durasi target. Engine tidak mengulang atau menambah fakta demi panjang naskah.');
  if(theme&&!items.some(x=>x.theme===theme))warnings.unshift('Belum ada bukti khusus untuk angle '+angle+'; draft memakai konteks yang tersedia.');
  const brief=['Angle: '+angle,'Target '+minutes+' menit; estimasi bahan '+(count/140).toFixed(1)+' menit.','Catatan editor (tidak otomatis menjadi fakta): '+(rules||issue.research?.notes||'—')].join('\n');
  const refs=report.sources.filter(s=>usedRefs.has(s.number)).map(s=>'['+s.number+'] '+s.publisher+' — '+s.title+'\n'+s.url).join('\n');
  return {title:(title+(format==='threeShorts'?' · '+angle:'')),format:format==='long'?'long':'shorts',angle,brief,sourceOrder:report.sources.map(s=>s.id),script:['HOOK',hook,...(comparison?[comparison]:[]),...blocks,'PENUTUP',close,'RUJUKAN',refs].join('\n\n'),productionNotes:['CEK SEBELUM PRODUKSI',...new Set(warnings),'Aturan editor: '+(rules||'—'),'Catatan riset: '+(issue.research?.notes||'—'),'Penulis engine bersifat ekstraktif: mempertahankan kalimat sumber, bukan verifikasi otomatis atau parafrasa bebas.'].join('\n\n'),wordCount:count,estimatedMinutes:Number((count/140).toFixed(1)),evidenceCount:selected.length,warnings:[...new Set(warnings)]};
 });
 const result={usesAI:false,engine:'layered-extractive-writer',version:WRITER_VERSION,issueId:issue.id,revision:issue.revision,cached:false,note:'Draft bersumber tanpa kuota AI. Algoritma memilih bahan, memilah opini, menggabungkan pengulangan, mengatur alur dan memeriksa durasi. Catatan bebas disimpan untuk editor/AI, bukan ditebak sebagai fakta.',drafts};
 cache.set(hash,result);if(cache.size>100)cache.delete(cache.keys().next().value);return structuredClone(result);
}
