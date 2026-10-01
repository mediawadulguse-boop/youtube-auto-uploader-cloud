import { pacificToday } from './analytics.mjs';
const DAY=86400000;
const shift=(date,days)=>new Date(Date.parse(date+'T00:00:00Z')+days*DAY).toISOString().slice(0,10);
const finite=value=>value!==null&&value!==undefined&&Number.isFinite(Number(value))?Number(value):null;
export function saveDaily(channel,rows,range,now=Date.now()) {
  channel.dailyHistory??={};
  if(rows!==null){
    for(const day of Object.keys(channel.dailyHistory))if(day>=range.startDate&&day<=range.endDate)delete channel.dailyHistory[day];
    for(const row of rows)if(/^\d{4}-\d{2}-\d{2}$/.test(row.day)&&row.day>=range.startDate&&row.day<=range.endDate)channel.dailyHistory[row.day]={...row,fetchedAt:new Date(now).toISOString()};
    channel.dailySync={...channel.dailySync,status:'ready',lastSync:new Date(now).toISOString(),lastReportedDay:rows.at(-1)?.day||null,error:null,retryAt:null};
  }
  for(const [day,row] of Object.entries(channel.dailyHistory))if(now-Date.parse(row.fetchedAt)>30*DAY)delete channel.dailyHistory[day];
}
export function saveSnapshot(channel,statistics,now=Date.now()) {
  channel.snapshots??={};const day=pacificToday(now),old=channel.snapshots[day];
  channel.snapshots[day]={day,capturedAt:new Date(now).toISOString(),firstCapturedAt:old?.firstCapturedAt||new Date(now).toISOString(),subscribers:statistics.hiddenSubscriberCount?null:finite(statistics.subscriberCount),views:finite(statistics.viewCount),videos:finite(statistics.videoCount)};
  for(const [date,row] of Object.entries(channel.snapshots))if(now-Date.parse(row.capturedAt)>30*DAY)delete channel.snapshots[date];
}
export function buildDailyHistory(channel,range,now=Date.now()) {
  const rows=[];
  for(let day=range.startDate;day<=range.endDate;day=shift(day,1)) {
    const daily=channel.dailyHistory?.[day],fresh=daily&&now-Date.parse(daily.fetchedAt)<=30*DAY?daily:null;
    const current=channel.snapshots?.[day],snapshot=current&&now-Date.parse(current.capturedAt)<=30*DAY?current:null;
    const prior=channel.snapshots?.[shift(day,-1)],previous=prior&&now-Date.parse(prior.capturedAt)<=30*DAY?prior:null;
    const delta=key=>snapshot?.[key]!==null&&snapshot?.[key]!==undefined&&previous?.[key]!==null&&previous?.[key]!==undefined?snapshot[key]-previous[key]:null;
    rows.push({day,hasAnalytics:!!fresh,views:finite(fresh?.views),watchHours:finite(fresh?.watchHours),subscribersGained:finite(fresh?.subscribersGained),subscribersLost:finite(fresh?.subscribersLost),netSubscribers:finite(fresh?.netSubscribers),totalSubscribers:snapshot?.subscribers??null,totalViews:snapshot?.views??null,totalVideos:snapshot?.videos??null,subscriberSnapshotChange:delta('subscribers'),viewSnapshotChange:delta('views'),videoChange:delta('videos'),capturedAt:snapshot?.capturedAt||null,fetchedAt:fresh?.fetchedAt||null});
  }
  const available=rows.filter(r=>r.hasAnalytics),metric=key=>available.length?available.reduce((sum,r)=>sum+(r[key]??0),0):null;
  const snapshots=Object.values(channel.snapshots||{}).filter(r=>now-Date.parse(r.capturedAt)<=30*DAY).sort((a,b)=>a.day.localeCompare(b.day));
  return {rows,summary:{reportedDays:available.length,requestedDays:rows.length,views:metric('views'),netSubscribers:metric('netSubscribers'),subscribersGained:metric('subscribersGained'),subscribersLost:metric('subscribersLost'),watchHours:metric('watchHours'),averageDailyViews:available.length?metric('views')/available.length:null,averageDailySubscribers:available.length?metric('netSubscribers')/available.length:null},snapshotStartedAt:snapshots[0]?.firstCapturedAt||snapshots[0]?.capturedAt||null,latestSnapshot:snapshots.at(-1)||null,sync:channel.dailySync||{},timeZone:'America/Los_Angeles'};
}
