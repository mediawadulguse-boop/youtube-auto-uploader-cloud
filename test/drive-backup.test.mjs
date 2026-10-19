import {test} from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {DriveBackup} from '../drive-backup.mjs';
import {checksum} from '../postgres-store.mjs';
function fixture({mismatch=false,location='https://www.googleapis.com/upload/drive/v3/files?upload_id=one',denied=false}={}){let state={},bytes,file,uploads=0,calls=0;const bundle={version:1,createdAt:'2026-10-05T12:00:00Z',documents:{notes:'private test data'}};const request=async(url,options)=>{calls++;assert.equal(options.redirect,'error');assert.equal(options.headers.authorization,'Bearer mock-token');if(denied)return new Response('{}',{status:403});const u=new URL(url);if(u.pathname.endsWith('/files/folder'))return Response.json({id:'folder',mimeType:'application/vnd.google-apps.folder'});if(u.pathname.endsWith('/files/file'))return Response.json({...file,md5Checksum:mismatch?'bad':file.md5Checksum});if(u.searchParams.has('q'))return Response.json({files:u.searchParams.get('q').includes("value='folder'")?[]:file?[file]:[]});if(options.method==='POST'&&u.searchParams.get('uploadType')==='resumable')return new Response('',{headers:{location}});if(options.method==='PUT'){uploads++;bytes=Buffer.from(options.body);const {digest,...rest}=JSON.parse(gunzipSync(bytes));assert.equal(checksum(rest),digest);file={id:'file',name:'backup.json.gz',parents:['folder'],size:String(bytes.length),md5Checksum:crypto.createHash('md5').update(bytes).digest('hex')};return Response.json(file);}return Response.json({id:'folder'});};const engine=new DriveBackup({snapshot:async()=>({bundle,digest:checksum(bundle)}),loadToken:async()=>({refresh_token:'fixture'}),getAccessToken:async()=> 'mock-token',readState:async()=>state,saveState:async (patch,guard)=>{guard();state={...state,...patch};},fetch:request,now:()=>Date.parse(bundle.createdAt)});return {engine,state:()=>state,uploads:()=>uploads,calls:()=>calls};}
test('Drive upload verifies read-back checksum, size and parent before storing success; daily tick is idempotent',async()=>{const f=fixture(),result=await f.engine.run();assert.equal(result.fileId,'file');assert.equal(result.digest.length,64);assert.equal(f.uploads(),1);assert.equal(f.state().error,null);assert.equal((await f.engine.run()).skipped,true);assert.equal(f.uploads(),1);await assert.rejects(f.engine.run({force:true}),e=>e.status===429);});
test('Drive checksum mismatch and permission failure never record verified backup',async()=>{for(const options of [{mismatch:true},{denied:true}]){const f=fixture(options);await assert.rejects(f.engine.run(),e=>e.status===503);assert.equal(f.state().lastVerifiedAt,undefined);assert.ok(f.state().error);assert.equal((await f.engine.status()).busy,false);}});
test('resumable session cannot redirect credentials or private bytes to another host',async()=>{const f=fixture({location:'https://attacker.example/upload/drive/file'});await assert.rejects(f.engine.run());assert.equal(f.uploads(),0);assert.equal(f.state().lastVerifiedAt,undefined);});
test('missing offline connection fails closed without a provider request',async()=>{const f=fixture();f.engine.loadToken=async()=>null;await assert.rejects(f.engine.run(),e=>e.status===409);assert.equal(f.calls(),0);assert.equal((await f.engine.status()).connected,false);});

test('reconnecting Drive during upload rejects the old receipt and leaves the new account state untouched',async()=>{
 const f=fixture();let version=1;f.engine.getConnectionVersion=()=>version;
 const request=f.engine.request;f.engine.request=async(url,options)=>{const response=await request(url,options);if(options.method==='PUT'){version++;await f.engine.saveState({folderId:'new-account-folder',connectedAt:'new-connection'},()=>{});}return response;};
 await assert.rejects(f.engine.run(),e=>e.code==='drive_connection_changed'&&e.status===409);
 assert.equal(f.state().folderId,'new-account-folder');assert.equal(f.state().lastVerifiedAt,undefined);assert.equal((await f.engine.status()).error,null);
});
test('Drive state guard also checks after waiting for a database row lock',async()=>{
 const f=fixture();let version=1;f.engine.getConnectionVersion=()=>version;const save=f.engine.saveState;
 f.engine.saveState=async(patch,guard)=>{if(patch.lastVerifiedAt)version++;return save(patch,guard);};
 await assert.rejects(f.engine.run(),e=>e.code==='drive_connection_changed');assert.equal(f.state().lastVerifiedAt,undefined);
});

test('unchanged automatic Drive backups reuse a checksum-verified file across days without renewing its snapshot time',async()=>{
 const f=fixture();let clock=Date.parse('2026-10-05T12:00:00Z');f.engine.now=()=>clock;f.engine.snapshot=async()=>{const bundle={version:1,createdAt:new Date(clock).toISOString(),documents:{notes:'private test data'}};return {bundle,digest:checksum(bundle)};};
 const first=await f.engine.run();clock+=86400000;const next=await f.engine.run();assert.equal(next.skipped,true);assert.equal(next.unchanged,true);assert.equal(f.uploads(),1);assert.equal(f.state().lastVerifiedAt,first.lastVerifiedAt);assert.equal(f.state().lastCheckedAt,new Date(clock).toISOString());const calls=f.calls();assert.equal((await f.engine.run()).skipped,true);assert.equal(f.calls(),calls);
});
test('a missing previous Drive file never counts as a successful unchanged backup',async()=>{
 const f=fixture();let clock=Date.parse('2026-10-05T12:00:00Z');f.engine.now=()=>clock;f.engine.snapshot=async()=>{const bundle={version:1,createdAt:new Date(clock).toISOString(),documents:{notes:'private test data'}};return {bundle,digest:checksum(bundle)};};const first=await f.engine.run(),request=f.engine.request;clock+=86400000;f.engine.request=(url,options)=>new URL(url).pathname.endsWith('/files/file')?Promise.resolve(new Response('{}',{status:404})):request(url,options);await assert.rejects(f.engine.run(),e=>e.status===503);assert.equal(f.state().lastVerifiedAt,first.lastVerifiedAt);assert.notEqual(f.state().lastCheckedAt,new Date(clock).toISOString());assert.equal(f.uploads(),1);
});
