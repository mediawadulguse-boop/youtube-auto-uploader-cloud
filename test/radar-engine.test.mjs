import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {buildIssueReport} from '../radar-engine.mjs';
import {buildRadarDigest} from '../radar-digest.mjs';
import {ContentStore} from '../content-store.mjs';
import {RadarStore} from '../radar-store.mjs';
import {RadarAIProviders} from '../radar-ai.mjs';
import {createIssueMatcher,sourceSimilarity} from '../radar-methodology.mjs';
const now=Date.parse('2026-10-03T04:00:00Z');
const source=(n,extra={})=>({id:'s'+n,url:`https://media${n}.example/article`,title:'Data pajak bantuan di Jember',publisher:'Media '+n,platform:'Berita / Web',publishedAt:'2026-10-03T02:00:00Z',coverage:'snippet',verification:'unchecked',excerpt:'Anggaran bantuan di Jember mencapai Rp187,38 miliar. Pemerintah membuka layanan pengaduan warga. Menurut pengamat, bantuan diperkirakan menjangkau 500 orang.',...extra});
const issue=sources=>({id:'issue1',title:'Bantuan warga',sources});

test('extracts source sentences, Rupiah decimals, factual claims and numeric predictions into distinct categories',()=>{
 const report=buildIssueReport(issue([source(1)]));
 assert.equal(report.usesAI,false);assert.equal(report.data.length,1);assert.deepEqual(report.data[0].numbers,['rp187,38 miliar']);
 assert.equal(report.facts.length,1);assert.equal(report.opinions.length,1);assert.match(report.opinions[0].text,/500 orang/);
 for(const item of [...report.summary,...report.data,...report.facts,...report.opinions]){assert.ok(source(1).excerpt.includes(item.text));assert.deepEqual(item.sourceNumbers,[1]);}
 assert.match(report.text,/https:\/\/media1.example/);assert.match(report.note,/bukan verifikasi otomatis/);
});
test('deduplicates repeated claims, counts publishers without reposts, and preserves attribution and opposing claims',()=>{
 const positive='Pemerintah membuka layanan pengaduan warga terdampak banjir besar di Jember.';
 const negative='Pemerintah tidak membuka layanan pengaduan warga terdampak banjir besar di Jember.';
 const report=buildIssueReport(issue([source(1,{excerpt:positive}),source(2,{excerpt:positive}),source(3,{excerpt:positive,repost:true}),source(4,{excerpt:negative}),source(5,{excerpt:'Bupati mengatakan layanan pengaduan warga telah dibuka.'})]));
 const merged=report.facts.find(i=>i.text===positive);assert.equal(merged.sourceNumbers.length,3);assert.equal(merged.publishers,2);
 assert.ok(report.facts.some(i=>i.text===negative));assert.equal(report.facts.find(i=>i.text.startsWith('Bupati')).status,'attributed_claim');
 const temporal=buildIssueReport(issue([source(1,{excerpt:'Pemerintah membuka layanan pengaduan warga terdampak banjir besar sebelum rapat daerah.'}),source(2,{excerpt:'Pemerintah membuka layanan pengaduan warga terdampak banjir besar setelah rapat daerah.'})]));assert.equal(temporal.facts.length,2);
});
test('different numeric statements remain visible and are flagged, without picking a winner',()=>{
 const report=buildIssueReport(issue([source(1,{excerpt:'Anggaran bantuan warga Jember mencapai Rp187,38 miliar tahun ini.'}),source(2,{excerpt:'Anggaran bantuan warga Jember mencapai Rp200 miliar tahun ini.'})]));
 assert.equal(report.data.length,2);assert.equal(report.conflicts.length,1);assert.match(report.conflicts[0].note,/tidak memilih/);
});
test('headlines and video descriptions expose limits; cache invalidates when source text changes and cannot be mutated by callers',()=>{
 const data=issue([source(1,{excerpt:'',platform:'YouTube',coverage:'headline',verification:'verified'})]);
 const report=buildIssueReport(data);assert.ok(report.facts[0].headlineOnly);assert.equal(report.facts[0].status,'headline_only');
 assert.ok(report.limitations.some(t=>/bukan transkrip/.test(t)));assert.ok(report.limitations.some(t=>/hanya memiliki judul/.test(t)));
 report.facts[0].text='Mutated';assert.notEqual(buildIssueReport(data).facts[0].text,'Mutated');
 data.sources[0].excerpt='Anggaran bantuan warga meningkat menjadi 200 juta.';assert.equal(buildIssueReport(data).data[0].numbers[0],'200 juta');
 assert.deepEqual(buildIssueReport(issue([])).summary,[]);
});
test('daily and weekly engine reports use only in-period sources, work with configured AI, and spend no quota or storage writes',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'radar-engine-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 const content=new ContentStore(path.join(dir,'contents.json')),radar=new RadarStore(content,{now:()=>now});
 await radar.addSources([source(1),source(2,{publishedAt:'2026-10-01T02:00:00Z',excerpt:'Anggaran bantuan mencapai 100 juta.'}),source(3,{publishedAt:null}),source(4,{publishedAt:'2026-10-03T06:00:00Z'})]);
 const ai=new RadarAIProviders(radar,{defaultProvider:'openai',providers:{openai:{key:'test',model:'gpt-test',now:()=>now,fetcher:()=>{throw Error('Engine must not call AI');}},gemini:{key:''},groq:{key:''}}});
 const before=await content.read(),data=await radar.read();
 const daily=buildRadarDigest(data,{period:'daily',now}),weekly=buildRadarDigest(data,{period:'weekly',now});
 assert.equal(daily.usesAI,false);assert.equal(daily.sourceCount,1);assert.equal(weekly.sourceCount,2);
 assert.equal(daily.items[0].report.sourceCount,1);assert.ok(daily.items.every(i=>i.report.sources.every(s=>Date.parse(s.publishedAt)>=Date.parse(daily.startAt)&&Date.parse(s.publishedAt)<now)));
 assert.ok(!daily.items[0].report.text.includes('100 juta'));assert.ok(weekly.items.some(i=>i.report.text.includes('100 juta')));
 assert.equal((await ai.status()).used,0);assert.deepEqual(await content.read(),before);
});
test('multiple group members rescue weak headlines while one-member chains and conflicting locations cannot merge',()=>{
 const match=createIssueMatcher(),a=source(1,{title:'Alpha Beta Gamma Delta Epsilon Zeta',excerpt:''}),b=source(2,{title:'Alpha Beta Gamma Delta Epsilon Theta',excerpt:''}),c=source(3,{title:'Alpha Beta Gamma Delta Theta Kappa',excerpt:''});
 assert.ok(match({sources:[a]},b));assert.equal(match({sources:[a,b]},c),0);assert.ok(match({sources:[a,b,{...b,id:'other',url:'https://another.example'}]},c));
 assert.equal(match({sources:[source(1,{title:'Bantuan untuk warga Jember'}),source(2,{title:'Bantuan untuk warga Banyuwangi'})]},source(3,{title:'Bantuan untuk warga Banyuwangi'})),0);
});
test('substantial cross-platform excerpts group despite different wording, but shared boilerplate does not',()=>{
 const body='Harga beras melonjak di Jember karena pasokan petani menurun setelah banjir merendam sawah. Warga mengeluhkan pangan mahal dan pedagang pasar meminta bantuan distribusi kepada pemerintah daerah.';
 const a=source(1,{title:'Harga beras melonjak di Jember',excerpt:body}),b=source(2,{platform:'YouTube',title:'Warga Jember mengeluhkan pangan mahal',excerpt:body+' Pemeriksaan gudang, ongkos transportasi, stok Bulog serta persediaan distributor menjadi langkah petugas pekan berikutnya.'});
 assert.ok(sourceSimilarity(a,b)>0);
 assert.equal(sourceSimilarity({...a,excerpt:'Subscribe dan follow channel berita terbaru.'},{...b,excerpt:'Subscribe dan follow channel berita terbaru.'}),0);
});
test('engine UI escapes all extracted text and exposes original citations with no AI invocation',async()=>{
 const code=await fs.readFile(new URL('../public/radar.js',import.meta.url),'utf8');
 const context={esc:s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;'),rDate:String};vm.createContext(context);
 vm.runInContext(code.slice(code.indexOf('function radarEngineReport('),code.indexOf('async function radarEngineIssue(')),context);
 const report=buildIssueReport(issue([source(1,{excerpt:'Menurut sumber, <img src=x onerror=alert(1)> adalah dugaan awal.',title:'<script>evil</script>'})]));
 const html=context.radarEngineReport(report);assert.ok(!html.includes('<script>'));assert.ok(!html.includes('<img'));assert.match(html,/&lt;script&gt;|&lt;script/);assert.match(html,/0 kuota AI/);assert.match(html,/https:\/\/media1.example/);
});
