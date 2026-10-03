import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ContentStore } from '../content-store.mjs';
import { RadarStore } from '../radar-store.mjs';
import { RadarAIProviders } from '../radar-ai.mjs';
const result={text:'Hasil diperiksa',drafts:[],citations:[]},body={action:'script',script:'Script sebelum produksi'};
const success=(value=result)=>Response.json({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(value)}]}]});
async function setup(t,fetcher,options={}){
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'ai-providers-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 const content=new ContentStore(path.join(dir,'contents.json')),radar=new RadarStore(content);let now=Date.parse('2026-10-02T12:00:00Z');
 const ai=new RadarAIProviders(radar,{defaultProvider:'gemini',order:'openai,groq,gemini',common:{fetcher,now:()=>now,wait:async ms=>{now+=ms;},random:()=>0},providers:{gemini:{key:'secret-gemini',model:'gemini-3.8-flash'},openai:{key:'secret-openai',model:'gpt-test'},groq:{key:'secret-groq',model:'groq-test'}},...options});
 return {ai,content,radar,advance:ms=>{now+=ms;}};
}
test('quota chain Gemini → GPT → Groq uses separate credentials, one reservation, validated preview and explicit actual provider',async t=>{
 const calls=[];const {ai,content}=await setup(t,async(url,opts)=>{calls.push({url,opts});if(url.startsWith('https://api.groq.com'))return Response.json({choices:[{finish_reason:'stop',message:{role:'assistant',content:JSON.stringify(result)}}]});return Response.json({error:{code:'insufficient_quota',message:'secret provider body'}},{status:429});});
 const out=await ai.generate(body);assert.equal(out.providerId,'groq');assert.equal(out.model,'groq-test');assert.deepEqual(out.fallbackHistory.map(h=>h.providerId),['gemini','openai']);assert.equal(calls.length,3);
 assert.equal(calls[0].opts.headers['x-goog-api-key'],'secret-gemini');assert.equal(calls[1].opts.headers.authorization,'Bearer secret-openai');assert.equal(calls[2].opts.headers.authorization,'Bearer secret-groq');
 assert.equal(calls[2].url,'https://api.groq.com/openai/v1/chat/completions');const request=JSON.parse(calls[2].opts.body);assert.equal(request.store,undefined);assert.equal(request.max_completion_tokens,5000);assert.equal(request.messages[0].role,'system');assert.equal(request.messages[1].role,'user');assert.equal(request.stream,false);assert.equal(request.text,undefined);assert.equal(request.tools,undefined);
 assert.equal((await ai.status()).used,1);assert.equal((await ai.status()).modelResults['gemini-3.8-flash'].state,'fallback');assert.equal((await content.read()).contents.length,0);assert.ok(!JSON.stringify(out).includes('secret'));assert.ok(!JSON.stringify(await ai.status()).includes('secret'));
});
test('provider model check is isolated, Groq lists language models and enforces configured allowlist',async t=>{
 let calls=0;const {ai}=await setup(t,async(url,opts)=>{calls++;assert.equal(url,'https://api.groq.com/openai/v1/models');assert.equal(opts.headers.authorization,'Bearer secret-groq');return Response.json({data:[{id:'groq-test',active:true},{id:'groq-other',active:true},{id:'groq-expensive',active:true}]});});
 ai.clients.groq.extraModels=['groq-other'];const status=await ai.checkConnection({provider:'groq'});assert.equal(status.providerId,'groq');assert.deepEqual(status.models.map(m=>m.id),['groq-other','groq-test']);assert.equal(status.used,0);assert.equal((await ai.status()).connection.state,'unchecked');assert.equal(calls,1);
 await assert.rejects(ai.generate({...body,provider:'groq',model:'groq-expensive'}),{status:400});await assert.rejects(ai.generate({...body,provider:'https://evil.example'}),{status:400});assert.equal((await ai.status()).used,0);assert.equal(calls,1);
});
test('format, permission and source-validation failures never try another provider',async t=>{
 for(const status of [400,403]){
  let calls=0;const {ai}=await setup(t,async()=>{calls++;return Response.json({error:{message:'private denied'}},{status});});
  await assert.rejects(ai.generate({...body,provider:'groq'}));assert.equal(calls,1);
 }
 let calls=0;const {ai}=await setup(t,async()=>{calls++;return success({text:'Unknown source [9]',drafts:[],citations:[9]});});await assert.rejects(ai.generate({...body,provider:'openai'}),{status:502});assert.equal(calls,1);
});
test('Groq credit exhaustion can switch; ordinary permission denial cannot',async t=>{
 let calls=0;const {ai}=await setup(t,async url=>{calls++;return url.startsWith('https://api.groq.com')?Response.json({error:'Your team has used all available credits or reached its monthly spending limit.'},{status:403}):success();});
 const out=await ai.generate({...body,provider:'groq'});assert.equal(out.providerId,'openai');assert.equal(calls,2);assert.equal(out.fallbackHistory[0].providerId,'groq');
});
test('unconfigured fallback is skipped; all exhausted stops with one reservation and respects shared daily limit',async t=>{
 let calls=0;const {ai,advance}=await setup(t,async()=>{calls++;return Response.json({error:{message:'quota'}},{status:429});},{common:{limit:1,fetcher:async()=>{calls++;return Response.json({},{status:429});}},providers:{gemini:{key:'key',model:'gemini-test'},openai:{key:'',model:''},groq:{key:'key',model:'groq-test'}}});
 await assert.rejects(ai.generate(body),e=>e.status===429&&/provider/.test(e.message));assert.equal(calls,2);assert.equal((await ai.status()).used,0);advance(11000);await assert.rejects(ai.generate({...body,provider:'groq'}),{status:429});assert.equal(calls,2);
});
test('application cooldown is not mistaken for provider quota; disabling fallback preserves selected provider',async t=>{
 let calls=0;const {ai}=await setup(t,async()=>{calls++;return success();});await ai.generate({...body,provider:'openai'});await assert.rejects(ai.generate({...body,provider:'groq'}),{status:429});assert.equal(calls,1);
 const other=await setup(t,async()=>{calls++;return Response.json({},{status:429});},{autoFallback:false});await assert.rejects(other.ai.generate(body),{status:429});assert.equal(calls,2);
});
test('fallback output validation failure stops chain rather than bypassing source constraints',async t=>{
 const calls=[];const {ai}=await setup(t,async url=>{calls.push(url);return url.includes('googleapis')?Response.json({},{status:429}):success({text:'https://invented.example',drafts:[],citations:[]});});
 await assert.rejects(ai.generate(body),{status:502});assert.equal(calls.length,2);assert.equal((await ai.status()).used,0);
});
test('quota cooldown skips exhausted providers on next action and actual chain has one total deadline',async t=>{
 const calls=[];const {ai,advance}=await setup(t,async url=>{calls.push(url);return url.includes('googleapis')?Response.json({},{status:429,headers:{'retry-after':'120'}}):success();});
 await ai.generate({...body,forceNew:true});advance(11000);const out=await ai.generate({...body,forceNew:true});assert.equal(calls.length,3);assert.equal(out.providerId,'openai');assert.match(out.fallbackHistory[0].reason,/jeda/);assert.equal((await ai.status()).used,2);
 let attempted=0;const bounded=await setup(t,async()=>{attempted++;bounded.advance(61000);return Response.json({},{status:429});});await assert.rejects(bounded.ai.generate({...body,forceNew:true}),{status:502});assert.equal(attempted,1);
});

