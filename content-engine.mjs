import {plainSource,sentenceParts} from './radar-engine.mjs';
import {writeEngineScript} from './radar-writer.mjs';

export const CONTENT_ENGINE_VERSION=1;
const stop=new Set('yang dan untuk dari dalam dengan pada ini itu atau adalah akan sudah sebagai tentang menjadi oleh ada ke di sebuah kita bisa lebih juga belum tidak apa mengapa bagaimana sumber rujukan menurut informasi laporan konteks hook penutup'.split(' '));
const headings=/^(?:HOOK|PENUTUP|RUJUKAN|SUMBER|BUKTI DAN KONTEKS|ATURAN DAN SISTEM|DAMPAK YANG DILAPORKAN|\[?\d{1,2}:\d{2}[^\]]*\]?)$/i;
function prose(script){
 const lines=plainSource(script).split('\n'),end=lines.findIndex(l=>/^(RUJUKAN|SUMBER)$/i.test(l));
 return (end<0?lines:lines.slice(0,end)).filter(l=>!headings.test(l)&&!/^https?:\/\//i.test(l)).flatMap(sentenceParts).filter(s=>s.length>=15);
}
export function fillContentWithEngine(content){
 const fields={},warnings=[];
 const sources=(content.sources||[]).map((s,i)=>({id:s.id||String(i),title:s.label||content.title,publisher:s.label||'Sumber tersimpan',url:s.url||'',excerpt:s.notes||'',verification:s.verified?'verified':'unchecked',coverage:'snippet',publishedAt:null}));
 let script=content.script||'';
 if(!script.trim()&&sources.some(s=>s.excerpt.trim())){
  try{const draft=writeEngineScript({id:content.id||'draft',revision:content.revision||1,title:content.title,sources,research:{notes:content.brief||''}},{format:content.format==='shorts'?'shorts':'long'}).drafts[0];script=draft.script;fields.script=script;if(!content.productionNotes?.trim())fields.productionNotes=draft.productionNotes;warnings.push(...draft.warnings);}
  catch(error){if(error.status!==422)throw error;warnings.push(error.message);}
 }
 const paragraphs=prose(script),summary=paragraphs.filter(p=>!/^(Sebenarnya, apa|Mari kita lihat|Apa yang sudah kita|Sebelum menarik kesimpulan)/i.test(p)).slice(0,4);
 if(summary.length){
  if(!content.brief?.trim())fields.brief=['Topik: '+content.title,'Bahan utama dari naskah tersimpan:',...summary].join('\n\n');
  if(!content.hook?.trim()&&paragraphs[0])fields.hook=paragraphs[0];
  if(!content.cta?.trim())fields.cta='Baca sumber yang dicantumkan dan sampaikan pandangan Anda setelah memeriksa konteksnya.';
  if(!content.description?.trim())fields.description=[content.title,...summary,'Pembahasan disusun dari bahan yang tersedia; periksa sumber asli untuk konteks lengkap.',...(sources.some(s=>s.url)?['Sumber bahan:',...sources.filter(s=>s.url).map(s=>s.publisher+'\n'+s.url)]:[]),content.cta||fields.cta].filter(Boolean).join('\n\n');
  if(!content.productionNotes?.trim()&&!fields.productionNotes)fields.productionNotes=['Rencana berdasarkan naskah:',...summary.map((s,i)=>'Bagian '+(i+1)+': '+s),'Gunakan kutipan/data dan visual dari sumber yang tercantum. Periksa izin aset dan kecocokan angka sebelum produksi.','Thumbnail: gunakan topik “'+content.title+'”.','Video final, thumbnail, dan review tetap perlu dikonfirmasi oleh editor.'].join('\n\n');
 }else warnings.push('Belum ada isi naskah atau bahan sumber yang cukup; engine tidak membuat klaim dari judul saja.');
 if(!content.tags?.trim()&&summary.length){
  const counts=new Map();for(const word of plainSource(content.title+' '+summary.join(' ')).match(/[\p{L}][\p{L}\p{N}-]*/gu)||[]){const key=word.toLocaleLowerCase('id-ID');if(key.length<4||stop.has(key))continue;const row=counts.get(key)||{word,count:0};row.count++;counts.set(key,row);}
  fields.tags=[...counts.values()].sort((a,b)=>b.count-a.count).slice(0,12).map(r=>r.word).join(', ');
 }
 if(!content.audience?.trim())warnings.push('Target audiens perlu ditentukan editor.');
 warnings.push('Penanggung jawab, pilar, tanggal, aset, dan checklist tidak ditebak oleh engine.');
 return {usesAI:false,version:CONTENT_ENGINE_VERSION,fields,warnings:[...new Set(warnings)]};
}
