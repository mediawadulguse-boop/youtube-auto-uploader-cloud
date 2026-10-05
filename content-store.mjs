import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { richField, RICH_FIELDS } from './rich-text.mjs';
import {fillContentWithEngine,CONTENT_ENGINE_VERSION} from './content-engine.mjs';
import {publicationFromVideo} from './youtube-publication.mjs';

export const CONTENT_STAGES = ['idea', 'script', 'production', 'editing', 'review', 'ready'];
export const COLUMN_ICONS = ['bulb','pen','camera','scissors','eye','check','cloud','clock','upload','calendar','play','alert'];
export const defaultColumns = () => [
  ['idea','Ide','#526178','bulb'], ['script','Naskah','#2157ad','pen'],
  ['production','Produksi','#b97900','camera'], ['editing','Editing','#6f42ba','scissors'],
  ['review','Review','#9e3565','eye'], ['ready','Siap Upload','#216e4e','check']
].map(([id,name,color,icon]) => ({ id,name,color,icon,isDone:id==='ready' }));
const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const text = value => {
  if (typeof value !== 'string') throw fail('Teks tidak valid');
  return value;
};
const date = value => {
  if (!value) return null;
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) throw fail('Tanggal tidak valid');
  return new Date(value).toISOString();
};
const url = value => {
  if (!value) return '';
  try { const u = new URL(text(value)); if (!['http:', 'https:'].includes(u.protocol)) throw 0; return u.href; }
  catch { throw fail('Tautan harus berupa URL http atau https yang valid'); }
};
const defaults = () => ({
  version: 2, contents: [], columns: defaultColumns(), boardRevision: 1,
  pillars: [
    { id: 'education', name: 'Edukasi', color: '#346dff' },
    { id: 'analysis', name: 'Analisis', color: '#8b5cf6' },
    { id: 'information', name: 'Informasi', color: '#db2777' },
    { id: 'entertainment', name: 'Hiburan', color: '#0f9167' }
  ]
});
const blank = () => ({
  youtubeVideoId:'', youtubePublication:null, title: 'Konten baru', stage: 'idea', pillarId: '', format: 'shorts', priority: 'normal', owner: '',
  deadline: null, plannedPublishAt: null, brief: '', audience: '', hook: '', script: '', cta: '',
  productionNotes: '', richText: {}, description: '', tags: '', sources: [], assets: [], archived: false,
  checklist: { script: false, video: false, thumbnail: false, review: false }
});
function normalize(input, db, base = blank()) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw fail('Data konten tidak valid');
  const out = { ...base };
  for (const key of ['title','owner','brief','audience','hook','script','cta','productionNotes','description','tags']) {
    if (key in input) out[key] = text(input[key]);
  }
  if('richText' in input&&(!input.richText||typeof input.richText!=='object'||Array.isArray(input.richText)||Object.keys(input.richText).some(k=>!RICH_FIELDS.includes(k))))throw fail('Format naskah tidak valid');
  out.richText={};
  for(const key of RICH_FIELDS){
    const rich=richField({...(Object.hasOwn(input,key)?{[key]:input[key]}:{}),...('richText' in input?{html:input.richText[key]??''}:{})},{...base,html:base.richText?.[key]},key,'html');
    out[key]=rich.text;if(rich.html)out.richText[key]=rich.html;
  }
  if('youtubeVideoId' in input){if(typeof input.youtubeVideoId!=='string'||(input.youtubeVideoId&&!/^[A-Za-z0-9_-]{11}$/.test(input.youtubeVideoId)))throw fail('ID video tidak valid');out.youtubeVideoId=input.youtubeVideoId;}
  out.title = out.title.trim();
  if (!out.title) throw fail('Judul konten wajib diisi');
  for (const [key, options] of Object.entries({stage: db.columns.map(c=>c.id), format: ['shorts','long','live','other'], priority: ['low','normal','high']})) {
    if (key in input) { if (!options.includes(input[key])) throw fail(`${key} tidak valid`); out[key] = input[key]; }
  }
  if ('pillarId' in input) {
    if (input.pillarId !== '' && !db.pillars.some(p => p.id === input.pillarId)) throw fail('Pilar tidak ditemukan');
    out.pillarId = input.pillarId;
  }
  for (const key of ['deadline', 'plannedPublishAt']) if (key in input) out[key] = date(input[key]);
  if ('archived' in input) { if (typeof input.archived !== 'boolean') throw fail('Status arsip tidak valid'); out.archived = input.archived; }
  if ('checklist' in input) {
    if (!input.checklist || typeof input.checklist !== 'object') throw fail('Checklist tidak valid');
    out.checklist = Object.fromEntries(['script','video','thumbnail','review'].map(k => [k, input.checklist[k] === true]));
  }
  for (const key of ['sources','assets']) if (key in input) {
    if (!Array.isArray(input[key]) || input[key].length > 100) throw fail('Maksimal 100 bahan per konten');
    out[key] = input[key].map(item => {
      if (!item || typeof item !== 'object') throw fail('Bahan tidak valid');
      return { id: typeof item.id === 'string' && /^[0-9a-f-]{36}$/i.test(item.id) ? item.id : crypto.randomUUID(), label: text(item.label || ''), url: url(item.url || ''), notes: text(item.notes || ''), verified: item.verified === true };
    }).filter(item=>[item.label,item.url,item.notes].some(value=>value.trim()));
  }
  return out;
}
function columnFields(input, base = {name:'Kolom baru',color:'#3263e7',icon:'bulb',isDone:false}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw fail('Data kolom tidak valid');
  const out = {...base};
  if ('name' in input) { out.name=text(input.name).trim(); if(!out.name)throw fail('Nama kolom wajib diisi'); }
  if ('color' in input) { if(!/^#[0-9a-f]{6}$/i.test(input.color))throw fail('Warna kolom tidak valid'); out.color=input.color; }
  if ('icon' in input) { if(!COLUMN_ICONS.includes(input.icon))throw fail('Ikon kolom tidak valid');out.icon=input.icon; }
  if ('isDone' in input) { if(typeof input.isDone!=='boolean')throw fail('Status selesai tidak valid');out.isDone=input.isDone; }
  return out;
}
function checkBoardRevision(db, revision) {
  if (!Number.isInteger(revision) || revision !== db.boardRevision) throw fail('Kolom berubah di tab lain. Muat versi terbaru.',409);
}
function snapshot(content) {
  const { history, ...rest } = content;
  return rest;
}
export class ContentStore {
  constructor(file) { this.file = file; this.chain = Promise.resolve(); this.loaded = null; }
  async load() {
    if(this.persistence)return this.persistence.read('contents');
    if (!this.loaded) this.loaded = (async () => {
      try {
        const db = JSON.parse(await fs.readFile(this.file, 'utf8'));
        if (![1,2].includes(db.version) || !Array.isArray(db.contents) || !Array.isArray(db.pillars)) throw Error('Struktur tidak valid');
        if (db.version===1) { this.needsBackup=true;db.version=2;db.columns=defaultColumns();db.boardRevision=1; }
        if (!Array.isArray(db.columns)||!db.columns.length||db.columns.length>24||!Number.isInteger(db.boardRevision)||db.boardRevision<1)throw Error('Struktur kolom tidak valid');
        const ids=new Set();
        for(const column of db.columns){if(!column||typeof column.id!=='string'||!/^[a-z0-9-]{1,60}$/.test(column.id)||ids.has(column.id)||['name','color','icon','isDone'].some(k=>!Object.hasOwn(column,k)))throw Error('ID atau data kolom tidak valid');columnFields(column);ids.add(column.id);}
        if(db.contents.some(c=>!ids.has(c.stage)))throw Error('Tahap konten tidak ditemukan');
        return db;
      } catch (e) {
        if (e.code === 'ENOENT') return defaults();
        throw fail('Data konten gagal dibaca. File asli dipertahankan; periksa log server.', 503);
      }
    })();
    try { return await this.loaded; } catch (e) { this.loaded = null; throw e; }
  }
  async read() { return structuredClone(await this.load()); }
  mutate(fn) {
    if(this.persistence)return this.persistence.mutate('contents',fn);
    const work = this.chain.catch(() => {}).then(async () => {
      const previous = await this.load();
      const next = structuredClone(previous);
      const result = await fn(next);
      await fs.mkdir(path.dirname(this.file), { recursive: true });
      if(this.needsBackup){try{await fs.copyFile(this.file,this.file.replace(/\.json$/,'.v1.backup.json'),fs.constants.COPYFILE_EXCL)}catch(e){if(e.code!=='EEXIST'&&e.code!=='ENOENT')throw e}this.needsBackup=false;}
      await fs.writeFile(this.file + '.tmp', JSON.stringify(next), { mode: 0o600 });
      await fs.rename(this.file + '.tmp', this.file);
      this.loaded = Promise.resolve(next);
      return structuredClone(result);
    });
    this.chain = work;
    return work;
  }
  create(body,{fillEngine=false}={}) {
    return this.mutate(db => {
      if(typeof body?.title!=='string'||!body.title.trim())throw fail('Judul konten wajib diisi');
      const now = new Date().toISOString();
      let content = { ...normalize(body, db, {...blank(),stage:db.columns[0].id}), id: crypto.randomUUID(), revision: 1, createdAt: now, updatedAt: now, history: [] };
      if(fillEngine)content=normalize(fillContentWithEngine(content).fields,db,content);
      if(content.youtubeVideoId&&db.contents.some(c=>c.youtubeVideoId===content.youtubeVideoId))throw fail('Video sudah terhubung ke konten produksi lain.',409);
      if(body.radarIssueId){const issue=db.radar?.issues.find(i=>i.id===body.radarIssueId);if(!issue)throw fail('Isu Radar berubah. Muat ulang sebelum membuat konten.',409);issue.contentIds=[...new Set([...issue.contentIds,content.id])];issue.revision++;}
      db.contents.unshift(content); return content;
    });
  }
  update(id, body, guard = () => {}) {
    return this.mutate(async db => {
      const item = db.contents.find(c => c.id === id);
      if (!item) throw fail('Konten tidak ditemukan', 404);
      if (!body || typeof body !== 'object' || Array.isArray(body)) throw fail('Data konten tidak valid');
      if (!Number.isInteger(body.revision) || body.revision !== item.revision) throw fail('Konten berubah di tab lain. Muat versi terbaru sebelum menyimpan.', 409);
      const fields = body.restoreRevision !== undefined
        ? item.history.find(h => h.revision === body.restoreRevision) : body;
      if (!fields) throw fail('Versi tidak ditemukan', 404);
      // A historical snapshot can reference a deleted column; retain the current valid stage.
      const restore = body.restoreRevision!==undefined&&!db.columns.some(c=>c.id===fields.stage)?{...fields,stage:item.stage}:fields;
      const updated = normalize(body.restoreRevision!==undefined?{...restore,richText:restore.richText||{},youtubeVideoId:item.youtubeVideoId||''}:restore, db, body.restoreRevision!==undefined?{...item,richText:{}}:item);
      if(updated.youtubeVideoId!==item.youtubeVideoId)updated.youtubePublication=null;
      if(updated.youtubeVideoId&&db.contents.some(c=>c.id!==id&&c.youtubeVideoId===updated.youtubeVideoId))throw fail('Video sudah terhubung ke konten produksi lain.',409);
      await guard(item, updated);
      const comparable = c => JSON.stringify(Object.fromEntries(Object.keys(blank()).map(k => [k, c[k]])));
      if (comparable(item) === comparable(updated)) return item;
      const result = { ...updated, revision: item.revision + 1, updatedAt: new Date().toISOString(), history: [snapshot(item), ...item.history].slice(0, 30) };
      db.contents[db.contents.indexOf(item)] = result; return result;
    });
  }
  publicationUpdate(db,id,revision,video) {
    const item=db.contents.find(c=>c.id===id);
    if(!item)throw fail('Konten tidak ditemukan',404);
    if(!Number.isInteger(revision)||revision!==item.revision)throw fail('Konten berubah. Muat versi terbaru.',409);
    if(item.youtubeVideoId&&item.youtubeVideoId!==video.id)throw fail('Konten sudah terhubung ke video lain.',409);
    if(db.contents.some(c=>c.id!==id&&c.youtubeVideoId===video.id))throw fail('Video sudah terhubung ke konten produksi lain.',409);
    const next={...item,youtubeVideoId:video.id,youtubePublication:publicationFromVideo(video)};
    // Status polling must not consume writing history or conflict with editor saves.
    if(item.youtubeVideoId!==video.id){next.revision++;next.updatedAt=new Date().toISOString();next.history=[snapshot(item),...item.history].slice(0,30);}
    return {item,next};
  }
  recordPublication(id,revision,video,guard=()=>{}) {
    return this.mutate(async db=>{
      const {item,next}=this.publicationUpdate(db,id,revision,video);
      await guard(item,next);
      db.contents[db.contents.indexOf(item)]=next;return next;
    });
  }
  recordPublications(entries,guard=()=>{}) {
    return this.mutate(async db=>{
      await guard();let updated=0;
      for(const {id,revision,video} of entries){
        let change;
        try{change=this.publicationUpdate(db,id,revision,video);}catch(error){if([404,409].includes(error.status))continue;throw error;}
        db.contents[db.contents.indexOf(change.item)]=change.next;updated++;
      }
      // A channel switch invalidates the entire response, including earlier items.
      await guard();return {updated};
    });
  }
  fillEmptyWithEngine() {
    return this.mutate(db=>{
      if(db.contentEngineVersion===CONTENT_ENGINE_VERSION)return {updated:0};
      let updated=0;const now=new Date().toISOString();
      for(let i=0;i<db.contents.length;i++){
        const item=db.contents[i];if(item.archived)continue;
        const result=fillContentWithEngine(item);if(!Object.keys(result.fields).length)continue;
        const next=normalize(result.fields,db,item);
        db.contents[i]={...next,revision:item.revision+1,updatedAt:now,history:[snapshot(item),...item.history].slice(0,30)};updated++;
      }
      db.contentEngineVersion=CONTENT_ENGINE_VERSION;return {updated};
    });
  }
  duplicate(id) {
    return this.mutate(db => {
      const item = db.contents.find(c => c.id === id);
      if (!item) throw fail('Konten tidak ditemukan', 404);
      const now = new Date().toISOString();
      const copy = { ...snapshot(item), youtubeVideoId:'', youtubePublication:null, id: crypto.randomUUID(), title: (item.title + ' (salinan)'), stage: db.columns[0].id, archived: false, plannedPublishAt: null, deadline: null, checklist: blank().checklist, revision: 1, createdAt: now, updatedAt: now, history: [] };
      db.contents.unshift(copy); return copy;
    });
  }
  remove(id, revision, guard = () => {}) {
    return this.mutate(async db => {
      const item = db.contents.find(c => c.id === id);
      if (!item) throw fail('Konten tidak ditemukan', 404);
      if (revision !== item.revision) throw fail('Konten berubah. Muat versi terbaru.', 409);
      await guard(item); db.contents = db.contents.filter(c => c.id !== id); return { ok: true };
    });
  }
  savePillar(body) {
    return this.mutate(db => {
      if (!body || typeof body !== 'object' || Array.isArray(body)) throw fail('Data pilar tidak valid');
      const name = text(body.name).trim();
      if (!name || !/^#[0-9a-f]{6}$/i.test(body.color)) throw fail('Nama atau warna pilar tidak valid');
      const previous = body.id ? db.pillars.find(p => p.id === body.id) : null;
      if (body.id && !previous) throw fail('Pilar tidak ditemukan', 404);
      const pillar = { id: previous?.id || crypto.randomUUID(), name, color: body.color };
      if (previous) db.pillars[db.pillars.indexOf(previous)] = pillar; else db.pillars.push(pillar);
      return pillar;
    });
  }
  saveColumn(body, id = null) {
    return this.mutate(db=>{
      if(!id&&(typeof body?.name!=='string'||!body.name.trim()))throw fail('Nama kolom wajib diisi');
      checkBoardRevision(db,body?.boardRevision);
      const old=id?db.columns.find(c=>c.id===id):null;
      if(id&&!old)throw fail('Kolom tidak ditemukan',404);
      if(!id&&db.columns.length>=24)throw fail('Maksimal 24 kolom');
      const column={...columnFields(body,old||undefined),id:old?.id||crypto.randomUUID()};
      if(old)db.columns[db.columns.indexOf(old)]=column;else db.columns.push(column);
      db.boardRevision++;return {column,columns:db.columns,boardRevision:db.boardRevision};
    });
  }
  reorderColumns(body) {
    return this.mutate(db=>{
      checkBoardRevision(db,body?.boardRevision);
      if(!Array.isArray(body.ids)||body.ids.length!==db.columns.length||new Set(body.ids).size!==db.columns.length||body.ids.some(id=>!db.columns.some(c=>c.id===id)))throw fail('Urutan kolom tidak valid');
      db.columns=body.ids.map(id=>db.columns.find(c=>c.id===id));db.boardRevision++;
      return {columns:db.columns,boardRevision:db.boardRevision};
    });
  }
  removeColumn(id,body) {
    return this.mutate(db=>{
      checkBoardRevision(db,body?.boardRevision);
      if(!db.columns.some(c=>c.id===id))throw fail('Kolom tidak ditemukan',404);
      if(db.columns.length===1)throw fail('Sisakan setidaknya satu kolom');
      if(body.moveTo===id||!db.columns.some(c=>c.id===body.moveTo))throw fail('Pilih kolom tujuan yang valid');
      let moved=0;const now=new Date().toISOString();
      for(let i=0;i<db.contents.length;i++){const item=db.contents[i];if(item.stage!==id)continue;db.contents[i]={...item,stage:body.moveTo,revision:item.revision+1,updatedAt:now,history:[snapshot(item),...item.history].slice(0,30)};moved++;}
      db.columns=db.columns.filter(c=>c.id!==id);db.boardRevision++;
      return {columns:db.columns,boardRevision:db.boardRevision,moved};
    });
  }
}
