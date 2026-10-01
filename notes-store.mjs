import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
const fail=(message,status=400)=>Object.assign(new Error(message),{status});
function normalize(input,base={title:'Catatan baru',body:'',kind:'note',tags:[],pinned:false,archived:false}){
  if(!input||typeof input!=='object'||Array.isArray(input))throw fail('Data catatan tidak valid');
  const out={...base};
  for(const [key,max] of [['title',200],['body',160000]])if(key in input){if(typeof input[key]!=='string'||input[key].length>max)throw fail(`${key} melebihi batas atau tidak valid`);out[key]=input[key];}
  out.title=out.title.trim();if(!out.title)throw fail('Judul catatan wajib diisi');
  if('kind' in input){if(!['note','prompt'].includes(input.kind))throw fail('Jenis catatan tidak valid');out.kind=input.kind;}
  for(const key of ['pinned','archived'])if(key in input){if(typeof input[key]!=='boolean')throw fail('Status catatan tidak valid');out[key]=input[key];}
  if('tags' in input){if(!Array.isArray(input.tags)||input.tags.length>12||input.tags.some(t=>typeof t!=='string'||t.length>40))throw fail('Maksimal 12 tag, masing-masing 40 karakter');out.tags=[...new Set(input.tags.map(t=>t.trim()).filter(Boolean))];}
  return out;
}
export class NotesStore{
  constructor(file){this.file=file;this.loaded=null;this.chain=Promise.resolve();}
  async load(){
    if(!this.loaded)this.loaded=(async()=>{try{const db=JSON.parse(await fs.readFile(this.file,'utf8'));if(db.version!==1||!Array.isArray(db.notes))throw Error('Struktur tidak valid');return db;}catch(e){if(e.code==='ENOENT')return {version:1,notes:[]};throw fail('Catatan gagal dibaca. File asli dipertahankan.',503)}})();
    try{return await this.loaded}catch(e){this.loaded=null;throw e}
  }
  async read(){return structuredClone(await this.load())}
  mutate(fn){const work=this.chain.catch(()=>{}).then(async()=>{const db=structuredClone(await this.load()),result=await fn(db);await fs.mkdir(path.dirname(this.file),{recursive:true});await fs.writeFile(this.file+'.tmp',JSON.stringify(db),{mode:0o600});await fs.rename(this.file+'.tmp',this.file);this.loaded=Promise.resolve(db);return structuredClone(result)});this.chain=work;return work;}
  create(body){return this.mutate(db=>{const now=new Date().toISOString(),note={...normalize(body),id:crypto.randomUUID(),revision:1,createdAt:now,updatedAt:now};db.notes.unshift(note);return note})}
  update(id,body){return this.mutate(db=>{const old=db.notes.find(n=>n.id===id);if(!old)throw fail('Catatan tidak ditemukan',404);if(!Number.isInteger(body?.revision)||body.revision!==old.revision)throw fail('Catatan berubah di tab lain. Muat versi server atau simpan salinan.',409);const next=normalize(body,old);if(['title','body','kind','tags','pinned','archived'].every(k=>JSON.stringify(next[k])===JSON.stringify(old[k])))return old;const note={...next,revision:old.revision+1,updatedAt:new Date().toISOString()};db.notes[db.notes.indexOf(old)]=note;return note})}
  remove(id,revision){return this.mutate(db=>{const old=db.notes.find(n=>n.id===id);if(!old)throw fail('Catatan tidak ditemukan',404);if(revision!==old.revision)throw fail('Catatan berubah. Muat versi terbaru.',409);db.notes=db.notes.filter(n=>n.id!==id);return {ok:true}})}
}
