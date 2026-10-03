import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {ContentStore} from '../content-store.mjs';
import {RadarStore} from '../radar-store.mjs';
import {RadarMemory} from '../radar-memory.mjs';
import {RadarAI,RadarAIProviders} from '../radar-ai.mjs';
import {buildRadarPerformance} from '../radar-performance.mjs';
async function setup(t){const dir=await fs.mkdtemp(path.join(os.tmpdir(),'radar-memory-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));const content=new ContentStore(path.join(dir,'contents.json')),store=new RadarStore(content);return {content,store,memory:new RadarMemory(store)};}
test('prompt versions persist, reject stale writes and deletes, and do not change content',async t=>{
 const {content,store,memory}=await setup(t);const before=(await content.read()).contents;const p=await memory.save({name:'Naskah',action:'script',prompt:'Tulis dengan rujukan.'});const next=await memory.save({name:'Naskah v2',action:'script',prompt:'Bahasa percakapan.',revision:p.revision},p.id);assert.equal(next.revision,2);assert.equal(next.history[0].prompt,p.prompt);await assert.rejects(memory.save({...next,revision:1},p.id),{status:409});await assert.rejects(memory.remove(p.id,{revision:1}),{status:409});
 const restarted=new RadarMemory(new RadarStore(new ContentStore(content.file)));assert.equal((await restarted.list()).prompts[0].prompt,next.prompt);assert.deepEqual((await content.read()).contents,before);await memory.remove(p.id,{revision:2});assert.equal((await memory.list()).prompts.length,0);assert.equal((await store.read()).aiCache,undefined);
});
test('identical validated material reuses AI across restart at full quota; edits and force-new require a real request',async t=>{
 const {content,store,memory}=await setup(t);let now=Date.parse('2026-10-03T12:00:00Z'),calls=0;const options={key:'fake',model:'test-model',limit:1,now:()=>now,fetcher:async()=>{calls++;return Response.json({status:'completed',output:[{type:'message',content:[{type:'output_text',text:'Naskah bersumber.'}]}]});}};
 const ai=new RadarAI(store,options),body={action:'script',title:'Judul',customPrompt:'Tulis naskah.',script:''};const first=await ai.generate(body);assert.equal(first.cached,false);first.text='Mutated client';const reused=await ai.generate(body);assert.equal(reused.cached,true);assert.equal(reused.text,'Naskah bersumber.');assert.equal(calls,1);assert.equal((await ai.status()).used,1);
 const restarted=new RadarAI(new RadarStore(new ContentStore(content.file)),options);assert.equal((await restarted.generate(body)).cached,true);assert.equal(calls,1);await assert.rejects(restarted.generate({...body,forceNew:true}),{status:429});await assert.rejects(restarted.generate({...body,customPrompt:'Prompt berbeda.'}),{status:429});
 now+=86400000;await restarted.generate({...body,customPrompt:'Prompt berbeda.'});assert.equal(calls,2);const usage=await new RadarMemory(restarted.store).usage();assert.equal(usage.summary.successful,2);assert.equal(usage.summary.reused,2);assert.ok(!JSON.stringify(usage).includes('fake'));
});
test('source edits invalidate cache and invalid AI results never become reusable',async t=>{
 const {store,memory}=await setup(t);let now=Date.parse('2026-10-03T12:00:00Z'),valid=true,calls=0;await store.addSources([{title:'Pajak bantuan warga',url:'https://example.org/a',excerpt:'Anggaran mencapai 200 juta.',coverage:'snippet'}]);const issue=(await store.read()).issues[0];const ai=new RadarAI(store,{key:'fake',model:'test-model',now:()=>now,fetcher:async()=>{calls++;return Response.json({output:[{type:'message',content:[{type:'output_text',text:valid?'Bantuan [1]':'Klaim [99]'}]}]});}}),body={action:'summary',issueId:issue.id,script:''};await ai.generate(body);await store.mutate(r=>{r.issues[0].sources[0].excerpt='Anggaran mencapai 300 juta.';});now+=11000;valid=false;await assert.rejects(ai.generate(body),{status:502});now+=11000;await assert.rejects(ai.generate(body),{status:502});assert.equal(calls,3);assert.equal((await ai.status()).used,1);assert.equal((await memory.usage()).summary.failed,2);
});
test('provider outage permits reuse of a prior valid answer without another provider call',async t=>{
 const {store}=await setup(t);let calls=0;const providers=new RadarAIProviders(store,{defaultProvider:'openai',autoFallback:false,providers:{openai:{key:'fake',model:'test-model',fetcher:async()=>{calls++;return Response.json({output:[{type:'message',content:[{type:'output_text',text:'Naskah.'}]}]});}},groq:{key:''},gemini:{key:''}}});const body={action:'script',title:'Judul',script:''};await providers.generate(body);providers.blocked.set('openai',{retryAt:new Date(Date.now()+60000).toISOString(),reason:'Jeda'});assert.equal((await providers.generate(body)).cached,true);assert.equal(calls,1);
});
test('performance links only owned cached videos and exposes missing values instead of invented metrics',()=>{
 const data={contents:[{id:'c',title:'Konten',format:'long',youtubeVideoId:'abcdefghijk'},{id:'x',title:'Other',youtubeVideoId:'otherchannel'}],radar:{issues:[{id:'i',title:'Isu',contentIds:['c','x','deleted']}]}};const channel={videos:{abcdefghijk:{snippet:{channelId:'own'},dataUpdatedAt:'2026-10-02T00:00:00Z',statistics:{viewCount:'100',commentCount:'0'}},otherchannel:{snippet:{channelId:'other'},dataUpdatedAt:'2026-10-02T00:00:00Z',statistics:{viewCount:'999'}}}};
 const result=buildRadarPerformance(data,channel,{channelId:'own',now:Date.parse('2026-10-03T00:00:00Z')});assert.equal(result.usesAI,false);assert.equal(result.items[0].contents.length,2);assert.deepEqual(result.items[0].contents[0].metrics,{views:100,likes:null,comments:0});assert.equal(result.items[0].contents[1].metrics,null);assert.match(result.note,/sebab-akibat/);assert.equal(buildRadarPerformance(data,channel,{channelId:'own',now:Date.parse('2026-12-01T00:00:00Z')}).items[0].contents[0].state,'stale');
});
