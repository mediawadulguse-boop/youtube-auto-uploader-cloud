import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {ContentStore} from '../content-store.mjs';
import {RadarStore} from '../radar-store.mjs';
import {RadarAI,RadarAIProviders} from '../radar-ai.mjs';
import {runAISmoke} from '../ai-smoke.mjs';
const model='openai/gpt-oss-120b';
const chat=(content='Script valid',extra={})=>Response.json({choices:[{finish_reason:'stop',message:{content,reasoning:'Private reasoning'},...extra}]});
async function setup(t){const dir=await fs.mkdtemp(path.join(os.tmpdir(),'groq-ai-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));const content=new ContentStore(path.join(dir,'contents.json'));return {dir,content,store:new RadarStore(content)};}

test('Groq accepts active namespaced text models and excludes unconfigured or non-text models',async t=>{
 const {store}=await setup(t);const ai=new RadarAI(store,{provider:'groq',key:'private-groq',model,models:'openai/gpt-oss-20b,groq/compound,whisper-large-v3,text-inactive',fetcher:async(url,options)=>{
  assert.equal(url,'https://api.groq.com/openai/v1/models');assert.equal(options.headers.authorization,'Bearer private-groq');
  return Response.json({data:[{id:model,active:true},{id:'openai/gpt-oss-20b',active:true},{id:'text-inactive',active:false},{id:'groq/compound'},{id:'whisper-large-v3'},{id:'unconfigured-text'}]});
 }});
 assert.deepEqual((await ai.checkConnection()).models.map(m=>m.id),[model,'openai/gpt-oss-20b'].sort());
});
test('Groq GPT-OSS uses its chat contract, discards reasoning and leaves saved scripts unchanged',async t=>{
 const {store,content}=await setup(t);const saved=await content.create({title:'Video',script:'Naskah asli'});
 const ai=new RadarAI(store,{provider:'groq',key:'private-groq',model,fetcher:async(url,options)=>{
  assert.equal(url,'https://api.groq.com/openai/v1/chat/completions');assert.equal(options.headers.authorization,'Bearer private-groq');
  const request=JSON.parse(options.body);assert.equal(request.reasoning_effort,'low');assert.equal(request.include_reasoning,false);assert.equal(request.max_completion_tokens,5000);assert.equal(request.response_format,undefined);assert.equal(request.tools,undefined);assert.equal(request.messages[0].role,'system');return chat();
 }});
 const out=await ai.generate({action:'script',script:'Naskah asli',contentId:saved.id});assert.equal(out.text,'Script valid');assert.equal(out.model,model);assert.ok(!JSON.stringify(out).includes('Private reasoning'));assert.equal((await content.read()).contents[0].script,'Naskah asli');
});
test('Groq incomplete, refused and tool answers do not fall back or consume successful preview usage',async t=>{
 const {store}=await setup(t);
 for(const response of [chat('',{finish_reason:'length'}),chat('',{finish_reason:'content_filter'}),chat('',{message:{refusal:'private'}}),chat('text',{message:{content:'text',tool_calls:[{}]}}),Response.json({choices:[]})]){
  let calls=0;const ai=new RadarAIProviders(store,{defaultProvider:'groq',providers:{groq:{key:'private',model,fetcher:async()=>{calls++;return response;}},openai:{key:'other',model:'gpt-4.1-mini',fetcher:()=>{throw Error('backup should not be called');}},gemini:{key:'',model:''}}});
  await assert.rejects(ai.generate({action:'script',script:'Naskah'}));assert.equal(calls,1);assert.equal((await ai.status()).used,0);
  await store.mutate(r=>{r.aiUsage.lastAt=null;});
 }
});
test('blank environment model uses a documented default while invalid model credentials stay private',async t=>{
 const {store}=await setup(t);const previous=process.env.OPENAI_MODEL;
 try{process.env.OPENAI_MODEL='';const ai=new RadarAI(store,{provider:'openai',key:'private'});assert.equal(ai.configuration().model,'gpt-4.1-mini');assert.equal(ai.configuration().modelSource,'default');assert.equal(ai.configuration().configured,true);}finally{if(previous===undefined)delete process.env.OPENAI_MODEL;else process.env.OPENAI_MODEL=previous;}
 const absent=new RadarAI(store,{provider:'groq',key:'',model});assert.deepEqual(absent.configuration().missingVariables,['GROQ_API_KEY']);assert.ok(!absent.configuration().setupMessage.includes('GROQ_MODEL'));
 for(const bad of ['gsk_sensitive-value','sk-sensitive-value','https://bad/model']){const ai=new RadarAI(store,{provider:'groq',key:'private',model:bad});assert.equal(ai.configuration().configured,false);assert.equal(ai.configuration().model,null);assert.ok(!JSON.stringify(await ai.status()).includes(bad));}
});
test('legacy Grok selection resolves to Groq and an absent preferred provider selects a configured backup',async t=>{
 const {store}=await setup(t);const providers={openai:{key:'',model:''},groq:{key:'private-groq',model},gemini:{key:'',model:''}};
 const migrated=new RadarAIProviders(store,{defaultProvider:'grok',order:'openai,grok,gemini',providers});assert.equal(migrated.defaultProvider,'groq');assert.deepEqual(migrated.order,['openai','groq','gemini']);assert.equal(migrated.client().key,'private-groq');assert.ok(!migrated.clients.grok);
 const selected=new RadarAIProviders(store,{defaultProvider:'gemini',providers});assert.equal(selected.defaultProvider,'groq');assert.equal((await selected.status()).preferredProvider,'gemini');assert.match((await selected.status()).selectionMessage,/Groq/);
 const explicit=new RadarAIProviders(store,{defaultProvider:'gemini',autoFallback:false,providers});assert.equal(explicit.defaultProvider,'gemini');
});
test('OpenAI generation distinguishes billing exhaustion, rate limits and invalid credentials without raw details',async t=>{
 const {store}=await setup(t);
 for(const [status,code,message]of [[429,'insufficient_quota',/Saldo\/kuota API OpenAI/],[429,'rate_limit_exceeded',/Batas laju/],[401,'invalid_api_key',/API key OpenAI ditolak/],[404,'model_not_found',/Model OpenAI tidak ditemukan/]]){
  const ai=new RadarAIProviders(store,{providers:{openai:{key:'private',model:'gpt-4.1-mini',fetcher:async(_url,options)=>{assert.equal(JSON.parse(options.body).max_output_tokens,64);return Response.json({error:{code,message:'secret key and prompt'}},{status});}},groq:{key:'',model:''},gemini:{key:'',model:''}}});
  const out=await ai.checkGeneration({provider:'openai'});assert.equal(out.generationTest.state,'error');assert.equal(out.generationTest.httpStatus,status);assert.match(out.generationTest.message,message);assert.ok(!JSON.stringify(out).includes('secret'));assert.equal(out.used,0);
 }
});
test('billing type wins over other codes and only recognized error metadata and numeric limits are exposed',async t=>{
 const {store}=await setup(t);const ai=new RadarAIProviders(store,{providers:{openai:{key:'private',model:'gpt-4.1-mini',fetcher:async()=>Response.json({error:{code:'rate_limit_exceeded',type:'insufficient_quota',message:'private billing details'}},{status:429,headers:{'x-ratelimit-limit-requests':'3','x-ratelimit-remaining-tokens':'private','x-ratelimit-limit-tokens':'10000'}})},groq:{key:'',model:''},gemini:{key:'',model:''}}});
 const status=await ai.checkGeneration({provider:'openai'});assert.equal(status.generationTest.quotaKind,'billing');assert.equal(status.generationTest.providerErrorType,'insufficient_quota');assert.deepEqual(status.generationTest.rateLimits,{'limit-requests':3,'limit-tokens':10000});assert.ok(!JSON.stringify(status).includes('private'));assert.match(status.generationTest.message,/Saldo\/kuota/);
});
test('filtered one-shot diagnosis reports safe configuration and continues after a failed provider',async t=>{
 const {dir}=await setup(t);const logs=[],calls=[];
 const ai={preferredProvider:'openai',defaultProvider:'openai',clients:Object.fromEntries(['openai','groq','gemini'].map(provider=>[provider,{provider,key:'secret-key',model:'text-model',now:()=>Date.now(),configuration:()=>({configured:true,model:'text-model'}),complete:async()=> 'Script valid'}])),
 checkConnection:async({provider})=>({connection:{state:'connected',message:'catalog OK'},models:[{id:'text-model'}]}),checkGeneration:async({provider})=>{calls.push(provider);if(provider==='openai')throw Error('private');return {generationTest:{state:'ready',model:'text-model'}};}};
 await runAISmoke(ai,dir,'filtered_operator_2026',message=>logs.push(message),'openai,groq');assert.deepEqual(calls,['openai','groq']);assert.ok(logs.some(s=>s.includes('"probe":"script"')));assert.ok(!logs.join('').includes('secret-key'));assert.ok(!logs.join('').includes('private'));assert.ok(!logs.join('').includes('gemini'));assert.ok(logs.some(s=>s.includes('"availableModels":["text-model"]')));
});
