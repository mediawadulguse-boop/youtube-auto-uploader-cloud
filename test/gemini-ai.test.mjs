import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {ContentStore} from '../content-store.mjs';
import {RadarStore} from '../radar-store.mjs';
import {RadarAI,decodeAIResult} from '../radar-ai.mjs';
async function setup(t){const dir=await fs.mkdtemp(path.join(os.tmpdir(),'gemini-ai-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));const content=new ContentStore(path.join(dir,'contents.json')),store=new RadarStore(content);return {content,store};}
const model='gemini-3.8-flash',result={text:'Script diperbaiki',drafts:[],citations:[]};
const response=(out=result,extras={})=>Response.json({candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify(out)}]},...extras}]});
const script={action:'script',script:'Script asli'};

test('all providers request ordinary text, with no structured API format dependency',async t=>{
 const {store}=await setup(t);
 for(const provider of ['gemini','openai','groq']){
  let request,url;const ai=new RadarAI(store,{provider,key:'private',model:provider==='gemini'?model:'text-model',fetcher:async(u,opts)=>{url=u;request=JSON.parse(opts.body);return provider==='gemini'?Response.json({candidates:[{finishReason:'STOP',content:{parts:[{text:'OK'}]}}]}):provider==='groq'?Response.json({choices:[{finish_reason:'stop',message:{content:'OK'}}]}):Response.json({status:'completed',output:[{type:'message',content:[{type:'output_text',text:'OK'}]}]});}});
  assert.equal(await ai.complete('Reply OK','test'), 'OK');
  if(provider==='gemini')assert.deepEqual(request.generationConfig,{maxOutputTokens:12000,thinkingConfig:{thinkingLevel:'low'}});
  else if(provider==='groq'){assert.equal(request.response_format,undefined);assert.equal(request.max_completion_tokens,5000);assert.equal(request.messages[1].content,'test');assert.match(url,/api\.groq\.com\/openai\/v1\/chat\/completions$/);}
  else{assert.equal(request.text,undefined);assert.equal(request.store,false);assert.match(url,/\/v1\/responses$/);}
 }
});

