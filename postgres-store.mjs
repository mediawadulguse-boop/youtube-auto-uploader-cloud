import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { gzipSync, gunzipSync } from 'node:zlib';
import {databaseUsage,backupUsage} from './storage-usage.mjs';

export const BACKUP_RETENTION=Object.freeze({daily:3,manual:2});
export function backupDataDigest(documents){const data=structuredClone(documents),state=data.contents?.storageBackup;if(state&&typeof state==='object')for(const key of ['lastAttemptAt','lastVerifiedAt','lastCheckedAt','error','fileId','fileName','fileUrl','digest','bytes','contentDigest','md5Checksum'])delete state[key];if(state&&typeof state==='object'&&!Object.keys(state).length)delete data.contents.storageBackup;return checksum(data);}
export const DOCUMENT_KEYS = ['uploads','contents','notes','analytics'];
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value==='object' ? Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonical(value[k])])) : value;
export const checksum = value => crypto.createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
const storageError = () => Object.assign(Error('PostgreSQL belum tersedia. Penyimpanan tidak dialihkan ke data kosong.'),{status:503,code:'storage_unavailable'});

// Preserve the existing versioned domain models in JSONB. Every CRUD mutation
// reads the latest document under a row lock; revisions remain authoritative.
export const encodeBackup=bundle=>({encoding:'gzip-base64',payload:gzipSync(JSON.stringify(bundle)).toString('base64')});
export const decodeBackup=bundle=>bundle?.encoding==='gzip-base64'?JSON.parse(gunzipSync(Buffer.from(bundle.payload,'base64'))):bundle;
export class PostgresStorage {
  constructor(pool,{backupDir,now=Date.now}={}) {this.pool=pool;this.backupDir=backupDir;this.now=now;this.mode='postgresql';this.backupChain=Promise.resolve();this.backupWarning=null;}
  static async connect(url,options) {
    const {Pool}=await import('pg');
    const pool=new Pool({connectionString:url,max:5,connectionTimeoutMillis:15000,idleTimeoutMillis:30000});
    pool.on('error',()=>console.error('Storage: PostgreSQL connection unavailable'));
    return new PostgresStorage(pool,options);
  }
  async transaction(fn) {
    const client=await this.pool.connect();
    let connectionError,rollbackError;
    // pg emits errors on checked-out clients too. The pool's idle-client
    // listener does not protect a transaction while its connection is lost.
    const onError=error=>{connectionError=error;};
    client.on?.('error',onError);
    try {await client.query('BEGIN');const result=await fn(client);if(connectionError)throw connectionError;await client.query('COMMIT');return result;}
    catch(e){try{await client.query('ROLLBACK')}catch(error){rollbackError=error}throw e;}
    finally{client.release(connectionError||rollbackError);client.removeListener?.('error',onError);}
  }
  async initialize(seed) {
    await this.pool.query(`CREATE TABLE IF NOT EXISTS app_documents (key text PRIMARY KEY, data jsonb NOT NULL, revision bigint NOT NULL DEFAULT 1, updated_at timestamptz NOT NULL DEFAULT now());
      CREATE TABLE IF NOT EXISTS app_migrations (id text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now(), manifest jsonb NOT NULL);
      CREATE TABLE IF NOT EXISTS app_backups (id uuid PRIMARY KEY, created_at timestamptz NOT NULL DEFAULT now(), kind text NOT NULL, digest text NOT NULL, bundle jsonb NOT NULL);
      ALTER TABLE app_documents SET (autovacuum_vacuum_threshold=2,autovacuum_vacuum_scale_factor=0,toast.autovacuum_vacuum_threshold=50,toast.autovacuum_vacuum_scale_factor=0);
      ALTER TABLE app_backups SET (autovacuum_vacuum_threshold=2,autovacuum_vacuum_scale_factor=0,toast.autovacuum_vacuum_threshold=50,toast.autovacuum_vacuum_scale_factor=0);`);
    await this.transaction(async client=>{
      await client.query('SELECT pg_advisory_xact_lock(44751001)');
      const existing=await client.query('SELECT key FROM app_documents');
      if(existing.rows.length){if(DOCUMENT_KEYS.some(k=>!existing.rows.some(r=>r.key===k)))throw storageError();return;}
      const {documents,files}=await seed();
      this.validate(documents);
      const id='migration-'+crypto.randomUUID(),dir=path.join(this.backupDir,id),manifest={version:1,createdAt:new Date(this.now()).toISOString(),documents:{},files:{}};
      await fs.mkdir(dir,{recursive:true,mode:0o700});
      for(const [key,file] of Object.entries(files)) {
        try{const raw=await fs.readFile(file);await fs.writeFile(path.join(dir,path.basename(file)),raw,{mode:0o600,flag:'wx'});manifest.files[key]={name:path.basename(file),sha256:crypto.createHash('sha256').update(raw).digest('hex')};}
        catch(e){if(e.code!=='ENOENT')throw e;manifest.files[key]={missing:true};}
      }
      for(const key of DOCUMENT_KEYS){manifest.documents[key]=checksum(documents[key]);await client.query('INSERT INTO app_documents(key,data) VALUES($1,$2::jsonb)',[key,JSON.stringify(documents[key])]);}
      const rows=(await client.query('SELECT key,data FROM app_documents')).rows;
      if(rows.some(r=>checksum(r.data)!==manifest.documents[r.key]))throw Error('Verifikasi migrasi PostgreSQL gagal');
      await fs.writeFile(path.join(dir,'manifest.json'),JSON.stringify(manifest,null,2),{mode:0o600,flag:'wx'});
      await client.query('INSERT INTO app_migrations(id,manifest) VALUES($1,$2::jsonb)',[id,JSON.stringify(manifest)]);
    });
    // Reclaim dead rows before allocating a new snapshot when headroom is critical.
    // A disk-full insert can otherwise exhaust WAL space before its rollback.
    if((await this.capacity(true)).level==='critical')await this.maintain();
    const startupBackups=async()=>{await this.backup('manual',{onlyIfOverLimit:true});await this.backup('daily');};
    try{await startupBackups();}
    catch(error){
      if(error.code!=='53100')throw error;
      // A failed insert is rolled back before VACUUM reclaims dead tuples.
      // Retention still requires a verified fresh snapshot before pruning.
      console.warn('Storage: reclaiming unused PostgreSQL space before retrying startup backup');
      await this.maintain();
      await startupBackups();
    }
  }
  validate(documents) {
    if(!documents||DOCUMENT_KEYS.some(k=>!documents[k])||Object.keys(documents).some(k=>!DOCUMENT_KEYS.includes(k)))throw Error('Struktur backup tidak valid');
    if(!Array.isArray(documents.uploads.jobs)||!Array.isArray(documents.contents.contents)||!Array.isArray(documents.contents.pillars)||!Array.isArray(documents.contents.columns)||!Array.isArray(documents.notes.notes)||!Array.isArray(documents.notes.categories)||!documents.analytics.channels)throw Error('Model data backup tidak valid');
  }
  async read(key){const {rows}=await this.pool.query('SELECT data FROM app_documents WHERE key=$1',[key]);if(!rows.length)throw storageError();return structuredClone(rows[0].data);}
  async mutate(key,fn){return this.transaction(async client=>{const {rows}=await client.query('SELECT data FROM app_documents WHERE key=$1 FOR UPDATE',[key]);if(!rows.length)throw storageError();const data=structuredClone(rows[0].data),before=JSON.stringify(data),result=await fn(data),after=JSON.stringify(data);if(after!==before)await client.query('UPDATE app_documents SET data=$2::jsonb,revision=revision+1,updated_at=now() WHERE key=$1',[key,after]);return structuredClone(result);});}
  async write(key,data){await this.mutate(key,document=>{for(const k of Object.keys(document))delete document[k];Object.assign(document,structuredClone(data));});}
  backup(kind='manual',options={}) {
    // Serialize the database snapshot and filesystem mirror together locally.
    // The advisory lock also guards manual cooldown across database clients.
    const work=this.backupChain.catch(()=>{}).then(()=>this.createBackup(kind,options));this.backupChain=work;return work;
  }
  checkedBackup(row){const bundle=decodeBackup(row.bundle);this.validate(bundle?.documents);if(bundle.version!==1||checksum(bundle)!==row.digest)throw Error('Checksum backup tidak cocok');return {...row,bundle};}
  async writeBackupMirror(full){
    const target=path.join(this.backupDir,full.id+'.json.gz'),tmp=target+'.'+crypto.randomUUID()+'.tmp';
    try{await fs.mkdir(this.backupDir,{recursive:true,mode:0o700});await fs.writeFile(tmp,gzipSync(JSON.stringify({...full.bundle,digest:full.digest})),{mode:0o600});const {digest,...bundle}=JSON.parse(gunzipSync(await fs.readFile(tmp)).toString('utf8'));this.validate(bundle.documents);if(digest!==full.digest||checksum(bundle)!==digest)throw Error('Verifikasi salinan volume gagal');await fs.rename(tmp,target);}finally{await fs.unlink(tmp).catch(()=>{});}
  }
  async cleanupBackupMirrors(){
    // Read current IDs under the same lock as creation so another writer's new mirror is protected.
    return this.transaction(async client=>{await client.query('SELECT pg_advisory_xact_lock(44751002)');const keep=new Set((await client.query('SELECT id FROM app_backups')).rows.map(r=>r.id));for(const name of await fs.readdir(this.backupDir))if(/^[a-f0-9-]{36}\.json\.gz$/.test(name)&&!keep.has(name.slice(0,36)))await fs.unlink(path.join(this.backupDir,name));});
  }
  async createBackup(kind,{minIntervalMs=0,onlyIfOverLimit=false}={}) {
    if(!['daily','manual'].includes(kind))throw Object.assign(Error('Jenis backup tidak valid'),{status:400});
    const result=await this.transaction(async client=>{
      await client.query('SELECT pg_advisory_xact_lock(44751002)');
      const before=(await client.query('SELECT id,kind,created_at,digest,pg_column_size(bundle)::bigint AS bytes FROM app_backups ORDER BY created_at DESC,id DESC')).rows;
      if(onlyIfOverLimit&&!Object.entries(BACKUP_RETENTION).some(([k,n])=>before.filter(r=>r.kind===k).length>n))return {skipped:true,reason:'within_retention'};
      if(kind==='manual'&&minIntervalMs){const last=before.find(r=>r.kind==='manual'),remaining=last?minIntervalMs-(this.now()-Date.parse(last.created_at)):0;if(remaining>0)throw Object.assign(Error('Tunggu satu menit sebelum membuat backup berikutnya.'),{status:429,retryAfter:Math.ceil(remaining/1000)});}
      const documents=Object.fromEntries((await client.query('SELECT key,data FROM app_documents ORDER BY key')).rows.map(r=>[r.key,r.data]));this.validate(documents);
      let full,unchanged=false,existing=false;
      if(onlyIfOverLimit){const previous=before.find(r=>r.kind==='manual');if(previous)try{const candidate=this.checkedBackup((await client.query('SELECT * FROM app_backups WHERE id=$1',[previous.id])).rows[0]);if(checksum(candidate.bundle.documents)===checksum(documents)){full=candidate;existing=true;unchanged=true;}}catch{}}
      if(kind==='daily'){
        const previous=before.find(r=>r.kind==='daily');
        if(previous)try{const row=(await client.query('SELECT * FROM app_backups WHERE id=$1',[previous.id])).rows[0],candidate=this.checkedBackup(row);unchanged=backupDataDigest(candidate.bundle.documents)===backupDataDigest(documents);if(unchanged||new Date(candidate.created_at).toISOString().slice(0,10)===new Date(this.now()).toISOString().slice(0,10)){full=candidate;existing=true;}}catch{}
      }
      if(!full){const bundle={version:1,createdAt:new Date(this.now()).toISOString(),documents},id=crypto.randomUUID(),digest=checksum(bundle);await client.query('INSERT INTO app_backups(id,kind,digest,bundle,created_at) VALUES($1,$2,$3,$4::jsonb,$5)',[id,kind,digest,JSON.stringify(encodeBackup(bundle)),bundle.createdAt]);full=this.checkedBackup((await client.query('SELECT * FROM app_backups WHERE id=$1',[id])).rows[0]);}
      let mirror='ready',warning=null,removed=0;
      try{await this.writeBackupMirror(full);}catch{mirror='error';warning='Backup tersimpan di PostgreSQL. Verifikasi salinan volume belum berhasil; pemangkasan backup lama ditunda.';}
      if(mirror==='ready'){
        const points=(await client.query('SELECT id,kind FROM app_backups ORDER BY (id=$1) DESC,created_at DESC,id DESC',[full.id])).rows,seen={},keep=[],expired=[];
        for(const point of points){seen[point.kind]=(seen[point.kind]||0)+1;(seen[point.kind]<=(BACKUP_RETENTION[point.kind]||Infinity)?keep:expired).push(point.id);}
        if(expired.length){
          try{for(const id of keep)this.checkedBackup((await client.query('SELECT * FROM app_backups WHERE id=$1',[id])).rows[0]);}
          catch{warning='Ada salinan pemulihan yang belum lolos verifikasi. Pemangkasan backup lama ditunda.';}
          if(!warning){for(const id of expired)await client.query('DELETE FROM app_backups WHERE id=$1',[id]);removed=expired.length;}
        }
      }
      const points=(await client.query('SELECT kind,pg_column_size(bundle)::bigint AS bytes FROM app_backups')).rows;
      const retention={...BACKUP_RETENTION,removed,remaining:points.length,dailyCount:points.filter(r=>r.kind==='daily').length,manualCount:points.filter(r=>r.kind==='manual').length,storedBytesBefore:before.reduce((n,r)=>n+Number(r.bytes),0),storedBytesAfter:points.reduce((n,r)=>n+Number(r.bytes),0)};
      return {id:full.id,createdAt:full.created_at,kind:full.kind,digest:full.digest,mirror,warning,existing,unchanged,retention};
    });
    if(Object.hasOwn(result,'warning'))this.backupWarning=result.warning;
    if(result.retention?.removed){this.capacityCache=null;console.log('Backup retention:',JSON.stringify({...result.retention,verified:true}));}
    if(result.mirror==='ready'&&!result.warning)try{await this.cleanupBackupMirrors();}catch{console.error('Backup mirror cleanup pending');}
    if(result.warning)console.error('Backup: verification pending; previous restore points preserved');
    return result;
  }
  async listBackups(){return (await this.pool.query('SELECT id,created_at AS "createdAt",kind,digest,pg_column_size(bundle)::bigint AS "storedBytes" FROM app_backups ORDER BY created_at DESC')).rows.map(b=>({...b,storedBytes:Number(b.storedBytes)}));}
  async getBackup(id){if(!/^[a-f0-9-]{36}$/.test(id))throw Object.assign(Error('Backup tidak valid'),{status:400});const row=(await this.pool.query('SELECT * FROM app_backups WHERE id=$1',[id])).rows[0];if(!row)throw Object.assign(Error('Backup tidak ditemukan'),{status:404});return this.checkedBackup(row);}
  async snapshot(){const documents=Object.fromEntries((await this.pool.query('SELECT key,data FROM app_documents ORDER BY key')).rows.map(r=>[r.key,r.data]));this.validate(documents);const bundle={version:1,createdAt:new Date(this.now()).toISOString(),documents};return {bundle,digest:checksum(bundle)};}
  async compactBackup(){const capacity=await this.capacity(true);if(!capacity.budgetBytes||capacity.level!=='ready')return {compressed:0,skipped:'insufficient_headroom'};return this.transaction(async client=>{await client.query('SELECT pg_advisory_xact_lock(44751002)');const row=(await client.query("SELECT id,bundle,digest FROM app_backups WHERE bundle->>'encoding' IS DISTINCT FROM 'gzip-base64' ORDER BY created_at LIMIT 1 FOR UPDATE")).rows[0];if(!row)return {compressed:0};if(checksum(row.bundle)!==row.digest)throw Error('Checksum backup lama tidak cocok');const encoded=encodeBackup(row.bundle);if(checksum(decodeBackup(encoded))!==row.digest)throw Error('Verifikasi kompresi gagal');await client.query('UPDATE app_backups SET bundle=$2::jsonb WHERE id=$1',[row.id,JSON.stringify(encoded)]);return {compressed:1};});}
  async maintain(){await this.pool.query('VACUUM (TRUNCATE ON) app_documents');await this.pool.query('VACUUM (TRUNCATE ON) app_backups');this.capacityCache=null;return {ready:true};}
  async capacity(fresh=false){if(!fresh&&this.capacityCache&&this.now()-this.capacityCache.checkedMs<300000)return this.capacityCache.value;try{const row=(await this.pool.query('SELECT pg_database_size(current_database()) AS database_bytes, (SELECT COALESCE(sum(size),0) FROM pg_ls_waldir()) AS wal_bytes')).rows[0],databaseBytes=Number(row.database_bytes),walBytes=Number(row.wal_bytes),budgetBytes=Number(process.env.DATABASE_VOLUME_MB||0)*1024*1024,estimateBytes=databaseBytes+walBytes,ratio=budgetBytes?estimateBytes/budgetBytes:null;const value={databaseBytes,walBytes,estimateBytes,budgetBytes:budgetBytes||null,estimated:true,level:ratio===null?'unknown':ratio>=.9?'critical':ratio>=.75?'warning':'ready',note:'Estimasi database aktif + WAL, bukan pembacaan ruang bebas volume. Ukuran fisik tidak langsung turun setelah penghapusan; PostgreSQL memakai ulang ruang.'};this.capacityCache={checkedMs:this.now(),value};return value;}catch{return {level:'unknown',note:'Ukuran database belum dapat diperiksa.'};}}
  async status(){const migration=(await this.pool.query('SELECT id,applied_at FROM app_migrations ORDER BY applied_at DESC LIMIT 1')).rows[0],backups=await this.listBackups();await Promise.all(backups.map(async b=>{try{const stat=await fs.stat(path.join(this.backupDir,b.id+'.json.gz'));b.volumeCopy='ready';b.fileBytes=stat.size;}catch{b.volumeCopy='missing';b.fileBytes=null;}}));const last=backups.find(b=>b.kind==='manual'),usage=await databaseUsage(this.pool).catch(()=>({available:false,error:'Rincian kategori belum dapat diperiksa.'}));return {backupRetention:{...BACKUP_RETENTION,skipUnchanged:true},usage:{...usage,backups:backupUsage(backups)},capacity:await this.capacity(true),backupEncoding:'gzip',mode:this.mode,ready:true,migratedAt:migration?.applied_at||null,backups,backupWarning:this.backupWarning||(backups.some(b=>b.volumeCopy==='missing')?'Backup tetap tersimpan di PostgreSQL dan bisa diunduh. Ada salinan di volume yang belum tersedia.':null),manualAvailableAt:last?new Date(Date.parse(last.createdAt)+60000).toISOString():null};}
  async restore(bundle,digest){this.validate(bundle?.documents);if(bundle.version!==1||checksum(bundle)!==digest)throw Error('Backup rusak atau checksum tidak cocok');return this.transaction(async client=>{await client.query('SELECT key FROM app_documents ORDER BY key FOR UPDATE');for(const key of DOCUMENT_KEYS)await client.query('UPDATE app_documents SET data=$2::jsonb,revision=revision+1,updated_at=now() WHERE key=$1',[key,JSON.stringify(bundle.documents[key])]);});}
}
