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
import {EventEmitter} from 'node:events';

// Real PostgreSQL WASM engine; serialize its single connection like a pool.
function poolFor(db){let tail=Promise.resolve();const query=(sql,args)=>!args&&sql.includes(';')?db.exec(sql).then(()=>({rows:[]})):db.query(sql,args);return {query,async connect(){const previous=tail;let release;tail=new Promise(r=>release=r);await previous;return {query,release}},end:()=>db.close()};}
async function setup(run){const dir=await fs.mkdtemp(path.join(os.tmpdir(),'pg-store-')),engine=new PGlite(),pool=poolFor(engine);try{await run({dir,pool,storage:new PostgresStorage(pool,{backupDir:path.join(dir,'backups')})})}finally{await pool.end();await fs.rm(dir,{recursive:true,force:true})}}
async function seed(dir){const contents=new ContentStore(path.join(dir,'contents.json')),notes=new NotesStore(path.join(dir,'notes.json')),analytics=new AnalyticsStore(path.join(dir,'analytics.json'));await contents.create({title:'Naskah asli',script:'Isi naskah lengkap'});await notes.create({title:'Note asli',body:'Catatan\nbaris dua'});await analytics.mutate('A',c=>{c.videos.x={title:'Video'}});const documents={uploads:{version:1,jobs:[],channel:{id:'A'}},contents:await contents.load(),notes:await notes.load(),analytics:await analytics.load()},files={contents:contents.file,notes:notes.file,analytics:analytics.file};return {documents,files};}
test('connection loss during a checked-out transaction rejects safely and destroys the damaged client',async()=>{
 const client=new EventEmitter(),lost=Object.assign(Error('Connection terminated unexpectedly'),{code:'ECONNRESET'}),queries=[];let released;
 client.query=async sql=>{queries.push(sql);if(sql==='ROLLBACK')throw lost;return {rows:[]};};client.release=error=>{released=error};
 const storage=new PostgresStorage({connect:async()=>client});
 await assert.rejects(storage.transaction(async()=>{client.emit('error',lost);return 'must not commit'}),error=>error===lost);
 assert.deepEqual(queries,['BEGIN','ROLLBACK']);assert.equal(released,lost);assert.equal(client.listenerCount('error'),0);
 const healthy=new EventEmitter();healthy.query=async()=>({rows:[]});healthy.release=error=>assert.equal(error,undefined);storage.pool.connect=async()=>healthy;
 assert.equal(await storage.transaction(async()=>42),42);assert.equal(healthy.listenerCount('error'),0);
});
test('no-op document mutations keep revisions and timestamps unchanged while real edits still persist',()=>setup(async({dir,storage,pool})=>{
 await storage.initialize(()=>seed(dir));const before=(await pool.query("SELECT revision,updated_at FROM app_documents WHERE key='contents'")).rows[0];
 assert.equal(await storage.mutate('contents',()=>({unchanged:true})).then(r=>r.unchanged),true);
 assert.deepEqual((await pool.query("SELECT revision,updated_at FROM app_documents WHERE key='contents'")).rows[0],before);
 await storage.mutate('contents',db=>{db.contents[0].script+=' tambahan'});
 const after=(await pool.query("SELECT revision FROM app_documents WHERE key='contents'")).rows[0];assert.equal(Number(after.revision),Number(before.revision)+1);assert.match((await storage.read('contents')).contents[0].script,/tambahan$/);
}));
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
test('Radar shares content transactions and is included in verified PostgreSQL backup and restore',()=>setup(async({dir,storage,pool})=>{
 const {RadarStore}=await import('../radar-store.mjs');await storage.initialize(()=>seed(dir));const contents=new ContentStore(path.join(dir,'contents.json'));contents.persistence=storage;const radar=new RadarStore(contents);
 await Promise.all([radar.addSources([{title:'Pajak publik',url:'https://example.org/pajak',publisher:'Media'}]),contents.create({title:'Produksi bersamaan',script:'Script utuh'})]);const issue=(await radar.read()).issues[0];const linked=await contents.create({title:'Dari Radar',radarIssueId:issue.id,format:'long'});assert.ok((await radar.read()).issues[0].contentIds.includes(linked.id));
 const point=await storage.backup('manual'),full=await storage.getBackup(point.id);assert.equal(full.bundle.documents.contents.radar.issues[0].sources[0].url,'https://example.org/pajak');assert.equal(checksum(full.bundle),full.digest);await storage.mutate('contents',db=>{db.radar.issues=[]});await storage.restore(full.bundle,full.digest);
 const restarted=new ContentStore(path.join(dir,'contents.json'));restarted.persistence=new PostgresStorage(pool,{backupDir:path.join(dir,'backups')});assert.equal((await new RadarStore(restarted).read()).issues[0].contentIds[0],linked.id);assert.ok((await restarted.read()).contents.some(c=>c.script==='Script utuh'));
}));

test('compressed backup storage stays compatible with raw restore points; legacy compaction is lossless and bounded',()=>setup(async({dir,storage,pool})=>{
 await storage.initialize(()=>seed(dir));const point=await storage.backup('manual'),full=await storage.getBackup(point.id);const encoded=(await pool.query('SELECT bundle FROM app_backups WHERE id=$1',[point.id])).rows[0].bundle;assert.equal(encoded.encoding,'gzip-base64');assert.equal(checksum(full.bundle),full.digest);
 await pool.query('UPDATE app_backups SET bundle=$2::jsonb WHERE id=$1',[point.id,JSON.stringify(full.bundle)]);assert.equal(checksum((await storage.getBackup(point.id)).bundle),full.digest);assert.equal((await storage.compactBackup()).compressed,1);assert.equal((await storage.compactBackup()).compressed,0);assert.equal(checksum((await storage.getBackup(point.id)).bundle),full.digest);
 const snapshot=await storage.snapshot();assert.equal(checksum(snapshot.bundle),snapshot.digest);assert.equal(snapshot.bundle.documents.contents.contents[0].script,'Isi naskah lengkap');
 await pool.query('UPDATE app_backups SET digest=$2 WHERE id=$1',[point.id,'invalid']);await assert.rejects(storage.getBackup(point.id),/Checksum/);
}));

test('capacity warning labels a database + WAL estimate and caches reads; unknown providers fail safely',async()=>{
 let calls=0;const storage=new PostgresStorage({query:async()=>{calls++;return {rows:[{database_bytes:350*1024*1024,wal_bytes:32*1024*1024}]};}});const previous=process.env.DATABASE_VOLUME_MB;process.env.DATABASE_VOLUME_MB='500';try{const result=await storage.capacity();assert.equal(result.level,'warning');assert.equal(result.estimated,true);assert.equal(result.estimateBytes,382*1024*1024);await storage.capacity();assert.equal(calls,1);}finally{if(previous===undefined)delete process.env.DATABASE_VOLUME_MB;else process.env.DATABASE_VOLUME_MB=previous;}
 const unknown=new PostgresStorage({query:async()=>{throw Error('unsupported')}});assert.equal((await unknown.capacity()).level,'unknown');
});
