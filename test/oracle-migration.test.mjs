import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {PGlite} from '@electric-sql/pglite';

const script=new URL('../deploy/oracle/scripts/data-manifest.py',import.meta.url).pathname;
test('data migration manifest covers hidden files, empty directories, symlinks and detects loss or tampering',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'oracle-data-'));
 try{
  const data=path.join(dir,'data'),manifest=path.join(dir,'manifest.json');
  await fs.mkdir(path.join(data,'empty'),{recursive:true});
  await fs.writeFile(path.join(data,'.oauth'),'PRIVATE_TOKEN');
  await fs.writeFile(path.join(data,'video.mp4'),Buffer.from([0,255,3]));
  await fs.symlink('video.mp4',path.join(data,'video-link'));
  const run=(mode,file=manifest)=>spawnSync('python3',[script,mode,data,file],{encoding:'utf8'});
  assert.equal(run('create').status,0);assert.equal(run('verify').status,0);
  const contents=await fs.readFile(manifest,'utf8');assert.ok(!contents.includes('PRIVATE_TOKEN'));
  assert.equal(JSON.parse(contents).entries.length,4);
  assert.notEqual(run('create').status,0,'existing manifest cannot be overwritten');
  assert.notEqual(run('create',path.join(data,'unsafe.json')).status,0,'manifest cannot be inside data');
  await fs.writeFile(path.join(data,'.oauth'),'ALTERED_TOKEN');assert.notEqual(run('verify').status,0);
  await fs.writeFile(path.join(data,'.oauth'),'PRIVATE_TOKEN');assert.equal(run('verify').status,0);
  await fs.writeFile(path.join(data,'extra'),'extra');assert.notEqual(run('verify').status,0);
  await fs.unlink(path.join(data,'extra'));await fs.unlink(path.join(data,'video-link'));
  assert.notEqual(run('verify').status,0);
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});

test('database inventory detects document, revision, historical backup and migration differences without writes',async()=>{
 const db=new PGlite();
 try{
  await db.exec(`CREATE TABLE app_documents(key text PRIMARY KEY,data jsonb,revision bigint);
   CREATE TABLE app_backups(id uuid PRIMARY KEY,bundle jsonb);
   CREATE TABLE app_migrations(id text PRIMARY KEY,manifest jsonb);
   INSERT INTO app_documents VALUES ('uploads','{"jobs":[]}',1),('contents','{"script":"Private script"}',1),('notes','{}',1),('analytics','{}',1);
   INSERT INTO app_backups VALUES ('00000000-0000-0000-0000-000000000001','{"history":true}');
   INSERT INTO app_migrations VALUES ('migration-1','{"source":"original"}');`);
  const sql=await fs.readFile(new URL('../deploy/oracle/scripts/database-manifest.sql',import.meta.url),'utf8');
  const query=sql.slice(sql.indexOf('COPY (')+6,sql.lastIndexOf(') TO STDOUT'));
  const before=(await db.query(query)).rows;assert.equal(before.length,6);
  assert.ok(!JSON.stringify(before).includes('Private script'));
  await db.exec('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
  assert.deepEqual((await db.query(query)).rows,before);await db.exec('COMMIT');
  for(const change of [
   `UPDATE app_documents SET data='{"changed":true}' WHERE key='contents'`,
   `UPDATE app_documents SET revision=2 WHERE key='notes'`,
   `UPDATE app_backups SET bundle='{"history":false}'`,
   `UPDATE app_migrations SET manifest='{"source":"changed"}'`
  ]){await db.exec('BEGIN');await db.exec(change);assert.notDeepEqual((await db.query(query)).rows,before);await db.exec('ROLLBACK');}
 }finally{await db.close();}
});
