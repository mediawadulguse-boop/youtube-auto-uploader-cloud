import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
const source=await fs.readFile(new URL('../public/radar.js',import.meta.url),'utf8');
const esc=s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');
test('prompt picker escapes names and sends selected revision and edited prompt for persistent saving',async()=>{
 const nodes=new Map(),node=id=>{if(!nodes.has(id))nodes.set(id,{value:'',isConnected:true,innerHTML:''});return nodes.get(id);},calls=[];const p={id:'prompt-id',name:'<img onerror=evil>',action:'script',prompt:'Prompt tersimpan',revision:3};
 const context={esc,radarUi:{},$:node,api:async()=>({prompts:[p],starters:[]}),rPost:async(path,body,method)=>calls.push({path,body,method}),radarRun:f=>f(),toast:()=>{}};vm.createContext(context);vm.runInContext(source.slice(source.indexOf('async function radarPromptPicker('),source.indexOf('async function radarPromptLibrary(')),context);
 await context.radarPromptPicker('script');assert.ok(!node('#radarPromptPicker').innerHTML.includes('<img'));assert.match(node('#radarPromptPicker').innerHTML,/&lt;img/);
 node('#radarSavedPrompt').value=p.id;node('#radarSavedPrompt').onchange({target:{value:p.id}});assert.equal(node('#radarCustomPrompt').value,p.prompt);node('#radarCustomPrompt').value='Prompt revisi';await node('#radarSavePrompt').onclick();assert.equal(calls[0].method,'PATCH');assert.equal(calls[0].path,'prompts/prompt-id');assert.equal(calls[0].body.revision,3);assert.equal(calls[0].body.prompt,'Prompt revisi');
});
test('slow modal data never replaces a dialog that the editor has closed or switched',async()=>{
 let resolve;const loading={isConnected:true},context={rDialog:{open:true,querySelector:()=>loading},radarModal:()=>{},api:()=>new Promise(r=>resolve=r)};vm.createContext(context);vm.runInContext(source.slice(source.indexOf('async function radarFetchModal(')),context);
 const pending=context.radarFetchModal('Riset','/api/radar');loading.isConnected=false;resolve({issue:'stale'});assert.equal(await pending,null);
});