test('concurrent different provider requests cannot duplicate a running fallback chain',async t=>{
 let resolve,calls=0;const {ai}=await setup(t,async()=>{calls++;return new Promise(r=>{resolve=r;});});
 const pending=ai.generate({...body,provider:'openai'});while(!resolve)await new Promise(r=>setImmediate(r));await assert.rejects(ai.generate({...body,provider:'groq'}),{status:429});assert.equal(calls,1);resolve(success());await pending;assert.equal(ai.generating,false);
});

test('503, timeout, invalid key and unavailable model switch to a working backup once',async t=>{
 for(const kind of [500,502,503,504,401,404,'invalid-key','timeout']){
  const calls=[];const {ai}=await setup(t,async url=>{calls.push(url);if(url.includes('googleapis')){if(kind==='invalid-key')return Response.json({error:{message:'API key not valid private'}},{status:400});if(kind==='timeout')throw new DOMException('private','TimeoutError');return Response.json({error:{message:'private'}},{status:kind});}return success();});
  const out=await ai.generate(body);assert.equal(out.providerId,'openai');assert.equal(calls.length,2);assert.equal((await ai.status()).used,1);assert.equal(out.fallbackHistory.length,1);assert.ok(!JSON.stringify(await ai.status()).includes('private'));
 }
});
test('readiness test sends fixed synthetic material, reports quota, and never consumes application usage',async t=>{
 let calls=0;const {ai,advance}=await setup(t,async(url,opts)=>{calls++;const input=JSON.parse(opts.body);assert.equal(input.max_output_tokens,2048);assert.equal(input.input,'Connection test.');return Response.json({status:'completed',output:[{type:'message',content:[{type:'output_text',text:'OK'}]}]});});
 const status=await ai.checkGeneration({provider:'openai'});assert.equal(status.generationTest.state,'ready');assert.equal(status.used,0);await assert.rejects(ai.checkGeneration({provider:'openai'}),{status:429});assert.equal(calls,1);
 advance(31000);ai.clients.openai.fetcher=async()=>Response.json({error:{message:'private'}},{status:429});const failed=await ai.checkGeneration({provider:'openai'});assert.equal(failed.generationTest.state,'error');assert.match(failed.generationTest.message,/Kuota/);assert.equal(failed.used,0);assert.ok(!JSON.stringify(failed).includes('private'));
});
test('provider refusal never falls back or counts as a successful preview',async t=>{
 let calls=0;const {ai}=await setup(t,async()=>{calls++;return Response.json({status:'completed',output:[{type:'message',content:[{type:'refusal',refusal:'private'}]}]});});await assert.rejects(ai.generate({...body,provider:'openai'}),{status:422});assert.equal(calls,1);assert.equal((await ai.status()).used,0);
});

