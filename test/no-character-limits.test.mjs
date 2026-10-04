import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {ContentStore} from '../content-store.mjs';
import {NotesStore} from '../notes-store.mjs';
import {RadarStore} from '../radar-store.mjs';
import {RadarMemory} from '../radar-memory.mjs';
import {RadarWorkspace} from '../radar-workspace.mjs';
import {RadarAI,RadarAIProviders,decodeAIResult} from '../radar-ai.mjs';

async function setup(t){const dir=await fs.mkdtemp(path.join(os.tmpdir(),'unlimited-writing-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));const content=new ContentStore(path.join(dir,'contents.json')),radar=new RadarStore(content);return {dir,content,radar};}
const large='Naskah lengkap dengan atribusi yang tetap utuh. '.repeat(5000)+'AKHIR TEKS UTUH';
test('long writing fields, rich markup, research material and duplicated titles survive restart without clipping',async t=>{
 const {dir,content}=await setup(t),title='Judul lengkap '.repeat(60),html='<p>'+large+'</p>',saved=await content.create({title,brief:large,audience:large,hook:large,cta:large,productionNotes:large,script:large,richText:{script:html},sources:[{label:title,url:'https://media.example/a',notes:large}]});
 const restarted=new ContentStore(path.join(dir,'contents.json')),found=(await restarted.read()).contents.find(c=>c.id===saved.id);for(const field of ['brief','audience','hook','cta','productionNotes','script'])assert.equal(found[field],large);assert.equal(found.richText.script,html);assert.equal(found.sources[0].notes,large);assert.equal((await restarted.duplicate(saved.id)).title,title.trim()+' (salinan)');
 const notes=new NotesStore(path.join(dir,'notes.json')),rich='Teks panjang '.repeat(130000)+'AKHIR HTML',category='Kategori '.repeat(30);await notes.createCategory({name:category});const note=await notes.create({title,bodyHtml:'<p>'+rich+'</p>',category,tags:['tag'.repeat(100)]});assert.equal(note.body,rich);assert.equal((await new NotesStore(path.join(dir,'notes.json')).read()).notes[0].bodyHtml,'<p>'+rich+'</p>');
});
test('prompt versions, imported transcript, checklist labels and notes preserve long text across restart',async t=>{
 const {dir,radar}=await setup(t),memory=new RadarMemory(radar),prompt=await memory.save({name:'P'.repeat(301),prompt:large,action:'script'});assert.equal(prompt.prompt,large);
 await radar.addSources([{title:'Sumber lengkap',url:'https://media.example/long',publisher:'Media',coverage:'manual',excerpt:large}]);let issue=(await radar.read()).issues[0],workspace=new RadarWorkspace(radar);assert.equal(issue.sources[0].excerpt,large);
 issue=await workspace.import(issue.id,{revision:issue.revision,sourceId:issue.sources[0].id,text:large,format:'txt'});issue=await workspace.save(issue.id,{revision:issue.revision,notes:large,checklist:[{label:large,done:false}]});
 const restarted=new RadarStore(new ContentStore(path.join(dir,'contents.json'))),found=(await restarted.read()).issues[0];assert.equal(found.sources[0].transcript.text,large);assert.equal(found.research.notes,large);assert.equal(found.research.checklist[0].label,large);assert.equal((await new RadarMemory(restarted).list()).prompts[0].prompt,large);
});
test('AI receives complete long prompt, script, brief and source notes, and accepts complete long results',async t=>{
 const {radar}=await setup(t);let payload,calls=0;const ai=new RadarAI(radar,{provider:'groq',key:'test-only',model:'openai/gpt-oss-120b',fetcher:async(url,options)=>{calls++;payload=JSON.parse(options.body);return Response.json({choices:[{finish_reason:'stop',message:{content:large}}]});}});
 const result=await ai.generate({action:'polish',script:large,brief:large,title:'J'.repeat(1000),customPrompt:large,sources:[{label:'S'.repeat(500),url:'https://media.example/a',notes:large}]});const input=JSON.parse(payload.messages[1].content);assert.ok(payload.messages[0].content.includes(large));assert.equal(input.script,large);assert.equal(input.brief,large);assert.equal(input.sources[0].excerpt,large);assert.equal(result.text,large);assert.equal(calls,1);assert.equal(decodeAIResult(large,'script',[]).text,large);
});
test('provider context rejection is explicit, refunds app usage, preserves originals and never retries on a backup',async t=>{
 const {radar,content}=await setup(t);const saved=await content.create({title:'Naskah tersimpan',script:large});let primary=0,backup=0;
 const ai=new RadarAIProviders(radar,{defaultProvider:'openai',providers:{openai:{key:'test-only',model:'gpt-test',fetcher:async()=>{primary++;return Response.json({error:{message:'Maximum context length exceeded',code:'context_length_exceeded'}},{status:400});}},groq:{key:'test-only',model:'groq-test',fetcher:async()=>{backup++;throw Error('must not retry');}},gemini:{key:'',model:''}}});
 await assert.rejects(ai.generate({action:'script',script:large,customPrompt:large}),e=>e.status===413&&e.providerContext&&/Teks asli tetap utuh/.test(e.message));assert.equal(primary,1);assert.equal(backup,0);assert.equal((await ai.status()).used,0);assert.equal((await content.read()).contents.find(c=>c.id===saved.id).script,large);
});
test('long full draft remains selectable for AI polishing and editor input/paste has no character rollback',async()=>{
 const code=await fs.readFile(new URL('../public/radar.js',import.meta.url),'utf8'),nodes=new Map(),node=id=>{if(!nodes.has(id))nodes.set(id,{value:'0'});return nodes.get(id);};let html='',sent;
 const context={$:node,rDialog:{},radarModal:(title,value)=>html=value,radarRun:fn=>fn(),radarAI:async(action,value)=>sent=value,esc:String,rNum:String};vm.createContext(context);vm.runInContext(code.slice(code.indexOf('function radarPolish('),code.indexOf('function radarResearchEngine(')),context);context.radarPolish('polish',{script:large});assert.match(html,/Seluruh draft/);await node('#radarPolishStart').onclick();assert.equal(sent.script,large);assert.equal(sent.polishOriginal,large);
 for(const file of ['public/index.html','public/content.js','public/radar.js'])assert.ok(!/maxlength=/.test(await fs.readFile(new URL('../'+file,import.meta.url),'utf8')));
 const rich=await fs.readFile(new URL('../public/rich-text.js',import.meta.url),'utf8');assert.ok(!/textarea\.maxLength|Batas panjang teks tercapai|Teks yang ditempel melebihi/.test(rich));
});
