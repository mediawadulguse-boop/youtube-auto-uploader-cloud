import test from 'node:test';
import assert from 'node:assert/strict';
import {buildIssueReport} from '../radar-engine.mjs';
const source=(id,excerpt,publishedAt)=>({id,url:'https://example.org/'+id,title:'Layanan warga',publisher:id,platform:'Berita / Web',excerpt,publishedAt,coverage:'snippet',verification:'unchecked'});
test('research preserves contextual numbers, explicit names, literal disagreement and publication dates',()=>{
 const report=buildIssueReport({id:'issue',title:'Layanan',sources:[source('b','Dinas Pendidikan Jember membuka layanan pengaduan warga. Anggaran bantuan mencapai Rp200 juta.','2026-10-02T01:00:00Z'),source('a','Dinas Pendidikan Jember tidak membuka layanan pengaduan warga. Budi Santoso mengatakan bantuan tersedia.','2026-10-01T01:00:00Z')]});
 assert.equal(report.usesAI,false);assert.equal(report.chronology[0].kind,'publication');assert.match(report.chronology[0].at,/10-01/);assert.ok(report.actors.some(a=>a.name==='Budi Santoso'));assert.ok(report.actors.some(a=>a.name==='Dinas Pendidikan Jember'));assert.equal(report.differences.length,1);assert.equal(report.importantNumbers[0].value,'rp200 juta');assert.match(report.text,/KEBUTUHAN RISET/);assert.ok(report.researchGaps.some(g=>g.includes('tanggal peristiwa')));
 for(const entry of [...report.actors,...report.importantNumbers])assert.ok(report.sources.some(s=>entry.sourceNumbers.includes(s.number)));
});
test('does not invent chronology or actors from missing material and invalidates event date cache',()=>{
 const issue={id:'i',title:'Kosong',sources:[source('a','',null)]};const a=buildIssueReport(issue);assert.deepEqual(a.chronology,[]);assert.deepEqual(a.actors,[]);assert.deepEqual(a.importantNumbers,[]);
 issue.eventDate='2026-10-01T00:00:00Z';const b=buildIssueReport(issue);assert.equal(b.eventDate,issue.eventDate);assert.ok(!b.researchGaps.some(g=>g.includes('tanggal peristiwa')));
});
