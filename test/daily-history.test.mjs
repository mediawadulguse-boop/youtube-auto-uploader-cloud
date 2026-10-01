import {test} from 'node:test';
import assert from 'node:assert/strict';
import {saveDaily,saveSnapshot,buildDailyHistory} from '../daily-history.mjs';
import {StudioAnalytics} from '../studio-analytics.mjs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
const now=Date.parse('2026-10-01T16:00:00Z'),range={startDate:'2026-09-28',endDate:'2026-09-30',days:3};
test('daily history distinguishes missing days, reported zero, exact net subscribers and snapshot totals',()=>{
 const c={};saveDaily(c,[{day:'2026-09-28',views:100,watchHours:10,subscribersGained:5,subscribersLost:2,netSubscribers:3},{day:'2026-09-30',views:0,watchHours:0,subscribersGained:0,subscribersLost:0,netSubscribers:0}],range,now);
 saveSnapshot(c,{subscriberCount:'1200',viewCount:'10000',videoCount:'20'},Date.parse('2026-09-28T16:00:00Z'));saveSnapshot(c,{subscriberCount:'1200',viewCount:'10300',videoCount:'19'},Date.parse('2026-09-29T16:00:00Z'));
 const h=buildDailyHistory(c,range,now);assert.equal(h.rows[1].views,null);assert.equal(h.rows[2].views,0);assert.equal(h.rows[1].videoChange,-1);assert.equal(h.rows[2].totalSubscribers,null);assert.equal(h.rows[0].netSubscribers,3);assert.equal(h.rows[1].subscriberSnapshotChange,0);assert.equal(h.summary.averageDailyViews,50);assert.equal(h.summary.reportedDays,2);assert.equal(h.rows[0].videoChange,null);
});
test('daily revisions replace old rows, unavailable fetch preserves cache, empty valid report clears range; hidden and expired totals remain unavailable',()=>{
 const c={};saveDaily(c,[{day:'2026-09-28',views:100}],range,now);saveDaily(c,null,range,now);assert.equal(buildDailyHistory(c,range,now).rows[0].views,100);saveDaily(c,[{day:'2026-09-28',views:90}],range,now);assert.equal(buildDailyHistory(c,range,now).rows[0].views,90);saveDaily(c,[],range,now);assert.equal(buildDailyHistory(c,range,now).summary.views,null);
 saveSnapshot(c,{hiddenSubscriberCount:true,subscriberCount:'2000',viewCount:'0',videoCount:'0'},now);const h=buildDailyHistory(c,{startDate:'2026-10-01',endDate:'2026-10-01'},now);assert.equal(h.rows[0].totalSubscribers,null);assert.equal(h.rows[0].totalViews,0);assert.equal(buildDailyHistory(c,{startDate:'2026-10-01',endDate:'2026-10-01'},now+31*86400000).latestSnapshot,null);
});
test('scheduled daily sync persists across restart, isolates channels, respects retry and does not invent snapshot totals on quota errors',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'daily-')),file=path.join(dir,'analytics.json');let calls=0,failed=false;
 const fetcher=async url=>{calls++;if(failed)return Response.json({error:{message:'quota',errors:[{reason:'quotaExceeded'}]}},{status:403});if(url.includes('youtube/v3'))return Response.json({items:[{id:'A',statistics:{subscriberCount:'1200',viewCount:'9000',videoCount:'8'}}]});return Response.json({columnHeaders:['day','views','estimatedMinutesWatched','subscribersGained','subscribersLost'].map(name=>({name,columnType:name==='day'?'DIMENSION':'METRIC'})),rows:[['2026-09-30',100,60,5,1]]})};
 try{const api=new StudioAnalytics(fetcher,{file,now:()=>now});await api.syncDaily('A');const c=await new StudioAnalytics(fetcher,{file,now:()=>now}).store.read('A');assert.equal(c.dailyHistory['2026-09-30'].netSubscribers,4);assert.equal(c.snapshots['2026-10-01'].subscribers,1200);assert.equal((await api.store.read('B')).dailyHistory,undefined);failed=true;await api.syncDaily('B');const count=calls;await api.syncDaily('B');assert.equal(calls,count);const b=await api.store.read('B');assert.equal(b.dailySync.status,'error');assert.equal(b.snapshots,undefined);assert.equal(b.snapshotError.code,'quota_exceeded');}finally{await fs.rm(dir,{recursive:true,force:true})}
});
