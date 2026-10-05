import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {analyzeEditorial,sourceQuality,relateIssues,compareEditorial} from '../radar-editorial.mjs';
import {rateIssue} from '../radar-methodology.mjs';
import {buildRadarPerformance} from '../radar-performance.mjs';
import {ContentStore} from '../content-store.mjs';
import {RadarStore} from '../radar-store.mjs';
const now=Date.parse('2026-10-05T05:00:00Z'),at=new Date(now-3600000).toISOString();
const text='Perusahaan X menaikkan biaya layanan pada 2026. Pendapatan perusahaan mencapai Rp200 juta, sementara pekerja menghadapi perubahan upah dan pelanggan menanggung biaya baru.';
const topics=[{id:'system',name:'Sistem',enabled:true,keywords:['perusahaan','upah'],exclusions:[]}];
const source=(n,extra={})=>({id:'s'+n,title:'Perusahaan X menaikkan biaya layanan pada 2026',url:`https://media${n}.example/a`,publisher:'Media '+n,platform:'Berita / Web',publishedAt:at,excerpt:text,verification:'unchecked',...extra});
const issue=(id,sources,extra={})=>({id,title:'Perusahaan X menaikkan biaya layanan pada 2026',sources,status:'new',topicIds:['system'],contentIds:[],stats:{...rateIssue({sources},now),relevant:true},...extra});
test('reviewed full primary evidence outranks identical syndicated snippets; copied text discounts momentum without mutating sources',()=>{
 const primary=issue('primary',[source(1,{article:{text},verification:'verified',sourceRole:'primary'})]),copies=issue('copies',[source(2),source(3),source(4)]),before=structuredClone(copies);
 const p=analyzeEditorial(primary,{topics,now}),c=analyzeEditorial(copies,{topics,now});assert.ok(p.score>c.score);assert.equal(c.sourceQuality.duplicateSources,2);assert.equal(c.momentum.score,43);assert.equal(p.readiness.state,'outline');assert.equal(c.readiness.state,'research');assert.match(p.angle,/Rp200 juta/);assert.ok(p.evidence.references.length);assert.deepEqual(copies,before);
 const quality=sourceQuality(issue('mixed',[source(1),source(2,{article:{text},verification:'verified',sourceRole:'primary'})]));assert.equal(quality.fullSources,1);assert.equal(quality.primarySources,1);assert.equal(quality.verifiedSources,1);
});
test('YouTube-only diverse coverage can have momentum; missing transcripts remain research material',()=>{
 const video=issue('video',[1,2,3].map(n=>source(n,{platform:'YouTube',excerpt:text+' Rincian berbeda '+n+'.'}))),e=analyzeEditorial(video,{topics,now});assert.equal(e.momentum.isHot,true);assert.equal(e.readiness.state,'research');assert.equal(e.sourceQuality.fullSources,0);assert.match(e.gaps.join(' '),/transkrip/);
});
test('preferences require five explicit issue judgements; outcomes require three distinct comparable published videos',()=>{
 const target=issue('target',[source(1)]),samples=Array.from({length:5},(_,n)=>issue('rated'+n,[source(n+2)],{editorialFeedback:{choice:'relevant'}}));
 const cold=analyzeEditorial(target,{topics,issues:samples.slice(0,4),now}),learned=analyzeEditorial(target,{topics,issues:samples,now});assert.equal(cold.learning.preferences.adjustment,0);assert.equal(learned.learning.preferences.adjustment,4);
 const performance={items:samples.slice(0,3).map((i,n)=>({id:i.id,contents:[{videoId:'video'+n,state:'cached',benchmark:{ratio:2}}]}))};
 const outcomes=analyzeEditorial(target,{topics,issues:samples,performance,now});assert.equal(outcomes.learning.outcomes.samples,3);assert.equal(outcomes.learning.outcomes.adjustment,2);
 performance.items[2].contents[0].videoId='video0';assert.equal(analyzeEditorial(target,{topics,issues:samples,performance,now}).learning.outcomes.adjustment,0);
 assert.ok(compareEditorial({...target,editorial:learned},{...target,id:'other',editorial:cold})<0);
});
test('related claims keep their source groups separate and reject conflicting geography',()=>{
 const a=issue('a',[source(1)],{title:'Perusahaan X menaikkan harga layanan di Jember'}),b=issue('b',[source(2)],{title:'Perusahaan X tidak menaikkan harga layanan di Jember'}),c=issue('c',[source(3)],{title:'Perusahaan X tidak menaikkan harga layanan di Banyuwangi'}),before=structuredClone([a,b,c]),links=relateIssues([a,b,c],now);
 assert.ok(links.get('a').some(r=>r.id==='b'&&r.type==='claim_response'));assert.ok(!links.get('a').some(r=>r.id==='c'));assert.deepEqual([a,b,c],before);
});
test('editorial feedback and source roles persist with revision checks and leave scripts untouched',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'radar-editorial-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));const content=new ContentStore(path.join(dir,'contents.json')),store=new RadarStore(content,{now:()=>now});await store.addSources([source(1)]);let i=(await store.read()).issues[0];const before=(await content.read()).contents;
 await store.changeIssue(i.id,{revision:i.revision,editorialFeedback:{choice:'relevant',dimension:'angle',reason:'Bukti menarik'}});await assert.rejects(store.changeIssue(i.id,{revision:i.revision,editorialFeedback:{choice:'less',dimension:'dna',reason:''}}),{status:409});i=(await store.read()).issues[0];
 await store.changeIssue(i.id,{revision:i.revision,sourceId:i.sources[0].id,verification:'verified',repost:false,sourceRole:'primary'});
 const reopened=new RadarStore(new ContentStore(content.file),{now:()=>now}),saved=(await reopened.read()).issues[0];assert.equal(saved.editorialFeedback.reason,'Bukti menarik');assert.equal(saved.sources[0].sourceRole,'primary');assert.deepEqual((await content.read()).contents,before);
 const snapshot=await content.read();await assert.rejects(store.changeIssue(saved.id,{revision:saved.revision,editorialFeedback:{choice:'hack',dimension:'dna',reason:''}}),{status:400});assert.deepEqual(await content.read(),snapshot);
});
test('owned video benchmarks require three fresh same-format peers and do not use foreign channels or unknown ages',()=>{
 const contents=Array.from({length:5},(_,n)=>({id:'c'+n,title:'C'+n,format:n===4?'shorts':'long',youtubeVideoId:'v'+n})),data={contents,radar:{issues:[{id:'i',title:'Isu',contentIds:['c0']}]}};
 const channel={videos:Object.fromEntries(contents.map((c,n)=>[c.youtubeVideoId,{snippet:{channelId:'own',publishedAt:new Date(now-48*3600000).toISOString()},dataUpdatedAt:new Date(now).toISOString(),statistics:{viewCount:String(n===0?200:100)}}]))};
 let result=buildRadarPerformance(data,channel,{channelId:'own',now});assert.equal(result.items[0].contents[0].benchmark.ratio,2);assert.equal(result.items[0].contents[0].benchmark.peers,3);
 channel.videos.v3.snippet.channelId='other';result=buildRadarPerformance(data,channel,{channelId:'own',now});assert.equal(result.items[0].contents[0].benchmark.ratio,null);channel.videos.v2.dataUpdatedAt=new Date(now-3*86400000).toISOString();assert.equal(buildRadarPerformance(data,channel,{channelId:'own',now}).items[0].contents[0].benchmark.peers,1);
});
