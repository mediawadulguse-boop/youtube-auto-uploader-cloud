import {test} from 'node:test';
import assert from 'node:assert/strict';
import {planRetention,applyRetention,RadarRetention} from '../radar-retention.mjs';
const now=Date.parse('2026-10-05T12:00:00Z'),old='2026-09-01T12:00:00Z',fresh='2026-10-04T12:00:00Z';
const source=(id,date=old)=>({id,publishedAt:date,coverage:'snippet',verification:'unchecked'});
const issue=(id,extra={})=>({id,status:'new',sources:[source(id)],revision:1,...extra});
const seed=()=>({contents:[],radar:{issues:[issue('old'),issue('mixed',{sources:[source('a'),source('b',fresh)]}),issue('unknown',{sources:[{id:'c'}]})],channels:[]}});
test('retention removes dated machine materials and archives, preserves fresh/undated evidence and resets changed group observations',()=>{
 const db=seed();db.radar.reportArchive=[{id:'old',endAt:old},{id:'fresh',endAt:fresh}];db.radar.aiCache=[{at:Date.parse(old)},{at:now}];const plan=planRetention(db,now);assert.equal(plan.policy.days,14);assert.equal(plan.counts.sources,2);
 const result=applyRetention(db,plan,now);assert.equal(result.issues,1);assert.deepEqual(db.radar.issues.map(i=>i.id),['mixed','unknown']);assert.deepEqual(db.radar.issues[0].sources.map(s=>s.id),['b']);assert.equal(db.radar.issues[0].revision,2);assert.equal(db.radar.issues[0].groupRevision,2);assert.deepEqual(db.radar.issues[0].observations,[]);assert.equal(db.radar.reportArchive.length,1);assert.equal(db.radar.aiCache.length,1);
});
test('saved, linked, manual, verified, research and editorial corrections remain protected',()=>{
 const variants=[{status:'saved'},{status:'discussed'},{contentIds:['script']},{groupingLocked:true},{groupingReview:true},{editorialFeedback:{choice:'less'}},{research:{notes:'riset'}},{sources:[{...source('manual'),coverage:'manual'}]},{sources:[{...source('verified'),verification:'verified'}]},{sources:[{...source('article'),article:{text:'article'}}]},{sources:[{...source('transcript'),transcript:{text:'captions'}}]}];
 const db={contents:[{radarIssueId:'linked'}],radar:{issues:[...variants.map((v,n)=>issue('p'+n,v)),issue('linked')],channels:[]}};const plan=planRetention(db,now);assert.equal(plan.counts.protected,variants.length+1);assert.equal(plan.pending,false);
});
test('edits and new script links during backup are skipped; changing retention invalidates stale plan',()=>{
 const db=seed(),plan=planRetention(db,now);db.radar.issues[0].title='edit terbaru';db.contents.push({radarIssueId:'mixed'});assert.equal(applyRetention(db,plan,now).changedDuringBackup,2);assert.equal(db.radar.issues.length,3);
 const other=seed(),stale=planRetention(other,now);other.radar.retention={enabled:true,days:7,revision:2};assert.equal(applyRetention(other,stale,now).skipped,'policy_changed');assert.equal(other.radar.issues.length,3);
});
test('channel feedback and latest videos stay; old snapshots and unselected history are trimmed',()=>{
 const db=seed();db.radar.channels=[{id:'channel',revision:1,videos:[{id:'latest'}],videoFeedback:{selected:{choice:'relevant'}},historyVideos:[{id:'latest',publishedAt:old},{id:'selected',publishedAt:old},{id:'remove',publishedAt:old}],snapshots:[{at:old},{at:fresh}]}];const plan=planRetention(db,now);applyRetention(db,plan,now);assert.deepEqual(db.radar.channels[0].historyVideos.map(x=>x.id),['latest','selected']);assert.equal(db.radar.channels[0].snapshots.length,1);assert.ok(db.radar.channels[0].videoFeedback.selected);
});
test('failed backup prevents every deletion; disabled policy does not invoke backup; valid settings use revisions',async()=>{
 const db=seed(),store={contentStore:{read:async()=>structuredClone(db),mutate:async fn=>fn(db)},mutate:async fn=>fn(db.radar,db)};let calls=0;const engine=new RadarRetention(store,{now:()=>now,backup:async()=>{calls++;throw Error('Drive gagal')}});await assert.rejects(engine.tick(),/Drive gagal/);assert.equal(db.radar.issues.length,3);assert.equal(calls,1);assert.match((await engine.status()).error,/Drive gagal/);
 await assert.rejects(engine.configure({enabled:true,days:30,revision:1}),e=>e.status===400);await engine.configure({enabled:false,days:7,revision:1});assert.equal((await engine.tick()).skipped,true);assert.equal(calls,1);await assert.rejects(engine.configure({enabled:true,days:14,revision:1}),e=>e.status===409);
});

test('configured retention rejects reimport of expired auto videos but allows deliberate manual references',async()=>{
 const {RadarStore}=await import('../radar-store.mjs');const db={contents:[],radar:{version:1,retention:{enabled:true,days:7,revision:1},topics:[],issues:[],channels:[],sync:{}}},store={read:async()=>structuredClone(db),mutate:async fn=>fn(db)};const radar=new RadarStore(store,{now:()=>now});
 await radar.addSources([{url:'https://example.org/expired',title:'Materi lama',publisher:'Publisher',publishedAt:old,coverage:'snippet'}]);assert.equal(db.radar.issues.length,0);
 await radar.addSources([{url:'https://example.org/expired',title:'Referensi manual',publisher:'Publisher',publishedAt:old,coverage:'manual'}]);assert.equal(db.radar.issues[0].status,'saved');assert.equal(planRetention(db,now).counts.protected,1);
});
