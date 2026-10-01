import {YouTubeAnalytics,analyticsError,validateVideoId} from './analytics.mjs';
import {AnalyticsStore} from './analytics-store.mjs';

export const MONETARY_SCOPE='https://www.googleapis.com/auth/yt-analytics-monetary.readonly';
export const hasMonetaryAccess=token=>String(token?.scope||'').split(/\s+/).includes(MONETARY_SCOPE);
const DAY=86400000,REPORTING='https://youtubereporting.googleapis.com/v1',REACH_TYPE='channel_reach_basic_a1';
const warning=(section,e)=>({section,code:e.code||'upstream_error',message:e.message});
const staleError=()=>Object.assign(Error('Koneksi channel berubah. Muat ulang.'),{status:409,code:'channel_changed'});
const publicVideo=item=>({id:item.id,title:item.snippet?.title||null,thumbnail:item.snippet?.thumbnails?.medium?.url||item.snippet?.thumbnails?.default?.url||null,publishedAt:item.snippet?.publishedAt||null,duration:item.contentDetails?.duration||null,privacyStatus:item.status?.privacyStatus||null,metadataSource:item.metadataSource||'youtube',metadataUpdatedAt:item.metadataUpdatedAt||null});
const breakdown=(rows,key)=>rows===null?null:rows.map(r=>({key:r[key],views:Number(r.views||0),watchHours:Number(r.estimatedMinutesWatched||0)/60})).sort((a,b)=>b.views-a.views);

export function parseCSV(value) {
  const rows=[];let row=[],cell='',quoted=false;
  for(let i=0;i<value.length;i++) {
    const c=value[i];
    if(c==='"'){if(quoted&&value[i+1]==='"'){cell+='"';i++}else if(quoted||!cell)quoted=!quoted;else throw Error('CSV tidak valid');}
    else if(c===','&&!quoted){row.push(cell);cell=''}
    else if((c==='\n'||c==='\r')&&!quoted){if(c==='\r'&&value[i+1]==='\n')i++;row.push(cell);if(row.some(Boolean))rows.push(row);row=[];cell=''}
    else cell+=c;
  }
  if(quoted)throw Error('CSV tidak lengkap');
  if(cell||row.length){row.push(cell);rows.push(row)}
  if(!rows.length)throw Error('Laporan CSV kosong');
  const headers=rows.shift();headers[0]=headers[0].replace(/^\uFEFF/,'');
  if(new Set(headers).size!==headers.length)throw Error('Kolom CSV ganda');
  return {headers,rows:rows.map(r=>{if(r.length!==headers.length)throw Error('Kolom CSV tidak cocok');return Object.fromEntries(headers.map((k,i)=>[k,r[i]]))})};
}

export function parseReachCSV(csv,channelId,report) {
  const {headers,rows}=parseCSV(csv);
  const required=['date','channel_id','video_id','video_thumbnail_impressions','video_thumbnail_impressions_ctr'];
  if(required.some(k=>!headers.includes(k)))throw Error('Laporan Reach tidak memiliki kolom wajib');
  const date=String(report.startTime||'').slice(0,10),byVideo={},seen=new Set();
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date))throw Error('Tanggal laporan Reach tidak valid');
  for(const row of rows){
    if(row.channel_id!==channelId||row.date!==date)throw Error('Channel atau tanggal laporan Reach tidak cocok');
    if(!row.video_id&&row.video_thumbnail_impressions===''&&row.video_thumbnail_impressions_ctr==='')continue;
    const key=row.video_id||'_unassigned';if(row.video_id)validateVideoId(row.video_id);
    const impressions=Number(row.video_thumbnail_impressions),ctr=Number(row.video_thumbnail_impressions_ctr);
    // Reporting Reach defines CTR as a percentage, not a count or the card CTR ratio.
    if(row.video_thumbnail_impressions===''||row.video_thumbnail_impressions_ctr===''||!Number.isSafeInteger(impressions)||impressions<0||!Number.isFinite(ctr)||ctr<0||ctr>100||seen.has(key))throw Error('Nilai Reach tidak valid');
    seen.add(key);byVideo[key]={impressions,ctr};
  }
  return {date,reportId:report.id,createTime:report.createTime,byVideo};
}

