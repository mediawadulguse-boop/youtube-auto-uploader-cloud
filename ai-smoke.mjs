import fs from 'node:fs/promises';
import path from 'node:path';
import {aiInstructions,decodeAIResult} from './radar-ai.mjs';

// Opt-in, bounded synthetic probes. Marker is written before any API call.
// Never log credentials, provider response bodies or user content.
export async function runAISmoke(ai, directory, token=process.env.AI_SMOKE_ONCE, log=console.log, providers=process.env.AI_SMOKE_PROVIDERS) {
  if(!/^[a-zA-Z0-9_-]{12,60}$/.test(token || ''))return;
  await fs.mkdir(directory,{recursive:true});
  try {await fs.writeFile(path.join(directory,'.ai-smoke-'+token),'started',{flag:'wx',mode:0o600});}
  catch(error){if(error.code==='EEXIST')return;throw error;}
  const selected=providers?new Set(String(providers).split(',').map(id=>id.trim())):null;
  for(const client of Object.values(ai.clients)) {
    if(selected&&!selected.has(client.provider))continue;
    const config=client.configuration();
    log('AI_SMOKE '+JSON.stringify({provider:client.provider,configured:config.configured,keyPresent:!!client.key,modelPresent:!!client.model,model:config.model||null,modelSource:config.modelSource||'configured',missingVariables:config.missingVariables||[],preferredProvider:ai.preferredProvider,defaultProvider:ai.defaultProvider}));
    if(!config.configured)continue;
    const connection=await ai.checkConnection?.({provider:client.provider});
    if(connection)log('AI_SMOKE '+JSON.stringify({provider:client.provider,probe:'catalog',state:connection.connection.state,model:client.model,modelAvailable:connection.models.some(m=>m.id===client.model),availableModels:connection.models.map(m=>m.id),message:connection.connection.message}));
    let status;try{status=await ai.checkGeneration({provider:client.provider});}catch(error){log('AI_SMOKE '+JSON.stringify({provider:client.provider,probe:'generation',state:'error',status:error.status||502,message:'Uji belum dapat dijalankan; periksa key dan model.'}));continue;}
    log('AI_SMOKE '+JSON.stringify({provider:client.provider,...status.generationTest}));
    if(status.generationTest?.state!=='ready')continue;
    try {
      const input=JSON.stringify({issue:null,script:'Saya ingin memahami bagaimana sebuah aturan memengaruhi kehidupan sehari-hari. Kita perlu menelusuri sejarahnya, melihat siapa yang diuntungkan, dan mendengarkan pengalaman manusia yang terkena dampaknya.',sources:[],channel:null});
      const raw=await client.complete(aiInstructions('script'),input,client.model,client.now()+60000,{maxTokens:4096});
      decodeAIResult(raw,'script',[]);
      log('AI_SMOKE '+JSON.stringify({provider:client.provider,probe:'script',state:'ready',valid:true}));
    } catch(error) {
      log('AI_SMOKE '+JSON.stringify({provider:client.provider,probe:'script',state:'error',status:error.status || 502}));
    }
  }
}
