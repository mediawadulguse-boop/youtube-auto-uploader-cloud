import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import {spawn} from 'node:child_process';
import {ContentStore} from '../content-store.mjs';
import {RadarStore} from '../radar-store.mjs';
test('server backs up legacy imports before grouping; authenticated Radar exposes ranked groups with original sources',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'radar-api-')),reservation=net.createServer();await new Promise(r=>reservation.listen(0,'127.0.0.1',r));const port=reservation.address().port;await new Promise(r=>reservation.close(r));const base='http://127.0.0.1:'+port;
 const content=new ContentStore(path.join(dir,'contents.json')),radar=new RadarStore(content);
 for(let n=1;n<=3;n++)await radar.addSources([{title:'Pemerintah Naikkan Pajak PPN 12 Persen pada 2026',url:`https://publisher${n}.example/pajak`,publisher:'Media '+n,publishedAt:new Date(Date.now()-3600000).toISOString()}]);
 await radar.mutate(r=>{const i=r.issues[0];delete r.clusteringVersion;r.issues=i.sources.map((source,n)=>({...structuredClone(i),id:'legacy-'+n,sources:[source],revision:1}));});const before=await content.read();
 const server=spawn(process.execPath,['server.mjs'],{cwd:process.cwd(),env:{...process.env,PORT:String(port),APP_URL:base,DATA_DIR:dir,DATABASE_URL:'',APP_SECRET:'local-only-secret-at-least-32-characters',ADMIN_PASSWORD:'local-only-password',GOOGLE_CLIENT_ID:'',GOOGLE_CLIENT_SECRET:'',RADAR_AUTO_SYNC:'false',AI_PROVIDER:'gemini',GEMINI_API_KEY:'',GEMINI_MODEL:'',OPENAI_API_KEY:'',OPENAI_MODEL:'',GROQ_API_KEY:'',GROQ_MODEL:'',AI_SMOKE_ONCE:'',WORKER_INTERVAL_MS:'600000'},stdio:['ignore','pipe','pipe']});let logs='';server.stdout.on('data',b=>logs+=b);server.stderr.on('data',b=>logs+=b);
 t.after(async()=>{server.kill();if(server.exitCode===null)await new Promise(r=>server.once('exit',r));await fs.rm(dir,{recursive:true,force:true});});
 for(let i=0;i<100;i++){try{if((await fetch(base+'/api/health')).ok)break;}catch{}await new Promise(r=>setTimeout(r,50));}
 assert.equal((await fetch(base+'/api/radar')).status,401);assert.equal((await fetch(base+'/api/radar/digest')).status,401);
 const login=await fetch(base+'/api/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({password:'local-only-password'})});assert.equal(login.status,200,logs);const cookie=login.headers.get('set-cookie').split(';')[0];
 const request=(route,body)=>fetch(base+route,{headers:{cookie,'content-type':'application/json'},...(body?{method:'POST',body:JSON.stringify(body)}:{})});
 const data=await request('/api/radar').then(r=>r.json());assert.equal(data.methodology.version,3);assert.equal(data.issues.length,1);assert.equal(data.hotIssues.length,1);assert.equal(data.rankedIssueIds.length,1);assert.equal(data.hotIssues[0].stats.rating,4);assert.equal(data.hotIssues[0].sources.length,3);
 assert.deepEqual(JSON.parse(await fs.readFile(path.join(dir,'contents.radar-v1.backup.json'),'utf8')),before);assert.equal((await request('/api/contents').then(r=>r.json())).contents.length,0);
 const digest=await request('/api/radar/digest?period=weekly').then(r=>r.json());assert.equal(digest.timeZone,'Asia/Jakarta');assert.equal(digest.sourceCount,3);assert.equal((await request('/api/radar/digest?period=monthly')).status,400);assert.equal((await request('/api/radar/digest?date=2026-02-30')).status,400);
 const manual=await request('/api/radar/sources',{title:'Referensi produksi',url:'https://notes.example/source',coverage:'manual'});assert.equal(manual.status,201);const next=await request('/api/radar').then(r=>r.json());assert.equal(next.hotIssues.length,1);assert.ok(next.issues.some(i=>i.status==='saved'&&i.title==='Referensi produksi'));
 assert.equal((await request('/api/radar/sources',{title:'',url:'https://empty.example/source'})).status,400);assert.equal((await request('/api/radar').then(r=>r.json())).issues.length,2);
 const group=next.issues.find(i=>i.id===next.rankedIssueIds[0]),split=await request('/api/radar/issues/'+group.id+'/split',{revision:group.revision,title:'Pajak PPN sumber terpisah',sourceIds:[group.sources[0].id]});assert.equal(split.status,201);const result=await split.json();
 const after=await request('/api/radar').then(r=>r.json());assert.equal(after.rankedIssueIds.length,2);assert.equal(after.issues.find(i=>i.id===result.issueId).sources.length,1);assert.equal((await request('/api/radar/issues/'+group.id+'/split',{revision:group.revision,title:'Usang',sourceIds:[group.sources[1].id]})).status,409);
});
