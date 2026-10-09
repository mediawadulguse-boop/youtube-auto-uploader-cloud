import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {investigateIssue,focusAllows,withFocus,collectionTopics} from '../radar-focus.mjs';
import {ContentStore} from '../content-store.mjs';
import {RadarStore} from '../radar-store.mjs';
import {RadarSync} from '../radar-sync.mjs';
import {buildRadarDigest} from '../radar-digest.mjs';
import {buildRadarExecutive} from '../radar-executive.mjs';
const now=Date.parse('2026-10-10T03:00:00Z'),date=new Date(now-3600000).toISOString();
const source=(title,extra={})=>({title,url:'https://media.example/'+encodeURIComponent(title),publisher:'Media',publishedAt:date,...extra});
const cases=[
 ['RUU perpajakan ditolak warga setelah dibahas DPR',true],
 ['KPK menyelidiki dugaan suap pejabat pemerintah',true],
 ['Pekerja menolak pemotongan upah perusahaan',true],
 ['Platform aplikasi diduga menjual data pribadi pelanggan',true],
 ['Eksploitasi buruh dalam rantai pasok fast fashion',true],
 ['Menteri membantah dugaan korupsi anggaran',true],
 ['Pemerintah menaikkan pajak PPN 12 persen',true],
 ['Subsidi listrik untuk warga dicabut',true],
 ['Bupati meresmikan pabrik baru',false],
 ['Bupati melantik pejabat dengan pesan mencegah korupsi',false],
 ['Pelantikan pejabat pemerintah dikritik karena dugaan nepotisme',true],
 ['Menteri menghadiri seremoni penurunan harga',false],
 ['Bank mengumumkan kenaikan laba tahunan',false],
 ['Harga emas naik pada perdagangan pagi',false],
 ['Perusahaan menaikkan gaji pekerja',false],
 ['Harga diri artis naik usai kontroversi percintaan',false],
 ['Kontroversi wasit pada pertandingan sepak bola',false],
 ['Promo harga murah turun lagi untuk pelanggan',false],
 ['Banjir mengakibatkan kerugian warga',false],
 ['Warga mengkritik kebijakan izin tambang setelah banjir',true]
];
test('investigative selection requires an issue context and tension, excludes ceremonies, price tickers, gossip and promotions',()=>{
 for(const [title,expected] of cases)assert.equal(investigateIssue(source(title)).eligible,expected,title);
 const denial=investigateIssue(source('Menteri membantah dugaan korupsi anggaran'));assert.match(denial.note,/Dugaan, bantahan dan opini belum membuktikan/);assert.equal(denial.passages[0].headlineOnly,true);
});
test('full articles and transcripts supply source-grounded signals, do not combine unrelated sentences, and scan past neutral openings',()=>{
 const body='Pabrik dibuka pada 2026. Warga menghadiri peresmian. Perusahaan diduga membuang limbah beracun ke sungai.';
 for(const key of ['article','transcript']){const result=investigateIssue(source('Pembukaan pabrik',{[key]:{text:body}}));assert.equal(result.eligible,true);assert.equal(result.passages[0].level,'full');assert.match(result.passages[0].text,/limbah beracun/);}
 assert.equal(investigateIssue(source('Peraturan baru',{excerpt:'Pemerintah mengumumkan aturan. Artis mendapat kritik terkait percintaan.'})).eligible,false);
 assert.equal(investigateIssue({sources:[source('Kebijakan baru'),source('Kontroversi pertandingan sepak bola')]}).eligible,false);
 const before=source('Menteri membantah dugaan korupsi anggaran');investigateIssue(before);assert.equal(before.title,'Menteri membantah dugaan korupsi anggaran');
});
test('focus preset overlay preserves existing topic edits and disabled choices; removed presets are not recreated after setup',()=>{
 const custom={id:'custom',enabled:false,keywords:['tata kota'],sources:['news']},original={topics:[custom],focus:{mode:'controversy',revision:1}};
 const next=withFocus(original);assert.equal(next.topics.length,5);assert.equal(original.topics.length,1);assert.equal(next.topics[0].enabled,false);
 const removed={...next,topics:next.topics.filter(t=>t.id!=='focus-policy')};assert.equal(withFocus(removed).topics.length,4);assert.equal(collectionTopics(next,'news')[0].id,'focus-policy');assert.equal(focusAllows(source('Seremoni pemerintah'),{mode:'general'}),true);
});
async function setup(t){const dir=await fs.mkdtemp(path.join(os.tmpdir(),'focus-radar-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));const content=new ContentStore(path.join(dir,'contents.json')),store=new RadarStore(content,{now:()=>now,focusMode:'controversy'});return {store,content};}
test('focused ranking, daily/weekly and executive summaries exclude routine news without deleting saved references or scripts',async t=>{
 const {store,content}=await setup(t);await content.create({title:'Draft tetap',script:'Naskah tersimpan'});
 await store.addSources([source('Pemerintah mengumumkan kebijakan pajak tahunan'),source('Warga menolak kebijakan pajak baru')]);
 const db=await content.read(),read=await store.read({includeResearchPlans:false});assert.equal(read.issues.length,2);assert.equal(read.rankedIssueIds.length,1);assert.match(read.issues.find(i=>i.stats.relevant).title,/menolak/);
 for(const period of ['daily','weekly']){const digest=buildRadarDigest(read,{period,date:'2026-10-10',now});assert.equal(digest.groups,1);assert.match(digest.items[0].title,/menolak/);}
 assert.equal(buildRadarExecutive(read,{now}).groups,1);assert.deepEqual(await content.read(),db);
 const routine=read.issues.find(i=>!i.stats.relevant);await store.changeIssue(routine.id,{revision:routine.revision,status:'saved'});assert.equal((await store.read()).issues.find(i=>i.id===routine.id).status,'saved');assert.equal((await content.read()).contents[0].script,'Naskah tersimpan');
});
test('focus can be saved explicitly, survives restart and protects against stale or invalid writes',async t=>{
 const {store,content}=await setup(t);assert.equal((await store.read()).focus.mode,'controversy');assert.equal((await content.read()).radar,undefined);
 await store.configureFocus({mode:'general',revision:1});assert.equal((await new RadarStore(content,{focusMode:'controversy'}).read()).focus.mode,'general');
 const before=await content.read();await assert.rejects(store.configureFocus({mode:'controversy',revision:1}),{status:409});await assert.rejects(store.configureFocus({mode:'gossip',revision:2}),{status:400});assert.deepEqual(await content.read(),before);
 await store.configureFocus({mode:'controversy',revision:2});assert.equal((await store.read()).topics.filter(t=>t.id.startsWith('focus-')).length,4);
});
test('news and YouTube acquisition filter routine results before storing while keeping hourly limits and existing manual material',async t=>{
 const {store}=await setup(t),rss='<rss><channel>'+['Pemerintah meresmikan kebijakan pajak','Warga menolak kebijakan pajak'].map((title,n)=>`<item><title>${title}</title><link>https://media.example/news${n}</link><pubDate>${new Date(now-3600000).toUTCString()}</pubDate></item>`).join('')+'</channel></rss>';
 let searches=0;const sync=new RadarSync(store,async url=>{if(url.includes('/search?')){searches++;return Response.json({items:[{id:{videoId:'abcdefghijk'}},{id:{videoId:'lmnopqrstuv'}}]});}return Response.json({items:[{id:'abcdefghijk',snippet:{title:'Pemerintah meresmikan kebijakan pajak',publishedAt:date,description:'',channelTitle:'Channel'}},{id:'lmnopqrstuv',snippet:{title:'Warga menolak kebijakan pajak',publishedAt:date,description:'',channelTitle:'Channel'}}]});},{now:()=>now,feed:async()=>rss});
 await store.addSources([source('Materi manual lama',{coverage:'manual'})]);await sync.sync({force:true});const read=await store.read();assert.ok(read.issues.some(i=>i.sources.some(s=>s.url.endsWith('news1'))));assert.ok(read.issues.some(i=>i.sources.some(s=>s.url.endsWith('lmnopqrstuv'))));assert.ok(!read.issues.some(i=>i.sources.some(s=>s.url.endsWith('news0')||s.url.endsWith('abcdefghijk'))));assert.ok(read.issues.some(i=>i.status==='saved'));assert.equal(searches,1);await sync.searchTopics({videos:0,errors:[]});assert.equal(searches,1);
});
