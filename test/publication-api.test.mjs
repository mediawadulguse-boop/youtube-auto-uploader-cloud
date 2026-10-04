import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import net from 'node:net';
import {spawn} from 'node:child_process';
import {ContentStore} from '../content-store.mjs';
const secret='publication-test-secret-32-character-minimum',a='abcdefghijk';
async function setup(revoked,fn){
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'publication-api-')),reservation=net.createServer();let server,logs='';
 try{
  await new Promise(r=>reservation.listen(0,'127.0.0.1',r));const port=reservation.address().port;await new Promise(r=>reservation.close(r));const base='http://127.0.0.1:'+port;
  const store=new ContentStore(path.join(dir,'contents.json')),content=await store.create({title:'Data dari naskah',script:'Laporan perusahaan mencatat pendapatan Rp2 miliar pada 2025. Menurut perusahaan, anggaran tersebut digunakan untuk pengembangan layanan.'});
  await fs.writeFile(path.join(dir,'db.json'),JSON.stringify({version:1,channel:{id:'UC-test',title:'Test channel'},jobs:revoked?[{id:'11111111-1111-4111-8111-111111111111',contentId:content.id,title:'Failed legacy',status:'failed',error:'OAuth token gagal (400): Token has been expired or revoked.',createdAt:new Date().toISOString(),receivedBytes:10,fileSize:10}]:[]}));
  const token={access_token:'test-access',refresh_token:'test-refresh',scope:'https://www.googleapis.com/auth/youtube.force-ssl',expires_at:revoked?1:Date.now()+3600000},iv=crypto.randomBytes(12),cipher=crypto.createCipheriv('aes-256-gcm',crypto.createHash('sha256').update(secret).digest(),iv),bytes=Buffer.concat([cipher.update(JSON.stringify(token)),cipher.final()]);
  await fs.writeFile(path.join(dir,'youtube-token.enc.json'),JSON.stringify({iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64'),data:bytes.toString('base64')}));
  const calls=path.join(dir,'calls.txt'),status=path.join(dir,'status.json');await fs.writeFile(calls,'');await fs.writeFile(status,'{}');
  server=spawn(process.execPath,['--import',path.resolve('test/fixtures/publication-fetch.mjs'),'server.mjs'],{env:{...process.env,PORT:String(port),APP_URL:base,APP_SECRET:secret,ADMIN_PASSWORD:'test-password',DATA_DIR:dir,GOOGLE_CLIENT_ID:'test-client',GOOGLE_CLIENT_SECRET:'test-secret',WORKER_INTERVAL_MS:'600000',PUBLICATION_TEST_CALLS:calls,PUBLICATION_TEST_STATUS:status},stdio:['ignore','pipe','pipe']});server.stdout.on('data',b=>logs+=b);server.stderr.on('data',b=>logs+=b);
  let ready=false;for(let i=0;i<100;i++){try{if((await fetch(base+'/api/health')).ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,30));}assert.ok(ready,logs);
  const login=await fetch(base+'/api/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({password:'test-password'})});assert.equal(login.status,200);const cookie=login.headers.get('set-cookie').split(';')[0];
  const request=async(url,body)=>{const r=await fetch(base+url,{method:body?'POST':'GET',headers:{cookie,'content-type':'application/json'},body:body?JSON.stringify(body):undefined});return {status:r.status,data:await r.json()};};
  await fn({request,content,dir,calls,status,base});
 }finally{server?.kill();if(server&&server.exitCode===null)await new Promise(r=>server.once('exit',r));await fs.rm(dir,{recursive:true,force:true});}
}
test('expired refresh token is recognized once and remains disconnected after reload; uploads require reconnection',()=>setup(true,async({request,calls,content,dir})=>{
 for(let i=0;i<3;i++){const result=await request('/api/state');assert.equal(result.status,200);assert.equal(result.data.youtubeConnected,false);assert.equal(result.data.youtubeAuth,'reconnect_required');assert.ok(!JSON.stringify(result.data).includes('test-refresh'));}
 assert.equal((await fs.readFile(calls,'utf8')).trim(),'refresh');
 const upload=await request('/api/jobs',{fileName:'a.mp4',fileSize:10,scheduledAt:'2026-10-10T00:00:00Z'});assert.equal(upload.status,401);assert.match(upload.data.error,/Hubungkan ulang/);
 const current=(await request('/api/contents/'+content.id)).data.content;assert.match(current.description,/Rp2 miliar/);assert.equal(current.script,content.script);assert.equal(current.history[0].description,'');assert.ok((await fs.stat(path.join(dir,'contents.before-engine-v1.backup.json'))).size>0);
}));
test('manual publication API validates ownership, stale versions, actual visibility and duplicate links without uploading',()=>setup(false,async({request,content,status,base})=>{
 let c=(await request('/api/contents/'+content.id)).data.content;
 assert.equal((await fetch(base+'/api/contents/'+c.id+'/publication',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({revision:c.revision,video:a})})).status,401);
 assert.equal((await request('/api/contents/'+c.id+'/publication',{revision:c.revision,video:'xxxxxxxxxxx'})).status,404);
 assert.equal((await request('/api/contents/'+c.id+'/publication',{revision:0,video:a})).status,409);
 let r=await request('/api/contents/'+c.id+'/publication',{revision:c.revision,video:'https://youtu.be/'+a});assert.equal(r.status,200);c=r.data.content;assert.equal(c.youtubePublication.status,'published');assert.equal(c.youtubeVideoId,a);
 const revision=c.revision,historyLength=c.history.length;
 await fs.writeFile(status,JSON.stringify({[a]:{privacyStatus:'private',uploadStatus:'processed',publishAt:'2026-10-10T00:00:00Z'}}));r=await request('/api/contents/'+c.id+'/publication',{revision:c.revision});assert.equal(r.status,200);c=r.data.content;assert.equal(c.youtubePublication.status,'scheduled_youtube');assert.equal(c.youtubePublication.scheduledAt,'2026-10-10T00:00:00Z');assert.equal(c.revision,revision);assert.equal(c.history.length,historyLength);
 const other=(await request('/api/contents',{title:'Other'})).data.content;assert.equal((await request('/api/contents/'+other.id+'/publication',{revision:other.revision,video:a})).status,409);
 const summary=(await request('/api/contents')).data.contents.find(row=>row.id===c.id);assert.equal(summary.youtubePublication.status,'scheduled_youtube');assert.equal((await request('/api/state')).data.jobs.length,0);
 const job=await request('/api/jobs',{contentId:other.id,fileName:'video.mp4',fileSize:10,title:'Other',scheduledAt:'2030-10-10T00:00:00Z'});assert.equal(job.status,201);
 assert.equal((await request('/api/contents/'+other.id+'/publication',{revision:other.revision,video:'lmnopqrstuv'})).status,409);
 const preview=await request('/api/contents/engine-preview',{title:'Preview',script:content.script,description:'Manual description'});assert.equal(preview.status,200);assert.equal(preview.data.usesAI,false);assert.equal(preview.data.fields.description,undefined);assert.ok(preview.data.fields.tags);
 assert.equal((await request('/api/contents/engine-preview',{title:'Bad',sources:[{notes:42}]})).status,400);
}));
