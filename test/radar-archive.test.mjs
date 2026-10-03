import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {ContentStore} from '../content-store.mjs';
import {RadarStore} from '../radar-store.mjs';
import {RadarArchive} from '../radar-archive.mjs';
test('archives closed WIB periods once, survives restart, preserves evidence, and never spends AI quota',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'radar-archive-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));const content=new ContentStore(path.join(dir,'contents.json'));let now=Date.parse('2026-10-03T18:00:00Z');const store=new RadarStore(content,{now:()=>now}),archive=new RadarArchive(store,{now:()=>now});
 await store.addSources([{title:'Pajak bantuan warga',url:'https://news.example/a',excerpt:'Anggaran bantuan mencapai Rp200 juta.',coverage:'snippet',publishedAt:'2026-10-03T02:00:00Z'}]);
 await assert.rejects(archive.save({date:'2026-10-04'}),/periode selesai/);
 const [a,b]=await Promise.all([archive.save({date:'2026-10-03'}),archive.save({date:'2026-10-03'})]);assert.equal(a.id,b.id);assert.equal(a.sourceCount,1);assert.equal(a.comparison.deltaSources,1);assert.match(a.items[0].report.text,/Rp200 juta/);
 await store.mutate(r=>{r.issues[0].sources[0].excerpt='Anggaran berubah.';});assert.deepEqual(await archive.get(a.id),a);
 const restarted=new RadarArchive(new RadarStore(new ContentStore(content.file)),{now:()=>now});assert.deepEqual(await restarted.get(a.id),a);assert.equal((await store.read()).reportArchive,undefined);assert.deepEqual((await content.read()).radar.aiUsage,{});
 await archive.tick();await archive.tick();const list=await archive.list();assert.equal(list.reports.length,2);assert.ok(!Object.hasOwn(list.reports[0],'items'));assert.equal(list.reports.find(r=>r.period==='weekly').date,'2026-09-27');
 await assert.rejects(archive.configure({revision:0,enabled:false}),/Jadwal berubah/);await archive.configure({revision:1,enabled:false});now+=10*86400000;assert.equal((await archive.tick()).disabled,true);
});
test('scheduler catches up a bounded seven days and keeps weekly calendar boundaries',async()=>{
 let db={contents:[],radar:{issues:[],topics:[],reportSchedule:{enabled:true,revision:1,lastTickAt:'2026-09-01T00:00:00Z'}}};const store={contentStore:{read:async()=>structuredClone(db)},read:async()=>({topics:[],issues:[]}),mutate:async f=>f(db.radar,db)};
 const archive=new RadarArchive(store,{now:()=>Date.parse('2026-10-05T01:00:00Z')});await archive.tick();assert.equal(db.radar.reportArchive.length,8);const weekly=db.radar.reportArchive.find(r=>r.period==='weekly');assert.equal(weekly.startAt,'2026-09-27T17:00:00.000Z');assert.equal(weekly.endAt,'2026-10-04T17:00:00.000Z');assert.equal(weekly.usesAI,false);
});
