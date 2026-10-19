import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {gunzipSync} from 'node:zlib';
import {PGlite} from '@electric-sql/pglite';
import {PostgresStorage,checksum,encodeBackup,backupDataDigest} from '../postgres-store.mjs';
import {ContentStore} from '../content-store.mjs';
import {syncLinkedPublications} from '../youtube-publication.mjs';
import {NotesStore} from '../notes-store.mjs';
import {AnalyticsStore} from '../analytics-store.mjs';
import crypto from 'node:crypto';
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
 for(let i=0;i<12;i++)await storage.backup('manual');const points=await storage.listBackups();assert.equal(points.filter(p=>p.kind==='manual').length,2);assert.equal(points.filter(p=>p.kind==='daily').length,1);const today=points.find(p=>p.kind==='daily');await fs.unlink(path.join(dir,'backups',today.id+'.json.gz'));await storage.backup('daily');assert.ok(await fs.stat(path.join(dir,'backups',today.id+'.json.gz')));
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
 await pool.query('UPDATE app_backups SET bundle=$2::jsonb WHERE id=$1',[point.id,JSON.stringify(full.bundle)]);assert.equal(checksum((await storage.getBackup(point.id)).bundle),full.digest);storage.capacity=async()=>({budgetBytes:500*1024*1024,level:'ready'});assert.equal((await storage.compactBackup()).compressed,1);assert.equal((await storage.compactBackup()).compressed,0);assert.equal(checksum((await storage.getBackup(point.id)).bundle),full.digest);
 const snapshot=await storage.snapshot();assert.equal(checksum(snapshot.bundle),snapshot.digest);assert.equal(snapshot.bundle.documents.contents.contents[0].script,'Isi naskah lengkap');
 await pool.query('UPDATE app_backups SET digest=$2 WHERE id=$1',[point.id,'invalid']);await assert.rejects(storage.getBackup(point.id),/Checksum/);
}));

test('capacity warning labels a database + WAL estimate and caches reads; unknown providers fail safely',async()=>{
 let calls=0;const storage=new PostgresStorage({query:async()=>{calls++;return {rows:[{database_bytes:350*1024*1024,wal_bytes:32*1024*1024}]};}});const previous=process.env.DATABASE_VOLUME_MB;process.env.DATABASE_VOLUME_MB='500';try{const result=await storage.capacity();assert.equal(result.level,'warning');assert.equal(result.estimated,true);assert.equal(result.estimateBytes,382*1024*1024);await storage.capacity();assert.equal(calls,1);}finally{if(previous===undefined)delete process.env.DATABASE_VOLUME_MB;else process.env.DATABASE_VOLUME_MB=previous;}
 const unknown=new PostgresStorage({query:async()=>{throw Error('unsupported')}});assert.equal((await unknown.capacity()).level,'unknown');
});

test('legacy compaction stops before any write when capacity is critical or unknown',async()=>{
 const storage=new PostgresStorage({connect:async()=>{throw Error('must not write')}});for(const capacity of [{budgetBytes:500,level:'critical'},{budgetBytes:500,level:'warning'},{level:'unknown'}]){storage.capacity=async()=>capacity;assert.equal((await storage.compactBackup()).skipped,'insufficient_headroom');}
});

test('publication batch increments the PostgreSQL document once for multiple videos and rolls back a channel conflict',()=>setup(async({dir,storage,pool})=>{
 await storage.initialize(()=>seed(dir));const store=new ContentStore(path.join(dir,'contents.json'));store.persistence=storage;
 const ids=['abcdefghijk','lmnopqrstuv'];for(const id of ids)await store.create({title:'Publikasi '+id,youtubeVideoId:id,script:'Naskah '+id});
 const before=Number((await pool.query("SELECT revision FROM app_documents WHERE key='contents'")).rows[0].revision);
 const fetcher=async()=>Response.json({items:ids.map(id=>({id,snippet:{channelId:'owned',publishedAt:'2026-10-05T12:00:00Z'},status:{privacyStatus:'public'}}))});
 assert.equal((await syncLinkedPublications({store,fetcher,channelId:'owned'})).updated,2);
 const revision=Number((await pool.query("SELECT revision FROM app_documents WHERE key='contents'")).rows[0].revision);assert.equal(revision,before+1);
 const saved=await store.read();let guards=0;await assert.rejects(syncLinkedPublications({store,fetcher,channelId:'owned',force:true,guard:()=>{if(++guards===2)throw Object.assign(Error('Channel berubah'),{status:409});}}),{status:409});
 assert.deepEqual(await store.read(),saved);assert.equal(Number((await pool.query("SELECT revision FROM app_documents WHERE key='contents'")).rows[0].revision),revision);
}));

