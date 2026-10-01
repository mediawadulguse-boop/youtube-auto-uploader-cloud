import fs from 'node:fs/promises';
import {gunzipSync} from 'node:zlib';
import {PostgresStorage,checksum} from './postgres-store.mjs';
const [file,flag]=process.argv.slice(2);
if(!file){console.error('Penggunaan: npm run restore -- backup.json.gz [--apply]. Tanpa --apply hanya memvalidasi.');process.exit(1)}
try{
 const bytes=await fs.readFile(file),parsed=JSON.parse((file.endsWith('.gz')?gunzipSync(bytes):bytes).toString('utf8')),{digest,...bundle}=parsed;
 const verifier=new PostgresStorage(null);verifier.validate(bundle.documents);if(bundle.version!==1||checksum(bundle)!==digest)throw Error('Checksum backup tidak cocok');
 console.log(JSON.stringify({valid:true,createdAt:bundle.createdAt,counts:{contents:bundle.documents.contents.contents.length,notes:bundle.documents.notes.notes.length,jobs:bundle.documents.uploads.jobs.length,channels:Object.keys(bundle.documents.analytics.channels).length}}));
 if(flag==='--apply'){
   if(process.env.STORAGE_RESTORE_OFFLINE!=='true')throw Error('Hentikan aplikasi, lalu set STORAGE_RESTORE_OFFLINE=true untuk pemulihan.');
   if(!process.env.DATABASE_URL)throw Error('DATABASE_URL belum dikonfigurasi');
   const storage=await PostgresStorage.connect(process.env.DATABASE_URL);try{await storage.restore(bundle,digest);console.log('Pemulihan PostgreSQL selesai. Jalankan kembali aplikasi.')}finally{await storage.pool.end()}
 }else if(flag)throw Error('Gunakan --apply atau tanpa flag');
}catch(e){console.error('Pemulihan gagal:',e.message);process.exitCode=1}