test('provider selection isolates Gemini key/model and preserves OpenAI defaults without leaking credentials',async t=>{const {store}=await setup(t);const old={AI_PROVIDER:process.env.AI_PROVIDER,GEMINI_API_KEY:process.env.GEMINI_API_KEY,GEMINI_MODEL:process.env.GEMINI_MODEL,OPENAI_API_KEY:process.env.OPENAI_API_KEY,OPENAI_MODEL:process.env.OPENAI_MODEL};try{delete process.env.AI_PROVIDER;process.env.OPENAI_API_KEY='private-openai';process.env.OPENAI_MODEL='gpt-4.1-mini';process.env.GEMINI_API_KEY='private-gemini';process.env.GEMINI_MODEL=model;assert.equal((await new RadarAI(store).status()).provider,'OpenAI');process.env.AI_PROVIDER='gemini';const ai=new RadarAI(store),status=await ai.status();assert.equal(ai.key,'private-gemini');assert.equal(status.provider,'Gemini');assert.equal(status.model,model);assert.equal(status.configured,true);assert.ok(!JSON.stringify(status).includes('private'));assert.deepEqual(status.requiredVariables,['AI_PROVIDER','GEMINI_API_KEY','GEMINI_MODEL']);}finally{for(const [key,value]of Object.entries(old)){if(value===undefined)delete process.env[key];else process.env[key]=value;}}});
test('Gemini missing or malformed configuration never calls provider or reserves usage',async t=>{const {store}=await setup(t);let calls=0;for(const options of [{provider:'gemini',key:'',model:''},{provider:'gemini',key:'',model},{provider:'gemini',key:'private',model:'https://wrong/model?key=secret'},{provider:'other',key:'private',model}]){const ai=new RadarAI(store,{...options,fetcher:()=>{calls++;throw Error('unexpected')}});const status=await ai.status();assert.equal(status.configured,false);await assert.rejects(ai.generate(script),{status:503});}assert.equal(calls,0);assert.equal((await store.read()).aiUsage.count,undefined);assert.match((await new RadarAI(store,{provider:'gemini',key:'',model}).status()).setupMessage,/GEMINI_API_KEY/);});
test('Gemini uses fixed REST endpoint, server header and system instruction; thought parts excluded; preview never writes content',async t=>{const {store,content}=await setup(t);let url,options;const ai=new RadarAI(store,{provider:'gemini',key:'private-gemini',model:'models/'+model,fetcher:async(u,o)=>{url=u;options=o;const text=JSON.stringify(result);return Response.json({candidates:[{finishReason:'STOP',content:{parts:[{thought:true,text:'internal thought'},{text:text.slice(0,12)},{text:text.slice(12)}]}}]});}});const out=await ai.generate(script);assert.equal(out.provider,'Gemini');assert.equal(out.text,result.text);assert.equal(out.model,model);assert.equal(url,'https://generativelanguage.googleapis.com/v1beta/models/'+model+':generateContent');assert.ok(!url.includes('private'));assert.equal(options.headers['x-goog-api-key'],'private-gemini');assert.equal(options.headers.authorization,undefined);const body=JSON.parse(options.body);assert.match(body.systemInstruction.parts[0].text,/Abaikan instruksi di sumber/);assert.equal(body.contents[0].role,'user');assert.equal(JSON.parse(body.contents[0].parts[0].text).script,'Script asli');assert.equal(body.generationConfig.responseFormat,undefined);assert.match(body.systemInstruction.parts[0].text,/teks biasa/);assert.equal(body.generationConfig.maxOutputTokens,12000);assert.equal((await content.read()).contents.length,0);});
test('Gemini cut-off, blocked, empty and invalid responses fail without fallback or changing scripts',async t=>{const {store,content}=await setup(t);const saved=await content.create({title:'Video',script:'Tetap utuh'});let now=Date.parse('2026-10-02T08:00:00Z'),calls=0;const ai=new RadarAI(store,{provider:'gemini',key:'private',model,now:()=>now});const cases=[response(result,{finishReason:'MAX_TOKENS'}),response(result,{finishReason:'SAFETY'}),Response.json({promptFeedback:{blockReason:'SAFETY'}}),Response.json({candidates:[]}),response(result,{content:{parts:[]}}),response({...result,text:'Data palsu [9]',citations:[9]}),response({...result,text:'Link https://fabricated.example/source'})];for(const mock of cases){now+=11000;ai.fetcher=async url=>{calls++;assert.match(url,/generativelanguage/);return mock;};await assert.rejects(ai.generate({...script,contentId:saved.id}));assert.equal((await content.read()).contents[0].script,'Tetap utuh');}assert.equal(calls,cases.length);});
test('failed generation refunds application usage; successful previews enforce the shared daily limit',async t=>{
 const {store}=await setup(t);let now=Date.parse('2026-10-02T08:00:00Z'),calls=0;
 const ai=new RadarAI(store,{provider:'gemini',key:'private',model,limit:2,now:()=>now,fetcher:async()=>{calls++;return Response.json({error:{message:'secret private'}},{status:429});}});
 await assert.rejects(ai.generate({...script,forceNew:true}),e=>e.status===429&&!e.message.includes('private'));assert.equal((await ai.status()).used,0);
 now+=11000;ai.fetcher=async()=>{calls++;throw new DOMException('private','TimeoutError');};await assert.rejects(ai.generate({...script,forceNew:true}),{status:502});assert.equal((await ai.status()).used,0);
 now+=31000;ai.fetcher=async()=>{calls++;return response();};await ai.generate({...script,forceNew:true});now+=11000;await ai.generate({...script,forceNew:true});now+=11000;await assert.rejects(ai.generate({...script,forceNew:true}),{status:429});assert.equal(calls,4);assert.equal((await ai.status()).used,2);
});

