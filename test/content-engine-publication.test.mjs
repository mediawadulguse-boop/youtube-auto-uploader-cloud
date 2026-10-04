import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import vm from 'node:vm';
import {fillContentWithEngine} from '../content-engine.mjs';
import {videoIdFromInput,publicationFromVideo,syncLinkedPublications,authRequiredError} from '../youtube-publication.mjs';
import {ContentStore} from '../content-store.mjs';
import {runUploadWorker} from '../worker-policy.mjs';
const a='abcdefghijk',b='lmnopqrstuv',channel='UC-owned';
const video=(id=a,status={privacyStatus:'public',uploadStatus:'processed'})=>({id,snippet:{channelId:channel,publishedAt:'2026-10-04T12:00:00Z'},status});
const base={title:'Perubahan kebijakan perusahaan',format:'long',script:'HOOK\n\nMengapa kebijakan perusahaan berubah?\n\nPerusahaan melaporkan pendapatan Rp2 miliar pada 2025. Menurut laporan, perusahaan menilai kebijakan tersebut berpotensi membantu pekerja.\n\nRUJUKAN\n\n[1] Laporan\nhttps://example.com',sources:[{id:'one',label:'Laporan',url:'https://example.com',notes:'Perusahaan melaporkan pendapatan Rp2 miliar pada 2025.'}]};
async function withStore(fn){const dir=await fs.mkdtemp(path.join(os.tmpdir(),'content-engine-'));try{await fn(new ContentStore(path.join(dir,'contents.json')))}finally{await fs.rm(dir,{recursive:true,force:true})}}
test('engine fills missing metadata from stored script without changing existing writing or making dates/checks',()=>{
 const result=fillContentWithEngine({...base,brief:'Brief saya',description:'Deskripsi saya',tags:'tag saya'});
 assert.equal(result.usesAI,false);for(const k of ['script','brief','description','tags','owner','deadline','audience','checklist','pillarId'])assert.equal(result.fields[k],undefined);
 assert.match(result.fields.productionNotes,/Rp2 miliar/);assert.match(result.fields.hook,/Mengapa/);
 const full=fillContentWithEngine(base).fields;assert.match(full.description,/Rp2 miliar/);assert.match(full.description,/menilai/);assert.match(full.description,/https:\/\/example.com/);assert.ok(full.tags);
});
test('engine writes from source notes with literal values and citations; title-only content cannot invent a script',()=>{
 const full=fillContentWithEngine({...base,script:''});assert.match(full.fields.script,/Rp2 miliar pada 2025/);assert.match(full.fields.script,/\[1\]/);assert.ok(full.fields.description);
 const empty=fillContentWithEngine({title:'Berita sensasional',sources:[]});assert.deepEqual(empty.fields,{});assert.match(empty.warnings[0],/Belum ada/);
});
test('backfill is one-time, preserves original revisions for restore, skips archived and manual fields, and survives restart',()=>withStore(async store=>{
 const c=await store.create({...base,description:'Saya menulis ini',checklist:{video:true}}),archived=await store.create({...base,archived:true});
 assert.equal((await store.fillEmptyWithEngine()).updated,1);let current=(await store.read()).contents.find(x=>x.id===c.id);assert.equal(current.description,'Saya menulis ini');assert.equal(current.revision,2);assert.equal(current.history[0].brief,'');assert.equal(current.owner,'');assert.equal(current.checklist.video,true);assert.equal((await store.read()).contents.find(x=>x.id===archived.id).revision,1);
 assert.equal((await new ContentStore(store.file).fillEmptyWithEngine()).updated,0);
 current=await store.update(c.id,{revision:current.revision,restoreRevision:1});assert.equal(current.brief,'');
 const created=await store.create(base,{fillEngine:true});assert.ok(created.description);assert.equal(created.script,base.script);
}));
test('video IDs accept supported YouTube URLs and reject hostile domains or invalid IDs',()=>{
 for(const url of [a,'https://youtu.be/'+a,'https://www.youtube.com/watch?v='+a,'https://youtube.com/shorts/'+a,'https://studio.youtube.com/video/'+a+'/edit'])assert.equal(videoIdFromInput(url),a);
 for(const url of ['https://youtube.com.evil.test/watch?v='+a,'javascript:'+a,'bad','https://example.com/'+a])assert.throws(()=>videoIdFromInput(url));
});
test('publication uses actual visibility, processing and schedule rather than assuming linked means public',()=>{
 for(const [status,expected] of [[{privacyStatus:'public'},'published'],[{privacyStatus:'unlisted'},'unlisted_youtube'],[{privacyStatus:'private'},'private_youtube'],[{privacyStatus:'private',publishAt:'2026-10-06T00:00:00Z'},'scheduled_youtube'],[{privacyStatus:'public',uploadStatus:'uploaded'},'processing_youtube'],[{privacyStatus:'public',uploadStatus:'rejected'},'failed']])assert.equal(publicationFromVideo(video(a,status)).status,expected);
 assert.equal(publicationFromVideo(video(a,{privacyStatus:'private'})).publishedAt,null);
});
test('publication preserves identity on restoration and resets on duplication; forged status input is ignored',()=>withStore(async store=>{
 let c=await store.create(base);c=await store.recordPublication(c.id,c.revision,video());assert.equal(c.youtubePublication.status,'published');assert.equal(c.youtubeVideoId,a);
 for(let i=0;i<35;i++)c=await store.recordPublication(c.id,c.revision,video(a,{privacyStatus:i%2?'private':'public'}));assert.equal(c.revision,2);assert.equal(c.history.length,1);
 c=await store.recordPublication(c.id,c.revision,video());
 c=await store.update(c.id,{revision:c.revision,restoreRevision:1,youtubePublication:{status:'failed'}});assert.equal(c.youtubePublication.status,'published');assert.equal(c.youtubeVideoId,a);
 const copy=await store.duplicate(c.id);assert.equal(copy.youtubeVideoId,'');assert.equal(copy.youtubePublication,null);
 const changed=await store.update(c.id,{revision:c.revision,youtubeVideoId:b});assert.equal(changed.youtubePublication,null);
}));
test('batch publication sync checks ownership, skips stale concurrent edits, and avoids polling fresh snapshots',()=>withStore(async store=>{
 const first=await store.create({...base,youtubeVideoId:a}),other=await store.create({...base,youtubeVideoId:b});let calls=0;
 const fetcher=async url=>{calls++;assert.match(url,/snippet%2Cstatus/);await store.update(other.id,{revision:other.revision,script:'Ketikan baru'});return new Response(JSON.stringify({items:[video(),video(b)]}));};
 assert.equal((await syncLinkedPublications({store,fetcher,channelId:channel})).updated,1);let rows=(await store.read()).contents;assert.equal(rows.find(c=>c.id===other.id).script,'Ketikan baru');assert.equal(rows.find(c=>c.id===other.id).youtubePublication,null);
 await store.update(other.id,{revision:2,archived:true});assert.equal((await syncLinkedPublications({store,fetcher,channelId:channel})).updated,0);assert.equal(calls,1);assert.equal(rows.find(c=>c.id===first.id).youtubePublication.status,'published');
}));
test('batch sync refuses to mark a video from another channel as published',()=>withStore(async store=>{
 await store.create({...base,youtubeVideoId:a});const result=await syncLinkedPublications({store,channelId:channel,fetcher:async()=>new Response(JSON.stringify({items:[{...video(),snippet:{channelId:'UC-other'}}]}))});assert.equal(result.updated,0);
}));
test('application-uploaded video IDs are adopted into production and publication becomes visible without manual linking',()=>withStore(async store=>{
 const c=await store.create(base);
 const result=await syncLinkedPublications({store,channelId:channel,jobs:[{contentId:c.id,youtubeVideoId:a,channelId:channel,status:'scheduled_youtube'}],fetcher:async()=>new Response(JSON.stringify({items:[video()]}))});
 assert.equal(result.updated,1);const saved=(await store.read()).contents[0];assert.equal(saved.youtubeVideoId,a);assert.equal(saved.youtubePublication.status,'published');assert.equal(saved.script,c.script);assert.equal(saved.checklist.video,false);
}));
test('calendar shows actual publication over an old failed queue and uses actual publication date without making the card draggable',async()=>{
 const code=await fs.readFile('public/content.js','utf8'),context={state:{server:{jobs:[{contentId:'one',status:'failed'}]}},hub:{calendarField:'publish'},statusBadge:(kind,value)=>'badge:'+value,pillar:()=>null,formatBadge:()=>'',productionBadge:()=> 'production:ready',esc:v=>v,timeWib:()=> '10:00'};vm.createContext(context);
 vm.runInContext(code.slice(code.indexOf('function linkedJob('),code.indexOf('function formatBadge(')),context);
 vm.runInContext(code.slice(code.indexOf('function publicationBadge('),code.indexOf('function filtered(')),context);
 context.calendarEvents=()=>[];vm.runInContext(code.slice(code.indexOf('function calendarEvent('),code.indexOf('function renderCalendar(')),context);
 const c={id:'one',title:'Published',stage:'ready',youtubeVideoId:a,youtubePublication:{videoId:a,status:'published',publishedAt:'2026-10-04T12:00:00Z'},plannedPublishAt:'2026-10-03T12:00:00Z'};
 assert.equal(context.eventDate(c),'2026-10-04T12:00:00Z');const card=context.calendarEvent({...c,eventAt:context.eventDate(c)});assert.match(card,/badge:published/);assert.ok(!card.includes('badge:failed'));assert.ok(!card.includes('production:ready'));assert.ok(!card.includes('draggable="true"'));
});
test('revoked refresh token pauses worker without failing queue or discarding resumable upload, including across restart',async()=>{
 const db={jobs:[{id:'queued',status:'uploading_youtube',receivedBytes:10,fileSize:10,youtubeUploadOffset:5,order:1}]};let calls=0;
 const deps={readDb:async()=>db,writeDb:async()=>{},upload:async()=>{calls++;throw authRequiredError();}};
 assert.equal((await runUploadWorker(deps)).code,'youtube_auth_required');assert.equal(db.jobs[0].status,'uploading_youtube');assert.equal(db.jobs[0].youtubeUploadOffset,5);for(let i=0;i<3;i++)assert.equal((await runUploadWorker({...deps})).state,'paused');assert.equal(calls,1);
 db.youtubeWorker=null;deps.upload=async()=>{calls++;db.jobs[0].status='scheduled_youtube';};assert.equal((await runUploadWorker(deps)).state,'success');assert.equal(calls,2);
});
test('UI uses verified publication over a failed historical queue and guards engine against edits during request',async()=>{
 const code=await fs.readFile('public/content.js','utf8'),app=await fs.readFile('public/app.js','utf8'),context={state:{server:{jobs:[{contentId:'one',status:'failed'}]}}};vm.createContext(context);
 vm.runInContext(code.slice(code.indexOf('function linkedJob('),code.indexOf('function formatBadge(')),context);
 assert.equal(context.publicationState({id:'one',youtubeVideoId:a,youtubePublication:{videoId:a,status:'published'}}),'published');
 assert.equal(context.publicationState({id:'one',youtubeVideoId:a,youtubePublication:{videoId:b,status:'published'}}),'failed');
 assert.match(code,/hub\.editing!==edit\|\|edit\.epoch!==epoch/);assert.match(code,/HubRichText\.set\(field,value\)/);assert.match(app,/Hubungkan ulang YouTube/);
});
