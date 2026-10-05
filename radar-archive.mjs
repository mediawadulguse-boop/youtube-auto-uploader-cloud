import crypto from 'node:crypto';
import {buildRadarDigest,digestRange} from './radar-digest.mjs';
import {fail,radarData} from './radar-store.mjs';
import {buildExecutiveSummary} from './radar-executive.mjs';
const DAY=86400000;
const calendar=at=>new Date(at+7*3600000).toISOString().slice(0,10);
const settings=r=>r.reportSchedule||{enabled:true,revision:1,timeZone:'Asia/Jakarta'};
export class RadarArchive{
 constructor(store,{now=()=>Date.now()}={}){this.store=store;this.now=now;this.busy=false;}
 async list(){const r=radarData(await this.store.contentStore.read());return {schedule:settings(r),reports:(r.reportArchive||[]).map(({items,...report})=>({...report,itemCount:items.length})),retention:'Maksimal 60 laporan atau 20 MB. Retensi 7/14 hari mengikuti Data & Backup setelah backup Drive terverifikasi.'};}
 async get(id){const r=radarData(await this.store.contentStore.read()),report=r.reportArchive?.find(x=>x.id===id);if(!report)throw fail('Arsip tidak ditemukan.',404);return report.executive?report:{...report,executive:buildExecutiveSummary(report.items,{now:Date.parse(report.archivedAt||report.generatedAt),scope:'Arsip '+(report.period==='weekly'?'mingguan':'harian')})};}
 configure(body){if(!body||typeof body!=='object')throw fail('Data jadwal tidak valid.');return this.store.mutate(r=>{const old=settings(r);if(body.revision!==old.revision)throw fail('Jadwal berubah. Muat ulang.',409);if(typeof body.enabled!=='boolean')throw fail('Status jadwal tidak valid.');return r.reportSchedule={...old,enabled:body.enabled,revision:old.revision+1};});}
 async save(options={}){
  if(!options||typeof options!=='object'||Array.isArray(options))throw fail('Data arsip tidak valid.');const {period='daily',date,topic=''}=options;
  const now=this.now(),range=digestRange(period,date,now);if(range.partial)throw fail('Arsip dibuat setelah periode selesai. Gunakan ringkasan langsung untuk periode berjalan.');
  const data=await this.store.read(),report=buildRadarDigest(data,{period,date,topic,now});
  const previous=buildRadarDigest(data,{period,date:calendar(Date.parse(range.startAt)-DAY),topic,now});
  report.comparison={startAt:previous.startAt,endAt:previous.endAt,groups:previous.groups,sourceCount:previous.sourceCount,publishers:previous.publishers,deltaGroups:report.groups-previous.groups,deltaSources:report.sourceCount-previous.sourceCount,deltaPublishers:report.publishers-previous.publishers,note:'Perbandingan liputan dari data Radar yang tersedia saat arsip dibuat; bukan perubahan kebenaran atau seluruh berita internet.'};
  // Reports already retain referenced evidence. Do not duplicate raw excerpts in snapshots.
  report.items=report.items.map(({sources,...item})=>({...item,sources:sources.map(({excerpt,grouping,transcript,article,...source})=>source)}));
  const key=[period,range.startAt,topic].join('|');
  return this.store.mutate(r=>{const old=r.reportArchive?.find(x=>x.archiveKey===key);if(old)return old;
   const saved={...report,id:crypto.randomUUID(),archiveKey:key,archivedAt:new Date(now).toISOString()};
   const reports=[saved,...(r.reportArchive||[])].sort((a,b)=>b.startAt.localeCompare(a.startAt)||b.archivedAt.localeCompare(a.archivedAt)).slice(0,60);
   while(reports.length>1&&Buffer.byteLength(JSON.stringify(reports))>20*1024*1024)reports.pop();r.reportArchive=reports;return saved;});
 }
 async tick(){
  if(this.busy)return {busy:true};this.busy=true;
  try{const r=radarData(await this.store.contentStore.read());if(!settings(r).enabled)return {disabled:true};
   const now=this.now(),last=Date.parse(r.reportSchedule?.lastTickAt||''),count=Number.isFinite(last)?Math.min(7,Math.max(1,Math.ceil((now-last)/DAY))):1;
   let saved=0;for(let n=count;n>=1;n--){await this.save({period:'daily',date:calendar(now-n*DAY)});saved++;}
   await this.save({period:'weekly',date:calendar(Date.parse(digestRange('weekly',calendar(now),now).startAt)-DAY)});saved++;
   await this.store.mutate(r=>{r.reportSchedule={...settings(r),lastTickAt:new Date(now).toISOString()};});return {saved};
  }finally{this.busy=false;}
 }
}
