import {fail,issueStats} from './radar-store.mjs';

// Calendar boundaries in WIB (UTC+7), including Monday–Sunday weeks.
export function digestRange(period='daily',date,now=Date.now()) {
  if(!['daily','weekly'].includes(period))throw fail('Pilih ringkasan harian atau mingguan.');
  const selected=date||new Date(now+7*3600000).toISOString().slice(0,10);
  if(typeof selected!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(selected))throw fail('Tanggal ringkasan tidak valid.');
  const calendar=new Date(selected+'T00:00:00Z');
  if(!Number.isFinite(+calendar)||calendar.toISOString().slice(0,10)!==selected)throw fail('Tanggal ringkasan tidak valid.');
  const mondayOffset=period==='weekly'?(calendar.getUTCDay()+6)%7:0;
  const start=+calendar-7*3600000-mondayOffset*86400000,end=start+(period==='weekly'?7:1)*86400000;
  return {period,date:selected,timeZone:'Asia/Jakarta',startAt:new Date(start).toISOString(),endAt:new Date(end).toISOString(),throughAt:new Date(Math.min(end,now)).toISOString(),partial:now<end};
}

export function buildRadarDigest(data,{period='daily',date,topic='',now=Date.now()}={}) {
  const range=digestRange(period,date,now),start=Date.parse(range.startAt),end=Math.min(Date.parse(range.endAt),now);
  if(topic&&!data.topics.some(t=>t.id===topic))throw fail('Topik ringkasan tidak ditemukan.',404);
  const groups=data.issues.filter(i=>i.status!=='ignored'&&i.stats.relevant!==false&&(!topic||i.topicIds.includes(topic))).flatMap(i=>{
    const sources=i.sources.filter(s=>{const published=Date.parse(s.publishedAt||'');return published>=start&&published<end;});
    if(!sources.length)return [];
    return [{id:i.id,title:i.title,status:i.status,topicIds:i.topicIds,sources,stats:issueStats({...i,sources,observations:[]},end)}];
  }).sort((a,b)=>b.stats.score-a.stats.score||Date.parse(b.stats.latestPublishedAt)-Date.parse(a.stats.latestPublishedAt)||a.id.localeCompare(b.id));
  const sources=groups.flatMap(i=>i.sources),platforms={};
  for(const source of sources)platforms[source.platform]=(platforms[source.platform]||0)+1;
  return {...range,generatedAt:new Date(now).toISOString(),topic,groups:groups.length,sourceCount:sources.length,publishers:new Set(sources.map(s=>s.publisherUrl||s.publisher)).size,platforms,items:groups.slice(0,10),
    note:'Ringkasan dari sumber Radar yang tersimpan, menurut tanggal publikasi WIB. Isu diabaikan dan sumber tanpa tanggal tidak disertakan. Skor dihitung dari liputan dalam periode ini; cuplikan dan deskripsi belum membuktikan klaim.'};
}
