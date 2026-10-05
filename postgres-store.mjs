import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { gzipSync } from 'node:zlib';

export const DOCUMENT_KEYS = ['uploads','contents','notes','analytics'];
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value==='object' ? Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonical(value[k])])) : value;
export const checksum = value => crypto.createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
const storageError = () => Object.assign(Error('PostgreSQL belum tersedia. Penyimpanan tidak dialihkan ke data kosong.'),{status:503,code:'storage_unavailable'});

// Preserve the existing versioned domain models in JSONB. Every CRUD mutation
// reads the latest document under a row lock; revisions remain authoritative.
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
      CREATE TABLE IF NOT EXISTS app_backups (id uuid PRIMARY KEY, created_at timestamptz NOT NULL DEFAULT now(), kind text NOT NULL, digest text NOT NULL, bundle jsonb NOT NULL);`);
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
    await this.backup('daily');
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
  async createBackup(kind,{minIntervalMs=0}={}) {
    if(!['daily','manual'].includes(kind))throw Object.assign(Error('Jenis backup tidak valid'),{status:400});
    const entry=await this.transaction(async client=>{
      await client.query('SELECT pg_advisory_xact_lock(44751002)');
      if(kind==='manual'&&minIntervalMs){const last=(await client.query("SELECT created_at FROM app_backups WHERE kind='manual' ORDER BY created_at DESC LIMIT 1")).rows[0];const remaining=last?minIntervalMs-(this.now()-Date.parse(last.created_at)):0;if(remaining>0)throw Object.assign(Error('Tunggu satu menit sebelum membuat backup berikutnya.'),{status:429,retryAfter:Math.ceil(remaining/1000)});}
      if(kind==='daily'){const last=(await client.query("SELECT id,created_at FROM app_backups WHERE kind='daily' ORDER BY created_at DESC LIMIT 1")).rows[0];if(last&&new Date(last.created_at).toISOString().slice(0,10)===new Date(this.now()).toISOString().slice(0,10))return {...last,existing:true};}
      const documents=Object.fromEntries((await client.query('SELECT key,data FROM app_documents ORDER BY key')).rows.map(r=>[r.key,r.data]));this.validate(documents);
      const bundle={version:1,createdAt:new Date(this.now()).toISOString(),documents},id=crypto.randomUUID(),digest=checksum(bundle);
      await client.query('INSERT INTO app_backups(id,kind,digest,bundle,created_at) VALUES($1,$2,$3,$4::jsonb,$5)',[id,kind,digest,JSON.stringify(bundle),bundle.createdAt]);
      // Keep 14 daily and 10 manual restore points. Files mirror those points.
      await client.query(`DELETE FROM app_backups WHERE id IN (SELECT id FROM app_backups WHERE kind='daily' ORDER BY created_at DESC OFFSET 14) OR id IN (SELECT id FROM app_backups WHERE kind='manual' ORDER BY created_at DESC OFFSET 10)`);
      return {id,created_at:bundle.createdAt,digest,bundle,kind};
    });
    // Re-create a missing filesystem mirror after a restart, even for today's backup.
    const full=entry.bundle?entry:await this.getBackup(entry.id),target=path.join(this.backupDir,full.id+'.json.gz');
    const tmp=target+'.'+crypto.randomUUID()+'.tmp';let mirror='ready';
    try{
      await fs.mkdir(this.backupDir,{recursive:true,mode:0o700});
      await fs.writeFile(tmp,gzipSync(JSON.stringify({...full.bundle,digest:full.digest})),{mode:0o600});await fs.rename(tmp,target);
      const keep=new Set((await this.listBackups()).map(r=>r.id));for(const name of await fs.readdir(this.backupDir))if(/^[a-f0-9-]{36}\.json\.gz$/.test(name)&&!keep.has(name.slice(0,36)))await fs.unlink(path.join(this.backupDir,name)).catch(e=>{if(e.code!=='ENOENT')throw e});
      this.backupWarning=null;
    }catch{mirror='error';this.backupWarning='Backup tersimpan di PostgreSQL dan tetap bisa diunduh. Salinan di volume belum berhasil dibuat; periksa penyimpanan volume.';console.error('Backup: volume mirror unavailable; database snapshot preserved');}
    finally{await fs.unlink(tmp).catch(()=>{});}
    return {id:full.id,createdAt:full.created_at,kind:full.kind||kind,digest:full.digest,mirror,warning:this.backupWarning};
  }
  async listBackups(){return (await this.pool.query('SELECT id,created_at AS "createdAt",kind,digest FROM app_backups ORDER BY created_at DESC')).rows;}
  async getBackup(id){if(!/^[a-f0-9-]{36}$/.test(id))throw Object.assign(Error('Backup tidak valid'),{status:400});const row=(await this.pool.query('SELECT * FROM app_backups WHERE id=$1',[id])).rows[0];if(!row)throw Object.assign(Error('Backup tidak ditemukan'),{status:404});if(checksum(row.bundle)!==row.digest)throw Error('Checksum backup tidak cocok');return row;}
  async status(){const migration=(await this.pool.query('SELECT id,applied_at FROM app_migrations ORDER BY applied_at DESC LIMIT 1')).rows[0],backups=await this.listBackups();await Promise.all(backups.map(async b=>{b.volumeCopy=await fs.access(path.join(this.backupDir,b.id+'.json.gz')).then(()=>'ready',()=>'missing')}));const last=backups.find(b=>b.kind==='manual');return {mode:this.mode,ready:true,migratedAt:migration?.applied_at||null,backups,backupWarning:backups.some(b=>b.volumeCopy==='missing')?'Backup tetap tersimpan di PostgreSQL dan bisa diunduh. Ada salinan di volume yang belum tersedia.':null,manualAvailableAt:last?new Date(Date.parse(last.createdAt)+60000).toISOString():null};}
  async restore(bundle,digest){this.validate(bundle?.documents);if(bundle.version!==1||checksum(bundle)!==digest)throw Error('Backup rusak atau checksum tidak cocok');return this.transaction(async client=>{await client.query('SELECT key FROM app_documents ORDER BY key FOR UPDATE');for(const key of DOCUMENT_KEYS)await client.query('UPDATE app_documents SET data=$2::jsonb,revision=revision+1,updated_at=now() WHERE key=$1',[key,JSON.stringify(bundle.documents[key])]);});}
}