async function oldRestorePoints(storage,pool,{daily=14,manual=10,when='2026-10-01T00:00:00Z'}={}){
 const snapshot=await storage.snapshot();await pool.query('DELETE FROM app_backups');const rows=[];let i=0;
 for(const [kind,count] of [['daily',daily],['manual',manual]])for(let n=0;n<count;n++){
  const bundle={...structuredClone(snapshot.bundle),createdAt:new Date(Date.parse(when)+i++*1000).toISOString()},id=crypto.randomUUID(),digest=checksum(bundle);await pool.query('INSERT INTO app_backups(id,kind,digest,bundle,created_at) VALUES($1,$2,$3,$4::jsonb,$5)',[id,kind,digest,JSON.stringify(encodeBackup(bundle)),bundle.createdAt]);await fs.writeFile(path.join(storage.backupDir,id+'.json.gz'),'old mirror');rows.push({id,kind});
 }return rows;
}
test('startup disk-full rollback is followed by ordinary VACUUM and one verified retention retry',()=>setup(async({dir,storage,pool})=>{
 await storage.initialize(()=>seed(dir));await oldRestorePoints(storage,pool);await storage.mutate('contents',db=>{db.contents[0].script='Naskah terkini terlindungi';});
 const before=await pool.query('SELECT key,data,revision FROM app_documents ORDER BY key'),events=[];let failed=false;
 const wrapped={query:async(sql,args)=>{if(sql.startsWith('VACUUM'))events.push(sql);return pool.query(sql,args);},async connect(){const client=await pool.connect();return {...client,query:async(sql,args)=>{events.push(sql.split(' ')[0]);if(sql.startsWith('INSERT INTO app_backups')&&!failed){failed=true;throw Object.assign(Error('disk full'),{code:'53100'});}return client.query(sql,args);}};}};
 const restarted=new PostgresStorage(wrapped,{backupDir:storage.backupDir});await restarted.initialize(()=>{throw Error('no stale reseed');});
 assert.ok(events.indexOf('ROLLBACK')<events.indexOf('VACUUM (TRUNCATE ON) app_documents'));assert.equal(events.filter(s=>s==='VACUUM (TRUNCATE ON) app_documents').length,1);
 assert.deepEqual(await pool.query('SELECT key,data,revision FROM app_documents ORDER BY key'),before);assert.equal((await restarted.listBackups()).length,5);
 for(const row of await restarted.listBackups())await restarted.getBackup(row.id);
}));
test('persistent disk-full startup retries once and preserves all existing restore points and documents',()=>setup(async({dir,storage,pool})=>{
 await storage.initialize(()=>seed(dir));await oldRestorePoints(storage,pool);await storage.mutate('contents',db=>{db.contents[0].script='Tidak boleh hilang';});
 const before=await pool.query('SELECT key,data,revision FROM app_documents ORDER BY key');let inserts=0,vacuums=0;
 const wrapped={query:async(sql,args)=>{if(sql.startsWith('VACUUM'))vacuums++;return pool.query(sql,args);},async connect(){const client=await pool.connect();return {...client,query:async(sql,args)=>{if(sql.startsWith('INSERT INTO app_backups')){inserts++;throw Object.assign(Error('disk full'),{code:'53100'});}return client.query(sql,args);}};}};
 const restarted=new PostgresStorage(wrapped,{backupDir:storage.backupDir});await assert.rejects(restarted.initialize(()=>{throw Error('no reseed');}),{code:'53100'});
 assert.equal(inserts,2);assert.equal(vacuums,2);assert.equal((await storage.listBackups()).length,24);assert.deepEqual(await pool.query('SELECT key,data,revision FROM app_documents ORDER BY key'),before);
}));
test('old 24-copy policy is reduced to 3 daily and 2 manual only after a fresh full snapshot and gzip verification',()=>setup(async({dir,storage,pool})=>{
 await storage.initialize(()=>seed(dir));await oldRestorePoints(storage,pool);await storage.mutate('contents',db=>{db.contents[0].script='Perubahan terbaru wajib terlindungi';});const before=await pool.query('SELECT key,data,revision FROM app_documents ORDER BY key');
 const point=await storage.backup('manual',{onlyIfOverLimit:true});assert.equal(point.retention.removed,20);assert.equal(point.retention.remaining,5);assert.equal(point.retention.dailyCount,3);assert.equal(point.retention.manualCount,2);assert.equal(point.mirror,'ready');assert.equal(point.warning,null);assert.equal((await storage.getBackup(point.id)).bundle.documents.contents.contents[0].script,'Perubahan terbaru wajib terlindungi');
 const files=(await fs.readdir(storage.backupDir)).filter(n=>/^[a-f0-9-]{36}\.json\.gz$/.test(n));assert.equal(files.length,5);assert.deepEqual(await pool.query('SELECT key,data,revision FROM app_documents ORDER BY key'),before);for(const row of await storage.listBackups())await storage.getBackup(row.id);
 const restarted=new PostgresStorage(pool,{backupDir:storage.backupDir});await restarted.initialize(()=>{throw Error('no reseed');});assert.equal((await restarted.listBackups()).length,5);assert.equal((await restarted.read('contents')).contents[0].script,'Perubahan terbaru wajib terlindungi');
}));
test('failed volume verification and corrupt retained snapshots defer all pruning while preserving the fresh database backup',()=>setup(async({dir,storage,pool})=>{
 await storage.initialize(()=>seed(dir));const old=await oldRestorePoints(storage,pool),mirror=storage.writeBackupMirror.bind(storage);await storage.mutate('contents',db=>{db.contents[0].script='Perubahan terbaru';});storage.writeBackupMirror=async()=>{throw Error('disk unavailable');};const failed=await storage.backup('manual',{onlyIfOverLimit:true});assert.equal(failed.mirror,'error');assert.equal(failed.retention.removed,0);assert.equal((await storage.listBackups()).length,25);for(const row of old)await storage.getBackup(row.id);await storage.getBackup(failed.id);
 storage.writeBackupMirror=mirror;await pool.query('UPDATE app_backups SET digest=$2 WHERE id=$1',[old.filter(r=>r.kind==='daily').at(-1).id,'bad']);const guarded=await storage.backup('manual',{onlyIfOverLimit:true});assert.equal(guarded.retention.removed,0);assert.match(guarded.warning,/verifikasi/);assert.equal((await storage.listBackups()).length,25);assert.equal(guarded.id,failed.id);await storage.getBackup(guarded.id);
}));
test('automatic daily backup reuses identical content across dates but a changed script creates a new restore point',()=>setup(async({dir,storage})=>{
 let clock=Date.parse('2026-10-01T12:00:00Z');storage.now=()=>clock;await storage.initialize(()=>seed(dir));const initial=(await storage.listBackups())[0];clock+=86400000;const same=await storage.backup('daily');assert.equal(same.id,initial.id);assert.equal(same.unchanged,true);assert.equal((await storage.listBackups()).length,1);
 await storage.mutate('contents',db=>{db.storageBackup={lastVerifiedAt:'new status',bytes:123};});clock+=86400000;assert.equal((await storage.backup('daily')).id,initial.id);
 for(let i=0;i<5;i++){clock+=86400000;await storage.mutate('contents',db=>{db.contents[0].script='Narasi versi '+i;});const created=await storage.backup('daily');assert.equal(created.existing,false);await storage.getBackup(created.id);}assert.equal((await storage.listBackups()).length,3);
}));
test('new verified point stays protected when older backups have equal or future timestamps',()=>setup(async({dir,storage,pool})=>{
 storage.now=()=>Date.parse('2026-10-02T00:00:00Z');await storage.initialize(()=>seed(dir));await oldRestorePoints(storage,pool,{daily:3,manual:4,when:'2026-10-03T00:00:00Z'});const result=await storage.backup('manual',{onlyIfOverLimit:true});assert.equal(result.retention.remaining,5);await storage.getBackup(result.id);
}));
test('backup fingerprints ignore receipt bookkeeping but preserve account folder and actual data changes',()=>{
 const first={contents:{contents:[{script:'Utuh'}],storageBackup:{folderId:'one',lastAttemptAt:'old',contentDigest:'old'}}},next=structuredClone(first);next.contents.storageBackup.lastAttemptAt='new';next.contents.storageBackup.contentDigest='new';next.contents.storageBackup.md5Checksum='new';assert.equal(backupDataDigest(first),backupDataDigest(next));next.contents.storageBackup.folderId='two';assert.notEqual(backupDataDigest(first),backupDataDigest(next));next.contents.storageBackup.folderId='one';next.contents.contents[0].script+=' berubah';assert.notEqual(backupDataDigest(first),backupDataDigest(next));assert.equal(first.contents.storageBackup.lastAttemptAt,'old');
});
