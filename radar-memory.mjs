import crypto from 'node:crypto';
import {fail,radarData} from './radar-store.mjs';
export const PROMPT_ACTIONS=['summary','script','polish','digest','shorts','storyboard','analysis'];
export const STARTER_PROMPTS=[{id:'starter-script',name:'Long: sejarah, sistem, manusia',action:'script',prompt:'Susun naskah percakapan dengan hook pertanyaan, bukti sejarah/data, struktur sistem, dampak manusia dan refleksi. Tandai celah riset, pertahankan atribusi serta rujukan.'},{id:'starter-shorts',name:'Tiga Short mandiri',action:'shorts',prompt:'Buat tiga Short yang dapat ditonton terpisah: satu tentang data/sejarah, satu tentang sistem, satu tentang dampak manusia. Masing-masing punya hook, bukti bersumber dan penutup reflektif.'},{id:'starter-digest',name:'Prioritas editorial',action:'digest',prompt:'Utamakan isu dengan bahan cukup, jelaskan perubahan liputan dan daftar sumber primer atau transkrip yang masih perlu diperiksa.'}];
export class RadarMemory{
 constructor(store){this.store=store;}
 async list(){const r=radarData(await this.store.contentStore.read());return {prompts:r.promptLibrary||[],starters:STARTER_PROMPTS};}
 save(body,id){return this.store.mutate(r=>{
  if(!body||typeof body!=='object'||Array.isArray(body)||typeof body.name!=='string'||!body.name.trim()||typeof body.prompt!=='string'||!body.prompt.trim()||!PROMPT_ACTIONS.includes(body.action))throw fail('Nama, aksi dan prompt tidak valid.');
  const prompts=r.promptLibrary||=[],old=id?prompts.find(p=>p.id===id):null;if(id&&!old)throw fail('Prompt tidak ditemukan.',404);if(old&&body.revision!==old.revision)throw fail('Prompt berubah. Muat terbaru.',409);if(!old&&prompts.length>=50)throw fail('Maksimal 50 prompt.');
  const item={id:old?.id||crypto.randomUUID(),name:body.name.trim(),prompt:body.prompt.trim(),action:body.action,revision:(old?.revision||0)+1,updatedAt:new Date(this.store.now()).toISOString(),history:old?[...(old.history||[]),{name:old.name,prompt:old.prompt,action:old.action,revision:old.revision,at:old.updatedAt}].slice(-5):[]};
  if(old)prompts[prompts.indexOf(old)]=item;else prompts.push(item);return item;
 });}
 remove(id,body){if(!body||typeof body!=='object')throw fail('Data prompt tidak valid.');return this.store.mutate(r=>{const p=r.promptLibrary?.find(p=>p.id===id);if(!p)throw fail('Prompt tidak ditemukan.',404);if(body.revision!==p.revision)throw fail('Prompt berubah. Muat terbaru.',409);r.promptLibrary=r.promptLibrary.filter(p=>p.id!==id);return {ok:true};});}
 async usage(){const r=radarData(await this.store.contentStore.read()),history=r.aiHistory||[];return {history,cacheEntries:(r.aiCache||[]).length,summary:{successful:history.filter(h=>h.status==='success').length,reused:history.filter(h=>h.status==='cached').length,failed:history.filter(h=>h.status==='error').length},note:'Riwayat maksimal 300 aktivitas pratinjau aplikasi. Penggunaan ulang tidak memanggil provider atau menambah kuota AI aplikasi. Token dan biaya tagihan belum diukur; cek dashboard provider untuk tagihan.'};}
}
export function rememberActivity(r,event){r.aiHistory=[{id:crypto.randomUUID(),...event},...(r.aiHistory||[])].slice(0,300);}
export function rememberResult(r,key,result,at){
 const cache=[{key,result:structuredClone(result),at},...(r.aiCache||[]).filter(c=>c.key!==key&&at-c.at<30*86400000)].slice(0,40);
 while(cache.length>1&&Buffer.byteLength(JSON.stringify(cache))>4*1024*1024)cache.pop();r.aiCache=cache;
}
