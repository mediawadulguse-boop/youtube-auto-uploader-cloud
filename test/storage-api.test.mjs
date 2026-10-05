import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import {spawn} from 'node:child_process';
import {gunzipSync} from 'node:zlib';
import {checksum} from '../postgres-store.mjs';
import {APP_VERSION,RELEASES} from '../releases.mjs';
let dir,server,base,cookie,logs='';
before(async()=>{
 dir=await fs.mkdtemp(path.join(os.tmpdir(),'storage-api-'));const reservation=net.createServer();await new Promise(r=>reservation.listen(0,'127.0.0.1',r));const port=reservation.address().port;await new Promise(r=>reservation.close(r));base='http://127.0.0.1:'+port;
 const preload=path.join(dir,'preload.mjs');await fs.writeFile(preload,`import {PGlite} from ${JSON.stringify(path.resolve('node_modules/@electric-sql/pglite/dist/index.js'))};import {PostgresStorage} from ${JSON.stringify(path.resolve('postgres-store.mjs'))};
 PostgresStorage.connect=async(_url,options)=>{const db=new PGlite();let tail=Promise.resolve();const query=(sql,args)=>!args&&sql.includes(';')?db.exec(sql).then(()=>({rows:[]})):db.query(sql,args);const pool={query,async connect(){const prior=tail;let release;tail=new Promise(r=>release=r);await prior;return {query,release}},end:()=>db.close()};return new PostgresStorage(pool,options)};`);
 server=spawn(process.execPath,['--import',preload,'server.mjs'],{cwd:process.cwd(),env:{...process.env,PORT:String(port),APP_URL:base,DATA_DIR:dir,DATABASE_URL:'test-only-pglite',APP_SECRET:'test-local-only-secret-at-least-32-characters',ADMIN_PASSWORD:'storage-test-password',GOOGLE_CLIENT_ID:'',GOOGLE_CLIENT_SECRET:'',WORKER_INTERVAL_MS:'600000',BACKUP_EXPORT_TOKEN:'transfer-test-only-token-xxxxxxxxxxxxxxxx',BACKUP_EXPORT_UNTIL:new Date(Date.now()+900000).toISOString()},stdio:['ignore','pipe','pipe']});server.stdout.on('data',b=>logs+=b);server.stderr.on('data',b=>logs+=b);
 for(let i=0;i<200;i++){try{if((await fetch(base+'/api/health')).ok)break}catch{}await new Promise(r=>setTimeout(r,50))}
 const login=await fetch(base+'/api/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({password:'storage-test-password'})});assert.equal(login.status,200,logs);cookie=login.headers.get('set-cookie').split(';')[0];
});
after(async()=>{server?.kill();if(server)await new Promise(r=>server.exitCode!==null?r():server.once('exit',r));await fs.rm(dir,{recursive:true,force:true})});
const get=route=>fetch(base+route,{headers:{cookie}});
test('storage and release APIs remain private; active version matches package and shipped history',async()=>{
 for(const route of ['/api/storage','/api/releases'])assert.equal((await fetch(base+route)).status,401);
 const health=await fetch(base+'/api/health').then(r=>r.json());assert.equal(health.version,APP_VERSION);assert.equal(health.storage,'postgresql');
 const history=await get('/api/releases').then(r=>r.json());assert.equal(history.currentVersion,APP_VERSION);assert.equal(history.releases[0].version,APP_VERSION);assert.ok(history.releases.some(r=>r.version==='4.6.0'));assert.ok(RELEASES.every(r=>r.changes.length&&r.changes.every(c=>['feature','fix'].includes(c.type))));const pkg=JSON.parse(await fs.readFile('package.json','utf8'));assert.equal(pkg.version,APP_VERSION);
 for(const file of ['/updates.js','/storage.css'])assert.equal((await fetch(base+file)).status,200);
});
test('parallel backup requests create one manual restore point and return cooldown; gzip download verifies data',async()=>{
 const results=await Promise.all([1,2].map(()=>fetch(base+'/api/storage/backups',{method:'POST',headers:{cookie,'content-type':'application/json'},body:'{}'})));assert.deepEqual(results.map(r=>r.status).sort(),[201,429]);
 const backup=await results.find(r=>r.status===201).json(),limited=await results.find(r=>r.status===429).json();assert.ok(limited.retryAfter>0);assert.equal(backup.mirror,'ready');
 const status=await get('/api/storage').then(r=>r.json());assert.equal(status.backups.filter(b=>b.kind==='manual').length,1);assert.ok(status.manualAvailableAt);assert.equal(status.backupWarning,null);
 const download=await get('/api/storage/backups/'+backup.id);assert.equal(download.status,200);assert.equal(download.headers.get('content-type'),'application/gzip');const {digest,...bundle}=JSON.parse(gunzipSync(Buffer.from(await download.arrayBuffer())));assert.equal(digest,checksum(bundle));assert.ok(bundle.documents.notes);
 assert.equal((await get('/api/storage/backups/00000000-0000-4000-8000-000000000000')).status,404);
});

test('export capability is scoped to read-only backup; storage policies stay private and Drive failures protect data',async()=>{
 const headers={authorization:'Bearer transfer-test-only-token-xxxxxxxxxxxxxxxx'};assert.equal((await fetch(base+'/api/storage',{headers})).status,401);assert.equal((await fetch(base+'/api/storage/transfer')).status,401);assert.equal((await fetch(base+'/api/storage/transfer',{method:'POST',headers})).status,401);
 const response=await fetch(base+'/api/storage/transfer',{headers});assert.equal(response.status,200);const {digest,...bundle}=JSON.parse(gunzipSync(Buffer.from(await response.arrayBuffer())));assert.equal(checksum(bundle),digest);
 const status=await get('/api/storage').then(r=>r.json());assert.equal(status.drive.connected,false);assert.equal(status.retention.days,14);assert.ok(status.capacity);
 const invalid=await fetch(base+'/api/storage/retention',{method:'PATCH',headers:{cookie,'content-type':'application/json'},body:JSON.stringify({enabled:true,days:30,revision:1})});assert.equal(invalid.status,400);
 const configured=await fetch(base+'/api/storage/retention',{method:'PATCH',headers:{cookie,'content-type':'application/json'},body:JSON.stringify({enabled:true,days:7,revision:1})});assert.equal(configured.status,200);assert.equal((await configured.json()).days,7);
});
