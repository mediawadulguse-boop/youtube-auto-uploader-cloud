import {headline,publisherKey,profileConflicts} from './radar-methodology.mjs';
import {plainSource,materialText,sentences,classifyClaimText} from './radar-engine.mjs';

// Research support from stored material. Coverage means a text mentions a dimension,
// never that an explanation, causal relationship or claim has been established.
export const RESEARCH_PLAN_VERSION=1;
const normalize=value=>plainSource(value).normalize('NFKC').toLocaleLowerCase('id-ID').replace(/[^\p{L}\p{N}%]+/gu,' ').trim().replace(/\s+/g,' ');
const hasPhrase=(text,phrase)=>{const term=normalize(phrase);return !!term&&(' '+text+' ').includes(' '+term+' ');};
export function matchesResearchTopic(source,topic){
 const text=normalize(source.title+' '+materialText(source));
 return topic.enabled!==false&&(topic.keywords||[]).some(k=>hasPhrase(text,k))&&!(topic.exclusions||[]).some(k=>hasPhrase(text,k));
}
const GENERIC=new Set('perusahaan pemerintah kabupaten kota warga masyarakat program layanan tahun baru data berita publik terbaru x'.split(' '));
const dimensions=[
 {id:'event',label:'Peristiwa & data',question:'Apa yang berubah, berapa besarnya, dan kapan peristiwa ini terjadi?',seek:'Dokumen atau pernyataan asal, angka dan tanggal peristiwa.'},
 {id:'mechanism',label:'Aturan & mekanisme',pattern:/\b(aturan|kebijakan|regulasi|peraturan|pasal|anggaran|subsidi|pajak|insentif|kontrak|skema|mekanisme|keputusan|alokasi|tarif|upah|biaya)\b/i,question:'Aturan atau keputusan apa yang bekerja, dan siapa menanggung biaya atau menerima manfaat?',seek:'Peraturan, dokumen anggaran, kontrak atau penjelasan pelaksana.'},
 {id:'impact',label:'Dampak manusia',pattern:/\b(pekerja|warga|keluarga|masyarakat|mahasiswa|siswa|konsumen|pelanggan|pasien|petani|pedagang)\b[\s\S]*\b(biaya|upah|penghasilan|pendapatan|beban|kehilangan|menanggung|menghadapi|terdampak|kesulitan|akses|menerima|membayar)\b|\b(biaya|upah|penghasilan|beban|dampak|akses)\b[\s\S]*\b(pekerja|warga|keluarga|masyarakat|mahasiswa|siswa|konsumen|pelanggan|pasien|petani|pedagang)\b/i,question:'Siapa terdampak, dan apa data atau pengalaman yang menunjukkan dampaknya?',seek:'Data kelompok terdampak, laporan lapangan atau wawancara dengan konteks.'},
 {id:'comparison',label:'Pembanding waktu / kelompok',pattern:/\b(dibanding(?:kan)?|perbandingan|sebelumnya|tahun lalu|periode lalu|dari\s+\d[\s\S]*\b(?:menjadi|ke)\b)\b/i,question:'Bagaimana kondisi sebelum dan sesudahnya, dengan periode dan satuan yang sebanding?',seek:'Angka periode sebelumnya atau kelompok pembanding dengan definisi sama.'},
 {id:'response',label:'Tanggapan / perspektif lain',pattern:/\b(membantah|bantahan|menyangkal|mengklarifikasi|klarifikasi|menanggapi|tanggapan|merespons|sanggahan|berbeda pendapat|namun menurut)\b/i,question:'Apa tanggapan pihak terkait, dan adakah penjelasan alternatif yang perlu diuji?',seek:'Pernyataan pihak terkait, klarifikasi atau analisis pembanding.'}
];

