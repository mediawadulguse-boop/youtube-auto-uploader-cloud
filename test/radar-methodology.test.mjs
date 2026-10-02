import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {ContentStore} from '../content-store.mjs';
import {RadarStore} from '../radar-store.mjs';
import {headline,headlineSimilarity,createIssueMatcher,rateIssue,publisherKey} from '../radar-methodology.mjs';
import {freshNews,parseFeed,RadarSync} from '../radar-sync.mjs';
const now=Date.parse('2026-10-02T16:40:00Z'),iso=h=>new Date(now-h*3600000).toISOString();
const titles=['Pemerintah Naikkan Pajak PPN Menjadi 12 Persen pada 2026','Pajak PPN 12 Persen Berlaku 2026, Pemerintah Umumkan Kenaikan','Kenaikan Pajak PPN 12 Persen pada 2026 Diumumkan Pemerintah'];
const news=(n,overrides={})=>({id:'s'+n,title:titles[0],url:`https://media${n}.example/pajak`,publisher:'Media '+n,platform:'Berita / Web',publishedAt:iso(2),discoveredAt:new Date(now).toISOString(),coverage:'snippet',excerpt:'Pajak',verification:'unchecked',...overrides});
async function setup(t){const dir=await fs.mkdtemp(path.join(os.tmpdir(),'radar-method-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));const content=new ContentStore(path.join(dir,'contents.json')),radar=new RadarStore(content,{now:()=>now});return {radar,content};}
test('similar event headlines group after reordering and verb normalization, while different events stay separate',async t=>{
 const {radar}=await setup(t);for(const [n,title]of titles.entries())await radar.addSources([news(n,{title})]);
 let data=await radar.read();assert.equal(data.issues.length,1);assert.equal(data.issues[0].sources.length,3);assert.equal(data.hotIssues.length,1);assert.equal(data.hotIssues[0].stats.rating,4);
 await radar.addSources([news(8,{title:'Pajak daerah dibatalkan di Jember'})]);data=await radar.read();assert.equal(data.issues.length,2);assert.equal(data.hotIssues.length,1);
});
test('geography, negation, policy rates, year, and opposite decisions prevent misleading groups',()=>{
 const pairs=[
 ['Penataan Pasar Tanjung Jember Dimulai 2026','Penataan Pasar Tanjung Banyuwangi Dimulai 2026'],
 ['Pajak PPN Berlaku 12 Persen pada 2026','Pajak PPN Tidak Berlaku 12 Persen pada 2026'],
 ['Pajak PPN Berlaku 11 Persen pada 2026','Pajak PPN Berlaku 12 Persen pada 2026'],
 ['Pajak PPN Berlaku 12 Persen pada 2025','Pajak PPN Berlaku 12 Persen pada 2026'],
 ['Pemerintah Naikkan Pajak PPN pada 2026','Pemerintah Turunkan Pajak PPN pada 2026'],
 ['Subsidi BBM Dicabut Pemerintah','Subsidi BBM Diperpanjang Pemerintah'],
 ['Penataan Pasar Tanjung Jember Dimulai','Penataan Pasar Kembang Jember Dimulai']
 ];for(const [a,b]of pairs)assert.equal(headlineSimilarity(headline(a),headline(b)),0,a+' vs '+b);
 assert.ok(headlineSimilarity(headline('Subsidi Dicabut - Media 1','Media 1'),headline('Subsidi Dicabut - Media 2','Media 2')));
});
test('event time span and fixed anchor stop old editions and similarity-chain drift',()=>{
 const match=createIssueMatcher(),a=news(1,{title:'Alpha Beta Gamma Delta Epsilon Zeta'}),b=news(2,{title:'Alpha Beta Gamma Delta Epsilon Theta'}),c=news(3,{title:'Alpha Beta Gamma Delta Theta Kappa'});
 assert.ok(match({sources:[a]},b));assert.equal(match({sources:[a,b]},c),0);
 assert.equal(match({sources:[news(1,{publishedAt:iso(75)})]},news(2)),0);
});
test('rating rewards distinct recent publishers and exposes a reproducible 0–100 breakdown',()=>{
 const four=rateIssue({sources:[news(1),news(2),news(3)]},now);assert.equal(four.score,79);assert.equal(four.rating,4);assert.equal(four.isHot,true);assert.equal(Object.values(four.components).reduce((a,b)=>a+b),four.score);
 const five=rateIssue({sources:[1,2,3,4,5].map(n=>news(n))},now);assert.equal(five.score,95);assert.equal(five.rating,5);
 const two=rateIssue({sources:[news(1),news(2)]},now);assert.equal(two.isHot,false);assert.equal(two.rating,3);
});
test('same publisher aliases, duplicate URLs, and reposts cannot manufacture hotness',()=>{
 const repeated=[...Array(30)].map((_,n)=>news(n,{url:'https://www.media.example/article/'+n,publisher:'Different label '+n}));
 const stats=rateIssue({sources:repeated},now);assert.equal(stats.recentPublishers,1);assert.equal(stats.isHot,false);
 const repost=rateIssue({sources:[news(1),news(2,{repost:true}),news(3,{repost:true})]},now);assert.equal(repost.isHot,false);assert.equal(repost.recentPublishers,1);
 const duplicate=rateIssue({sources:[news(1),news(1),news(2)]},now);assert.equal(duplicate.sources,2);assert.equal(duplicate.isHot,false);
 assert.equal(publisherKey(news(1,{url:'https://news.google.com/rss/articles/a',publisher:'Kompas.com'})),publisherKey(news(2,{publisherUrl:'https://www.kompas.com'})));
});
test('old, future, undated and YouTube-only coverage do not become Hot News after import',()=>{
 for(const publishedAt of [iso(80),null,new Date(now+3600000).toISOString()]){
  const stats=rateIssue({sources:[1,2,3,4,5].map(n=>news(n,{publishedAt}))},now);assert.equal(stats.isHot,false);assert.equal(stats.score,0);assert.equal(stats.new24h,0);
 }
 const yt=rateIssue({sources:[1,2,3,4,5].map(n=>news(n,{platform:'YouTube',url:'https://www.youtube.com/watch?v=video'+n}))},now);assert.equal(yt.isHot,false);
 const stale=rateIssue({sources:[news(1,{publishedAt:iso(50)}),news(2,{publishedAt:iso(50)}),news(3,{publishedAt:iso(50)})]},now);assert.equal(stale.isHot,false);
});
test('Hot News excludes ignored, discussed and disabled topics while explicit manual references remain accessible',async t=>{
 const {radar}=await setup(t);await radar.addSources([news(1),news(2),news(3)]);let data=await radar.read(),issue=data.hotIssues[0];
 await radar.changeIssue(issue.id,{revision:issue.revision,status:'ignored'});assert.equal((await radar.read()).hotIssues.length,0);
 data=await radar.read();await radar.changeIssue(issue.id,{revision:data.issues[0].revision,status:'discussed'});assert.equal((await radar.read()).hotIssues.length,0);
 await radar.addSources([news(7,{title:'Catatan produksi pribadi',publishedAt:null,coverage:'manual'})]);assert.ok((await radar.read()).issues.some(i=>i.title==='Catatan produksi pribadi'&&i.status==='saved'));
 const other=await setup(t);await other.radar.addSources([news(1),news(2),news(3)]);for(const topic of (await other.radar.read()).topics)await other.radar.saveTopic({...topic,enabled:false},topic.id);assert.equal((await other.radar.read()).hotIssues.length,0);
});
test('legacy re-clustering preserves source IDs, annotations, saved groups and linked content, and runs only once',async t=>{
 const {radar,content}=await setup(t);await radar.addSources([news(1),news(2),news(3)]);const grouped=(await radar.read()).issues[0];
 await radar.mutate(r=>{delete r.clusteringVersion;r.issues=grouped.sources.map((source,n)=>({...structuredClone(grouped),id:'legacy-'+n,title:source.title,sources:[source],revision:1,createdAt:iso(3-n/10)}));
  r.issues.push({...structuredClone(grouped),id:'saved',status:'saved',title:'Judul editorial',sources:[news(8,{verification:'verified'})],contentIds:[]});
  r.issues.push({...structuredClone(grouped),id:'locked',groupingLocked:true,sources:[news(9)],contentIds:[]});
 });
 const saved=(await radar.read()).issues.find(i=>i.id==='saved'),production=await content.create({title:'Video terkait',script:'Script asli',radarIssueId:saved.id});
 const before=await content.read(),allIds=before.radar.issues.flatMap(i=>i.sources.map(s=>s.id)).sort();
 const result=await radar.recluster();assert.equal(result.merged,2);const after=await content.read();assert.deepEqual(after.radar.issues.flatMap(i=>i.sources.map(s=>s.id)).sort(),allIds);assert.deepEqual(after.contents,before.contents);
 const kept=after.radar.issues.find(i=>i.id==='saved');assert.equal(kept.title,'Judul editorial');assert.equal(kept.sources[0].verification,'verified');assert.ok(kept.contentIds.includes(production.id));assert.ok(after.radar.issues.some(i=>i.id==='locked'));
 assert.deepEqual(await radar.recluster(),{skipped:true});assert.deepEqual(await content.read(),after);
});
test('RSS attribution retains publisher URL, and syncing gathers only fresh dated news without relying on AI',async t=>{
 const xml=`<rss><channel><item><title>Pajak PPN naik</title><link>https://news.google.com/rss/articles/a</link><source url="https://www.media.example">Media</source><pubDate>${iso(2)}</pubDate></item><item><title>Pajak lama</title><link>https://media.example/old</link><pubDate>${iso(90)}</pubDate></item><item><title>Pajak tanpa tanggal</title><link>https://media.example/undated</link></item></channel></rss>`;
 const feed=parseFeed(xml);assert.equal(feed[0].publisherUrl,'https://www.media.example/');assert.equal(freshNews(feed,now).length,1);
 const {radar}=await setup(t),sync=new RadarSync(radar,()=>{throw Error('unexpected');},{now:()=>now,feed:async()=>xml});await sync.sync();const data=await radar.read();assert.equal(data.issues.length,1);assert.equal(data.issues[0].sources.length,1);assert.equal(data.hotIssues.length,0);
});
test('RSS update time alone is not publication evidence, and duplicate imports enrich attribution without changing source IDs',async t=>{
 const atom=parseFeed(`<feed><entry><title>Pajak PPN</title><link href="https://news.google.com/rss/articles/b"/><updated>${iso(2)}</updated></entry></feed>`);assert.equal(atom[0].publishedAt,null);assert.equal(freshNews(atom,now).length,0);
 const {radar}=await setup(t);await radar.addSources([news(1,{url:'https://news.google.com/rss/articles/c',publisher:'Alias Media'})]);const before=(await radar.read()).issues[0];
 await radar.addSources([news(1,{url:'https://news.google.com/rss/articles/c',publisherUrl:'https://media.example'})]);const after=(await radar.read()).issues[0];assert.equal(after.sources.length,1);assert.equal(after.sources[0].id,before.sources[0].id);assert.equal(after.sources[0].publisherUrl,'https://media.example/');
});
