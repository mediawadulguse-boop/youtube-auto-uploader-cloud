import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import vm from 'node:vm';
import {PGlite} from '@electric-sql/pglite';
import {databaseUsage,backupUsage,volumeUsage} from '../storage-usage.mjs';

test('usage aggregates UTF-8 bytes without exposing text, overlapping AI/reports or changing data',async()=>{
 const db=new PGlite();try{
  await db.exec('CREATE TABLE app_documents(key text PRIMARY KEY,data jsonb)');
  const documents={contents:{contents:[{title:'Private title',script:'Naskah rahasia 🌟',history:[{script:'Versi lama'}]}],columns:[{id:'idea'}],pillars:[],radar:{issues:[{sources:[{excerpt:'Rahasia sumber'}]}],channels:[],aiCache:[{result:'Rahasia AI'}],aiHistory:[],promptLibrary:[{prompt:'Rahasia prompt'}],reportArchive:[{text:'Rahasia laporan'}]}},notes:{notes:[{body:'Catatan rahasia'}],categories:[]},analytics:{channels:{one:{videos:{a:{views:5}}}}},uploads:{jobs:[{id:'upload'}]}};
  for(const [key,data] of Object.entries(documents))await db.query('INSERT INTO app_documents VALUES($1,$2::jsonb)',[key,JSON.stringify(data)]);
  const before=await db.query('SELECT * FROM app_documents ORDER BY key'),usage=await databaseUsage(db),byId=Object.fromEntries(usage.categories.map(c=>[c.id,c]));
  assert.equal(usage.available,true);assert.equal(usage.categories.length,8);assert.equal(usage.totalBytes,usage.categories.reduce((n,c)=>n+c.bytes,0));assert.equal(byId.production.items,1);assert.equal(byId.ai.items,2);assert.equal(byId.reports.items,1);assert.equal(byId.analytics.items,1);
  const size=(await db.query("SELECT octet_length((data->'contents')::text) AS bytes FROM app_documents WHERE key='contents'")).rows[0].bytes;assert.equal(byId.production.bytes,size);assert.ok(!JSON.stringify(usage).includes('Rahasia'));assert.deepEqual(await db.query('SELECT * FROM app_documents ORDER BY key'),before);
  await db.query("UPDATE app_documents SET data=jsonb_set(data,'{radar,aiCache}', $1::jsonb) WHERE key='contents'",[JSON.stringify([{result:'Lebih panjang '.repeat(100)}])]);
  const after=Object.fromEntries((await databaseUsage(db)).categories.map(c=>[c.id,c]));assert.equal(after.radar.bytes,byId.radar.bytes);assert.equal(after.production.bytes,byId.production.bytes);assert.ok(after.ai.bytes>byId.ai.bytes);
 }finally{await db.close();}
});

test('volume counts separate copies and videos without reading credentials or following symlinks',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'storage-usage-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 await fs.mkdir(path.join(dir,'uploads'));await fs.mkdir(path.join(dir,'backups','migration-one'),{recursive:true});
 for(const [name,bytes] of [['uploads/video.mp4',25],['backups/copy.json.gz',10],['backups/migration-one/notes.json',8],['contents.before-engine.backup.json',7],['db.json',6],['youtube-token.enc.json',5],['other.bin',4]])await fs.writeFile(path.join(dir,name),Buffer.alloc(bytes));
 await fs.symlink(path.join(dir,'uploads'),path.join(dir,'outside-link'));
 const usage=await volumeUsage(dir),categories=Object.fromEntries(usage.categories.map(c=>[c.id,c]));
 assert.equal(usage.totalFileBytes,65);assert.equal(categories.videos.bytes,25);assert.equal(categories.backups.bytes,18);assert.equal(categories.credentials.bytes,5);assert.equal(categories.legacy.bytes,7);assert.equal(usage.partial,true);assert.ok(usage.capacity.totalBytes>0);assert.ok(!JSON.stringify(usage).includes('token.enc'));
 const backup=backupUsage([{kind:'daily',storedBytes:8},{kind:'manual',storedBytes:12,fileBytes:10}]);assert.equal(backup.storedBytes,20);assert.equal(backup.count,2);assert.deepEqual(backup.kinds.map(k=>k.bytes),[8,12]);
});