test('Gemini Short previews validate exactly three drafts and citation numbers against real sources',async t=>{const {store}=await setup(t);await store.addSources([{title:'Sumber pajak',url:'https://media.example/pajak',publisher:'Media',excerpt:'Bahan pajak'}]);const issue=(await store.read()).issues[0];let now=Date.parse('2026-10-02T08:00:00Z');const drafts=[1,2,3].map(n=>({title:'Short '+n,script:'Bahan dari sumber [1]',angle:'Angle '+n}));const ai=new RadarAI(store,{provider:'gemini',key:'private',model,now:()=>now,fetcher:async()=>response({text:'Tiga angle',drafts,citations:[1]})});const out=await ai.generate({forceNew:true,action:'shorts',script:'Long script',issueId:issue.id});assert.equal(out.drafts.length,3);assert.equal(out.sources[0].url,'https://media.example/pajak');now+=11000;ai.fetcher=async()=>response({text:'',drafts:drafts.slice(0,2),citations:[1]});await assert.rejects(ai.generate({forceNew:true,action:'shorts',script:'Long script',issueId:issue.id}),{status:502});});

test('connection check discovers paginated text models, deduplicates and never consumes generation usage',async t=>{
 const {store}=await setup(t);let calls=0,now=Date.parse('2026-10-02T08:00:00Z');
 const ai=new RadarAI(store,{provider:'gemini',key:'private-key',model,now:()=>now,fetcher:async(url,opts)=>{
  calls++;assert.equal(opts.method,'GET');assert.equal(opts.body,undefined);assert.equal(opts.headers['x-goog-api-key'],'private-key');assert.ok(!url.includes('private-key'));
  if(calls===1)return Response.json({models:[{name:'models/'+model,displayName:'Flash',supportedGenerationMethods:['generateContent']},{name:'models/gemini-embedding',supportedGenerationMethods:['embedContent']},{name:'models/gemini-image',supportedGenerationMethods:['generateContent']},{name:'models/gemini-tts',supportedGenerationMethods:['generateContent']}],nextPageToken:'next & page'});
  assert.equal(new URL(url).searchParams.get('pageToken'),'next & page');return Response.json({models:[{name:'models/'+model,supportedGenerationMethods:['generateContent']},{name:'models/gemini-other-flash',supportedGenerationMethods:['generateContent']}]});
 }});
 assert.equal((await ai.status()).connection.state,'unchecked');const status=await ai.checkConnection();assert.equal(status.connection.state,'connected');assert.deepEqual(status.models.map(m=>m.id),[model,'gemini-other-flash'].sort());assert.equal(status.used,0);assert.equal((await store.read()).aiUsage.count,undefined);assert.ok(!JSON.stringify(status).includes('private-key'));await ai.checkConnection();assert.equal(calls,2);now+=600001;assert.equal((await ai.status()).connection.state,'unchecked');assert.equal((await ai.status()).models.length,0);
});
test('connection failure is explicit and sanitized; missing key never calls catalog',async t=>{
 const {store}=await setup(t);let calls=0;const ai=new RadarAI(store,{provider:'gemini',key:'private-key',model,fetcher:async()=>{calls++;return Response.json({error:{message:'API key not valid private-key secret input',details:[{reason:'API_KEY_INVALID'}]}},{status:400})}});
 const status=await ai.checkConnection();assert.equal(status.connection.state,'error');assert.match(status.connection.message,/key.*tidak valid/);assert.ok(!JSON.stringify(status).includes('private-key'));assert.equal(status.used,0);
 const absent=new RadarAI(store,{provider:'gemini',key:'',model,fetcher:()=>{calls++;throw Error('unexpected')}});assert.equal((await absent.checkConnection()).connection.state,'unconfigured');assert.equal(calls,1);
});
test('only discovered models may be selected; unavailable/default, forged and expired models fail before quota',async t=>{
 const {store}=await setup(t);let now=Date.parse('2026-10-02T08:00:00Z'),generation=0;
 const ai=new RadarAI(store,{provider:'gemini',key:'private',model,now:()=>now,fetcher:async(url,opts)=>opts.method==='GET'?Response.json({models:[{name:'models/gemini-other-flash',supportedGenerationMethods:['generateContent']}]}):(generation++,assert.match(url,/gemini-other-flash:generateContent$/),response())});
 await ai.checkConnection();await assert.rejects(ai.generate(script),{status:400});await assert.rejects(ai.generate({...script,model:'gemini-forged'}),{status:400});await assert.rejects(ai.generate({...script,model:'https://evil.example/'}),{status:400});assert.equal((await ai.status()).used,0);
 const out=await ai.generate({...script,model:'gemini-other-flash'});assert.equal(out.model,'gemini-other-flash');assert.equal(ai.model,model);assert.equal((await ai.status()).modelResults['gemini-other-flash'].state,'ready');now+=600001;await assert.rejects(ai.generate({...script,model:'gemini-other-flash',forceNew:true}),{status:400});assert.equal(generation,1);
});
test('plain output and fenced Short JSON normalize safely while source references remain validated',()=>{
 assert.equal(decodeAIResult('Script biasa','script',[]).text,'Script biasa');
 const sources=[{url:'https://media.example/a'}];assert.deepEqual(decodeAIResult('Fakta [1] [1]','summary',sources).citations,[1]);
 assert.throws(()=>decodeAIResult('Fakta [9]','script',sources));assert.throws(()=>decodeAIResult('https://invented.example/a','script',sources));
 const drafts=[1,2,3].map(n=>({title:'Short '+n,script:'Data [1]',angle:'Angle'}));
 const out=decodeAIResult('```json\n'+JSON.stringify({text:'',drafts,citations:[1]})+'\n```','shorts',sources);assert.equal(out.drafts.length,3);
 assert.throws(()=>decodeAIResult('Tiga Short biasa','shorts',sources));assert.throws(()=>decodeAIResult(JSON.stringify({text:'',drafts:drafts.slice(0,2),citations:[1]}),'shorts',sources));
});

