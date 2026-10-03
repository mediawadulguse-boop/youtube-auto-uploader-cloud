import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
const script=await fs.readFile(new URL('../public/radar.js',import.meta.url),'utf8');
const functions=script.slice(script.indexOf('function radarAIConnection('),script.indexOf('async function radarAI('));
function setup(){
 let now=Date.parse('2026-10-02T08:00:00Z');
 const elements={radarAIModel:{value:'',isConnected:true},radarCheckAI:{},radarAIConnection:{innerHTML:''},radarGenerateAI:{disabled:false,textContent:''}};
 const timers=new Map();let sequence=0;
 const context={Date:class extends Date{static now(){return now;}},esc:s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),rDate:s=>s,radarUi:{},rDialog:{open:true},$:id=>elements[id.slice(1)],setInterval:fn=>{timers.set(++sequence,fn);return sequence;},clearInterval:id=>timers.delete(id)};
 vm.createContext(context);vm.runInContext(functions,context);
 return {context,elements,timers,advance:ms=>{now+=ms;for(const fn of [...timers.values()])fn();}};
}
const config={configured:true,provider:'Gemini',model:'gemini-test',models:[{id:'gemini-test'}],connection:{state:'connected',checkedAt:'2026-10-02T08:00:00Z',message:'Daftar model berhasil diperiksa.'},modelResults:{'gemini-test':{state:'busy',checkedAt:'2026-10-02T07:59:55Z',message:'Gemini HTTP 503',retryAt:'2026-10-02T08:00:30Z'}}};
test('newer successful catalog check never hides previous failed preview and escapes messages',()=>{
 const {context}=setup();const html=context.radarAIConnection(config,'gemini-test');assert.match(html,/API terhubung/);assert.match(html,/Pratinjau.*gagal sementara/);assert.match(html,/HTTP 503/);assert.match(html,/Ulangi dalam 30 detik/);
 const untrusted=structuredClone(config);untrusted.modelResults['gemini-test'].message='<img src=x onerror=alert(1)>';assert.ok(!context.radarAIConnection(untrusted,'gemini-test').includes('<img'));
});
test('cooldown disables generation, counts down, re-enables and cleans timer when modal closes',()=>{
 const {context,elements,timers,advance}=setup();context.radarAIBind(config);assert.equal(elements.radarGenerateAI.disabled,true);assert.match(elements.radarGenerateAI.textContent,/30 dtk/);assert.equal(timers.size,1);
 advance(10000);assert.match(elements.radarGenerateAI.textContent,/20 dtk/);advance(20000);assert.equal(elements.radarGenerateAI.disabled,false);assert.equal(elements.radarGenerateAI.textContent,'Buat pratinjau');assert.equal(timers.size,0);
 const next=structuredClone(config);next.modelResults['gemini-test'].retryAt='2026-10-02T08:01:00Z';context.radarAIBind(next);assert.equal(timers.size,1);context.rDialog.open=false;advance(1000);assert.equal(timers.size,0);
});
test('changing to another available model permits generation during first model cooldown; unavailable model remains blocked',()=>{
 const {context,elements,timers}=setup();const next=structuredClone(config);next.models.push({id:'gemini-alternate'});context.radarAIBind(next);assert.equal(elements.radarGenerateAI.disabled,true);
 elements.radarAIModel.value='gemini-alternate';elements.radarAIModel.onchange();assert.equal(elements.radarGenerateAI.disabled,false);assert.equal(timers.size,0);assert.match(elements.radarAIConnection.innerHTML,/Belum ada hasil pratinjau/);
 elements.radarAIModel.value='gemini-unknown';elements.radarAIModel.onchange();assert.equal(elements.radarGenerateAI.disabled,true);assert.match(elements.radarAIConnection.innerHTML,/Model tidak tersedia/);
});

test('provider controls show GPT/Groq, reset cross-provider models and explain missing configuration',()=>{
 const {context}=setup();context.radarUi.aiProvider='gemini';context.radarUi.aiModel='gemini-test';
 const next={...config,provider:'Groq',providerId:'groq',model:'groq-test',models:[],configured:false,connection:{state:'unconfigured'},modelResults:{},autoFallback:true,setupMessage:'Isi GROQ_API_KEY dan GROQ_MODEL.',providers:[{providerId:'gemini',provider:'Gemini',configured:true},{providerId:'openai',provider:'OpenAI',configured:true},{providerId:'groq',provider:'Groq',configured:false}]};
 const html=context.radarAIControls(next);assert.match(html,/GPT \(OpenAI\)/);assert.match(html,/Groq/);assert.match(html,/Pindah otomatis/);assert.match(html,/GROQ_API_KEY/);assert.ok(!html.includes('id="radarAIModel"'));assert.equal(context.radarUi.aiModel,'groq-test');assert.equal(context.radarUi.aiProvider,'groq');
});
test('quota fallback is reported as another provider, not successful generation by the exhausted model',()=>{
 const {context}=setup();const next={...config,modelResults:{'gemini-test':{state:'fallback',message:'Pratinjau dibuat oleh Groq · groq-test.'}}};const html=context.radarAIConnection(next,'gemini-test');assert.match(html,/Pratinjau: provider cadangan/);assert.match(html,/Groq/);assert.ok(!html.includes('Pratinjau terakhir gagal'));
});
test('available backup keeps preview enabled; all blocked providers use earliest recovery time',()=>{
 const {context,elements}=setup();const next={...config,providerId:'gemini',autoFallback:true,providers:[{providerId:'gemini',configured:true,quotaRetryAt:'2026-10-02T08:01:00Z'},{providerId:'groq',configured:true,quotaRetryAt:null}]};
 context.radarAIBind(next);assert.equal(elements.radarGenerateAI.disabled,false);
 next.providers[1].quotaRetryAt='2026-10-02T08:00:20Z';context.radarAIBind(next);assert.equal(elements.radarGenerateAI.disabled,true);assert.match(elements.radarGenerateAI.textContent,/20 dtk/);
});
test('real response evidence is separate from catalog success and failure messages are escaped',()=>{
 const {context}=setup();const next={...config,generationTest:{model:'gemini-test',state:'error',message:'<secret>',checkedAt:'2026-10-02T08:00:00Z'}};
 const html=context.radarAIConnection(next,'gemini-test');assert.match(html,/API terhubung/);assert.match(html,/Uji jawaban gagal/);assert.ok(!html.includes('<secret>'));assert.ok(!context.radarAIConnection(next,'other-model').includes('Uji jawaban gagal'));
});
test('reuse remains available during provider cooldown while forcing a new request obeys it',()=>{
 const {context,elements}=setup();elements.radarForceAI={checked:false};context.radarAIBind(config);assert.equal(elements.radarGenerateAI.disabled,false);assert.equal(elements.radarGenerateAI.textContent,'Gunakan hasil tersimpan');
 elements.radarForceAI.checked=true;elements.radarForceAI.onchange();assert.equal(elements.radarGenerateAI.disabled,true);assert.match(elements.radarGenerateAI.textContent,/30 dtk/);
});
