import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {ContentStore} from '../content-store.mjs';
import {RadarStore} from '../radar-store.mjs';
import {headline,headlineSimilarity,explainSourceMatch,createIssueMatcher} from '../radar-methodology.mjs';
import {explainIssueGrouping,selectIssue} from '../radar-grouping.mjs';
import {buildIssueReport} from '../radar-engine.mjs';
import {buildRadarDigest} from '../radar-digest.mjs';
const now=Date.parse('2026-10-03T08:30:00Z'),at=new Date(now-3600000).toISOString();
const input=(n,extra={})=>({id:'s'+n,title:'Pajak usaha Jember dalam kebijakan baru',url:`https://media${n}.example/article`,publisher:'Media '+n,platform:'Berita / Web',publishedAt:at,discoveredAt:at,excerpt:`Anggaran bantuan warga dalam kebijakan pajak usaha Jember mencapai ${n} juta untuk distribusi kebutuhan masyarakat melalui layanan resmi daerah.`,...extra});
async function setup(t){const dir=await fs.mkdtemp(path.join(os.tmpdir(),'radar-grouping-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));const content=new ContentStore(path.join(dir,'contents.json'));return {dir,content,radar:new RadarStore(content,{now:()=>now})};}

test('controlled aliases group equivalent titles across news and video, while preserving actor/location guards',()=>{
 const pairs=[['Pemkab Jember Naikkan Pajak Daerah','Pemerintah Kabupaten Jember Menaikkan Pajak Daerah'],['Disdik Jember Umumkan Program Sekolah','Dinas Pendidikan Jember Umumkan Program Sekolah'],['PHK PT Alpha 500 Pekerja di Jember','Pemutusan Hubungan Kerja PT Alpha 500 Pekerja di Jember'],['Harga Elpiji Naik di Jember','Harga LPG Meningkat di Jember'],['Harga Beras Melonjak di Jember','Harga Beras Naik di Jember']];
 for(const [left,right]of pairs)assert.ok(headlineSimilarity(headline(left),headline(right))>0,left);
 assert.equal(headlineSimilarity(headline('Pemkab Jember Naikkan Pajak Daerah'),headline('Pemkab Banyuwangi Naikkan Pajak Daerah')),0);
 assert.equal(headlineSimilarity(headline('Harga Beras Melonjak di Jember'),headline('Harga Beras Merosot di Jember')),0);
});
test('explicit organizations and named honorifics protect otherwise similar events',()=>{
 for(const [left,right]of [['PHK PT Sumber Rejeki di Jember','PHK PT Sumber Makmur di Jember'],['Bank Jatim Naikkan Biaya Administrasi','Bank Jateng Naikkan Biaya Administrasi'],['Gus Fawait Naikkan Pajak Daerah Jember','Gus Ahmad Naikkan Pajak Daerah Jember'],['Disdik Jember Umumkan Kebijakan Baru','Dishub Jember Umumkan Kebijakan Baru']])assert.equal(headlineSimilarity(headline(left),headline(right)),0,left);
});
test('event dates and opposite opening/closing do not collapse, but unknown year does not fabricate a conflict',()=>{
 assert.equal(headlineSimilarity(headline('Penataan Pasar Tanjung Jember 3 Oktober 2026'),headline('Penataan Pasar Tanjung Jember 4 Oktober 2026')),0);
 assert.ok(!explainSourceMatch(input(1,{title:'Penataan Pasar Tanjung Jember 3 Oktober 2026',excerpt:''}),input(2,{title:'Penataan Pasar Tanjung Jember 3 Oktober',excerpt:''})).reasons.some(r=>/Tanggal/.test(r)));
 assert.equal(headlineSimilarity(headline('Pasar Tanjung Jember Dibuka'),headline('Pasar Tanjung Jember Ditutup')),0);
});
test('pair explanation reports actual text overlap and blockers without AI or truth probability',()=>{
 const a=input(1,{title:'Disdik Jember Umumkan Program Sekolah',excerpt:''}),b=input(2,{title:'Dinas Pendidikan Jember Umumkan Program Sekolah',excerpt:'',platform:'YouTube'}),detail=explainSourceMatch(a,b);
 assert.equal(detail.matched,true);assert.equal(detail.basis,'title_exact');assert.equal(detail.score,1);assert.ok(detail.sharedTerms.includes('pendidikan'));assert.ok(detail.sharedEntities.some(e=>e.value==='jember'));
 const blocked=explainSourceMatch(a,{...b,title:'Dishub Jember Umumkan Program Sekolah'});assert.equal(blocked.matched,false);assert.ok(blocked.reasons.some(r=>/Organisasi/.test(r)));
});
test('substantial body matches and multiple supporting sources explain the actual decision',()=>{
 const body='Harga beras di Kabupaten Jember naik setelah pasokan gudang berkurang. Pedagang pangan mengeluhkan biaya distribusi mahal. Warga menambah anggaran biaya hidup rumah tangga dan dinas perdagangan memantau persediaan melalui operasi pasar.';
 const a=input(1,{title:'Harga beras melonjak di Jember',excerpt:body}),b=input(2,{title:'Warga Jember mengeluhkan pangan mahal',excerpt:body});assert.equal(explainSourceMatch(a,b).basis,'content_similarity');
 const match=createIssueMatcher(),first=input(1,{title:'Alpha Beta Gamma Delta Epsilon Zeta',excerpt:''}),second=input(2,{title:'Alpha Beta Gamma Delta Epsilon Theta',excerpt:''}),third=input(3,{title:'Alpha Beta Gamma Delta Theta Kappa',excerpt:''});
 const result=match.explain({sources:[first,second,{...second,id:'s4',url:'https://other.example/a'}]},third);assert.equal(result.matched,true);assert.equal(result.basis,'multiple_sources');assert.equal(result.referenceSourceIds.length,2);assert.equal(result.score,match({sources:[first,second,{...second,id:'s4'}]},third));
 assert.equal(match.explain({sources:[first,second]},third).matched,false);
});
test('time/capacity guards are explained, including publication/ discovery window distinction',()=>{
 const match=createIssueMatcher();assert.match(match.explain({sources:[input(1,{publishedAt:new Date(now-80*3600000).toISOString()})]},input(2)).reasons[0],/72 jam/);
 assert.match(match.explain({sources:Array.from({length:100},(_,n)=>input(n))},input(101)).reasons[0],/100 sumber/);
 assert.match(match.explain({sources:[]},input(1)).reasons[0],/Belum ada/);
 assert.equal(match.explain({sources:[input(1,{publishedAt:null})]},input(2,{publishedAt:null})).windowHours,0);
});
test('cached source profiles refresh when an import enriches the excerpt or edits its headline',()=>{
 const match=createIssueMatcher(),body='Harga beras di Kabupaten Jember naik setelah pasokan gudang berkurang. Pedagang pangan mengeluhkan biaya distribusi mahal. Warga menambah anggaran biaya hidup rumah tangga dan dinas perdagangan memantau persediaan melalui operasi pasar.';
 const a=input(1,{title:'Harga beras melonjak di Jember',excerpt:''}),b=input(2,{title:'Warga Jember mengeluhkan pangan mahal',excerpt:body});assert.equal(match({sources:[a]},b),0);a.excerpt=body;assert.ok(match({sources:[a]},b)>0);a.title='Harga beras melonjak di Banyuwangi';assert.equal(match({sources:[a]},b),0);
});
test('saved import provenance and grouping explanations are read-only and survive restart',async t=>{
 const {radar,content,dir}=await setup(t);await radar.addSources([input(1),input(2)]);const issue=(await radar.read()).issues[0];assert.equal(issue.sources[0].grouping.mode,'anchor');assert.equal(issue.sources[1].grouping.mode,'automatic');assert.equal(issue.sources[1].grouping.methodVersion,5);
 const before=await content.read(),detail=explainIssueGrouping(issue);assert.equal(detail.usesAI,false);assert.equal(detail.sources[1].evaluation.matched,true);assert.equal(detail.sources[1].provenance.basis,'title_exact');assert.deepEqual(await content.read(),before);
 const reopened=new RadarStore(new ContentStore(path.join(dir,'contents.json')),{now:()=>now});assert.deepEqual((await reopened.read()).issues[0].sources,issue.sources);
});
test('split rules route identical material to the selected side and quarantine ambiguous new variants',async t=>{
 const {radar,content,dir}=await setup(t);await radar.addSources([input(1),input(2)]);let group=(await radar.read()).issues[0];const sourceA=group.sources[0],sourceB=group.sources[1];
 const split=await radar.split(group.id,{revision:group.revision,title:'Pajak kelompok A',sourceIds:[sourceA.id]});let data=await radar.read();const a=data.issues.find(i=>i.id===split.issueId),b=data.issues.find(i=>i.id===group.id);assert.equal(a.groupPartition,b.groupPartition);
 await radar.addSources([input(10,{excerpt:sourceA.excerpt})]);data=await radar.read();assert.equal(data.issues.find(i=>i.id===a.id).sources.length,2);assert.equal(data.issues.find(i=>i.id===b.id).sources.length,1);
 await radar.addSources([input(3)]);data=await radar.read();const review=data.issues.find(i=>i.groupingReview);assert.ok(review);assert.equal(review.sources[0].grouping.mode,'needs_review');assert.equal(review.groupPartition,a.groupPartition);assert.equal(data.issues.find(i=>i.id===b.id).sources[0].id,sourceB.id);
 await radar.addSources([input(30,{excerpt:input(3).excerpt})]);assert.equal((await radar.read()).issues.find(i=>i.id===review.id).sources.length,2);
 const reopened=new RadarStore(new ContentStore(path.join(dir,'contents.json')),{now:()=>now});await reopened.mutate(r=>r.clusteringVersion=4);assert.equal((await reopened.recluster()).merged,0);assert.equal((await reopened.read()).issues.length,3);assert.deepEqual((await content.read()).radar.issues.flatMap(i=>i.sources).map(s=>s.id).sort(),(await reopened.read()).issues.flatMap(i=>i.sources).map(s=>s.id).sort());
});
test('manual merge explicitly overrides a separation and preserves unrelated groups and all scripts',async t=>{
 const {radar,content}=await setup(t);for(let n=1;n<=5;n++)await radar.addSources([input(n,{title:['','Pajak pusat 2026','Subsidi listrik 2026','Biaya hidup rumah tangga','Krisis komoditas kopi','Arsip sejarah jembatan'][n],excerpt:''})]);let data=await radar.read();const ids=data.issues.map(i=>i.id);
 await radar.mutate(r=>{r.issues.find(i=>i.id===ids[0]).groupPartition='familyA';r.issues.find(i=>i.id===ids[1]).groupPartition='familyA';r.issues.find(i=>i.id===ids[2]).groupPartition='familyB';r.issues.find(i=>i.id===ids[2]).groupingHistory=[{action:'split',at,originalId:ids[2],createdId:ids[3],sourceIds:[]}];r.issues.find(i=>i.id===ids[3]).groupPartition='familyB';});
 await content.create({title:'Naskah tetap utuh',script:'Isi naskah asli',radarIssueId:ids[2]});const before=await content.read();data=await radar.read();const target=data.issues.find(i=>i.id===ids[0]),from=data.issues.find(i=>i.id===ids[2]);
 await radar.merge(target.id,{revision:target.revision,fromId:from.id,fromRevision:from.revision});const after=await content.read();assert.deepEqual(after.contents,before.contents);assert.equal(after.radar.issues.find(i=>i.id===ids[3]).groupPartition,'familyA');assert.equal(after.radar.issues.find(i=>i.id===ids[4]).groupPartition,undefined);assert.equal(after.radar.issues.flatMap(i=>i.sources).length,5);assert.equal(after.radar.issues.find(i=>i.id===target.id).groupingHistory.at(-1).action,'merge');assert.ok(after.radar.issues.find(i=>i.id===target.id).groupingHistory.some(h=>h.action==='split'));
});
test('merging a partitioned and unpartitioned group never assigns the family to unrelated records',async t=>{
 const {radar}=await setup(t);for(let n=1;n<=3;n++)await radar.addSources([input(n,{title:'Pajak kebijakan khusus '+['alpha','beta','gamma'][n-1],excerpt:''})]);let data=await radar.read();assert.equal(data.issues.length,3);const [target,from,other]=data.issues;await radar.mutate(r=>r.issues.find(i=>i.id===target.id).groupPartition='partition');data=await radar.read();
 await radar.merge(target.id,{revision:data.issues.find(i=>i.id===target.id).revision,fromId:from.id,fromRevision:from.revision});assert.equal((await radar.read()).issues.find(i=>i.id===other.id).groupPartition,undefined);
});
test('manual merge rules retain repeated material despite general entity guards, but do not learn unrelated new topics',async t=>{
 const {radar}=await setup(t),a=input(1,{title:'Disdik Jember Umumkan Kebijakan Pajak Sekolah'}),b=input(2,{title:'Dishub Jember Umumkan Kebijakan Pajak Sekolah'});await radar.addSources([a,b]);let data=await radar.read();assert.equal(data.issues.length,2);const [target,from]=data.issues;
 await radar.merge(target.id,{revision:target.revision,fromId:from.id,fromRevision:from.revision});await radar.addSources([{...a,url:'https://third.example/repeat'}]);data=await radar.read();assert.equal(data.issues.length,1);assert.equal(data.issues[0].sources.length,3);assert.equal(data.issues[0].sources.at(-1).grouping.mode,'manual_rule');
 await radar.addSources([input(4,{title:'Dinkes Jember Umumkan Kebijakan Pajak Sekolah'})]);assert.equal((await radar.read()).issues.length,2);
});
test('a saved manual correction wins an otherwise equal automatic match',()=>{
 const a=input(1),corrected={id:'z-corrected',sources:[a],groupingHistory:[{action:'merge',at}]},ordinary={id:'a-ordinary',sources:[{...a,id:'other',url:'https://other.example/a'}]};
 const result=selectIssue([ordinary,corrected],input(10,{excerpt:a.excerpt}));assert.equal(result.issue.id,corrected.id);assert.equal(result.match.basis,'manual_rule');
});
test('reviewing a group is revision-safe, preserves separation rules, and is not source verification',async t=>{
 const {radar,content}=await setup(t);await radar.addSources([input(1)]);let issue=(await radar.read()).issues[0];await radar.mutate(r=>{r.issues[0].groupingReview=true;r.issues[0].groupPartition='partition';});issue=(await radar.read()).issues[0];
 await assert.rejects(radar.changeIssue(issue.id,{revision:issue.revision-1,groupingReview:false}),{status:409});const before=await content.read();await assert.rejects(radar.changeIssue(issue.id,{revision:issue.revision,groupingReview:true}),{status:400});assert.deepEqual(await content.read(),before);
 await radar.changeIssue(issue.id,{revision:issue.revision,groupingReview:false});const next=(await radar.read()).issues[0];assert.equal(next.groupingReview,false);assert.equal(next.groupPartition,'partition');assert.equal(next.sources[0].verification,'unchecked');assert.equal(next.groupingHistory.at(-1).action,'reviewed');
});
test('review warnings survive cached summaries and digest generation, and disappear when explicitly reviewed',()=>{
 const issue={id:'issue',title:'Pajak kebijakan',status:'new',topicIds:[],stats:{relevant:true},sources:[input(1)],groupingReview:true};assert.ok(buildIssueReport(issue).limitations.some(l=>/Pengelompokan/.test(l)));
 const digest=buildRadarDigest({topics:[],issues:[issue]},{period:'daily',date:'2026-10-03',now});assert.equal(digest.items[0].groupingReview,true);assert.ok(digest.items[0].report.limitations.some(l=>/Pengelompokan/.test(l)));assert.equal(digest.items[0].stats.isHot,false);
 issue.groupingReview=false;assert.ok(!buildIssueReport(issue).limitations.some(l=>/Pengelompokan/.test(l)));
});
test('grouping UI escapes all metadata, distinguishes recorded/current explanations, and avoids executable URLs',async()=>{
 const code=await fs.readFile(new URL('../public/radar.js',import.meta.url),'utf8'),ctx={esc:s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),rDate:String};vm.createContext(ctx);vm.runInContext(code.slice(code.indexOf('function radarGroupingReport('),code.indexOf('async function radarGroupingIssue(')),ctx);
 const data=explainIssueGrouping({id:'issue',title:'Pajak',sources:[input(1,{title:'<img onerror=evil>',url:'javascript:evil()',publisher:'<script>evil</script>',grouping:{mode:'anchor',at,methodVersion:5}})],groupingLocked:true,groupPartition:'partition',groupingReview:true,groupingHistory:[{action:'split',at}]});
 const html=ctx.radarGroupingReport(data);assert.ok(!html.includes('<img'));assert.ok(!html.includes('<script>'));assert.ok(!html.includes('href="javascript:'));assert.match(html,/Aturan pemisahan tersimpan/);assert.match(html,/Riwayat masuk sumber/);assert.match(html,/Evaluasi saat ini/);assert.match(html,/bukan probabilitas kebenaran/);assert.match(html,/Pemisahan manual/);
});