test('general HTTP400, invalid key, schema rejection, quota, and permission errors never retry',async t=>{
 const {store}=await setup(t);let now=Date.parse('2026-10-02T08:00:00Z');for(const [code,message,details]of [[400,'generic private input',[]],[400,'responseJsonSchema rejected private',[]],[400,'API key not valid private',[{reason:'API_KEY_INVALID'}]],[429,'quota private',[]],[403,'denied private',[]]]){
  now+=11000;let calls=0;const ai=new RadarAI(store,{provider:'gemini',key:'private',model,now:()=>now,fetcher:async()=>{calls++;return Response.json({error:{message,details}},{status:code})}});
  await assert.rejects(ai.generate(script),e=>!e.message.includes('private'));assert.equal(calls,1);assert.equal((await ai.status()).modelResults[model].state,'error');
 }
});
test('OpenAI model picker is restricted to admin configured models present in account',async t=>{
 const {store}=await setup(t);const ai=new RadarAI(store,{provider:'openai',key:'private',model:'gpt-4.1-mini',models:'gpt-4.1, bad/path',fetcher:async()=>Response.json({data:[{id:'gpt-4.1-mini'},{id:'gpt-4.1'},{id:'unconfigured-expensive-model'}]})});
 assert.deepEqual((await ai.checkConnection()).models.map(m=>m.id),['gpt-4.1','gpt-4.1-mini']);await assert.rejects(ai.generate({...script,model:'unconfigured-expensive-model'}),{status:400});
});

// Contract snapshot is from Google's REST discovery document, not the application's schema.
test('shorts ask for a JSON document in the prompt without requiring structured API parameters',async t=>{
 const {store}=await setup(t);let request;const drafts=[1,2,3].map(n=>({title:'Short '+n,script:'Script',angle:'Angle'}));
 const ai=new RadarAI(store,{provider:'gemini',key:'private',model,fetcher:async(u,opts)=>{request=JSON.parse(opts.body);return response({text:'Tiga angle',drafts,citations:[]});}});
 await ai.generate({...script,action:'shorts'});assert.match(request.systemInstruction.parts[0].text,/tepat tiga/);assert.deepEqual(request.generationConfig,{maxOutputTokens:12000,thinkingConfig:{thinkingLevel:'low'}});
});

test('invalid Gemini payload is diagnosed as integration error without blaming the model or leaking input',async t=>{
 const {store}=await setup(t);const ai=new RadarAI(store,{provider:'gemini',key:'private',model,fetcher:async()=>Response.json({error:{message:'Invalid value at generation_config.response_format.text.mime_type private script'}},{status:400})});
 await assert.rejects(ai.generate(script),e=>/Struktur permintaan/.test(e.message)&&!e.message.includes('private')&&!e.message.includes('Pilih model'));
});

