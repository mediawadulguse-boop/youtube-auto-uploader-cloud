import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {ContentStore} from '../content-store.mjs';
import {RadarStore} from '../radar-store.mjs';
import {RadarWorkspace,transcriptText} from '../radar-workspace.mjs';
test('subtitle import strips cue timing and metadata without inventing content',()=>{
 assert.equal(transcriptText('1\n00:00:01,000 --> 00:00:02,000\nAnggaran bantuan mencapai Rp200 juta.\n','srt'),'Anggaran bantuan mencapai Rp200 juta.');
 assert.equal(transcriptText('WEBVTT\n\nNOTE private metadata\nnot speech\n\n00:01.000 --> 00:02.000\n<b>Budi mengatakan</b> bantuan tersedia.','vtt'),'Budi mengatakan bantuan tersedia.');
 assert.throws(()=>transcriptText('WEBVTT','vtt'),/tidak memiliki/);assert.throws(()=>transcriptText('a'.repeat(50001)),/50.000/);
});
test('research is revision-safe, imports remain unverified, restart and templates preserve source references',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'radar-workspace-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));const content=new ContentStore(path.join(dir,'contents.json')),store=new RadarStore(content),research=new RadarWorkspace(store);
 await store.addSources([{title:'Subsidi bantuan warga',url:'https://www.youtube.com/watch?v=abcdefghijk',excerpt:'Deskripsi awal tetap ada.',coverage:'snippet'}]);const issue=(await store.read()).issues[0];
 await research.save(issue.id,{revision:issue.revision,notes:'Cek arsip anggaran.',checklist:[{label:'Wawancara warga',done:false}]});await assert.rejects(research.save(issue.id,{revision:issue.revision,notes:'Usang',checklist:[]}),/Isu berubah/);
 let current=(await research.get(issue.id)).issue;await research.import(issue.id,{revision:current.revision,sourceId:current.sources[0].id,format:'srt',text:'1\n00:00:01,000 --> 00:00:02,000\nAnggaran bantuan mencapai Rp200 juta.'});
 const result=await research.get(issue.id);assert.equal(result.issue.sources[0].excerpt,'Deskripsi awal tetap ada.');assert.equal(result.issue.sources[0].verification,'unchecked');assert.match(result.report.data[0].text,/Rp200/);assert.ok(!result.report.limitations.some(t=>t.includes('bukan transkrip')));
 await assert.rejects(research.import(issue.id,{revision:result.issue.revision,sourceId:current.sources[0].id,text:'Teks baru cukup panjang.'}),/eksplisit/);
 const restarted=new RadarWorkspace(new RadarStore(new ContentStore(content.file)));assert.equal((await restarted.get(issue.id)).workspace.notes,'Cek arsip anggaran.');const outline=await restarted.outline(issue.id,'threeShorts');assert.equal(outline.usesAI,false);assert.equal(outline.drafts.length,3);assert.equal(new Set(outline.drafts.map(d=>d.angle)).size,3);for(const draft of outline.drafts){assert.match(draft.script,/Rp200 juta/);assert.match(draft.script,/https:\/\/www.youtube.com/);assert.match(draft.brief,/Wawancara warga/);}assert.deepEqual((await content.read()).radar.aiUsage,{});
});
test('manual merge preserves both research workspaces instead of discarding editor notes',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'radar-merge-research-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));const store=new RadarStore(new ContentStore(path.join(dir,'contents.json'))),research=new RadarWorkspace(store);
 await store.addSources([{title:'Pajak warga Jember',url:'https://example.org/a'},{title:'Banjir kota Banyuwangi',url:'https://example.org/b'}]);let issues=(await store.read()).issues;for(const [n,i] of issues.entries())await research.save(i.id,{revision:i.revision,notes:'Catatan '+n,checklist:[{label:'Riset '+n,done:false}]});issues=(await store.read()).issues;const merged=await store.merge(issues[0].id,{revision:issues[0].revision,fromId:issues[1].id,fromRevision:issues[1].revision});assert.match(merged.research.notes,/Catatan 0/);assert.match(merged.research.notes,/Catatan 1/);assert.equal(merged.research.checklist.length,2);
});
