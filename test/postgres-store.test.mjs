import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {gunzipSync} from 'node:zlib';
import {PGlite} from '@electric-sql/pglite';
import {PostgresStorage,checksum} from '../postgres-store.mjs';
import {ContentStore} from '../content-store.mjs';
import {NotesStore} from '../notes-store.mjs';
import {AnalyticsStore} from '../analytics-store.mjs';

// Real PostgreSQL WASM engine; serialize its single connection like a pool.
function poolFor(db){let tail=Promise.resolve();const query=(sql,args)=>!args&&sql.includes(';')?db.exec(sql).then(()=>({rows:[]})):db.query(sql,args);return {query,async connect(){const previous=tail;let release;tail=new Promise(r=>release=r);await previous;return {query,release}},end:()=>db.close()};}
async function setup(run){const dir=await fs.mkdtemp(path.join(os.tmpdir(),'pg-store-')),engine=new PGlite(),pool=poolFor(engine);try{await run({dir,pool,storage:new PostgresStorage(pool,{backupDir:path.join(dir,'backups')})})}finally{await pool.end();await fs.rm(dir,{recursive:true,force:true})}}
async function seed(dir){const contents=new ContentStore(path.join(dir,'contents.json')),notes=new NotesStore(path.join(dir,'notes.json')),analytics=new AnalyticsStore(path.join(dir,'analytics.json'));await contents.create({title:'Naskah asli',script:'Isi naskah lengkap'});await notes.create({title:'Note asli',body:'Catatan\nbaris dua'});await analytics.mutate('A',c=>{c.videos.x={title:'Video'}});const documents={uploads:{version:1,jobs:[],channel:{id:'A'}},contents:await contents.load(),notes:await notes.load(),analytics:await analytics.load()},files={contents:contents.file,notes:notes.file,analytics:analytics.file};return {documents,files};}
test('PostgreSQL JSONB import verifies hashes, preserves originals, revisions and category/column/script history; restart never reimports stale JSON',()=>setup(async({dir,storage,pool})=>{
 const initial=await seed(dir),original=await fs.readFile(initial.files.contents,'utf8');await storage.initialize(async()=>initial);assert.equal(checksum(await storage.read('contents')),checksum(initial.documents.contents));assert.equal(await fs.readFile(initial.files.contents,'utf8'),original);const folders=await fs.readdir(path.join(dir,'backups'));assert.ok(folders.some(n=>n.startsWith('migration-')));
 const contents=new ContentStore(initial.files.contents),notes=new NotesStore(initial.files.notes);contents.persistence=storage;notes.persistence=storage;
 await Promise.all(Array.from({length:10},(_,i)=>contents.create({title:'Konten '+i,script:'Naskah '+i})));assert.equal((await contents.read()).contents.length,11);
 const note=(await notes.read()).notes[0];const result=await Promise.allSettled([notes.update(note.id,{revision:note.revision,title:'Revisi A'}),notes.update(note.id,{revision:note.revision,title:'Revisi B'})]);assert.equal(result.filter(r=>r.status==='fulfilled').length,1);assert.equal(result.find(r=>r.status==='rejected').reason.status,409);assert.equal((await notes.read()).notes[0].body,'Catatan\nbaris dua');await assert.rejects(notes.create({title:'',body:''}));await assert.rejects(notes.create({title:'Catatan',category:'TYPO'}));
 const formatted=await notes.create({title:'Rich Note',format:'long',bodyHtml:'<b>PG format</b>'});const richContent=await contents.create({title:'Rich script',richText:{script:'<font size=5><u>PG naskah</u></font>'}});
 const restarted=new PostgresStorage(pool,{backupDir:path.join(dir,'backups')});await restarted.initialize(()=>{throw Error('must not read JSON')});assert.equal((await restarted.read('contents')).contents.length,12);assert.equal((await restarted.read('notes')).notes.find(n=>n.id===formatted.id).format,'long');assert.equal((await restarted.read('notes')).notes.find(n=>n.id===formatted.id).bodyHtml,'<b>PG format</b>');assert.equal((await restarted.read('contents')).contents.find(c=>c.id===richContent.id).richText.script,'<font size="5"><u>PG naskah</u></font>');
}));
test('migration failure rolls back all documents and preserves source files; corrupt seed cannot overwrite data',()=>setup(async({dir,storage,pool})=>{
 const initial=await seed(dir);await fs.mkdir(path.join(dir,'directory'));await assert.rejects(storage.initialize(async()=>({...initial,files:{contents:path.join(dir,'directory')}})));assert.equal((await pool.query('SELECT * FROM app_documents')).rows.length,0);assert.equal((await fs.readFile(initial.files.contents,'utf8')).includes('Naskah asli'),true);
 const bad=structuredClone(initial);bad.documents.notes.notes=null;await assert.rejects(storage.initialize(async()=>bad));assert.equal((await pool.query('SELECT * FROM app_documents')).rows.length,0);
 await storage.initialize(async()=>initial);await assert.rejects(storage.mutate('notes',db=>{db.notes=[];throw Error('reject')}));assert.equal((await storage.read('notes')).notes.length,1);
}));
test('backup survives restart, verifies checksum, mirrors gzip, keeps bounded restore points, and restores atomically',()=>setup(async({dir,storage})=>{
 await storage.initialize(()=>seed(dir));const backup=await storage.backup('manual'),full=await storage.getBackup(backup.id),gzip=JSON.parse(gunzipSync(await fs.readFile(path.join(dir,'backups',backup.id+'.json.gz'))));assert.equal(gzip.digest,checksum(full.bundle));assert.equal(Object.hasOwn(gzip,'tokens'),false);
 await storage.mutate('notes',db=>{db.notes=[]});await assert.rejects(storage.restore(full.bundle,'bad digest'));assert.equal((await storage.read('notes')).notes.length,0);await storage.restore(full.bundle,full.digest);assert.equal((await storage.read('notes')).notes.length,1);
 for(let i=0;i<12;i++)await storage.backup('manual');const points=await storage.listBackups();assert.equal(points.filter(p=>p.kind==='manual').length,10);assert.equal(points.filter(p=>p.kind==='daily').length,1);const today=points.find(p=>p.kind==='daily');await fs.unlink(path.join(dir,'backups',today.id+'.json.gz'));await storage.backup('daily');assert.ok(await fs.stat(path.join(dir,'backups',today.id+'.json.gz')));
}));
test('concurrent daily mirrors do not collide and manual cooldown is atomic across storage clients',()=>setup(async({dir,storage,pool})=>{
 await storage.initialize(()=>seed(dir));await Promise.all([storage.backup('daily'),storage.backup('daily'),storage.backup('daily')]);
 assert.equal((await storage.listBackups()).filter(b=>b.kind==='daily').length,1);assert.ok((await storage.status()).backups.every(b=>b.volumeCopy==='ready'));
 const other=new PostgresStorage(pool,{backupDir:path.join(dir,'backups')}),results=await Promise.allSettled([storage.backup('manual',{minIntervalMs:60000}),other.backup('manual',{minIntervalMs:60000})]);
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);const error=results.find(r=>r.status==='rejected').reason;assert.equal(error.status,429);assert.ok(error.retryAfter>0);
 assert.equal((await storage.listBackups()).filter(b=>b.kind==='manual').length,1);assert.ok((await storage.status()).manualAvailableAt);assert.equal((await fs.readdir(storage.backupDir)).filter(n=>n.endsWith('.tmp')).length,0);
}));
test('volume mirror failure preserves successful database backup, download data and warning after restart',()=>setup(async({dir,storage,pool})=>{
 await storage.initialize(()=>seed(dir));const bad=path.join(dir,'not-a-directory');await fs.writeFile(bad,'blocked');storage.backupDir=bad;
 const backup=await storage.backup('manual');assert.equal(backup.mirror,'error');assert.ok(backup.warning);const full=await storage.getBackup(backup.id);assert.equal(checksum(full.bundle),full.digest);
 const restarted=new PostgresStorage(pool,{backupDir:bad}),status=await restarted.status();assert.ok(status.ready);assert.ok(status.backupWarning);assert.equal(status.backups.find(b=>b.id===backup.id).volumeCopy,'missing');
 storage.backupDir=path.join(dir,'backups');await storage.backup('daily');assert.equal((await storage.status()).backups.find(b=>b.id===backup.id).volumeCopy,'missing');
 await assert.rejects(storage.backup('invalid'),e=>e.status===400);
}));
