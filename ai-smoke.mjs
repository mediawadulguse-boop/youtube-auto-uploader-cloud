import fs from 'node:fs/promises';
import path from 'node:path';
import {aiInstructions,decodeAIResult} from './radar-ai.mjs';

// Opt-in, bounded synthetic probes. Marker is written before any API call.
// Never log credentials, provider response bodies or user content.
export async function runAISmoke(ai, directory, token=process.env.AI_SMOKE_ONCE, log=console.log) {
  if(!/^[a-zA-Z0-9_-]{12,60}$/.test(token || ''))return;
  await fs.mkdir(directory,{recursive:true});
  try {await fs.writeFile(path.join(directory,'.ai-smoke-'+token),'started',{flag:'wx',mode:0o600});}
  catch(error){if(error.code==='EEXIST')return;throw error;}
  for(const client of Object.values(ai.clients)) {
    const config=client.configuration();
    log('AI_SMOKE '+JSON.stringify({provider:client.provider,configured:config.configured,model:config.configured?client.model:null}));
    if(!config.configured)continue;
    const status=await ai.checkGeneration({provider:client.provider});
    log('AI_SMOKE '+JSON.stringify({provider:client.provider,...status.generationTest}));
    if(status.generationTest?.state!=='ready')continue;
    try {
      const input=JSON.stringify({issue:null,script:'Saya ingin memahami bagaimana sebuah aturan memengaruhi kehidupan sehari-hari. Kita perlu menelusuri sejarahnya, melihat siapa yang diuntungkan, dan mendengarkan pengalaman manusia yang terkena dampaknya.',sources:[],channel:null});
      const raw=await client.complete(aiInstructions('script'),input,client.model,client.now()+20000,{maxTokens:4096});
      decodeAIResult(raw,'script',[]);
      log('AI_SMOKE '+JSON.stringify({provider:client.provider,probe:'script',state:'ready',valid:true}));
    } catch(error) {
      log('AI_SMOKE '+JSON.stringify({provider:client.provider,probe:'script',state:'error',status:error.status || 502}));
    }
  }
}
