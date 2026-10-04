import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { richField } from './rich-text.mjs';
const fail=(message,status=400)=>Object.assign(new Error(message),{status});
function categoryName(value){if(typeof value!=='string')throw fail('Kategori tidak valid');return value.trim()}
function addCategory(db,value){const name=categoryName(value);if(!name)return '';const existing=db.categories.find(c=>c.toLocaleLowerCase('id-ID')===name.toLocaleLowerCase('id-ID'));if(existing)return existing;if(db.categories.length>=100)throw fail('Maksimal 100 kategori');db.categories.push(name);return name}
function resolveCategory(db,value){const name=categoryName(value);if(!name)return '';const existing=db.categories.find(c=>c.toLocaleLowerCase('id-ID')===name.toLocaleLowerCase('id-ID'));if(!existing)throw fail('Pilih kategori yang tersedia atau buat melalui Tambah kategori');return existing}
function checkCategoryRevision(db,revision){if(!Number.isInteger(revision)||revision!==db.categoriesRevision)throw fail('Kategori berubah di tab lain. Tutup lalu buka pengaturan kategori.',409)}
function normalize(input,base={title:'',body:'',bodyHtml:'',kind:'note',category:'',format:'',tags:[],pinned:false,archived:false}){
  if(!input||typeof input!=='object'||Array.isArray(input))throw fail('Data catatan tidak valid');
  const out={...base};
  for(const key of ['title','body'])if(key in input){if(typeof input[key]!=='string')throw fail(`${key} tidak valid`);out[key]=input[key];}
  const rich=richField(input,base,'body','bodyHtml');out.body=rich.text;out.bodyHtml=rich.html;
  out.title=out.title.trim();if(!out.title)throw fail('Judul catatan wajib diisi');
  if('kind' in input){if(!['note','prompt'].includes(input.kind))throw fail('Jenis catatan tidak valid');out.kind=input.kind;}
  if('category' in input)out.category=categoryName(input.category);
  if('format' in input){if(!['','long','shorts'].includes(input.format))throw fail('Pilih kategori video Long atau Short');out.format=input.format;}else out.format=base.format||'';
  for(const key of ['pinned','archived'])if(key in input){if(typeof input[key]!=='boolean')throw fail('Status catatan tidak valid');out[key]=input[key];}
  if('tags' in input){if(!Array.isArray(input.tags)||input.tags.length>12||input.tags.some(t=>typeof t!=='string'))throw fail('Maksimal 12 tag berupa teks');out.tags=[...new Set(input.tags.map(t=>t.trim()).filter(Boolean))];}
  return out;
}
export class NotesStore{
  constructor(file){this.file=file;this.loaded=null;this.chain=Promise.resolve();}
  async load(){
    if(this.persistence)return this.persistence.read('notes');
    if(!this.loaded)this.loaded=(async()=>{try{const db=JSON.parse(await fs.readFile(this.file,'utf8'));if(db.version!==1||!Array.isArray(db.notes))throw Error('Struktur tidak valid');if(db.categories!==undefined&&(!Array.isArray(db.categories)||db.categories.length>100||db.categories.some(c=>!categoryName(c))))throw Error('Kategori tidak valid');db.categories??=[];db.categoriesRevision??=1;if(!Number.isInteger(db.categoriesRevision)||db.categoriesRevision<1)throw Error('Revisi kategori tidak valid');for(const note of db.notes)note.category=note.category===undefined?'':categoryName(note.category);return db;}catch(e){if(e.code==='ENOENT')return {version:1,notes:[],categories:[],categoriesRevision:1};throw fail('Catatan gagal dibaca. File asli dipertahankan.',503)}})();
    try{return await this.loaded}catch(e){this.loaded=null;throw e}
  }
  async read(){return structuredClone(await this.load())}
  mutate(fn){if(this.persistence)return this.persistence.mutate('notes',fn);const work=this.chain.catch(()=>{}).then(async()=>{const db=structuredClone(await this.load()),result=await fn(db);await fs.mkdir(path.dirname(this.file),{recursive:true});await fs.writeFile(this.file+'.tmp',JSON.stringify(db),{mode:0o600});await fs.rename(this.file+'.tmp',this.file);this.loaded=Promise.resolve(db);return structuredClone(result)});this.chain=work;return work;}
  create(body){return this.mutate(db=>{const fields=normalize(body);fields.category=resolveCategory(db,fields.category);const now=new Date().toISOString(),note={...fields,id:crypto.randomUUID(),revision:1,createdAt:now,updatedAt:now};db.notes.unshift(note);return note})}
  update(id,body){return this.mutate(db=>{const old=db.notes.find(n=>n.id===id);if(!old)throw fail('Catatan tidak ditemukan',404);if(!Number.isInteger(body?.revision)||body.revision!==old.revision)throw fail('Catatan berubah di tab lain. Muat versi server atau simpan salinan.',409);const next=normalize(body,old);next.category=resolveCategory(db,next.category);if(['title','body','bodyHtml','kind','category','format','tags','pinned','archived'].every(k=>JSON.stringify(next[k]??'')===JSON.stringify(old[k]??'')))return old;const note={...next,revision:old.revision+1,updatedAt:new Date().toISOString()};db.notes[db.notes.indexOf(old)]=note;return note})}
  createCategory(body){return this.mutate(db=>{if(!body||typeof body!=='object'||!categoryName(body.name))throw fail('Nama kategori wajib diisi');if(body.categoriesRevision!==undefined)checkCategoryRevision(db,body.categoriesRevision);const size=db.categories.length,category=addCategory(db,body.name);if(db.categories.length!==size)db.categoriesRevision++;return {category,categories:db.categories,categoriesRevision:db.categoriesRevision}})}
  changeCategory(body,remove=false){return this.mutate(db=>{checkCategoryRevision(db,body?.categoriesRevision);const name=resolveCategory(db,body.name);if(!name)throw fail('Pilih kategori yang valid');const newName=remove?'':categoryName(body.newName);if(!remove&&!newName)throw fail('Nama kategori wajib diisi');if(!remove&&db.categories.some(c=>c!==name&&c.toLocaleLowerCase('id-ID')===newName.toLocaleLowerCase('id-ID')))throw fail('Nama kategori sudah digunakan');if(!remove&&newName===name)return {categories:db.categories,categoriesRevision:db.categoriesRevision};db.categories=db.categories.filter(c=>c!==name);if(!remove)db.categories.push(newName);let changed=0;for(const note of db.notes){if(note.category.toLocaleLowerCase('id-ID')!==name.toLocaleLowerCase('id-ID'))continue;note.category=newName;note.revision++;note.updatedAt=new Date().toISOString();changed++}db.categoriesRevision++;return {categories:db.categories,categoriesRevision:db.categoriesRevision,changed}})}
  remove(id,revision){return this.mutate(db=>{const old=db.notes.find(n=>n.id===id);if(!old)throw fail('Catatan tidak ditemukan',404);if(revision!==old.revision)throw fail('Catatan berubah. Muat versi terbaru.',409);db.notes=db.notes.filter(n=>n.id!==id);return {ok:true}})}
}
