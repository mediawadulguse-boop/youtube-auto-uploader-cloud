import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import {spawn} from 'node:child_process';
test('authenticated API selects providers and reports actual quota fallback without content changes or key exposure',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'ai-api-')),reservation=net.createServer();await new Promise(r=>reservation.listen(0,'127.0.0.1',r));const port=reservation.address().port;await new Promise(r=>reservation.close(r));const base='http://127.0.0.1:'+port;
 const preload=path.join(dir,'preload.mjs');await fs.writeFile(preload,`globalThis.fetch=async(url,options)=>{
 const u=String(url);if(u==='https://api.groq.com/openai/v1/models')return Response.json({data:[{id:'groq-test',active:true}]});
 if(u==='https://api.groq.com/openai/v1/chat/completions'&&JSON.parse(options.body).messages?.[1]?.content==='Connection test.')return Response.json({choices:[{finish_reason:'stop',message:{role:'assistant',content:'OK'}}]});
 if(u==='https://api.groq.com/openai/v1/chat/completions')return Response.json({choices:[{finish_reason:'stop',message:{role:'assistant',content:JSON.stringify({text:'Hasil melalui Groq',drafts:[],citations:[]})}}]});
 if(u.startsWith('https://generativelanguage.googleapis.com/')||u==='https://api.openai.com/v1/responses')return Response.json({error:{message:'quota'}},{status:429});throw Error('Unexpected outbound request');};`);
 const server=spawn(process.execPath,['--import',preload,'server.mjs'],{cwd:process.cwd(),env:{...process.env,PORT:String(port),APP_URL:base,DATA_DIR:dir,DATABASE_URL:'',APP_SECRET:'local-only-secret-at-least-32-characters',ADMIN_PASSWORD:'local-only-password',GOOGLE_CLIENT_ID:'',GOOGLE_CLIENT_SECRET:'',RADAR_AUTO_SYNC:'false',AI_PROVIDER:'gemini',GEMINI_API_KEY:'private-gemini',GEMINI_MODEL:'gemini-test',OPENAI_API_KEY:'private-openai',OPENAI_MODEL:'gpt-test',GROQ_API_KEY:'private-groq',GROQ_MODEL:'groq-test',AI_AUTO_FALLBACK:'true',AI_FALLBACK_ORDER:'openai,groq,gemini',WORKER_INTERVAL_MS:'600000'},stdio:['ignore','pipe','pipe']});let logs='';server.stdout.on('data',b=>logs+=b);server.stderr.on('data',b=>logs+=b);
 t.after(async()=>{server.kill();if(server.exitCode===null)await new Promise(r=>server.once('exit',r));await fs.rm(dir,{recursive:true,force:true});});
 for(let i=0;i<100;i++){try{if((await fetch(base+'/api/health')).ok)break;}catch{}await new Promise(r=>setTimeout(r,50));}
 for(const route of ['/api/radar','/api/radar/ai','/api/radar/ai/check','/api/radar/ai/test'])assert.equal((await fetch(base+route,{method:route==='/api/radar'?'GET':'POST',headers:{'content-type':'application/json'},...(route==='/api/radar'?{}:{body:'{}'})})).status,401);
 const login=await fetch(base+'/api/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({password:'local-only-password'})});assert.equal(login.status,200,logs);const cookie=login.headers.get('set-cookie').split(';')[0];const request=(route,body)=>fetch(base+route,{headers:{cookie,'content-type':'application/json'},...(body?{method:'POST',body:JSON.stringify(body)}:{})});
 const selected=await request('/api/radar?aiProvider=groq').then(r=>r.json());assert.equal(selected.ai.providerId,'groq');assert.equal(selected.ai.providers.length,3);assert.ok(selected.ai.providers.every(p=>p.configured));assert.ok(!JSON.stringify(selected).includes('private-'));
 assert.equal((await request('/api/radar?aiProvider=forged')).status,400);
 const checked=await request('/api/radar/ai/check',{provider:'groq'}).then(r=>r.json());assert.equal(checked.connection.state,'connected');assert.equal(checked.used,0);
 const preview=await request('/api/radar/ai',{action:'script',script:'Script sebelum produksi',provider:'gemini'});assert.equal(preview.status,200);const out=await preview.json();assert.equal(out.providerId,'groq');assert.deepEqual(out.fallbackHistory.map(h=>h.providerId),['gemini','openai']);assert.equal(out.text,'Hasil melalui Groq');assert.ok(!JSON.stringify(out).includes('private-'));
 const tested=await request('/api/radar/ai/test',{provider:'groq',model:'groq-test'}).then(r=>r.json());assert.equal(tested.generationTest.state,'ready');assert.equal(tested.used,1);assert.ok(!JSON.stringify(tested).includes('private-'));assert.equal((await request('/api/radar/ai/test',{provider:'groq',model:'groq-test'})).status,429);
 const radar=await request('/api/radar').then(r=>r.json());assert.equal(radar.ai.used,1);assert.equal(radar.ai.modelResults['gemini-test'].state,'fallback');const contents=await request('/api/contents').then(r=>r.json());assert.equal(contents.contents.length,0);
});
