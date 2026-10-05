import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import {rateIssue} from '../radar-methodology.mjs';
import {buildExecutiveSummary,buildRadarExecutive} from '../radar-executive.mjs';
import {buildRadarDigest} from '../radar-digest.mjs';

const now=Date.parse('2026-10-05T05:00:00Z');
const source=(id,{at='2026-10-05T01:00:00Z',text='Anggaran program mencapai Rp200 juta.',...extra}={})=>({id,title:'Perubahan anggaran program',url:`https://media${id}.example/berita`,publisher:`Media ${id}`,platform:'Berita / Web',publishedAt:at,excerpt:text,coverage:'snippet',verification:'unchecked',...extra});
const issue=(id,sources,extra={})=>({id,title:'Anggaran program '+id,status:'new',topicIds:['system'],sources,stats:{...rateIssue({sources},now),relevant:true},...extra});
const data=issues=>({topics:[{id:'system'}],issues});

test('executive preserves attribution and references, excludes ignored/discussed priorities, and never changes input',()=>{
 const active=issue('active',[source('a'),source('b',{text:'Menurut laporan, anggaran program mencapai Rp200 juta.'})]),ignored=issue('ignored',[source('c')],{status:'ignored'}),done=issue('done',[source('d')],{status:'discussed'}),items=[active,ignored,done],before=structuredClone(items);
 const summary=buildExecutiveSummary(items,{now});assert.equal(summary.usesAI,false);assert.equal(summary.groups,2);assert.equal(summary.priorities.length,1);assert.equal(summary.priorities[0].id,'active');assert.match(summary.text,/Rp200 juta/);assert.ok(summary.priorities[0].evidence.every(e=>e.references.length>0));assert.match(summary.text,/https:\/\/media/);assert.equal(summary.priorities[0].action,'Lengkapi riset');assert.deepEqual(items,before);
});
test('headline-only and disputed groups receive research actions while full reviewed materials can start an outline',()=>{
 const bare=buildExecutiveSummary([issue('bare',[source('a',{text:''})])],{now});assert.equal(bare.priorities[0].evidence.length,0);assert.equal(bare.priorities[0].action,'Lengkapi riset');assert.match(bare.text,/judul saja/);
 const full=[source('a',{article:{text:'Anggaran program mencapai Rp200 juta.'},verification:'verified'}),source('b',{article:{text:'Anggaran program mencapai Rp200 juta.'},verification:'verified'})];
 const complete=buildExecutiveSummary([issue('full',full)],{now});assert.equal(complete.priorities[0].action,'Susun kerangka bersumber');assert.match(complete.note,/bukan prediksi viral/);
 const disputed=buildExecutiveSummary([issue('disputed',full,{groupingReview:true})],{now});assert.equal(disputed.priorities[0].action,'Periksa perbedaan');
 const conflicting=buildExecutiveSummary([issue('conflict',[source('a'),source('b',{text:'Anggaran program mencapai Rp300 juta.'})])],{now});assert.equal(conflicting.priorities[0].action,'Periksa perbedaan');assert.match(conflicting.text,/belum ada penentuan kebenaran/);
});
test('live executive matches filters, keeps low-score priorities, and explicitly marks out-of-period fallback',()=>{
 const news=issue('news',[source('a')]),video=issue('video',[source('b',{platform:'YouTube'})]),old=issue('old',[source('c',{at:'2026-09-01T00:00:00Z'})]);
 assert.equal(buildRadarExecutive(data([news]),{now}).priorities[0].id,'news');
 assert.equal(buildRadarExecutive(data([news,video]),{now,platform:'YouTube'}).priorities[0].id,'video');
 assert.equal(buildRadarExecutive(data([news,video]),{now,q:'program video'}).groups,1);
 assert.equal(buildRadarExecutive(data([old]),{now}).fallback,true);assert.equal(buildRadarExecutive(data([old,news]),{now}).fallback,false);
 assert.equal(buildRadarExecutive(data([news]),{now,topic:'system',status:'discussed'}).groups,0);
 assert.throws(()=>buildRadarExecutive(data([]),{period:1}),/Pilih periode/);assert.throws(()=>buildRadarExecutive(data([]),{topic:'missing'}),/tidak ditemukan/);
});
test('daily/weekly executives compare equal elapsed WIB periods and use evidence only from the selected period',()=>{
 const current=issue('current',[source('a'),source('b',{at:'2026-10-04T01:00:00Z',text:'Anggaran lama mencapai Rp999 juta.'})]),past=issue('past',[source('c',{at:'2026-10-04T02:00:00Z'})]);
 const daily=buildRadarDigest(data([current,past]),{period:'daily',date:'2026-10-05',now});assert.equal(daily.executive.partial,true);assert.equal(daily.executive.groups,1);assert.equal(daily.executive.comparison.deltaGroups,-1);assert.equal(daily.executive.comparison.startAt,'2026-10-03T17:00:00.000Z');assert.equal(daily.executive.comparison.throughAt,'2026-10-04T05:00:00.000Z');assert.doesNotMatch(daily.executive.text,/Rp999/);
 const weekly=buildRadarDigest(data([current,issue('last-week',[source('d',{at:'2026-09-28T01:00:00Z'})]),issue('later-last-week',[source('e',{at:'2026-09-29T01:00:00Z'})])]),{period:'weekly',date:'2026-10-05',now});assert.equal(weekly.executive.comparison.startAt,'2026-09-27T17:00:00.000Z');assert.equal(weekly.executive.comparison.throughAt,'2026-09-28T05:00:00.000Z');assert.equal(weekly.executive.comparison.deltaGroups,0);
 const empty=buildExecutiveSummary([],{now});assert.equal(empty.priorities.length,0);assert.match(empty.overview,/Belum ada bahan/);
});
test('executive UI escapes source text, displays research gaps, and includes only supported evidence links',async()=>{
 const code=await fs.readFile('public/radar.js','utf8'),ctx={esc:v=>String(v).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;')};vm.createContext(ctx);
 vm.runInContext(code.slice(code.indexOf('function radarExecutiveReport('),code.indexOf('const rDialog=')),ctx);
 const summary=buildExecutiveSummary([issue('html',[source('a')],{title:'<img src=x onerror=alert(1)>'})],{now});const html=ctx.radarExecutiveReport(summary);assert.match(html,/&lt;img/);assert.doesNotMatch(html,/<img/);assert.match(html,/Klaim sumber/);assert.match(html,/Perlu diperiksa/);assert.match(html,/data-executive-copy/);assert.match(html,/rel="noopener noreferrer"/);
 assert.equal(ctx.radarExecutiveReport(null),'');
});
