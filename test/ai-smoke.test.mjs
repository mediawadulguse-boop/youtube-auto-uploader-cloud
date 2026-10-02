import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {runAISmoke} from '../ai-smoke.mjs';

test('operator smoke is opt-in, one-shot across restarts, and skips unconfigured providers',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'ai-smoke-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 const calls=[],logs=[],ai={clients:Object.fromEntries(['gemini','openai','grok'].map(provider=>[provider,{provider,model:'text-model',key:'private-key',now:()=>Date.now(),complete:async()=> 'Script sintetis valid',configuration:()=>({configured:provider!=='grok'})}])),
  checkGeneration:async body=>{calls.push(body);return {generationTest:{state:'ready',model:'text-model',message:'OK'}};}};
 await runAISmoke(ai,dir,'',s=>logs.push(s));await runAISmoke(ai,dir,'../unsafe/path',s=>logs.push(s));assert.equal(calls.length,0);
 await runAISmoke(ai,dir,'operator_test_2026',s=>logs.push(s));assert.deepEqual(calls,[{provider:'gemini'},{provider:'openai'}]);assert.equal(logs.length,7);assert.ok(!logs.join('').includes('private-key'));
 await runAISmoke(ai,dir,'operator_test_2026',s=>logs.push(s));assert.equal(calls.length,2);
});
test('a crash after marker creation never repeats billable smoke calls on restart',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'ai-smoke-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));let calls=0;
 const ai={clients:{gemini:{provider:'gemini',model:'gemini-test',configuration:()=>({configured:true})}},checkGeneration:async()=>{calls++;throw Error('stopped');}};
 await assert.rejects(runAISmoke(ai,dir,'operator_crash_2026',()=>{}));await runAISmoke(ai,dir,'operator_crash_2026',()=>{});assert.equal(calls,1);
});
