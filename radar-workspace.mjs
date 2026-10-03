import {fail} from './radar-store.mjs';
import {buildIssueReport} from './radar-engine.mjs';
export function transcriptText(text,format='txt'){
 if(typeof text!=='string'||!text.trim()||text.length>50000)throw fail('Impor teks maksimal 50.000 karakter.');
 if(!['txt','srt','vtt'].includes(format))throw fail('Gunakan TXT, SRT atau VTT.');
 if(format==='txt')return text.trim();
 let metadata=false;
 const lines=text.replace(/\r/g,'').split('\n').filter(line=>{
  const value=line.trim();if(!value){metadata=false;return false;}
  if(/^(?:NOTE|STYLE|REGION)(?:\s|$)/.test(value)){metadata=true;return false;}
  return !metadata&&!/^WEBVTT|^\d+$|-->|^Kind:|^Language:/.test(value);
 }).map(line=>line.replace(/<[^>]*>/g,'').trim());
 const value=lines.join(' ').replace(/\s+/g,' ').trim();if(!value)throw fail('Transkrip tidak memiliki teks.');return value;
}
export class RadarWorkspace{
 constructor(store){this.store=store;}
 async get(id){const issue=(await this.store.read()).issues.find(i=>i.id===id);if(!issue)throw fail('Isu tidak ditemukan.',404);return {issue,workspace:issue.research||{notes:'',checklist:[]},report:buildIssueReport(issue)};}
 save(id,body){if(!body||typeof body!=='object'||Array.isArray(body))throw fail('Data riset tidak valid.');return this.store.mutate(r=>{const issue=r.issues.find(i=>i.id===id);if(!issue)throw fail('Isu tidak ditemukan.',404);if(body.revision!==issue.revision)throw fail('Isu berubah. Muat riset terbaru.',409);
  if(typeof body.notes!=='string'||body.notes.length>20000||!Array.isArray(body.checklist)||body.checklist.length>60||body.checklist.some(c=>!c||typeof c.label!=='string'||!c.label.trim()||c.label.length>500||typeof c.done!=='boolean'))throw fail('Catatan/checklist riset tidak valid.');
  issue.research={notes:body.notes.trim(),checklist:body.checklist.map(c=>({label:c.label.trim(),done:c.done}))};issue.groupingLocked=true;issue.revision++;return issue;
 });}
 import(id,body){if(!body||typeof body!=='object'||Array.isArray(body))throw fail('Data impor tidak valid.');return this.store.mutate(r=>{const issue=r.issues.find(i=>i.id===id);if(!issue)throw fail('Isu tidak ditemukan.',404);if(body.revision!==issue.revision)throw fail('Isu berubah. Muat riset terbaru.',409);const source=issue.sources.find(s=>s.id===body.sourceId);if(!source)throw fail('Pilih sumber asal transkrip.',404);
  if(body.replace!==undefined&&typeof body.replace!=='boolean')throw fail('Pilihan ganti teks tidak valid.');const text=transcriptText(body.text,body.format);if(r.issues.flatMap(i=>i.sources).filter(s=>s.id!==source.id).reduce((n,s)=>n+Buffer.byteLength(s.transcript?.text||''),Buffer.byteLength(text))>10*1024*1024)throw fail('Kapasitas teks impor 10 MB tercapai. Ringkas teks impor sebelumnya.');if(source.transcript&&!body.replace)throw fail('Sumber sudah memiliki teks impor. Pilih ganti secara eksplisit.',409);
  source.transcript={text,format:body.format||'txt',importedAt:new Date(this.store.now()).toISOString()};source.verification='unchecked';issue.groupingLocked=true;issue.revision++;return issue;
 });}
 async outline(id,format='long'){
  if(!['long','shorts','threeShorts'].includes(format))throw fail('Format kerangka tidak valid.');
  const {issue,workspace,report}=await this.get(id),cite=c=>c.text+' ['+c.sourceNumbers.join(', ')+']';
  const evidence=report.summary.map(cite).join('\n')||'[Tambahkan klaim bersumber setelah riset.]';
  const references=report.sources.map(s=>'['+s.number+'] '+s.publisher+' — '+s.title+'\n'+s.url).join('\n');
  const brief=['Tujuan: jelaskan '+issue.title,'Bukti tersedia:\n'+evidence,'Catatan editor:\n'+workspace.notes,'Perlu diteliti:\n'+[...report.researchGaps,...workspace.checklist.filter(c=>!c.done).map(c=>c.label)].join('\n')].join('\n\n').slice(0,4000);
  const angles=['Sejarah dan data','Aturan, insentif dan sistem','Dampak pada kehidupan manusia'];
  const make=(angle,n)=>({title:(issue.title+(format==='threeShorts'?' · '+angle:'')).slice(0,200),format:format==='long'?'long':'shorts',angle,brief,sourceOrder:report.sources.map(s=>s.id),script:[format==='long'?'KERANGKA LONG':'KERANGKA SHORT '+(n+1),'HOOK\n[Pertanyaan pembuka tentang '+issue.title+'; jangan menambah klaim.]','BUKTI DARI SUMBER\n'+evidence,format==='long'?'SEJARAH & KRONOLOGI\n[Susun urutan peristiwa setelah tanggal diverifikasi.]':'ANGLE\n['+angle+': pilih satu klaim dan jelaskan konteksnya.]',format==='long'?'STRUKTUR SISTEM\n[Teliti aturan, insentif dan pihak yang berperan.]':'KONTEKS\n[Isi penjelasan singkat berdasarkan sumber.]','DAMPAK MANUSIA\n[Tambahkan pengalaman atau data dampak yang dapat diperiksa.]','REFLEKSI\n[Tutup dengan pertanyaan; hindari kesimpulan yang belum terbukti.]','CEK SEBELUM PRODUKSI\n'+report.researchGaps.join('\n'),'RUJUKAN\n'+references].join('\n\n')});
  return {usesAI:false,engine:'editorial-template',issueId:id,revision:issue.revision,note:'Kerangka untuk disunting, bukan naskah faktual final. Tidak memakai AI.',drafts:format==='threeShorts'?angles.map(make):[make(format==='long'?'Sejarah → sistem → manusia':angles[0],0)]};
 }
}
