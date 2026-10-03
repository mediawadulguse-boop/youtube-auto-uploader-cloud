import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {ContentStore} from '../content-store.mjs';
import {RadarStore} from '../radar-store.mjs';
import {sourceSimilarity,headline,headlineSimilarity,rateIssue} from '../radar-methodology.mjs';
import {RadarSync,parseFeed,freshNews} from '../radar-sync.mjs';
const start=Date.parse('2026-10-03T01:25:00Z'),date=(hours=1)=>new Date(start-hours*3600000).toISOString();
const input=(n,overrides={})=>({title:'Pemerintah Naikkan Pajak PPN 12 Persen pada 2026',url:`https://media${n}.example/article/${n}`,publisher:'Media '+n,publishedAt:date(),...overrides});
async function setup(t){const dir=await fs.mkdtemp(path.join(os.tmpdir(),'ranked-radar-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));let now=start;const content=new ContentStore(path.join(dir,'contents.json')),radar=new RadarStore(content,{now:()=>now});return {content,radar,dir,advance:hours=>now+=hours*3600000};}
const body='Harga beras di Kabupaten Jember naik setelah pasokan gudang berkurang. Pedagang pangan mengeluhkan biaya distribusi mahal. Warga harus menambah anggaran biaya hidup rumah tangga. Dinas perdagangan memantau persediaan beras melalui operasi pasar di wilayah Jember.';
test('different headlines group through substantial shared content, without relying on AI',async t=>{
 const a=input(1,{title:'Harga beras melonjak di Jember',excerpt:body}),b=input(2,{title:'Warga Jember mengeluhkan pangan mahal',excerpt:body+' Pemerintah menyiapkan pemeriksaan harga.'});
 assert.equal(headlineSimilarity(headline(a.title),headline(b.title)),0);assert.ok(sourceSimilarity(a,b)>0);
 const {radar}=await setup(t);await radar.addSources([a,b]);const data=await radar.read();assert.equal(data.issues.length,1);assert.equal(data.issues[0].sources.length,2);assert.equal(data.rankedIssueIds.length,1);
});
test('content cannot override event guards or turn boilerplate/short summaries into similarity evidence',()=>{
 const a=input(1,{title:'Harga beras melonjak di Jember',excerpt:body});
 for(const b of [input(2,{title:'Harga beras melonjak di Banyuwangi',excerpt:body}),input(3,{title:'Proyek jembatan selesai di Jember',excerpt:body}),input(4,{title:'Warga Jember mengeluhkan pangan mahal',excerpt:'Harga beras melonjak - Media lain'})])assert.equal(sourceSimilarity(a,b),0);
 const boiler='Baca berita terkini dan peristiwa terbaru hari ini melalui situs resmi kami. Temukan informasi lengkap dari seluruh wilayah Indonesia bersama redaksi pilihan pembaca. Semua hak cipta dilindungi dan kebijakan privasi berlaku untuk pengguna layanan.';
 assert.equal(sourceSimilarity({...a,excerpt:boiler},input(5,{title:'Warga Jember mengeluhkan pangan mahal',excerpt:boiler})),0);
});
test('ranking includes one-publisher and undated groups, while preserving active-topic and editorial exclusions',async t=>{
 const {radar}=await setup(t);await radar.addSources([input(1),input(2,{title:'Subsidi energi berkurang',publishedAt:null})]);let data=await radar.read();assert.equal(data.rankedIssueIds.length,2);assert.equal(data.issues.find(i=>i.id===data.rankedIssueIds[0]).stats.rating,2);assert.equal(data.issues.find(i=>i.id===data.rankedIssueIds[1]).stats.score,0);
 const top=data.issues.find(i=>i.id===data.rankedIssueIds[0]);await radar.changeIssue(top.id,{revision:top.revision,status:'ignored'});assert.equal((await radar.read()).rankedIssueIds.length,1);
 data=await radar.read();for(const topic of data.topics)await radar.saveTopic({...topic,enabled:false},topic.id);assert.equal((await radar.read()).rankedIssueIds.length,0);
});
test('splitting preserves source IDs, verification, content relations and scripts across restart and re-clustering',async t=>{
 const {radar,content,dir}=await setup(t);await radar.addSources([input(1),input(2),input(3)]);let group=(await radar.read()).issues[0];
 await radar.changeIssue(group.id,{revision:group.revision,sourceId:group.sources[0].id,verification:'verified',repost:false});const production=await content.create({title:'Script terkait',script:'Jangan mengubah script ini',radarIssueId:group.id});
 group=(await radar.read()).issues[0];await radar.observe();const before=await content.read();const result=await radar.split(group.id,{revision:group.revision,title:'Kelompok koreksi',sourceIds:[group.sources[0].id]});
 const after=await content.read();assert.deepEqual(after.contents,before.contents);assert.deepEqual(after.radar.issues.flatMap(i=>i.sources).sort((a,b)=>a.id.localeCompare(b.id)),before.radar.issues[0].sources.sort((a,b)=>a.id.localeCompare(b.id)));
 const original=after.radar.issues.find(i=>i.id===group.id),created=after.radar.issues.find(i=>i.id===result.issueId);assert.ok(original.contentIds.includes(production.id));assert.deepEqual(created.contentIds,[]);assert.equal(created.sources[0].verification,'verified');assert.equal(original.observations.length,0);assert.equal(created.groupingLocked,true);
 await radar.mutate(r=>r.clusteringVersion=2);assert.equal((await radar.recluster()).merged,0);
 const reopened=new RadarStore(new ContentStore(path.join(dir,'contents.json')));assert.equal((await reopened.read()).issues.length,2);await reopened.addSources([input(1),input(2),input(3)]);assert.equal((await reopened.read()).issues.length,2);
});
test('invalid, empty, all-source and stale splits fail atomically; concurrent edits cannot lose sources',async t=>{
 const {radar,content}=await setup(t);await radar.addSources([input(1),input(2),input(3)]);const group=(await radar.read()).issues[0],before=await content.read();
 for(const patch of [{sourceIds:[]},{sourceIds:['missing']},{sourceIds:group.sources.map(s=>s.id)},{sourceIds:[group.sources[0].id],title:''}])await assert.rejects(radar.split(group.id,{revision:group.revision,title:'Valid',...patch}),{status:400});
 assert.deepEqual(await content.read(),before);
 const outcomes=await Promise.allSettled([0,1].map(n=>radar.split(group.id,{revision:group.revision,title:'Split '+n,sourceIds:[group.sources[n].id]})));assert.equal(outcomes.filter(x=>x.status==='fulfilled').length,1);assert.equal(outcomes.find(x=>x.status==='rejected').reason.status,409);
 assert.equal((await radar.read()).issues.flatMap(i=>i.sources).length,3);
});
test('trend uses actual spaced observations, ignores same-publisher link volume, expires coverage and resets after merge',async t=>{
 const {radar,advance}=await setup(t);await radar.addSources([input(1)]);assert.equal((await radar.read()).issues[0].stats.trend.state,'unavailable');await radar.observe();advance(.1);assert.equal((await radar.observe()).recorded,0);assert.equal((await radar.read()).issues[0].stats.trend.state,'unavailable');
 advance(.9);await radar.addSources([input(2)]);let data=await radar.read();assert.equal(data.issues[0].stats.trend.state,'rising');assert.equal(data.issues[0].stats.trend.deltaPublishers24h,1);
 await radar.observe();advance(1);await radar.addSources([input(22,{url:'https://media2.example/second'})]);data=await radar.read();assert.equal(data.issues[0].stats.trend.state,'stable');assert.equal(data.issues[0].stats.trend.deltaPublishers24h,0);
 await radar.observe();advance(24);data=await radar.read();assert.equal(data.issues[0].stats.trend.state,'falling');assert.equal(data.issues[0].stats.trend.deltaPublishers24h,-2);
 await radar.addSources([input(9,{title:'Kebijakan subsidi baru'})]);const [a,b]=(await radar.read()).issues;await radar.merge(a.id,{revision:a.revision,fromId:b.id,fromRevision:b.revision});assert.equal((await radar.read()).issues[0].stats.trend.state,'unavailable');
});
test('publication timestamp stays visible on older zero-score groups and empty RSS is a successful zero-result sync',async t=>{
 const stats=rateIssue({sources:[{...input(1,{publishedAt:date(120)}),platform:'Berita / Web'}]},start);assert.equal(stats.score,0);assert.equal(stats.latestPublishedAt,date(120));assert.equal(stats.freshness,'older');
 const {radar}=await setup(t),sync=new RadarSync(radar,()=>{throw Error('unexpected')},{now:()=>start,feed:async()=>'<rss><channel/></rss>'});const result=await sync.sync();assert.equal(result.news,0);assert.deepEqual(result.errors,[]);assert.ok((await radar.read()).sync.newsAt);
 const feed=parseFeed(`<rss><channel><item><title>Pajak PPN</title><link>https://media.example/old</link><pubDate>${date(120)}</pubDate><content:encoded><![CDATA[<p>Isi feed yang tersedia.</p>]]></content:encoded></item></channel></rss>`);assert.equal(freshNews(feed,start).length,1);assert.match(feed[0].excerpt,/Isi feed/);
});
