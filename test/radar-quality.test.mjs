import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import {buildIssueReport} from '../radar-engine.mjs';
import {buildRadarDigest} from '../radar-digest.mjs';
import {sourceSimilarity} from '../radar-methodology.mjs';

// Synthetic regression cases: these are not claims from the production Radar dataset.
const source=(excerpt,extra={})=>({id:'s1',title:'Program revitalisasi sekolah di Jember',url:'https://media.example/one',publisher:'Media',platform:'Berita / Web',coverage:'snippet',excerpt,...extra});
const report=(...sources)=>buildIssueReport({id:'fixture',title:'Bahan uji Radar',sources});
const pair=(a,b)=>report(source(a),source(b,{id:'s2',url:'https://second.example/two',publisher:'Media 2'}));
const inCategory=(excerpt,kind)=>{const r=report(source(excerpt));assert.equal(r[kind].length,1);assert.equal(r[kind][0].text,excerpt);return r[kind][0];};
const cases=[
 ['01 doctor abbreviation',()=>{const text='Dr. Hafid, S.Pd. menyatakan revitalisasi mencakup 258 sekolah.';assert.equal(inCategory(text,'data').attributed,true);}],
 ['02 abbreviated Rupiah and decimal',()=>{const text='Anggaran revitalisasi sekolah mencapai Rp. 187,38 miliar.';assert.deepEqual(inCategory(text,'data').numbers,['rp. 187,38 miliar']);}],
 ['03 decimals and thousands remain exact',()=>{const text='Program senilai Rp187,38 miliar menyerap sekitar 5.160 pekerja.';assert.deepEqual(inCategory(text,'data').numbers,['rp187,38 miliar','5.160 pekerja']);}],
 ['04 HTML block boundaries',()=>{const r=report(source('<p>Program mencakup 258 sekolah.</p><p>Layanan pengaduan warga dibuka</p>'));assert.equal(r.data.length,1);assert.equal(r.facts.length,1);}],
 ['05 HTML entities',()=>{assert.equal(report(source('<p>Program sekolah &amp; layanan warga sudah dimulai.</p>')).facts[0].text,'Program sekolah & layanan warga sudah dimulai.');}],
 ['06 empty HTML falls back to a labelled headline',()=>{const r=report(source('<p><br></p>'));assert.equal(r.quality.headlineOnlySources,1);assert.equal(r.summary[0].headlineOnly,true);}],
 ['07 RSS headline and publisher is headline-only',()=>{const r=report(source('Program revitalisasi sekolah di Jember Media'));assert.equal(r.quality.headlineOnlySources,1);assert.equal(r.summary[0].status,'headline_only');}],
 ['08 manual note remains source-attributed material',()=>{const r=report(source('Program mencakup 258 sekolah.',{coverage:'manual'}));assert.equal(r.data[0].status,'source_statement');assert.equal(r.quality.excerptSources,1);}],
 ['09 video promotion does not erase preceding data',()=>{const r=report(source('Program mencakup 258 sekolah.\nSubscribe channel kami untuk informasi terbaru.\nhttps://example.com',{platform:'YouTube'}));assert.equal(r.data[0].text,'Program mencakup 258 sekolah.');assert.equal(r.facts.length,0);}],
 ['10 evidence link in a meaningful sentence survives',()=>{const text='Program mencakup 258 sekolah, rincian tersedia di https://example.com/data';inCategory(text,'data');}],
 ['11 oversized prose uses headline fallback',()=>{const r=report(source('Narasi '.repeat(200)));assert.equal(r.summary[0].headlineOnly,true);assert.equal(r.summary[0].text,'Program revitalisasi sekolah di Jember');}],
 ['12 ellipsis tail is not a complete claim',()=>{const r=report(source('Program mencakup 258 sekolah. Anggaran untuk tahap berikutnya masih…'));assert.equal(r.data.length,1);assert.equal(r.facts.length,0);assert.equal(r.quality.truncatedSources,1);const middle=report(source('Anggaran bantuan berikutnya masih... Program mencakup 258 sekolah.'));assert.equal(middle.facts.length,0);assert.equal(middle.data.length,1);assert.equal(middle.quality.truncatedSources,1);}],
 ['13 storage-length tail does not leak into summary',()=>{const prefix='Program mencakup 258 sekolah. ';const r=report(source((prefix+'Bahan terpotong '.repeat(300)).slice(0,3000)));assert.equal(r.quality.truncatedSources,1);assert.equal(r.data[0].text,'Program mencakup 258 sekolah.');}],
 ['14 quote retains following attribution',()=>{const text='“Program mencakup 258 sekolah.” kata Hafid.';assert.equal(inCategory(text,'data').attributed,true);}],
 ['15 menurut with numbers is reported data',()=>{const text='Menurut Dinas Pendidikan, program mencakup 258 sekolah.';assert.equal(inCategory(text,'data').status,'attributed_claim');}],
 ['16 menurut with factual statement is attributed',()=>{const text='Menurut petugas, layanan pengaduan warga sudah dibuka.';assert.equal(inCategory(text,'facts').status,'attributed_claim');}],
 ['17 unverified numerical claim is not automatically opinion',()=>{const text='Perusahaan mengklaim telah membangun 258 sekolah.';const item=inCategory(text,'data');assert.equal(item.attributed,true);assert.equal(item.sourceVerified,false);}],
 ['18 evaluative statement is opinion',()=>{inCategory('Menurut pengamat, pembagian bantuan ini tidak adil.','opinions');}],
 ['19 numerical prediction remains opinion',()=>{inCategory('Pengamat memperkirakan program menjangkau 500 orang.','opinions');}],
 ['20 question is not a verified fact',()=>{inCategory('Apakah program revitalisasi sekolah sudah benar-benar selesai?','opinions');}],
 ['21 repeated cross-platform claims consolidate citations',()=>{const text='Program mencakup 258 sekolah.';const r=report(source(text),source(text,{id:'s2',url:'https://youtube.com/watch?v=abcdefghijk',publisher:'Channel',platform:'YouTube'}));assert.equal(r.data.length,1);assert.equal(r.data[0].sourceNumbers.length,2);}],
 ['22 negation remains a separate claim',()=>{assert.equal(pair('Layanan pengaduan warga telah dibuka.','Layanan pengaduan warga belum dibuka.').facts.length,2);}],
 ['23 comparable numeric disagreement is flagged',()=>{assert.equal(pair('Anggaran bantuan warga mencapai Rp100 juta tahun ini.','Anggaran bantuan warga mencapai Rp200 juta tahun ini.').conflicts.length,1);}],
 ['24 different calendar years are not a numeric conflict',()=>{assert.equal(pair('Anggaran bantuan warga mencapai Rp100 juta pada tahun 2025.','Anggaran bantuan warga mencapai Rp200 juta pada tahun 2026.').conflicts.length,0);}],
 ['25 different places are not a numeric conflict',()=>{assert.equal(pair('Anggaran bantuan warga Jember mencapai Rp100 juta tahun ini.','Anggaran bantuan warga Banyuwangi mencapai Rp200 juta tahun ini.').conflicts.length,0);}],
 ['26 different units are not a numeric conflict',()=>{assert.equal(pair('Anggaran bantuan warga mencapai Rp100 juta tahun ini.','Anggaran bantuan warga mencapai Rp1 miliar tahun ini.').conflicts.length,0);}],
 ['27 different publication/event dates are not a numeric conflict',()=>{assert.equal(pair('Anggaran bantuan warga mencapai Rp100 juta pada 3 Oktober 2026.','Anggaran bantuan warga mencapai Rp200 juta pada 4 Oktober 2026.').conflicts.length,0);}],
 ['28 generic titles cannot hide different body geography',()=>{const body=city=>`Program revitalisasi sekolah di ${city} mencakup fasilitas pendidikan negeri serta swasta dengan dukungan anggaran daerah dan tenaga kerja setempat.`;assert.equal(sourceSimilarity(source(body('Jember'),{title:'Pemerintah umumkan program revitalisasi sekolah'}),source(body('Banyuwangi'),{title:'Pemerintah umumkan program revitalisasi sekolah'})),0);}],
 ['29 same event still groups with generic titles',()=>{const body='Program revitalisasi sekolah di Jember mencakup fasilitas pendidikan negeri serta swasta dengan dukungan anggaran daerah dan tenaga kerja setempat.';assert.ok(sourceSimilarity(source(body,{title:'Pemerintah umumkan program revitalisasi sekolah'}),source(body,{title:'Pemerintah umumkan program revitalisasi sekolah'})));}],
 ['30 digest consolidates publisher aliases',()=>{const sources=[source('Program mencakup 258 sekolah.',{publisher:'Media.com',publisherUrl:'https://www.media.com',publishedAt:'2026-10-03T02:00:00Z'}),source('Layanan pengaduan warga dibuka.',{id:'s2',url:'https://media.com/two',publisher:'Media',publisherUrl:'https://media.com',publishedAt:'2026-10-03T02:00:00Z'})];const r=buildRadarDigest({topics:[],issues:[{id:'group',title:'Revitalisasi sekolah',status:'new',topicIds:[],stats:{relevant:true},sources}]},{period:'daily',date:'2026-10-03',now:Date.parse('2026-10-03T04:00:00Z')});assert.equal(r.publishers,1);assert.equal(r.sourceCount,2);assert.equal(r.usesAI,false);}],
];
for(const [name,run]of cases)test('Radar quality '+name,run);

test('quality metadata and lead source limitations remain visible in the UI and copied report',async()=>{
 const code=await fs.readFile(new URL('../public/radar.js',import.meta.url),'utf8'),ctx={esc:s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),rDate:String};vm.createContext(ctx);
 vm.runInContext(code.slice(code.indexOf('function radarEngineReport('),code.indexOf('async function radarEngineIssue(')),ctx);
 const data=report(source('Program revitalisasi sekolah di Jember Media'));
 const html=ctx.radarEngineReport(data);assert.match(html,/sumber judul saja/);assert.match(html,/Judul saja/);assert.match(html,/1 \/ 1/);assert.match(html,/Cakupan bahan rangkuman/);assert.match(data.text,/1 sumber judul saja/);
});
