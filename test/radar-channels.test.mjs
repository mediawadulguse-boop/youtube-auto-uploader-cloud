import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {analyzeChannel,retainChannelHistory,durationSeconds,CHANNEL_SNAPSHOT_LIMIT} from '../radar-channels.mjs';
import {ContentStore} from '../content-store.mjs';
import {RadarStore} from '../radar-store.mjs';
import {RadarSync} from '../radar-sync.mjs';
const H=3600000,D=24*H,now=Date.parse('2026-10-03T12:00:00Z');
const video=(id,extra={})=>({id,title:'Pajak untuk pekerja',url:'https://www.youtube.com/watch?v='+id,publishedAt:new Date(now-24*H).toISOString(),duration:'PT10M',viewCount:500,lastObservedAt:new Date(now).toISOString(),...extra});
const topics=[{id:'pajak',name:'Kebijakan pajak',enabled:true,sources:['youtube'],keywords:['pajak'],exclusions:['hoaks']}];
const snap=(at,values)=>({at:new Date(at).toISOString(),values:Object.fromEntries(Object.entries(values).map(([id,viewCount])=>[id,{viewCount}]))});
const analyze=(videos,snapshots=[],extra={})=>analyzeChannel({id:'channel',videos,snapshots,...extra},topics,[],now);
test('cold start and missing counts retain relevance without inventing growth or baseline',()=>{
 const c=analyze([video('a',{viewCount:null,description:''})],[snap(now,{a:null})]);const a=c.videos[0].analysis;
 assert.equal(a.usesAI,false);assert.equal(a.growth,null);assert.equal(a.baseline.ratio,null);assert.equal(a.observationCount,0);assert.ok(a.needs.some(n=>n.includes('judul saja')));assert.equal(a.components.growth,0);assert.equal(a.components.relevance,35);assert.equal(c.analysis.periods[0].measuredVideos,0);
 assert.equal(durationSeconds('PT1H2M3S'),3723);assert.equal(durationSeconds('PT'),null);
});
test('growth uses actual unequal intervals, requires 30 minutes and 3 observations for acceleration',()=>{
 let c=analyze([video('a')],[snap(now-3*H,{a:100}),snap(now-H,{a:200}),snap(now,{a:500})]);let a=c.videos[0].analysis;
 assert.equal(a.growth.perHour,300);assert.equal(a.growth.accelerating,true);assert.equal(a.status,'Pertumbuhan meningkat');
 a=analyze([video('a')],[snap(now-10*60000,{a:400}),snap(now,{a:500})]).videos[0].analysis;assert.equal(a.growth,null);
 a=analyze([video('a')],[snap(now-2*H,{a:100}),snap(now,{a:500})]).videos[0].analysis;assert.equal(a.growth.perHour,200);assert.equal(a.growth.accelerating,false);
});
test('zero, corrections and stale/null current metrics never masquerade as rising',()=>{
 let a=analyze([video('a',{viewCount:100})],[snap(now-H,{a:100}),snap(now,{a:100})]).videos[0].analysis;assert.equal(a.growth.perHour,0);assert.equal(a.components.growth,0);
 a=analyze([video('a',{viewCount:90})],[snap(now-H,{a:100}),snap(now,{a:90})]).videos[0].analysis;assert.equal(a.growth.corrected,true);assert.equal(a.growth.perHour,null);assert.equal(a.status,'Metrik perlu diperiksa');
 a=analyze([video('a')],[snap(now-26*H,{a:100}),snap(now-25*H,{a:500})]).videos[0].analysis;assert.equal(a.stale,true);assert.equal(a.components.growth,0);
 a=analyze([video('a',{viewCount:null})],[snap(now-H,{a:100}),snap(now,{a:null})]).videos[0].analysis;assert.equal(a.stale,true);assert.equal(a.components.growth,0);
});
test('baseline uses at least 3 different videos at comparable historical age and duration in same channel',()=>{
 const peers=['b','c','d'].map((id,n)=>video(id,{publishedAt:new Date(now-(n+3)*D).toISOString(),viewCount:9000}));
 const snapshots=[snap(now,{a:500}),...peers.map((v,n)=>snap(now-(n+2)*D,{[v.id]:100})),snap(now,Object.fromEntries(peers.map(v=>[v.id,9000])))];
 let c=analyze([video('a'),...peers],snapshots),a=c.videos.find(v=>v.id==='a').analysis;
 assert.equal(a.baseline.peers,3);assert.equal(a.baseline.median,100);assert.equal(a.baseline.ratio,5);assert.equal(a.status,'Di atas pembanding');
 c=analyze([video('a'),...peers.map(v=>({...v,duration:'PT1M'}))],snapshots);assert.equal(c.videos.find(v=>v.id==='a').analysis.baseline.ratio,null);
 c=analyze([video('a'),...peers.slice(0,2)],snapshots);assert.equal(c.videos.find(v=>v.id==='a').analysis.baseline.ratio,null);
 c=analyze([video('a'),...peers],[snap(now,{a:500,b:9000,c:9000,d:9000})]);assert.equal(c.videos.find(v=>v.id==='a').analysis.baseline.ratio,null);
});
test('window summaries count only observed nonnegative intervals and repeat topics require multiple videos',()=>{
 const c=analyze([video('a'),video('b',{viewCount:200}),video('c',{viewCount:30})],[snap(now-2*H,{a:100,b:100,c:40}),snap(now,{a:500,b:200,c:30})]);
 assert.equal(c.analysis.periods[0].observedViewIncrease,500);assert.equal(c.analysis.periods[0].measuredVideos,2);assert.equal(c.analysis.repeatingTopics[0].videos,3);
 const excluded=analyzeChannel({videos:[video('a',{title:'Hoaks pajak'})]},topics,[],now);assert.equal(excluded.videos[0].analysis.components.relevance,0);
});
test('history migrates legacy videos, keeps videos leaving latest playlist, prunes by date and capacity',()=>{
 const c={videos:[video('old',{lastObservedAt:undefined})],lastSyncAt:new Date(now-H).toISOString(),snapshots:[snap(now-31*D,{old:1}),snap(now-H,{old:100})],videoFeedback:{old:{choice:'relevant'},expired:{choice:'less'}}};
 retainChannelHistory(c,[video('new')],snap(now,{new:500}),now);
 assert.equal(c.historyVideos.length,2);assert.equal(c.snapshots.length,2);assert.equal(c.videoFeedback.old.choice,'relevant');assert.equal(c.videoFeedback.expired,undefined);
 c.snapshots=Array.from({length:900},(_,n)=>snap(now-(900-n)*60000,{old:100}));retainChannelHistory(c,[],snap(now,{old:200}),now);assert.equal(c.snapshots.length,CHANNEL_SNAPSHOT_LIMIT);
 retainChannelHistory(c,[],snap(now+31*D,{}),now+31*D);assert.equal(c.historyVideos.length,0);assert.equal(c.videoFeedback.old,undefined);
});
async function setup(t){const dir=await fs.mkdtemp(path.join(os.tmpdir(),'channel-engine-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));const content=new ContentStore(path.join(dir,'contents.json')),radar=new RadarStore(content,{now:()=>now});return {radar,content,dir};}
test('feedback persists across restart and sync; revision conflicts protect choices; analysis reads use no AI',async t=>{
 const {radar,content,dir}=await setup(t),c=await radar.saveChannel({url:'https://youtube.com/@example',role:'reference'});
 await radar.mutate(r=>{r.channels[0].videos=[video('abcdefghijk')];r.channels[0].lastSyncAt=new Date(now).toISOString();});
 await radar.setVideoFeedback(c.id,{revision:1,videoId:'abcdefghijk',choice:'relevant'});
 await assert.rejects(radar.setVideoFeedback(c.id,{revision:1,videoId:'abcdefghijk',choice:'less'}),{status:409});
 assert.throws(()=>radar.setVideoFeedback(c.id,null),{status:400});
 await assert.rejects(radar.setVideoFeedback(c.id,{revision:2,videoId:'missing',choice:'relevant'}),{status:404});
 const before=await content.read();const read=await radar.read();assert.equal(read.channels[0].videos[0].analysis.feedback,'relevant');assert.deepEqual(await content.read(),before);
 const reopened=new RadarStore(new ContentStore(path.join(dir,'contents.json')),{now:()=>now});assert.equal((await reopened.read()).channels[0].videoFeedback.abcdefghijk.choice,'relevant');
 await radar.mutate(r=>retainChannelHistory(r.channels[0],[video('abcdefghijk')],snap(now,{abcdefghijk:500}),now));assert.equal((await radar.read()).channels[0].videoFeedback.abcdefghijk.choice,'relevant');
});
test('sync updates retained videos in one batch and channel deletion during API call is respected',async t=>{
 const {radar}=await setup(t),c=await radar.saveChannel({url:'https://youtube.com/@example',role:'reference'});
 await radar.mutate(r=>Object.assign(r.channels[0],{channelId:'UCa',uploads:'UUa',videos:[video('oldvideo001')],lastSyncAt:new Date(now-H).toISOString(),snapshots:[snap(now-H,{oldvideo001:100})]}));
 const calls=[],yt=async url=>{const u=new URL(url);calls.push(u);return Response.json({items:u.pathname.endsWith('playlistItems')?[{contentDetails:{videoId:'newvideo001'}}]:['newvideo001','oldvideo001'].map(id=>({id,snippet:{title:'Pajak pekerja',description:'Data pajak.',publishedAt:new Date(now-H).toISOString()},contentDetails:{duration:'PT10M'},statistics:{viewCount:'500'}}))});};
 const sync=new RadarSync(radar,yt,{now:()=>now}),raw=(await radar.contentStore.read()).radar.channels[0];await sync.channel(raw,topics);
 assert.equal(calls.length,2);assert.deepEqual(calls[1].searchParams.get('id').split(','),['newvideo001','oldvideo001']);const updated=(await radar.read()).channels[0];assert.equal(updated.videos.length,2);assert.equal(updated.videos.find(v=>v.id==='oldvideo001').analysis.growth.delta,400);
 const deleting=new RadarSync(radar,async url=>{if(url.includes('/videos?'))await radar.remove('channels',c.id,{revision:1});return yt(url);},{now:()=>now});assert.equal(await deleting.channel((await radar.contentStore.read()).radar.channels[0],topics),0);assert.equal((await radar.read()).channels.length,0);
});
const source=await fs.readFile(new URL('../public/radar.js',import.meta.url),'utf8'),ui=source.slice(source.indexOf('function radarChannelPage('),source.indexOf('function radarList(){'));
test('UI prioritizes 10 across channels, groups known issues, searches videos and keeps feedback choices in all videos',()=>{
 const ctx={radarUi:{q:'',data:{issues:[]}},esc:s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;'),rNum:String,rDate:()=>''};vm.createContext(ctx);vm.runInContext(ui,ctx);
 const videos=Array.from({length:15},(_,n)=>video('id'+n,{title:n===1?'Unique query':'<unsafe>',analysis:{score:n,status:'Relevan',reasons:['<b>reason</b>'],needs:['<b>need</b>'],issueIds:n>12?['same']:[],feedback:n===0?'less':'',discussed:false}}));const data={issues:[],channels:[{id:'c',name:'Channel',url:'https://youtube.com/@example',enabled:true,videos}]};ctx.radarUi.data=data;
 let page=ctx.radarChannelPage(data);assert.equal(page.items.length,10);assert.equal(page.items[0].video.id,'id14');assert.equal(page.items.filter(i=>i.video.analysis.issueIds[0]==='same').length,1);assert.equal(page.items.some(i=>i.video.id==='id0'),false);
 assert.equal(ctx.radarChannelPage(data,{all:true}).items.length,15);assert.equal(ctx.radarChannelPage(data,{q:'unique query'}).items.length,1);
 let html=ctx.radarChannelList(data);assert.equal((html.match(/class="hub-panel radar-opportunity"/g)||[]).length,10);assert.match(html,/&lt;b>reason/);assert.match(html,/&lt;unsafe>/);assert.match(html,/data-r-channel-view/);assert.match(html,/data-r-video-feedback/);assert.doesNotMatch(html,/<b>reason/);
 data.channels[0].enabled=false;assert.equal(ctx.radarChannelPage(data).items.length,0);
});

test('channel source import uses one batch, preserves each video topic, and unchanged metrics are a no-op',async t=>{
 const {radar}=await setup(t),c=await radar.saveChannel({url:'https://youtube.com/@example',role:'reference'});
 const monitored=[{id:'tax',name:'Pajak',enabled:true,sources:['youtube'],keywords:['pajak'],exclusions:[],lenses:['system']},{id:'labor',name:'Pekerja',enabled:true,sources:['youtube'],keywords:['pekerja'],exclusions:[],lenses:['human']}];
 await radar.mutate(r=>{r.topics=monitored;Object.assign(r.channels[0],{channelId:'UCa',uploads:'UUa'});});
 const videos=['newvideo001','newvideo002','newvideo003'].map((id,n)=>({id,snippet:{title:n===1?'Kehidupan pekerja desa':'Kebijakan pajak pendapatan '+n,description:'Bahan sumber lengkap.',publishedAt:new Date(now-H).toISOString()},contentDetails:{duration:'PT10M'},statistics:{viewCount:'500'}}));
 const yt=async url=>Response.json({items:url.includes('/playlistItems?')?videos.map(v=>({contentDetails:{videoId:v.id}})):videos});
 const mutate=radar.mutate.bind(radar);let writes=0;radar.mutate=fn=>{writes++;return mutate(fn);};
 await new RadarSync(radar,yt,{now:()=>now}).channel((await radar.contentStore.read()).radar.channels[0],monitored);assert.equal(writes,2);
 const raw=await radar.contentStore.read();for(const v of videos){const item=raw.radar.issues.find(i=>i.sources.some(s=>s.url.endsWith(v.id)));assert.deepEqual(item.topicIds,[v.id==='newvideo002'?'labor':'tax']);}
 const inputs=videos.map(v=>new RadarSync(radar,yt).videoSource(v));for(const input of inputs){input.publisher='YouTube';input.publisherUrl='https://www.youtube.com/channel/UCa';}
 const before=await radar.contentStore.read();await radar.addSources(inputs,[],null,{topicIdsByUrl:new Map(inputs.map((s,n)=>[s.url,[n===1?'labor':'tax']]))});assert.deepEqual(await radar.contentStore.read(),before);
});
