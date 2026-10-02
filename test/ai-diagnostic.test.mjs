import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { runAIDiagnostic } from '../ai-diagnostic.mjs';

async function directory(t) { const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-diagnostic-')); t.after(() => fs.rm(dir, { recursive: true, force: true })); return dir; }
const valid = {text:'OK',drafts:[],citations:[]};
const output = data => Response.json({candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify(data)}]}}]});
function ai(fetcher) { return { provider:'gemini', key:'secret-key', model:'gemini-3.8-flash', configuration:()=>({configured:true}), fetcher, models:[], checkConnection:async()=>{} }; }

test('diagnostic is opt-in, bounded and once across simultaneous calls/restarts', async t => {
 const dir=await directory(t);let calls=0;const client=ai(async(url,options)=>{calls++;assert.equal(options.headers['x-goog-api-key'],'secret-key');assert.ok(!url.includes('secret-key'));const body=JSON.parse(options.body);assert.ok(!JSON.stringify(body).includes('user-script'));if(url.endsWith('interactions')){assert.equal(body.store,false);return Response.json({status:'completed',steps:[{type:'model_output',content:[{type:'text',text:JSON.stringify(valid)}]}]});}return body.generationConfig.responseFormat?output(valid):Response.json({candidates:[{finishReason:'STOP',content:{parts:[{text:'OK'}]}}]});});
 assert.deepEqual(await runAIDiagnostic(client,dir,{token:'',log:()=>{}}),[]);assert.equal(calls,0);
 const logs=[];const results=await Promise.all([1,2].map(()=>runAIDiagnostic(client,dir,{token:'audit_001',log:r=>logs.push(r)})));
 assert.equal(calls,3);assert.equal(results.flat().length,3);assert.ok(logs.every(r=>r.valid));assert.ok(!JSON.stringify(logs).includes('secret'));
 assert.deepEqual(await runAIDiagnostic(client,dir,{token:'audit_001',log:()=>{}}),[]);assert.equal(calls,3);
});
test('provider failures are sanitized and only a catalog verified alternate gets one probe',async t=>{
 const dir=await directory(t);const urls=[],logs=[];const client=ai(async url=>{urls.push(url);return Response.json({error:{status:'UNAVAILABLE',message:'secret-key raw private body'}},{status:503});});
 client.checkConnection=async()=>{client.models=[{id:'gemini-3.7-flash'},{id:'gemini-3.6-flash'}];};
 await runAIDiagnostic(client,dir,{token:'audit_002',log:r=>logs.push(r)});
 assert.equal(urls.length,4);assert.match(urls.at(-1),/gemini-3.7-flash:generateContent$/);assert.ok(logs.every(r=>r.http===503&&!r.valid&&r.providerStatus==='UNAVAILABLE'));assert.ok(!JSON.stringify(logs).includes('secret'));assert.ok(!JSON.stringify(logs).includes('private'));
});
test('malformed and incomplete success responses cannot be reported as working JSON',async t=>{
 const dir=await directory(t);const client=ai(async()=>Response.json({candidates:[{finishReason:'MAX_TOKENS',content:{parts:[{text:JSON.stringify(valid)}]}}]}));
 const results=await runAIDiagnostic(client,dir,{token:'audit_003',log:()=>{}});assert.equal(results.length,3);assert.ok(results.every(r=>!r.valid));
});