test('generation 503 is not repeated on the same provider and refunds usage immediately',async t=>{
 const {store}=await setup(t);let calls=0,waits=0;const ai=new RadarAI(store,{provider:'gemini',key:'private',model,wait:async()=>{waits++;},fetcher:async()=>{calls++;return Response.json({error:{message:'private'}},{status:503});}});
 await assert.rejects(ai.generate(script),e=>e.status===503&&e.providerUnavailable&&!e.message.includes('private'));assert.equal(calls,1);assert.equal(waits,0);assert.equal((await ai.status()).used,0);
});

test('terminal 503 is explicit, bounded and retains failed preview after successful catalog check; cooldown reserves no extra usage',async t=>{
 const {store}=await setup(t);let calls=0,now=Date.parse('2026-10-02T08:00:00Z');
 const ai=new RadarAI(store,{provider:'gemini',key:'private',model,now:()=>now,random:()=>0,wait:async ms=>{now+=ms;},fetcher:async(url,opts)=>{calls++;return opts.method==='GET'?Response.json({models:[{name:'models/'+model,supportedGenerationMethods:['generateContent']}]}):Response.json({error:{message:'private raw prompt overloaded'}},{status:503});}});
 await assert.rejects(ai.generate(script),e=>e.status===503&&!e.message.includes('private'));assert.equal(calls,1);let status=await ai.status();assert.equal(status.used,0);assert.equal(status.modelResults[model].state,'busy');
 now+=1000;await ai.checkConnection();status=await ai.status();assert.equal(status.connection.state,'connected');assert.equal(status.modelResults[model].state,'busy');assert.ok(Date.parse(status.connection.checkedAt)>Date.parse(status.modelResults[model].checkedAt));
 await assert.rejects(ai.generate(script),{status:503});assert.equal(calls,2);assert.equal((await ai.status()).used,0);
 now+=30000;ai.fetcher=async()=>{calls++;return response();};assert.equal((await ai.generate(script)).text,result.text);assert.equal((await ai.status()).used,1);
});
test('Retry-After sets cooldown without waiting or retrying; a later action may recover',async t=>{
 const {store}=await setup(t);let calls=0,now=Date.parse('2026-10-02T08:00:00Z'),waits=0;
 const ai=new RadarAI(store,{provider:'gemini',key:'private',model,now:()=>now,wait:async()=>{waits++;},fetcher:async()=>{calls++;return Response.json({},{status:503,headers:{'retry-after':'120'}});}});
 await assert.rejects(ai.generate(script),{status:503});assert.equal(calls,1);assert.equal(waits,0);assert.equal(Date.parse((await ai.status()).modelResults[model].retryAt)-now,120000);
 now+=119000;await assert.rejects(ai.generate(script),{status:503});assert.equal(calls,1);now+=1000;ai.fetcher=async()=>{calls++;return response();};await ai.generate(script);assert.equal(calls,2);assert.equal((await ai.status()).used,1);
});

test('abandoned application reservations expire, preserving completed usage',async t=>{
 const {store}=await setup(t);const now=Date.parse('2026-10-02T08:00:00Z');await store.mutate(r=>{r.aiUsage={day:'2026-10-02',count:2,pending:{abandoned:now-1}};});
 const ai=new RadarAI(store,{provider:'gemini',key:'private',model,limit:2,now:()=>now,fetcher:async()=>response()});await ai.generate(script);assert.equal((await ai.status()).used,2);assert.deepEqual((await store.read()).aiUsage.pending,{});
});

test('concurrent preview cannot start another provider request or quota reservation',async t=>{
 const {store}=await setup(t);let resolve,calls=0;const ai=new RadarAI(store,{provider:'gemini',key:'private',model,fetcher:async()=>{calls++;return new Promise(r=>{resolve=r;});}});
 const first=ai.generate(script);while(!resolve)await new Promise(r=>setImmediate(r));await assert.rejects(ai.generate(script),{status:429});assert.equal(calls,1);assert.equal((await ai.status()).used,1);resolve(response());await first;assert.equal(ai.inFlight.size,0);
});
