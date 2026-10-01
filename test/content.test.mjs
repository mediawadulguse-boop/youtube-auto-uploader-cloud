import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import net from 'node:net';
import { ContentStore } from '../content-store.mjs';
let server, dir, base, cookie, logs='';
const wait=ms=>new Promise(r=>setTimeout(r,ms));
async function request(route,method='GET',body,authenticated=true){const r=await fetch(base+route,{method,headers:{'content-type':'application/json',...(authenticated?{cookie}:{})},body:body===undefined?undefined:JSON.stringify(body)});return {status:r.status,data:await r.json()};}
before(async()=>{
  dir=await fs.mkdtemp(path.join(os.tmpdir(),'yt-content-test-'));
  const reservation=net.createServer();await new Promise(r=>reservation.listen(0,'127.0.0.1',r));const port=reservation.address().port;await new Promise(r=>reservation.close(r));base=`http://127.0.0.1:${port}`;
  await fs.writeFile(path.join(dir,'db.json'),JSON.stringify({version:1,jobs:[{id:'11111111-1111-4111-8111-111111111111',title:'Legacy upload',status:'cancelled',createdAt:new Date().toISOString()}],channel:null}));
  server=spawn(process.execPath,['server.mjs'],{cwd:process.cwd(),env:{...process.env,PORT:String(port),APP_URL:base,APP_SECRET:'test-only-secret-with-at-least-32-characters',ADMIN_PASSWORD:'test-only-password',DATA_DIR:dir,GOOGLE_CLIENT_ID:'',GOOGLE_CLIENT_SECRET:'',WORKER_INTERVAL_MS:'600000'},stdio:['ignore','pipe','pipe']});
  server.stdout.on('data',b=>logs+=b);server.stderr.on('data',b=>logs+=b);
  for(let i=0;i<100;i++){try{if((await fetch(base+'/api/health')).ok)break;}catch{}await wait(50)}
  const r=await fetch(base+'/api/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({password:'test-only-password'})});assert.equal(r.status,200,logs);cookie=r.headers.get('set-cookie').split(';')[0];
});
after(async()=>{server?.kill();if(server)await new Promise(r=>server.exitCode!==null?r():server.once('exit',r));await fs.rm(dir,{recursive:true,force:true})});
test('CRUD, autosave revisions, research, restoration, duplicate and archive',async()=>{
  assert.equal((await request('/api/contents','GET',undefined,false)).status,401);
  let r=await request('/api/contents','POST',{title:'Netflix',script:'Opening\nData sebelum produksi',sources:[{label:'Laporan tahunan',url:'https://example.com/report',notes:'Angka dari laporan',verified:true}],plannedPublishAt:'2026-10-05T02:00:00.000Z'});assert.equal(r.status,201);let c=r.data.content;const id=c.id;
  r=await request('/api/contents/'+id,'PATCH',{revision:c.revision,stage:'script',script:'Script revisi'});assert.equal(r.status,200);c=r.data.content;assert.equal(c.revision,2);assert.equal(c.history[0].script,'Opening\nData sebelum produksi');
  assert.equal((await request('/api/contents/'+id,'PATCH',{revision:1,script:'Tab lama'})).status,409);
  r=await request('/api/contents/'+id,'PATCH',{revision:c.revision,restoreRevision:1});assert.equal(r.status,200);c=r.data.content;assert.equal(c.script,'Opening\nData sebelum produksi');assert.equal(c.sources[0].verified,true);
  const unchanged=await request('/api/contents/'+id,'PATCH',{revision:c.revision,title:c.title});assert.equal(unchanged.data.content.revision,c.revision);
  const summary=await request('/api/contents');assert.equal(summary.data.contents[0].script,undefined);assert.ok(summary.data.contents[0].scriptLength>0);
  const copy=await request('/api/contents/'+id+'/duplicate','POST',{});assert.equal(copy.status,201);assert.notEqual(copy.data.content.id,id);assert.equal(copy.data.content.script,c.script);assert.equal(copy.data.content.plannedPublishAt,null);assert.deepEqual(copy.data.content.history,[]);
  r=await request('/api/contents/'+id,'PATCH',{revision:c.revision,archived:true});c=r.data.content;assert.equal(c.archived,true);
  assert.equal((await request('/api/contents/'+id,'DELETE',{revision:c.revision})).status,200);assert.equal((await request('/api/contents/'+id)).status,404);
});
test('concurrent writes retain every content and reject competing edits',async()=>{
  const creates=await Promise.all(Array.from({length:12},(_,i)=>request('/api/contents','POST',{title:'Parallel '+i})));assert.ok(creates.every(r=>r.status===201));const listing=(await request('/api/contents')).data.contents;assert.equal(listing.filter(c=>c.title.startsWith('Parallel ')).length,12);
  const c=creates[0].data.content;const saves=await Promise.all(['A','B'].map(script=>request('/api/contents/'+c.id,'PATCH',{revision:c.revision,script})));assert.deepEqual(saves.map(r=>r.status).sort(),[200,409]);
});
test('validation preserves data, pillars and authenticated static assets',async()=>{
  assert.equal((await request('/api/contents','POST',{title:''})).status,400);
  assert.equal((await request('/api/contents','POST',{title:'Bad URL',sources:[{url:'javascript:alert(1)'}]})).status,400);
  assert.equal((await request('/api/contents','POST',{title:'Bad date',deadline:'invalid'})).status,400);
  const p=await request('/api/pillars','POST',{name:'Bisnis',color:'#123456'});assert.equal(p.status,200);
  assert.equal((await request('/api/contents','POST',{title:'Bisnis baru',pillarId:p.data.pillar.id})).status,201);
  assert.equal((await request('/api/pillars','POST',{name:'Unsafe',color:'red;display:none'})).status,400);
  assert.equal((await fetch(base+'/content.css')).status,200);assert.equal((await fetch(base+'/content.js')).status,200);
});
test('upload linking prevents duplicate jobs and locks the YouTube schedule',async()=>{
  const c=(await request('/api/contents','POST',{title:'Video terhubung',plannedPublishAt:'2026-10-10T02:00:00Z'})).data.content;
  const body={contentId:c.id,title:c.title,fileName:'final.mp4',fileSize:4,scheduledAt:new Date(Date.now()+3600000).toISOString()};
  const jobs=await Promise.all([request('/api/jobs','POST',body),request('/api/jobs','POST',body)]);assert.deepEqual(jobs.map(r=>r.status).sort(),[201,409]);const j=jobs.find(r=>r.status===201).data.job;assert.equal(j.contentId,c.id);
  assert.equal((await request('/api/contents/'+c.id,'PATCH',{revision:c.revision,plannedPublishAt:'2026-10-11T02:00:00Z'})).status,409);
  assert.equal((await request('/api/contents/'+c.id,'PATCH',{revision:c.revision,script:'Boleh memperbarui script'})).status,200);
  assert.equal((await request('/api/contents/'+c.id,'DELETE',{revision:2})).status,409);
  const upload=await fetch(base+`/api/jobs/${j.id}/chunk`,{method:'PUT',headers:{cookie,'content-type':'application/octet-stream','x-upload-offset':'0'},body:Buffer.from('test')});assert.equal(upload.status,200);assert.equal((await upload.json()).job.status,'queued_upload');
  assert.equal((await request(`/api/jobs/${j.id}/cancel`,'POST',{})).status,200);
  assert.equal((await request('/api/contents/'+c.id,'PATCH',{revision:2,plannedPublishAt:'2026-10-11T02:00:00Z'})).status,200);
  assert.ok((await request('/api/state')).data.jobs.some(j=>j.title==='Legacy upload'));
});
test('persisted scripts survive reload; corrupted files are never replaced',async()=>{
  const file=path.join(dir,'standalone.json');let store=new ContentStore(file);const c=await store.create({title:'Persist',script:'Naskah panjang\n🌟',sources:[{label:'Data',notes:'123',verified:true}]});store=new ContentStore(file);assert.equal((await store.read()).contents[0].script,c.script);
  const corrupt=path.join(dir,'corrupt.json');await fs.writeFile(corrupt,'{broken');const bad=new ContentStore(corrupt);await assert.rejects(bad.read(),e=>e.status===503);assert.equal(await fs.readFile(corrupt,'utf8'),'{broken');
  const broken=new ContentStore(path.join(dir,'write-failure.json'));const write=fs.writeFile;let first=true;fs.writeFile=async(...args)=>{if(first){first=false;throw Error('Disk error')}return write(...args)};try{await assert.rejects(broken.create({title:'Unsaved'}));}finally{fs.writeFile=write}assert.equal((await broken.read()).contents.length,0);await broken.create({title:'Recovered'});assert.equal((await broken.read()).contents[0].title,'Recovered');
});
