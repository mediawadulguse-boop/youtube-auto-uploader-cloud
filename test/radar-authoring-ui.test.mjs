import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
const source=await fs.readFile(new URL('../public/radar.js',import.meta.url),'utf8');

test('script AI dialog sends the typed custom prompt with empty script and preserves it when controls refresh',async()=>{
 const nodes=new Map(),node=id=>{if(!nodes.has(id))nodes.set(id,{value:'',innerHTML:'',isConnected:true,classList:{add(){},remove(){}}});return nodes.get(id);};
 const config={configured:true,providerId:'openai',model:'gpt-test',used:0,limit:20},calls=[];let modal='';
 const edit={epoch:4,content:{sources:[]}},context={hub:{editing:edit},radarUi:{data:{ai:config}},rDialog:{open:true},$:selector=>node(selector),api:async()=>({ai:config}),radarAIPath:()=>'/api/radar',radarPromptPicker:async()=>{},radarAIControls:()=>'<select id="radarAIModel"></select>',radarAIBind:()=>{node('#radarAIModel').value='gpt-test';node('#radarAIProvider').value='openai';},esc:s=>String(s).replaceAll('<','&lt;'),radarModal:(title,html)=>{modal=html;},radarRun:fn=>fn(),rPost:async(path,body)=>{calls.push({path,body});return {text:'Hasil script',sources:[],drafts:[]};},radarAIResult:()=>{},radarList:()=>{}};
 vm.createContext(context);vm.runInContext(source.slice(source.indexOf('async function radarAI('),source.indexOf("document.getElementById('scriptAI')")),context);
 await context.radarAI('script',{script:'',title:'Topik baru',sources:[]});assert.match(modal,/Prompt khusus/);assert.match(modal,/maxlength="12000"/);
 const prompt='Buat script 8 menit. Gunakan PAS.\nHook tajam.';node('#radarCustomPrompt').value=prompt;node('#radarCustomPrompt').oninput({target:{value:prompt}});
 await node('#radarGenerateAI').onclick();assert.equal(calls.length,1);assert.equal(calls[0].body.customPrompt,prompt);assert.equal(calls[0].body.script,'');assert.equal(calls[0].body.title,'Topik baru');assert.equal(context.radarUi.aiLast.edit,edit);
 await context.radarAI('script',{script:''});assert.ok(modal.includes(prompt));
});

test('daily/weekly digest dialog keeps selected period and topic when opening AI and escapes source excerpts',async()=>{
 const nodes=new Map(),node=id=>{if(!nodes.has(id))nodes.set(id,{value:'',isConnected:true});return nodes.get(id);};let html='',request,aiContext;
 const report={date:'2026-10-03',startAt:'2026-09-27T17:00:00Z',throughAt:'2026-10-03T04:00:00Z',partial:true,groups:1,sourceCount:2,publishers:2,platforms:{YouTube:1},topic:'topic1',note:'Deskripsi bukan transkrip',items:[{id:'issue1',title:'Judul',status:'new',stats:{counts:{YouTube:1,'Berita / Web':1}},sources:[{url:'https://youtu.be/abcdefghijk',publisher:'Channel',title:'Judul video',excerpt:'<img onerror=evil>'}]}]};
 const context={radarUi:{topic:'topic1'},rDialog:{open:true,querySelectorAll:()=>[]},$:selector=>node(selector),radarModal:(title,text)=>{html=text;},api:async url=>{request=url;return report;},URLSearchParams,esc:s=>String(s).replaceAll('<','&lt;'),rDate:String,radarRating:()=>'',rStatus:{new:'Baru'},radarRun:fn=>fn(),radarAI:async(action,ctx)=>{aiContext={action,...ctx};}};
 vm.createContext(context);vm.runInContext(source.slice(source.indexOf('async function radarDigest('),source.indexOf('async function radarLoad(')),context);
 await context.radarDigest('weekly','2026-10-03');assert.match(request,/period=weekly/);assert.match(request,/topic=topic1/);assert.match(html,/Senin–Minggu/);assert.ok(!html.includes('<img onerror'));assert.match(html,/&lt;img/);
 await node('#radarDigestAI').onclick();assert.equal(aiContext.action,'digest');assert.equal(aiContext.digestPeriod,'weekly');assert.equal(aiContext.digestDate,'2026-10-03');assert.equal(aiContext.digestTopic,'topic1');assert.equal(aiContext.script,'');
});
