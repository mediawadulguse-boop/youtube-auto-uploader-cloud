import fs from 'node:fs/promises';
import path from 'node:path';

// Return aggregates only: writing, credentials and source text never enter the API response.
export async function databaseUsage(pool) {
 const {rows}=await pool.query(`WITH docs AS MATERIALIZED (SELECT key,data FROM app_documents),
 c AS (SELECT data FROM docs WHERE key='contents'),
 r AS (SELECT COALESCE(data->'radar','{}'::jsonb) AS data FROM c),
 pieces(id,payload,items) AS (
 SELECT 'production',COALESCE(data->'contents','[]'::jsonb),jsonb_array_length(COALESCE(data->'contents','[]'::jsonb)) FROM c
 UNION ALL SELECT 'radar',data-ARRAY['aiCache','aiHistory','promptLibrary','reportArchive'],jsonb_array_length(COALESCE(data->'issues','[]'::jsonb)) FROM r
 UNION ALL SELECT 'notes',data,jsonb_array_length(COALESCE(data->'notes','[]'::jsonb)) FROM docs WHERE key='notes'
 UNION ALL SELECT 'analytics',data,(SELECT count(*) FROM jsonb_object_keys(COALESCE(data->'channels','{}'::jsonb))) FROM docs WHERE key='analytics'
 UNION ALL SELECT 'uploads',data,jsonb_array_length(COALESCE(data->'jobs','[]'::jsonb)) FROM docs WHERE key='uploads'
 UNION ALL SELECT 'ai',COALESCE((SELECT jsonb_object_agg(key,value) FROM jsonb_each(r.data) WHERE key IN ('aiCache','aiHistory','promptLibrary')),'{}'::jsonb),
 jsonb_array_length(COALESCE(data->'aiCache','[]'::jsonb))+jsonb_array_length(COALESCE(data->'aiHistory','[]'::jsonb))+jsonb_array_length(COALESCE(data->'promptLibrary','[]'::jsonb)) FROM r
 UNION ALL SELECT 'reports',COALESCE(data->'reportArchive','[]'::jsonb),jsonb_array_length(COALESCE(data->'reportArchive','[]'::jsonb)) FROM r
 UNION ALL SELECT 'settings',data-ARRAY['contents','radar'],jsonb_array_length(COALESCE(data->'columns','[]'::jsonb))+jsonb_array_length(COALESCE(data->'pillars','[]'::jsonb)) FROM c
 ) SELECT id,octet_length(payload::text)::bigint AS bytes,items FROM pieces`);
 const categories=rows.map(row=>({id:row.id,bytes:Number(row.bytes),items:Number(row.items)}));
 return {available:true,basis:'json_utf8',measuredAt:new Date().toISOString(),totalBytes:categories.reduce((n,c)=>n+c.bytes,0),categories};
}

export function backupUsage(backups) {
 const kinds=['daily','manual'].map(kind=>({kind,count:backups.filter(b=>b.kind===kind).length,bytes:backups.filter(b=>b.kind===kind).reduce((n,b)=>n+(b.storedBytes||0),0)}));
 return {count:backups.length,storedBytes:kinds.reduce((n,k)=>n+k.bytes,0),kinds};
}

export async function volumeUsage(directory,{io=fs}={}) {
 const kinds=['videos','backups','legacy','localData','credentials','other'],categories=kinds.map(id=>({id,bytes:0,items:0}));
 let partial=false,visited=0;const started=Date.now();let capacity=null;
 try {const stat=await io.statfs(directory);capacity={totalBytes:stat.blocks*stat.bsize,usedBytes:(stat.blocks-stat.bfree)*stat.bsize,availableBytes:stat.bavail*stat.bsize};}catch{}
 const category=relative=>relative.startsWith('uploads/')?'videos':relative.startsWith('backups/')?'backups':/\.backup\.|\.backup$/.test(relative)?'legacy':/token.*\.enc\.json$/.test(relative)?'credentials':relative.endsWith('.json')?'localData':'other';
 async function walk(current,relative=''){
  let entries;try{entries=await io.readdir(current,{withFileTypes:true});}catch(error){if(error.code!=='ENOENT')partial=true;return;}
  for(const entry of entries){if(++visited>20000||Date.now()-started>5000){partial=true;return;}
   const name=relative?relative+'/'+entry.name:entry.name,full=path.join(current,entry.name);
   if(entry.isSymbolicLink()){partial=true;continue;}
   if(entry.isDirectory())await walk(full,name);
   else if(entry.isFile())try{const stat=await io.lstat(full);if(!stat.isFile()){partial=true;continue;}const item=categories.find(c=>c.id===category(name));item.bytes+=stat.size;item.items++;}catch{partial=true;}
  }
 }
 await walk(directory);
 return {available:!!capacity,capacity,categories,totalFileBytes:categories.reduce((n,c)=>n+c.bytes,0),partial,measuredAt:new Date().toISOString()};
}
