import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import {spawn} from 'node:child_process';

test('settings status is private, read-only and does not contact providers or expose credential values',async t=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'preferences-api-')),reservation=net.createServer();
  await new Promise(r=>reservation.listen(0,'127.0.0.1',r));const port=reservation.address().port;await new Promise(r=>reservation.close(r));
  const base='http://127.0.0.1:'+port,secret='synthetic-settings-key-must-not-be-returned';
  const preload=path.join(dir,'preload.mjs');await fs.writeFile(preload,"globalThis.fetch=()=>{throw Error('Unexpected provider request during status read')};");
  await fs.writeFile(path.join(dir,'db.json'),JSON.stringify({version:1,jobs:[],channel:null,youtubeConnection:{state:'error',code:'test_error',message:'Check failed',checkedAt:'2026-10-09T10:00:00Z',internalSecret:secret},internalSecret:secret}));
  const server=spawn(process.execPath,['--import',preload,'server.mjs'],{env:{...process.env,PORT:String(port),APP_URL:base,DATA_DIR:dir,DATABASE_URL:'',APP_SECRET:'local-settings-only-secret-at-least-32-chars',ADMIN_PASSWORD:'settings-test',GOOGLE_CLIENT_ID:'',GOOGLE_CLIENT_SECRET:'',AI_PROVIDER:'openai',OPENAI_API_KEY:secret,OPENAI_MODEL:'gpt-4.1-mini',GEMINI_API_KEY:'',GROQ_API_KEY:'',AI_SMOKE_ONCE:'',RADAR_AUTO_SYNC:'false',WORKER_INTERVAL_MS:'600000'},stdio:['ignore','pipe','pipe']});
  let logs='';server.stdout.on('data',b=>logs+=b);server.stderr.on('data',b=>logs+=b);
  t.after(async()=>{server.kill();if(server.exitCode===null)await new Promise(r=>server.once('exit',r));await fs.rm(dir,{recursive:true,force:true});});
  for(let n=0;n<100;n++){try{if((await fetch(base+'/api/health')).ok)break;}catch{}await new Promise(r=>setTimeout(r,50));}
  for(const [asset,type] of [['/preferences.js','text/javascript'],['/preferences.css','text/css'],['/radar-trends.js','text/javascript']]){const response=await fetch(base+asset);assert.equal(response.status,200);assert.ok(response.headers.get('content-type').startsWith(type));assert.ok((await response.text()).length>100);}
  const endpoints=['/api/settings/connections','/api/radar/ai/status','/api/radar/focus','/api/radar/trends'];
  for(const endpoint of endpoints)assert.equal((await fetch(base+endpoint)).status,401);
  const login=await fetch(base+'/api/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({password:'settings-test'})});assert.equal(login.status,200,logs);
  const headers={cookie:login.headers.get('set-cookie').split(';')[0]},before=await fs.readFile(path.join(dir,'contents.json'),'utf8');
  const connections=await fetch(base+endpoints[0],{headers});assert.equal(connections.status,200);assert.equal(connections.headers.get('cache-control'),'no-store');
  const text=await connections.text();assert.ok(!text.includes(secret));const status=JSON.parse(text);
  assert.equal(status.youtube.connected,false);assert.equal(status.youtube.auth,'not_connected');assert.equal(status.youtube.connection.state,'error');assert.equal(status.analytics.authorized,false);
  for(let n=0;n<2;n++){const response=await fetch(base+endpoints[1],{headers});assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');const text=await response.text();assert.ok(!text.includes(secret));const ai=JSON.parse(text);assert.equal(ai.configured,true);assert.equal(ai.connection.state,'unchecked');assert.equal(ai.used,0);assert.ok(!('issues' in ai));}
  const groq=await fetch(base+endpoints[1]+'?provider=groq',{headers}).then(r=>r.json());assert.equal(groq.providerId,'groq');assert.equal(groq.configured,false);
  assert.equal((await fetch(base+endpoints[1]+'?provider=invalid',{headers})).status,400);
  assert.equal(await fs.readFile(path.join(dir,'contents.json'),'utf8'),before);
  assert.ok(!logs.includes('Unexpected provider request'));
  const trends=await fetch(base+'/api/radar/trends?period=24',{headers});assert.equal(trends.status,200);assert.equal(trends.headers.get('cache-control'),'no-store');assert.equal((await trends.json()).sourceCount,0);assert.equal(await fs.readFile(path.join(dir,'contents.json'),'utf8'),before);assert.equal((await fetch(base+'/api/radar/trends?period=72',{headers})).status,400);
  const radar=await fetch(base+'/api/radar',{headers}).then(r=>r.json());assert.equal(radar.focus.mode,'controversy');assert.equal(radar.topics.filter(t=>t.id.startsWith('focus-')).length,4);
  const setFocus=(body)=>fetch(base+'/api/radar/focus',{method:'PATCH',headers:{...headers,'content-type':'application/json'},body:JSON.stringify(body)});
  assert.equal((await setFocus({mode:'general',revision:1})).status,200);assert.equal((await setFocus({mode:'controversy',revision:1})).status,409);assert.equal((await setFocus({mode:'invalid',revision:2})).status,400);
  assert.equal((await fetch(base+'/api/radar',{headers}).then(r=>r.json())).focus.mode,'general');
});