test('a sole active provider gets all 60 seconds; configured backups share the remaining deadline',async t=>{
 const single=await setup(t,async()=>{throw Error('unexpected');},{providers:{gemini:{key:'key',model:'gemini-test'},openai:{key:'',model:''},groq:{key:'',model:''}}});
 single.ai.clients.gemini.complete=async(_instructions,_input,_model,deadline)=>{assert.equal(deadline-single.ai.clients.gemini.now(),60000);return 'Script valid';};await single.ai.generate(body);
 const multi=await setup(t,async()=>{throw Error('unexpected');});
 multi.ai.clients.gemini.complete=async(_instructions,_input,_model,deadline)=>{assert.equal(deadline-multi.ai.clients.gemini.now(),20000);const e=Error('quota');e.status=429;e.providerQuota=true;e.retryDelayMs=30000;throw e;};
 multi.ai.clients.openai.complete=async(_instructions,_input,_model,deadline)=>{assert.equal(deadline-multi.ai.clients.openai.now(),30000);return 'Script valid';};await multi.ai.generate(body);
});
test('a timeout while reading the provider response body switches to a backup',async t=>{
 const {ai}=await setup(t,async url=>url.includes('googleapis')?{ok:true,json:async()=>{throw new DOMException('private','AbortError');}}:success());
 const out=await ai.generate(body);assert.equal(out.providerId,'openai');assert.equal(out.fallbackHistory.length,1);assert.equal((await ai.status()).used,1);
});