export function buildResearchPlan(issue,report,quality){
 const titleProfile=headline(issue.title),anchors=[...titleProfile.tokens].filter(t=>t.length>1&&!GENERIC.has(t)&&!/^\d+$/.test(t)),byUrl=new Map(report.sources.map(s=>[s.url,s])),ledger=new Map();
 for(const source of quality.representatives){
  const reference=byUrl.get(source.url);if(!reference)continue;
  const material=sentences(source),full=!!(source.article?.text?.trim()||source.transcript?.text?.trim());
  for(const text of material.items){
   const profile=headline(text),shared=anchors.filter(t=>profile.tokens.has(t));
   // Geography/identity mismatches cannot supply evidence for this issue. Different
   // quantities and actions remain available for the explicit discrepancy checks.
   const relevant=anchors.length>0&&(shared.length>=2||shared.length/anchors.length>=.25)&&!profileConflicts(titleProfile,profile,true).length;
   if(!relevant)continue;
   const classification=classifyClaimText(text),key=normalize(text),support={number:reference.number,id:source.id,url:source.url,publisher:source.publisher,full,verified:source.verification==='verified',role:source.sourceRole||'unknown',repost:!!source.repost};
   let claim=ledger.get(key);
   if(!claim){claim={text,...classification,headlineOnly:material.headlineOnly,anchorMatches:shared.length,supports:[]};ledger.set(key,claim);}
   claim.headlineOnly&&=material.headlineOnly;claim.supports.push(support);
  }
 }
 const claims=[...ledger.values()].map(c=>{
  const full=c.supports.filter(s=>s.full&&!s.repost&&s.role!=='commentary'),reviewed=full.filter(s=>s.verified),primary=full.filter(s=>s.role==='primary'),substantive=c.numbers.filter(n=>!/^\d{1,2}$|^(?:19|20)\d{2}$/.test(n.trim())).length;
  return {...c,sourceNumbers:c.supports.map(s=>s.number),references:c.supports.map(s=>byUrl.get(s.url)),fullSources:full.length,verifiedFullSources:reviewed.length,primaryFullSources:primary.length,publishers:new Set(c.supports.map(publisherKey)).size,score:c.anchorMatches*3+Math.min(6,substantive*3)+(reviewed.length?9:full.length?4:0)+(primary.length?3:0)};
 }).toSorted((a,b)=>b.score-a.score||a.sourceNumbers[0]-b.sourceNumbers[0]||a.text.localeCompare(b.text));
 const factual=claims.filter(c=>!c.headlineOnly&&c.kind!=='opinions'&&c.supports.some(s=>s.role!=='commentary')),lead=factual[0]||null;
 const coverage=dimensions.map(d=>{
  const found=(d.id==='response'?claims.filter(c=>!c.headlineOnly):factual).filter(c=>d.id==='event'?c===lead:d.pattern.test(c.text)).slice(0,2);
  return {id:d.id,label:d.label,state:found.length?'mentioned':'missing',question:d.question,seek:d.seek,claims:found.map(c=>({text:c.text,kind:c.kind,sourceNumbers:c.sourceNumbers,references:c.references,verifiedFullSources:c.verifiedFullSources}))};
 });
 const missing=coverage.filter(d=>d.state==='missing'),gaps=[];
 if(!lead)gaps.push('Belum ada klaim faktual relevan dari isi bahan; judul dan opini tidak cukup menjadi titik awal.');
 else{
  if(!lead.fullSources)gaps.push('Lengkapi artikel atau transkrip yang memuat klaim utama; bahan lengkap lain tidak menggantikannya.');
  if(!lead.verifiedFullSources)gaps.push('Periksa konteks klaim utama pada bahan lengkap dan tandai verifikasinya.');
  if(!lead.primaryFullSources)gaps.push('Cari sumber primer yang memuat klaim utama.');
 }
 const focus=lead?.text||issue.title;
 const angles=[
  {id:'system',label:'Sistem & insentif',dimensions:['mechanism','impact'],question:`Dalam isu “${issue.title}”, aturan apa yang membagi biaya dan manfaat, dan apa bukti pembagiannya?`},
  {id:'history',label:'Sejarah & perubahan',dimensions:['comparison','event'],question:`Apa yang berubah dalam “${issue.title}” dibanding periode sebelumnya, dan bagaimana kronologinya?`},
  {id:'human',label:'Manusia & konsekuensi',dimensions:['impact','response'],question:`Siapa yang terdampak oleh “${issue.title}”, dan bagaimana pengalaman mereka dibanding penjelasan pihak terkait?`}
 ].map(a=>({...a,basis:focus,references:lead?.references||[],gaps:coverage.filter(d=>a.dimensions.includes(d.id)&&d.state==='missing').map(d=>d.label),status:lead&&a.dimensions.every(id=>coverage.find(d=>d.id===id).state==='mentioned')?'Bahan awal tersedia':'Perlu bahan tambahan'}));
 const queries=missing.map(d=>({dimension:d.id,label:d.label,query:`${issue.title} ${({event:'sumber asli tanggal',mechanism:'aturan dokumen keputusan',impact:'data dampak warga pekerja',comparison:'data sebelum sesudah',response:'klarifikasi tanggapan'})[d.id]}`,question:d.question,seek:d.seek}));
 return {version:RESEARCH_PLAN_VERSION,usesAI:false,lead,coverage,coveragePercent:Math.round((coverage.length-missing.length)/coverage.length*100),angles,queries,gaps,note:'Peta menunjukkan dimensi yang disebut bahan relevan, bukan kelengkapan fakta atau bukti sebab-akibat. Angle dan kueri adalah pertanyaan riset; engine belum menjalankan pencarian.'};
}
