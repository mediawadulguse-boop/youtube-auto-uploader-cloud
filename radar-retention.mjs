import {checksum} from './postgres-store.mjs';
const DAY=86400000;
export function retentionPolicy(r={}) { return {...{enabled:true,days:14,revision:1},...r.retention}; }
export function protectedIssue(issue,db) {
 return ['saved','discussed'].includes(issue.status)||!!(issue.contentIds?.length||issue.groupingLocked||issue.groupPartition||issue.groupingReview||issue.groupingHistory?.length||issue.editorialFeedback||issue.feedbackHistory?.length||issue.research?.notes||issue.research?.checklist?.length)||db.contents?.some(c=>c.radarIssueId===issue.id)||issue.sources?.some(s=>s.coverage==='manual'||s.article||s.transcript||(s.verification&&s.verification!=='unchecked')||(s.sourceRole&&s.sourceRole!=='unknown')||s.repost===true);
}
const older=(value,cutoff)=>{const at=typeof value==='number'?value:Date.parse(value||'');return Number.isFinite(at)&&at<cutoff;};
export function planRetention(db,now=Date.now()) {
 const r=db.radar||{},policy=retentionPolicy(r),cutoff=now-policy.days*DAY,issues=[],counts={sources:0,issues:0,protected:0,reports:0,cache:0,channelEntries:0};
 for(const issue of r.issues||[]){if(protectedIssue(issue,db)){counts.protected++;continue;}const ids=(issue.sources||[]).filter(s=>older(s.publishedAt||s.discoveredAt,cutoff)).map(s=>s.id);if(ids.length){issues.push({id:issue.id,hash:checksum(issue),sourceIds:ids});counts.sources+=ids.length;if(ids.length===issue.sources.length)counts.issues++;}}
 const arrays=[];
 for(const [key,field] of [['reportArchive','endAt'],['aiCache','at']]){const entries=(r[key]||[]).filter(x=>older(x[field],cutoff));if(entries.length){arrays.push({key,hash:checksum(r[key]),entries});counts[key==='reportArchive'?'reports':'cache']+=entries.length;}}
 const channels=[];
 for(const channel of r.channels||[]){const keep=new Set([...(channel.videos||[]).map(v=>v.id),...Object.keys(channel.videoFeedback||{})]);const history=(channel.historyVideos||[]).filter(v=>keep.has(v.id)||!older(v.publishedAt||v.lastObservedAt,cutoff)),snapshots=(channel.snapshots||[]).filter(s=>!older(s.at,cutoff));const removed=(channel.historyVideos||[]).length-history.length+(channel.snapshots||[]).length-snapshots.length;if(removed){channels.push({id:channel.id,hash:checksum(channel),history,snapshots});counts.channelEntries+=removed;}}
 return {policy,cutoff:new Date(cutoff).toISOString(),issues,arrays,channels,counts,pending:counts.sources+counts.reports+counts.cache+counts.channelEntries>0};
}
export function applyRetention(db,plan,now=Date.now()) {
 const r=db.radar;if(!r||checksum(retentionPolicy(r))!==checksum(plan.policy))return {skipped:'policy_changed'};
 const result={sources:0,issues:0,reports:0,cache:0,channelEntries:0,changedDuringBackup:0};
 for(const entry of plan.issues){const issue=r.issues.find(i=>i.id===entry.id);if(!issue)continue;if(checksum(issue)!==entry.hash||protectedIssue(issue,db)){result.changedDuringBackup++;continue;}const ids=new Set(entry.sourceIds);issue.sources=issue.sources.filter(s=>!ids.has(s.id));result.sources+=ids.size;if(!issue.sources.length){r.issues=r.issues.filter(i=>i.id!==issue.id);result.issues++;}else{issue.revision++;issue.groupRevision=(issue.groupRevision||1)+1;issue.observations=[];issue.updatedAt=new Date(now).toISOString();}}
 for(const entry of plan.arrays){if(checksum(r[entry.key])!==entry.hash){result.changedDuringBackup++;continue;}const hashes=new Set(entry.entries.map(checksum));r[entry.key]=r[entry.key].filter(x=>!hashes.has(checksum(x)));result[entry.key==='reportArchive'?'reports':'cache']+=entry.entries.length;}
 for(const entry of plan.channels){const channel=r.channels.find(c=>c.id===entry.id);if(!channel)continue;if(checksum(channel)!==entry.hash){result.changedDuringBackup++;continue;}result.channelEntries+=(channel.historyVideos||[]).length-entry.history.length+(channel.snapshots||[]).length-entry.snapshots.length;channel.historyVideos=entry.history;channel.snapshots=entry.snapshots;channel.revision++;}
 r.retention={...retentionPolicy(r),lastRunAt:new Date(now).toISOString(),lastResult:result};return result;
}
export class RadarRetention {
 constructor(store,{backup,now=Date.now}={}){this.store=store;this.backup=backup;this.now=now;this.busy=false;this.error=null;}
 async status(){const plan=planRetention(await this.store.contentStore.read(),this.now());return {...plan.policy,preview:plan.counts,cutoff:plan.cutoff,busy:this.busy,error:this.error};}
 async configure(body){if(!body||typeof body.enabled!=='boolean'||![7,14].includes(body.days))throw Object.assign(Error('Pilih retensi 7 atau 14 hari.'),{status:400});return this.store.mutate(r=>{const old=retentionPolicy(r);if(body.revision!==old.revision)throw Object.assign(Error('Pengaturan berubah. Muat ulang.'),{status:409});return r.retention={...old,enabled:body.enabled,days:body.days,revision:old.revision+1};});}
 async tick(){if(this.busy)return {busy:true};this.busy=true;try{const plan=planRetention(await this.store.contentStore.read(),this.now());if(!plan.policy.enabled||!plan.pending)return {skipped:true};await this.backup();const result=await this.store.contentStore.mutate(db=>applyRetention(db,plan,this.now()));this.error=null;return result;}catch(e){this.error=e.message;throw e;}finally{this.busy=false;}}
}