export function aggregateReach(reach,range,videoId=null) {
  const entries=Object.entries(reach).filter(([day])=>day>=range.startDate&&day<=range.endDate).sort(([a],[b])=>a.localeCompare(b));
  let impressions=0,weighted=0;
  const daily=entries.map(([day,report])=>{
    const values=videoId?(report.byVideo[videoId]?[report.byVideo[videoId]]:[]):Object.values(report.byVideo);
    const count=values.reduce((s,r)=>s+r.impressions,0),sum=values.reduce((s,r)=>s+r.impressions*r.ctr,0);
    impressions+=count;weighted+=sum;
    return {day,impressions:count,ctr:count?sum/count:null,hasData:values.length>0};
  });
  return {hasData:daily.some(x=>x.hasData),complete:entries.length===range.days,coveredDays:entries.length,requestedDays:range.days,impressions:daily.some(x=>x.hasData)?impressions:null,ctr:impressions?weighted/impressions:null,daily,firstDay:entries[0]?.[0]||null,lastDay:entries.at(-1)?.[0]||null};
}

export class StudioAnalytics extends YouTubeAnalytics {
  constructor(fetcher,{file,now=Date.now,monetary=async()=>false,...options}={}) {
    super(fetcher,{...options,now});this.store=new AnalyticsStore(file);this.monetary=monetary;this.work=new Map();this.backoff=new Map();
  }
  clear(){super.clear();this.backoff?.clear();}
  async single(key,run){if(this.work.has(key))return this.work.get(key);const work=run().finally(()=>{if(this.work.get(key)===work)this.work.delete(key)});this.work.set(key,work);return work;}
  async persist(channelId,generation,fn){if(generation!==this.generation)throw staleError();return this.store.mutate(channelId,c=>{if(generation!==this.generation)throw staleError();return fn(c)});}
  async dataRequest(channelId,path,params){
    const until=this.backoff.get(channelId);if(until?.at>this.now())throw until.error;
    try{return await this.request('https://www.googleapis.com/youtube/v3/'+path+'?'+new URLSearchParams(params))}
    catch(e){this.backoff.set(channelId,{at:this.now()+(['quota_exceeded','api_disabled'].includes(e.code)?60*60*1000:120000),error:e});throw e}
  }
  async metadata(channelId,ids,{force=false,publicFallback=false}={}) {
    const unique=[...new Set(ids)];unique.forEach(validateVideoId);
    const generation=this.generation,state=await this.store.read(channelId),missing=unique.filter(id=>force||!state.videos[id]||this.now()-Date.parse(state.videos[id].metadataUpdatedAt)>DAY||!state.videos[id].contentDetails||!state.videos[id].dataUpdatedAt||this.now()-Date.parse(state.videos[id].dataUpdatedAt)>DAY),warnings=[];
    if(missing.length){
      await this.single('metadata:'+channelId+':'+missing.join(','),async()=>{
        for(let i=0;i<missing.length;i+=50){
          const batch=missing.slice(i,i+50);
          try{
            const data=await this.dataRequest(channelId,'videos',{part:'snippet,contentDetails,statistics,status',id:batch.join(',')});
            if((data.items||[]).some(item=>batch.includes(item.id)&&item.snippet?.channelId&&item.snippet.channelId!==channelId))throw Object.assign(Error('Video ini bukan milik channel yang terhubung.'),{status:404,code:'wrong_channel'});
            await this.persist(channelId,generation,c=>{for(const item of data.items||[]){if(!batch.includes(item.id)||item.snippet?.channelId!==channelId)continue;c.videos[item.id]={...item,metadataUpdatedAt:new Date(this.now()).toISOString(),metadataSource:'youtube',dataUpdatedAt:new Date(this.now()).toISOString()};}});
          }catch(e){if(['wrong_channel','channel_changed'].includes(e.code))throw e;warnings.push(warning('videoDetails',e));break}
        }
      });
    }
    // Public oEmbed is a metadata fallback when Data API quota is unavailable. No Google token is sent.
    const current=await this.store.read(channelId),publicMissing=publicFallback?unique.filter(id=>(!current.videos[id]?.snippet?.title||this.now()-Date.parse(current.videos[id].metadataUpdatedAt)>30*DAY)&&(!current.videos[id]?.oembedAttemptAt||this.now()-Date.parse(current.videos[id].oembedAttemptAt)>DAY)).slice(0,10):[];
    for(let i=0;i<publicMissing.length;i+=3){
      await Promise.all(publicMissing.slice(i,i+3).map(id=>this.single('oembed:'+channelId+':'+id,async()=>{
        let data=null;
        try{const r=await fetch('https://www.youtube.com/oembed?'+new URLSearchParams({url:'https://www.youtube.com/watch?v='+id,format:'json'}),{signal:AbortSignal.timeout(5000)});if(r.ok)data=await r.json()}catch{}
        await this.persist(channelId,generation,c=>{
          const old=c.videos[id]||{id};old.oembedAttemptAt=new Date(this.now()).toISOString();
          if(data?.title&&typeof data.title==='string'){old.snippet={title:data.title.slice(0,500),channelId,thumbnails:{medium:{url:'https://i.ytimg.com/vi/'+id+'/mqdefault.jpg'}}};old.metadataUpdatedAt=new Date(this.now()).toISOString();old.metadataSource='oembed'}
          c.videos[id]=old;
        });
      })));
    }
    const latest=await this.store.read(channelId),items=unique.map(id=>latest.videos[id]).filter(item=>item?.snippet?.title&&this.now()-Date.parse(item.metadataUpdatedAt)<30*DAY);
    return {items,warnings};
  }
  async videoMetadata(ids){
    // Base reports call this without channel; their metadata is upgraded in enrich().
    return [];
  }
  async fetchReport(channelId,range){
    // Avoid the old independent Data API requests: use durable metadata and channel cache instead.
    const totals=await this.report(channelId,range),warnings=[];
    const optional=async(section,fn)=>{try{return await fn()}catch(e){warnings.push(warning(section,e));return null}};
    const [daily,previous,top]=await Promise.all([
      optional('daily',()=>this.report(channelId,range,{dimensions:'day',sort:'day'})),
      optional('previous',()=>this.report(channelId,{startDate:range.previousStart,endDate:range.previousEnd})),
      optional('topVideos',()=>this.report(channelId,range,{dimensions:'video',sort:'-views',maxResults:'10'}))
    ]);
    const map=r=>{const s=Object.fromEntries(['views','estimatedMinutesWatched','averageViewDuration','subscribersGained','subscribersLost','likes','comments','shares'].map(k=>[k,Number(r?.[k]||0)]));return {...s,watchHours:s.estimatedMinutesWatched/60,netSubscribers:s.subscribersGained-s.subscribersLost}};
    return {range,generatedAt:new Date(this.now()).toISOString(),warnings,summary:map(totals[0]),hasData:totals.length>0,previous:previous===null?null:{...map(previous[0]),hasData:previous.length>0},daily:daily===null?null:daily.map(r=>({day:r.day,...map(r)})),lastReportedDay:daily?.at(-1)?.day||null,channel:null,topVideos:top===null?null:top.map(r=>({id:r.video,...map(r)}))};
  }
  async get(channelId,range){return this.studioCache('studio:'+channelId+':'+range.startDate+':'+range.endDate,async()=>this.enrich(channelId,await this.fetchReport(channelId,range)));}
  async getVideo(channelId,id,range){validateVideoId(id);return this.studioCache('studio-video:'+channelId+':'+id+':'+range.startDate+':'+range.endDate,async()=>{
    // Override Data metadata call for this report, retaining base report validation and isolation.
    const base=new YouTubeAnalytics(async(url,options)=>url.startsWith('https://www.googleapis.com/youtube/v3/videos?')?Response.json({items:[]}):this.fetcher(url,options),{now:this.now});
    const d=await base.fetchVideo(channelId,id,range);return this.enrich(channelId,d,id);
  });}
  async studioCache(key,run){
    const cached=this.cache.get(key),generation=this.generation;
    if(cached&&this.now()-cached.at<(cached.data.warnings.length?120000:this.ttl))return {...cached.data,cached:true};
    return this.single(key,async()=>{const d=await run();if(generation!==this.generation)throw staleError();this.cache.set(key,{at:this.now(),data:d});while(this.cache.size>24)this.cache.delete(this.cache.keys().next().value);return {...d,cached:false}});
  }
  async enrich(channelId,d,id=null){
    const metadata=await this.metadata(channelId,id?[id]:(d.topVideos||[]).map(v=>v.id),{publicFallback:!id||d.hasData});d.warnings.push(...metadata.warnings);
    const byId=new Map(metadata.items.map(x=>[x.id,x]));
    if(id){const item=byId.get(id);d.video={...d.video,...(item?publicVideo(item):{}),lifetime:item?.statistics&&item.dataUpdatedAt&&this.now()-Date.parse(item.dataUpdatedAt)<30*DAY?{views:Number(item.statistics.viewCount||0),likes:item.statistics.likeCount===undefined?null:Number(item.statistics.likeCount),comments:item.statistics.commentCount===undefined?null:Number(item.statistics.commentCount)}:null};}
    else{d.topVideos=d.topVideos?.map(v=>({...v,...(byId.get(v.id)?publicVideo(byId.get(v.id)):{} )}));const c=await this.store.read(channelId);if(c.channel&&this.now()-Date.parse(c.channelUpdatedAt)<30*DAY)d.channel=c.channel;}
    const advanced=await this.advanced(channelId,d.range,id);d.warnings.push(...advanced.warnings);const {warnings:ignored,...fields}=advanced;Object.assign(d,fields);
    const c=await this.store.read(channelId);d.reach={...aggregateReach(c.reach,d.range,id),status:c.reporting.status||'not_started',error:c.reporting.error||null,lastSync:c.reporting.lastSync||null};d.sync=c.catalog;return d;
  }
  async advanced(channelId,range,id){
    const warnings=[],filters=id?{filters:'video=='+id}:{},limited={...filters,metrics:'views,estimatedMinutesWatched'};
    const optional=async(section,fn)=>{try{return await fn()}catch(e){warnings.push(warning(section,e));return null}};
    const tasks={
      engaged:optional('engaged',()=>this.report(channelId,range,{...filters,metrics:'engagedViews,averageViewPercentage'})),
      demographics:optional('demographics',()=>this.report(channelId,range,{...filters,dimensions:'ageGroup,gender',metrics:'viewerPercentage'})),
      contentTypes:!id?optional('contentTypes',()=>this.report(channelId,range,{metrics:'views,estimatedMinutesWatched',dimensions:'creatorContentType'})):Promise.resolve(null)
    };
    if(!id){for(const [name,dimension] of Object.entries({traffic:'insightTrafficSourceType',devices:'deviceType',countries:'country',subscribed:'subscribedStatus'}))tasks[name]=optional(name,()=>this.report(channelId,range,{...limited,dimensions:dimension}));tasks.searchTerms=optional('searchTerms',()=>this.report(channelId,range,{filters:'insightTrafficSourceType==YT_SEARCH',dimensions:'insightTrafficSourceDetail',metrics:'views,estimatedMinutesWatched',sort:'-views',maxResults:'25'}));}
    let revenue={status:'authorization_required',currency:'USD'};
    if(await this.monetary())tasks.revenue=optional('revenue',()=>this.report(channelId,range,{...filters,metrics:'estimatedRevenue,estimatedAdRevenue,estimatedRedPartnerRevenue,monetizedPlaybacks,playbackBasedCpm,adImpressions',currency:'USD'}));
    const keys=Object.keys(tasks),values=await Promise.all(Object.values(tasks)),data=Object.fromEntries(keys.map((k,i)=>[k,values[i]]));
    if('revenue' in data)revenue=data.revenue===null?{status:'unavailable',currency:'USD'}:{status:data.revenue.length?'ready':'empty',currency:'USD',summary:data.revenue[0]||null};
    const out={warnings,revenue,engagedViews:!data.engaged?.length?null:Number(data.engaged[0]?.engagedViews??0),averageViewPercentage:!data.engaged?.length?null:Number(data.engaged[0]?.averageViewPercentage??0),demographics:data.demographics===null?null:data.demographics.map(r=>({age:r.ageGroup,gender:r.gender,percentage:Number(r.viewerPercentage)})),contentTypes:breakdown(data.contentTypes,'creatorContentType')};
    if(!id)for(const [key,dim] of Object.entries({traffic:'insightTrafficSourceType',devices:'deviceType',countries:'country',subscribed:'subscribedStatus',searchTerms:'insightTrafficSourceDetail'}))out[key]=breakdown(data[key],dim);
    return out;
  }
  async listVideos(channelId,range){
    return this.studioCache('studio-list:'+channelId+':'+range.startDate+':'+range.endDate,async()=>{
      const d=await super.listVideos(channelId,range),meta=await this.metadata(channelId,d.videos.map(v=>v.id),{publicFallback:true});
      d.warnings=d.warnings.filter(w=>w.section!=='videoDetails');d.warnings.push(...meta.warnings);
      const c=await this.store.read(channelId),reported=new Map(d.videos.map(v=>[v.id,v]));
      const known=Object.values(c.videos).filter(x=>x.snippet?.title&&this.now()-Date.parse(x.metadataUpdatedAt)<30*DAY);
      for(const item of known)reported.set(item.id,{...(reported.get(item.id)||{id:item.id,hasPeriodData:false}),...publicVideo(item)});
      d.videos=[...reported.values()].map(v=>({...v,hasPeriodData:v.hasPeriodData!==false}));d.catalogCount=known.length;d.sync=c.catalog;d.limit=200;return d;
    });
  }
  async syncCatalog(channelId,{force=false}={}){
    return this.single('catalog:'+channelId,async()=>{
      const generation=this.generation,state=await this.store.read(channelId);
      if(!force&&state.catalog.retryAt&&Date.parse(state.catalog.retryAt)>this.now())return {...state.catalog,count:Object.keys(state.videos).length};
      if(force)this.backoff.delete(channelId);
      await this.persist(channelId,generation,c=>{c.catalog={...c.catalog,status:'syncing',error:null}});
      try{
        const response=await this.dataRequest(channelId,'channels',{part:'snippet,contentDetails,statistics',id:channelId}),channel=response.items?.find(x=>x.id===channelId),playlistId=channel?.contentDetails?.relatedPlaylists?.uploads;
        if(!playlistId)throw Object.assign(Error('Playlist upload channel belum tersedia. Coba sinkronkan kembali.'),{code:'catalog_unavailable'});
        await this.persist(channelId,generation,c=>{c.channel={id:channel.id,title:channel.snippet?.title,thumbnail:channel.snippet?.thumbnails?.default?.url||null,subscribers:channel.statistics?.hiddenSubscriberCount?null:Number(channel.statistics?.subscriberCount||0),lifetimeViews:Number(channel.statistics?.viewCount||0),videoCount:Number(channel.statistics?.videoCount||0)};c.channelUpdatedAt=new Date(this.now()).toISOString();});
        let pageToken=state.catalog.nextPageToken||'',done=false,scanned=0;
        for(let page=0;page<4;page++){
          const data=await this.dataRequest(channelId,'playlistItems',{part:'snippet,contentDetails,status',playlistId,maxResults:'50',...(pageToken?{pageToken}:{})}),ids=[];
          await this.persist(channelId,generation,c=>{
            for(const item of data.items||[]){const id=item.contentDetails?.videoId||item.snippet?.resourceId?.videoId;if(!/^[A-Za-z0-9_-]{11}$/.test(id||''))continue;ids.push(id);if(['Private video','Deleted video'].includes(item.snippet?.title))continue;const old=c.videos[id]||{id};c.videos[id]={...old,snippet:{...old.snippet,title:item.snippet?.title||old.snippet?.title,channelId,publishedAt:item.contentDetails?.videoPublishedAt||old.snippet?.publishedAt,thumbnails:item.snippet?.thumbnails||old.snippet?.thumbnails},metadataUpdatedAt:new Date(this.now()).toISOString(),metadataSource:'playlist',status:old.status||item.status};}
            c.catalog.nextPageToken=data.nextPageToken||'';
          });
          scanned+=ids.length;await this.metadata(channelId,ids,{publicFallback:true});pageToken=data.nextPageToken||'';if(!pageToken){done=true;break}
        }
        await this.persist(channelId,generation,c=>{c.catalog={...c.catalog,status:done?'ready':'partial',nextPageToken:pageToken,lastSync:new Date(this.now()).toISOString(),error:null,retryAt:null,scanned};for(const [id,item] of Object.entries(c.videos))if(item.metadataUpdatedAt&&this.now()-Date.parse(item.metadataUpdatedAt)>30*DAY)delete c.videos[id];});
      }catch(e){if(e.code==='channel_changed')throw e;await this.persist(channelId,generation,c=>{c.catalog={...c.catalog,status:'error',error:{code:e.code||'upstream_error',message:e.message},lastAttempt:new Date(this.now()).toISOString(),retryAt:new Date(this.now()+(e.code==='quota_exceeded'?60*60*1000:120000)).toISOString()}});}
      this.cache.clear();const final=await this.store.read(channelId);return {...final.catalog,count:Object.keys(final.videos).length};
    });
  }
  async reportingRequest(path,options={}){
    let response;try{response=await this.fetcher(REPORTING+path,{...options,signal:AbortSignal.timeout(20000)})}catch{throw Object.assign(Error('Koneksi Reporting gagal. Coba lagi nanti.'),{code:'network_error'})}
    const data=await response.json().catch(()=>({}));if(!response.ok)throw analyticsError(response.status,data,'YouTube Reporting API');return data;
  }
  async syncReach(channelId,{force=false}={}){
    return this.single('reach:'+channelId,async()=>{
      const generation=this.generation,state=await this.store.read(channelId);
      if(!force&&state.reporting.retryAt&&Date.parse(state.reporting.retryAt)>this.now())return state.reporting;
      try{
        let job=state.reporting.job;
        if(!job){
          const types=await this.reportingRequest('/reportTypes');if(!(types.reportTypes||[]).some(x=>x.id===REACH_TYPE))throw Object.assign(Error('Laporan Reach belum tersedia untuk channel ini.'),{code:'reach_unavailable'});
          const existing=await this.reportingRequest('/jobs');job=existing.jobs?.find(x=>x.reportTypeId===REACH_TYPE&&x.name==='Content Hub Reach');
          if(!job)job=await this.reportingRequest('/jobs',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({reportTypeId:REACH_TYPE,name:'Content Hub Reach'})});
          if(!job.id)throw Error('Job Reporting tidak valid');await this.persist(channelId,generation,c=>{c.reporting={...c.reporting,job:{id:job.id,reportTypeId:REACH_TYPE}}});
        }
        const reports=[];let pageToken='';
        do{const result=await this.reportingRequest('/jobs/'+encodeURIComponent(job.id)+'/reports'+(pageToken?'?pageToken='+encodeURIComponent(pageToken):''));reports.push(...(result.reports||[]));pageToken=result.nextPageToken||'';if(reports.length>1000)throw Error('Laporan Reporting terlalu besar')}while(pageToken);
        // Only newest report per date; backfills replace rather than add to old data.
        const newest=new Map();for(const r of reports){const day=String(r.startTime).slice(0,10),old=newest.get(day);if(!old||r.createTime>old.createTime)newest.set(day,r)}
        for(const report of [...newest.values()].sort((a,b)=>a.startTime.localeCompare(b.startTime))){
          const day=report.startTime.slice(0,10);if(state.reach[day]?.reportId===report.id)continue;
          const url=new URL(report.downloadUrl);if(url.protocol!=='https:'||url.hostname!=='youtubereporting.googleapis.com'||!url.pathname.startsWith('/v1/media/'))throw Error('URL unduhan Reporting tidak valid');
          const response=await this.fetcher(url.href,{signal:AbortSignal.timeout(30000),redirect:'error'});if(!response.ok)throw analyticsError(response.status,await response.json().catch(()=>({})),'YouTube Reporting API');
          let csv='';const decoder=new TextDecoder();for await(const chunk of response.body){csv+=decoder.decode(chunk,{stream:true});if(csv.length>30000000)throw Error('Laporan Reach terlalu besar')}csv+=decoder.decode();
          const parsed=parseReachCSV(csv,channelId,report);await this.persist(channelId,generation,c=>{c.reach[day]=parsed;const cutoff=new Date(this.now()-366*DAY).toISOString().slice(0,10);for(const date of Object.keys(c.reach))if(date<cutoff)delete c.reach[date]});
        }
        await this.persist(channelId,generation,c=>{c.reporting={...c.reporting,status:Object.keys(c.reach).length?'ready':'waiting',error:null,lastSync:new Date(this.now()).toISOString(),retryAt:null}});
      }catch(e){if(e.code==='channel_changed')throw e;await this.persist(channelId,generation,c=>{c.reporting={...c.reporting,status:'error',error:{code:e.code||'upstream_error',message:e.message},lastAttempt:new Date(this.now()).toISOString(),retryAt:new Date(this.now()+(e.code==='api_disabled'?60*60*1000:300000)).toISOString()}});}
      this.cache.clear();return (await this.store.read(channelId)).reporting;
    });
  }
}
