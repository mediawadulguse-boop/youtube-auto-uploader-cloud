import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {EventEmitter} from 'node:events';
import {Readable} from 'node:stream';
import {safeArticle,extractArticle,acquireCaptions,RadarAcquire} from '../radar-acquire.mjs';
import {buildIssueReport,selectSourceText} from '../radar-engine.mjs';
import {writeEngineScript} from '../radar-writer.mjs';
import {RadarAI,validatePolish} from '../radar-ai.mjs';
import {ContentStore} from '../content-store.mjs';
import {RadarStore} from '../radar-store.mjs';
import {RadarWorkspace} from '../radar-workspace.mjs';

const text='Pemerintah membuka layanan bantuan untuk pekerja di Jember. Anggaran bantuan warga Jember mencapai Rp200 juta tahun ini. Menurut Budi, bantuan mungkin menjangkau 500 orang. Warga dapat memeriksa persyaratan di kantor pelayanan.';
const source={id:'s1',title:'Bantuan pekerja Jember',url:'https://media.example/a',publisher:'Media A',platform:'Berita / Web',coverage:'snippet',verification:'unchecked',excerpt:text};
const issue={id:'issue1',revision:1,title:'Bantuan pekerja Jember',sources:[source],research:{notes:'Pertahankan atribusi.',checklist:[]}};
async function setup(t){const dir=await fs.mkdtemp(path.join(os.tmpdir(),'radar-writing-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));const content=new ContentStore(path.join(dir,'contents.json')),store=new RadarStore(content);await store.addSources([{...source}]);return {dir,content,store,issue:(await store.read()).issues[0]};}
const publicDNS=async()=>[{address:'93.184.216.34',family:4}];
function fakeHTTP(handler){return u=>({get(url,options,callback){const request=new EventEmitter();request.setTimeout=()=>{};request.destroy=error=>{if(error)request.emit('error',error);request.emit('close');};queueMicrotask(()=>{const spec=handler(url,options),response=Readable.from([Buffer.from(spec.body||'')]);response.statusCode=spec.status||200;response.headers=spec.headers||{'content-type':'text/html'};response.on('end',()=>request.emit('close'));callback(response);});return request;}});}

test('article extraction selects readable content, removes navigation and executable/hidden text',()=>{
 const html='<nav><p>Navigation must not become evidence.</p></nav><main><article><h1>Bantuan pekerja</h1><p>'+text+'</p><script>Injected invented fact.</script><p hidden>Hidden invented information.</p><p>Baca juga tautan lain</p></article></main><footer><p>Footer must not become evidence.</p></footer>';
 const result=extractArticle(html);assert.match(result.text,/Rp200 juta/);assert.ok(!/Navigation|Injected|Hidden|Footer|Baca juga/.test(result.text));assert.equal(result.truncated,false);
 assert.throws(()=>extractArticle('<html>Sign in</html>'),/belum cukup/);
});
test('article size truncation ends on a complete sentence',()=>{const out=extractArticle((text+'\n').repeat(400),'text/plain');assert.ok(out.text.length<=50000);assert.equal(out.truncated,true);assert.match(out.text,/[.!?]$/);});
test('safe acquisition rejects private, mixed DNS and unsafe ports before opening a socket',async()=>{
 let calls=0;const requestFor=()=>{calls++;throw Error('must not connect');};
 for(const url of ['http://127.0.0.1/a','http://[::1]/a','http://10.0.0.1/a','https://media.example:8080/a'])await assert.rejects(safeArticle(url,{lookup:publicDNS,requestFor}));
 await assert.rejects(safeArticle('https://media.example/a',{lookup:async()=>[{address:'93.184.216.34',family:4},{address:'192.168.1.1',family:4}],requestFor}));assert.equal(calls,0);
});
test('safe acquisition pins DNS, validates redirects and refuses non-HTML/oversize responses',async()=>{
 let calls=0;const requestFor=fakeHTTP((url,options)=>{calls++;options.lookup('media.example',{},(err,address,family)=>{assert.equal(address,'93.184.216.34');assert.equal(family,4);});return {body:text};});
 assert.equal((await safeArticle('https://media.example/a',{lookup:publicDNS,requestFor})).body,text);assert.equal(calls,1);
 await assert.rejects(safeArticle('https://media.example/a',{lookup:publicDNS,requestFor:fakeHTTP(()=>({status:302,headers:{location:'http://127.0.0.1/private'}}))}),/publik/);
 await assert.rejects(safeArticle('https://media.example/a',{lookup:publicDNS,requestFor:fakeHTTP(()=>({headers:{'content-type':'application/pdf'}}))}),/Format/);
 await assert.rejects(safeArticle('https://media.example/a',{lookup:publicDNS,requestFor:fakeHTTP(()=>({body:'x'.repeat(512*1024+1)}))}),/512 KB/);
 await assert.rejects(safeArticle('https://media.example/a',{lookup:publicDNS,deadline:Date.now()-1}),/batas waktu/);
});
test('slow DNS cannot open a socket after acquisition deadline',async()=>{let sockets=0;await assert.rejects(safeArticle('https://media.example/a',{lookup:()=>new Promise(r=>setTimeout(()=>r([{address:'93.184.216.34',family:4}]),30)),requestFor:()=>{sockets++;},deadline:Date.now()+5}),/DNS/);assert.equal(sockets,0);});

const video={...source,platform:'YouTube',url:'https://www.youtube.com/watch?v=abcdefghijk'};
test('caption retrieval verifies channel ownership and uses official endpoints with VTT conversion',async()=>{
 const calls=[];const youtube=async url=>{calls.push(url);if(url.includes('/videos?'))return Response.json({items:[{snippet:{channelId:'owner'}}]});if(url.includes('/captions?'))return Response.json({items:[{id:'caption',snippet:{status:'serving',language:'id'}}]});return new Response('WEBVTT\n\n00:01.000 --> 00:02.000\nAnggaran bantuan mencapai Rp200 juta.');};
 const result=await acquireCaptions(video,{youtube,channelId:'owner'});assert.equal(calls.length,3);assert.match(calls[2],/^https:\/\/www.googleapis.com\/youtube\/v3\/captions\/caption\?tfmt=vtt$/);assert.equal(result.text,'Anggaran bantuan mencapai Rp200 juta.');assert.equal(result.origin,'youtube-captions');
});
test('foreign videos, unavailable captions and permission errors never use alternative scrapers',async()=>{
 let calls=0;await assert.rejects(acquireCaptions(video,{channelId:'owner',youtube:async()=>{calls++;return Response.json({items:[{snippet:{channelId:'other'}}]});}}),/channel lain/);assert.equal(calls,1);
 calls=0;await assert.rejects(acquireCaptions(video,{channelId:'owner',youtube:async url=>{calls++;return url.includes('/videos?')?Response.json({items:[{snippet:{channelId:'owner'}}]}):new Response('',{status:403});}}),/HTTP 403/);assert.equal(calls,2);
 await assert.rejects(acquireCaptions(video,{youtube:()=>{throw Error('must not fetch');}}),/Hubungkan channel/);
});
test('caption limits reject oversized content instead of silently losing source data',async()=>{
 await assert.rejects(acquireCaptions(video,{channelId:'owner',youtube:async url=>url.includes('/videos?')?Response.json({items:[{snippet:{channelId:'owner'}}]}):url.includes('/captions?')?Response.json({items:[{id:'c',snippet:{status:'serving',language:'id'}}]}):new Response('WEBVTT\n\n'+text.repeat(1000))}),/terlalu besar/);
});
test('acquisition persists article material with references, leaves AI usage untouched and reuses cache',async t=>{
 const {dir,store,content,issue}=await setup(t);let calls=0;const acquire=new RadarAcquire(store,{article:async()=>{calls++;return {body:'<article><p>'+text+'</p></article>',type:'text/html',url:source.url};}});
 const out=await acquire.acquire(issue.id,{revision:issue.revision,sourceId:issue.sources[0].id});assert.equal(out.status,'ready');assert.equal(out.issue.sources[0].verification,'unchecked');assert.equal(out.issue.sources[0].excerpt,text);assert.equal(buildIssueReport(out.issue).sources[0].hasArticle,true);
 const cached=await acquire.acquire(issue.id,{revision:out.issue.revision,sourceId:out.issue.sources[0].id});assert.equal(cached.cached,true);assert.equal(calls,1);assert.deepEqual((await content.read()).radar.aiUsage,{});
 const restarted=new RadarStore(new ContentStore(path.join(dir,'contents.json')));
 assert.ok((await restarted.read()).issues[0].sources[0].article.text.includes('Rp200 juta'));
});
test('unavailable sources record actionable status, cooldown and preserve previous material',async t=>{
 const {store,issue}=await setup(t),acquire=new RadarAcquire(store,{article:async()=>{throw Error('HTTP 403');}});
 const out=await acquire.acquire(issue.id,{revision:issue.revision,sourceId:issue.sources[0].id});assert.equal(out.status,'unavailable');assert.match(out.issue.sources[0].acquisition.message,/impor manual/);assert.equal(out.issue.sources[0].excerpt,text);assert.equal(out.issue.sources[0].article,undefined);
 await assert.rejects(acquire.acquire(issue.id,{revision:out.issue.revision,sourceId:issue.sources[0].id}),{status:429});
});
test('slow acquisition cannot overwrite a source edited, removed or imported during the request',async t=>{
 const {store,issue}=await setup(t);let release,started;const ready=new Promise(r=>started=r),acquire=new RadarAcquire(store,{article:async()=>{started();await new Promise(r=>release=r);return {body:text,type:'text/plain',url:source.url};}});
 const pending=acquire.acquire(issue.id,{revision:issue.revision,sourceId:issue.sources[0].id});await ready;
 await new RadarWorkspace(store).import(issue.id,{revision:issue.revision,sourceId:issue.sources[0].id,text:'Catatan impor baru tentang bantuan warga.',format:'txt'});release();await assert.rejects(pending,{status:409});assert.equal((await store.read()).issues[0].sources[0].article,undefined);
});
test('full-material selection includes relevant middle/end evidence within a whole-sentence budget',()=>{
 const full=Array.from({length:160},(_,n)=>'Uraian konteks nomor '+n+' menjelaskan layanan pemerintah yang tersedia.').join(' ')+' Anggaran final bantuan Jember mencapai Rp777 juta.';
 const selected=selectSourceText({...source,article:{text:full}},1800,'Anggaran final bantuan Jember');assert.ok(selected.length<=1800);assert.match(selected,/Rp777 juta/);assert.ok(selected.split('\n').every(s=>full.includes(s)));assert.match(buildIssueReport({...issue,sources:[{...source,article:{text:full}}]}).data.map(c=>c.text).join(' '),/Rp777 juta/);
});
test('layered writer preserves claims, attribution, opinions, citations and editor notes without placeholders',()=>{
 const out=writeEngineScript(issue,{format:'long',minutes:5,rules:'Pertahankan angka dan hindari klaim baru.'}),d=out.drafts[0];assert.equal(out.usesAI,false);assert.match(d.script,/Rp200 juta/);assert.match(d.script,/Menurut Budi.*mungkin.*500 orang/);assert.match(d.script,/\[1\]/);assert.match(d.productionNotes,/Pertahankan angka/);assert.ok(!/\[Tambahkan|\[Isi |\[Teliti/.test(d.script));assert.ok(d.wordCount<=700);assert.ok(d.estimatedMinutes<5);assert.ok(d.warnings.some(w=>w.includes('tidak cukup')));
 assert.equal(writeEngineScript(issue,{format:'long',minutes:5,rules:'Pertahankan angka dan hindari klaim baru.'}).cached,true);
});
test('writer rejects title-only sources, invalid rules and stale source revision',()=>{
 assert.throws(()=>writeEngineScript({...issue,sources:[{...source,excerpt:''}]}),{status:422});assert.throws(()=>writeEngineScript(issue,{minutes:0}));assert.throws(()=>writeEngineScript(issue,{rules:'x'.repeat(4001)}));assert.throws(()=>writeEngineScript(issue,{revision:0}),{status:409});
});
test('writer deduplicates literal claims only, keeps conflicting numbers and reports comparison needs',()=>{
 const sources=[source,{...source,id:'s2',url:'https://other.example/a',publisher:'Media B'},{...source,id:'s3',url:'https://third.example/a',publisher:'Media C',excerpt:'Anggaran bantuan warga Jember mencapai Rp300 juta tahun ini.'}];
 const d=writeEngineScript({...issue,sources},{format:'long',minutes:5}).drafts[0];assert.equal(d.script.match(/Rp200 juta/g).length,1);assert.match(d.script,/Rp300 juta/);assert.ok(d.warnings.some(w=>w.includes('Angka berbeda')));assert.match(d.script,/\[1\]\[2\]/);
});
test('three Short angles respect word budgets and cannot invent missing system/human evidence',()=>{
 const out=writeEngineScript(issue,{format:'threeShorts',minutes:1});assert.equal(out.drafts.length,3);assert.equal(new Set(out.drafts.map(d=>d.script)).size,3);for(const d of out.drafts)assert.ok(d.wordCount<=140);
 const noThemes={...issue,sources:[{...source,excerpt:'Observatorium mencatat 200 titik cahaya pada malam pengamatan.'}]};assert.ok(writeEngineScript(noThemes,{format:'threeShorts'}).drafts[1].warnings.some(w=>w.includes('Belum ada bukti khusus')));
});
test('AI editing selects entire-material evidence with bounded input, caches and never changes saved scripts',async t=>{
 const {store,content,issue}=await setup(t);const workspace=new RadarWorkspace(store),full=text+' '+Array.from({length:120},(_,n)=>'Rincian konteks urutan '+n+' tetap tercantum dalam laporan sumber.').join(' ')+' Anggaran final bantuan Jember mencapai Rp777 juta.';
 await workspace.import(issue.id,{revision:issue.revision,sourceId:issue.sources[0].id,text:full,format:'txt'});
 let input,calls=0;const ai=new RadarAI(store,{provider:'groq',key:'test-only',model:'openai/gpt-oss-120b',fetcher:async(url,options)=>{calls++;const body=JSON.parse(options.body);assert.match(body.messages[0].content,/Sunting hanya draft/);input=JSON.parse(body.messages[1].content);return Response.json({choices:[{finish_reason:'stop',message:{content:'Anggaran final bantuan Jember mencapai Rp777 juta. [1]'}}]});}});
 const body={action:'polish',issueId:issue.id,script:'Anggaran final bantuan Jember mencapai Rp777 juta. [1]'},out=await ai.generate(body);assert.match(input.sources[0].excerpt,/Rp777 juta/);assert.ok(out.efficiency.selectedCharacters<=18000);assert.equal(out.efficiency.mode,'edit-only');assert.equal((await content.read()).contents.length,0);assert.equal((await ai.generate(body)).cached,true);assert.equal(calls,1);
 assert.equal((await ai.status()).limit,50);assert.equal((await ai.status()).used,1);await assert.rejects(ai.generate({action:'polish',script:'x'.repeat(12001)}),/12.000/);
});
test('AI evidence budget applies across 30 sources and refuses missing edit citations before quota',async t=>{
 const {store}=await setup(t);let captured;const ai=new RadarAI(store,{provider:'groq',key:'test-only',model:'openai/gpt-oss-120b',fetcher:async(url,options)=>{captured=JSON.parse(JSON.parse(options.body).messages[1].content);return Response.json({choices:[{finish_reason:'stop',message:{content:'Pratinjau bersumber [1]'}}]});}});
 const sources=Array.from({length:30},(_,n)=>({label:'Sumber '+n,url:'https://media.example/'+n,notes:text.repeat(20),verified:false}));const out=await ai.generate({action:'script',script:'Naskah',sources});assert.ok(captured.sources.reduce((n,s)=>n+s.excerpt.length,0)<=18000);assert.ok(out.efficiency.availableCharacters>18000);
 await assert.rejects(ai.generate({action:'polish',script:'Klaim dengan sumber tidak ada [31]',sources}),{status:422});assert.equal((await ai.status()).used,1);
});
test('browser polishing applies only the selected unique section and rejects changed or repeated originals',async()=>{
 const code=await fs.readFile(new URL('../public/radar.js',import.meta.url),'utf8'),context={};vm.createContext(context);vm.runInContext(code.slice(code.indexOf('function radarMaterialNotes('),code.indexOf('function radarPolish(')),context);
 assert.equal(context.radarApplyPolish('HOOK\nBagian asli\nPENUTUP','Bagian asli','Bagian disunting'),'HOOK\nBagian disunting\nPENUTUP');assert.throws(()=>context.radarApplyPolish('Berubah','Bagian asli','Baru'));assert.throws(()=>context.radarApplyPolish('asli asli','asli','baru'));
 const notes=context.radarMaterialNotes({...source,article:{text:(text+'\n').repeat(80)+'Informasi akhir bersumber tetap tersedia.'}});assert.ok(notes.length<=10000);assert.match(notes,/Informasi akhir/);
});
test('polishing may improve wording but cannot change numeric values or citation identities',()=>{
 validatePolish('Menurut Budi, bantuan mungkin mencapai Rp200 juta. [1]','Budi menyebut bantuan itu mungkin mencapai Rp200 juta. [1]');
 assert.throws(()=>validatePolish('Bantuan Rp200 juta. [1]','Bantuan Rp300 juta. [1]'),/angka/);assert.throws(()=>validatePolish('Bantuan Rp200 juta. [1]','Bantuan Rp200 juta. [2]'),/rujukan/);assert.throws(()=>validatePolish('Bantuan Rp200 juta. [1]','Bantuan Rp200 juta.'),/rujukan/);
});
test('polishing a later reference preserves its original number and reserves evidence space for cited material',async t=>{
 const {store}=await setup(t);const long='Menurut Budi, '+('rincian bantuan untuk pekerja '.repeat(30))+'anggaran mencapai Rp200 juta.',original=long+' [75]';let captured;
 const ai=new RadarAI(store,{provider:'groq',key:'test-only',model:'openai/gpt-oss-120b',fetcher:async(url,options)=>{captured=JSON.parse(JSON.parse(options.body).messages[1].content);return Response.json({choices:[{finish_reason:'stop',message:{content:original}}]});}});
 const sources=Array.from({length:100},(_,n)=>({label:'Sumber '+(n+1),url:'https://media.example/'+n,notes:n===74?long:text}));
 const out=await ai.generate({action:'polish',script:original,sources});assert.equal(out.sources.length,30);assert.ok(captured.sources.find(s=>s.number===75).excerpt.includes(long));assert.deepEqual(out.citations,[75]);assert.ok(out.efficiency.selectedCharacters<=18000);
});
test('research controls expose acquisition and writer actions, escape material status and guard stale dialogs',async()=>{
 const code=await fs.readFile(new URL('../public/radar.js',import.meta.url),'utf8'),nodes=new Map(),node=id=>{if(!nodes.has(id))nodes.set(id,{value:id==='#radarAcquireSource'?'s1':id==='#radarWriteFormat'?'long':id==='#radarWriteMinutes'?'5':id==='#radarWriteStyle'?'conversational':'',isConnected:true});return nodes.get(id);};let html='',posts=[],reload=0;
 const context={$:node,rDialog:{open:true,querySelector:()=>({insertAdjacentHTML:(where,value)=>html=value}),querySelectorAll:()=>[]},esc:s=>String(s).replaceAll('<','&lt;').replaceAll('"','&quot;'),rNum:String,confirm:()=>true,radarRun:fn=>fn(),rPost:async(route,body)=>{posts.push({route,body});return {note:'Bahan tersimpan'};},radarLoad:async()=>reload++,radarResearch:async()=>reload++,toast:()=>{}};vm.createContext(context);vm.runInContext(code.slice(code.indexOf('function radarResearchEngine('),code.indexOf('async function radarPromptPicker(')),context);
 context.radarResearchEngine({...issue,sources:[{...source,title:'<script>unsafe</script>',acquisition:{message:'<img onerror=unsafe>'}}]});assert.ok(!html.includes('<script>'));assert.match(html,/&lt;script/);assert.match(html,/Ambil bahan sumber/);assert.match(html,/Buat naskah engine/);assert.equal(node('#radarAcquireStatus').textContent,'<img onerror=unsafe>');
 await node('#radarAcquire').onclick();assert.equal(posts[0].route,'issues/issue1/acquire');assert.equal(posts[0].body.sourceId,'s1');assert.equal(reload,2);
 node('#radarAcquire').isConnected=false;await node('#radarAcquire').onclick();assert.equal(reload,2);assert.equal(posts.length,2);
 node('#radarWriteFormat').onchange({target:{value:'shorts'}});assert.equal(node('#radarWriteMinutes').max,'3');assert.equal(node('#radarWriteMinutes').value,'1');
});