test('usage UI labels separate byte bases, handles unknown capacity and clamps progress without leaking markup',async()=>{
 const source=await fs.readFile('public/storage.js','utf8'),context={esc:s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;'),storageDate:()=> '6 Okt 2026 WIB'};vm.createContext(context);vm.runInContext(source.slice(source.indexOf('const storageCategoryInfo=')),context);
 const data={usage:{available:true,totalBytes:110,categories:[{id:'production',bytes:100,items:1},{id:'ai',bytes:10,items:2}],backups:{count:1,storedBytes:9,kinds:[{kind:'daily',count:1,bytes:9}]}},capacity:{estimateBytes:200,budgetBytes:100,level:'critical'},volume:{capacity:{usedBytes:20,totalBytes:100,availableBytes:80},categories:[{id:'videos',bytes:10,items:1}],totalFileBytes:10,partial:true},drive:{connected:true,lastVerifiedAt:'date',bytes:8}};
 const app=context.storageUsageMarkup(data);assert.match(app,/Naskah &amp; produksi/);assert.match(app,/sebelum kompresi/);assert.match(app,/stroke-dasharray="100 100"/);assert.match(app,/200%/);assert.match(app,/Melampaui|melampaui/);assert.match(app,/Sisa anggaran<\/dt><dd>0 B/);assert.ok(!app.includes('width:200%'));
 const files=context.storageUsageMarkup(data,'files');assert.match(files,/Backup Drive terakhir/);assert.match(files,/bukan seluruh akun/);assert.match(files,/Pemindaian belum lengkap/);
 const unknown=context.storageUsageMarkup({usage:{available:false,error:'<unsafe>'},capacity:{},volume:{}});assert.match(unknown,/&lt;unsafe>/);assert.ok(!unknown.includes('NaN'));assert.ok(!unknown.includes('aria-valuenow="0"'));assert.ok(!unknown.includes('stroke-dasharray='));assert.match(unknown,/Persentase penggunaan database belum tersedia/);assert.equal(context.storageBytes(null),'—');assert.equal(context.storageBytes(0),'0 B');
 const empty=context.storageDatabaseDonut({estimateBytes:0,budgetBytes:100});assert.match(empty,/0%/);assert.match(empty,/Sisa anggaran<\/dt><dd>100 B/);
 const half=context.storageDatabaseDonut({estimateBytes:50,budgetBytes:100});assert.match(half,/stroke-dasharray="50 100"/);assert.match(half,/50%/);assert.match(half,/Sisa anggaran<\/dt><dd>50 B/);
});

test('backup pagination shows five copies, retains all entries and clamps page after the list shrinks',async()=>{
 const source=await fs.readFile('public/storage.js','utf8'),context={esc:s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;'),storageDate:()=> '6 Okt 2026 WIB'};vm.createContext(context);vm.runInContext(source.slice(source.indexOf('const storageCategoryInfo=')),context);
 const backups=Array.from({length:16},(_,i)=>({id:'backup-'+i,createdAt:'date',kind:'daily',fileBytes:1024}));
 const first=context.storageBackupPage(backups,1),last=context.storageBackupPage(backups,4);assert.equal(first.items.length,5);assert.equal(first.items[0].id,'backup-0');assert.equal(first.end,5);assert.equal(last.items.length,1);assert.equal(last.start,16);assert.equal(last.pages,4);assert.equal(backups.length,16);
 const firstMarkup=context.storageBackupsMarkup(first);assert.equal((firstMarkup.match(/data-download-backup=/g)||[]).length,5);assert.match(firstMarkup,/Halaman sebelumnya" disabled/);assert.match(firstMarkup,/aria-current="page"/);assert.match(firstMarkup,/Menampilkan 1–5 dari 16/);
 assert.match(context.storageBackupsMarkup(last),/Halaman berikutnya" disabled/);assert.equal(context.storageBackupPage(backups.slice(0,6),4).page,2);assert.equal(context.storageBackupPage(backups,NaN).page,1);assert.equal(context.storageBackupPage(backups,-1).page,1);assert.equal(context.storageBackupPage(backups,2).items[0].id,'backup-5');assert.match(context.storageBackupsMarkup(context.storageBackupPage([],4)),/Belum ada backup/);
});
