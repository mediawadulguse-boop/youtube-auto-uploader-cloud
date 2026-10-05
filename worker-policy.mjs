import {isYouTubeAuthError,authRequiredError} from './youtube-publication.mjs';
export function workerFailure(error,now=Date.now()){
  if(isYouTubeAuthError(error))return {code:'youtube_auth_required',retryAt:null,message:authRequiredError().message};
  const message=String(error?.message||'Worker gagal'),code=String(error?.code||'');
  const quota=code==='quota_exceeded'||/quota|dailyLimitExceeded|RESOURCE_EXHAUSTED/i.test(message);
  const transient=quota||['network_error','ETIMEDOUT','ECONNRESET','ECONNREFUSED'].includes(code)||[429,502,503,504].includes(error?.status)||['TimeoutError','AbortError'].includes(error?.name)||/fetch failed|network|sementara|terlalu lama|rate.?limit/i.test(message);
  return {code:quota?'quota_exceeded':transient?'temporary_error':'worker_error',retryAt:transient?new Date(now+(quota?3600000:60000)).toISOString():null,message:quota?'Kuota YouTube Data API habis. Worker mencoba kembali setelah jeda satu jam.':message};
}

export function legacyJobAction(status,scheduledAt,now=Date.now()){
  if(['public','unlisted'].includes(status.privacyStatus))return 'published';
  if(status.privacyStatus==='private'&&status.publishAt)return 'scheduled_youtube';
  if(status.privacyStatus==='private'&&Date.parse(scheduledAt)>now)return 'schedule';
  throw Error('Status atau jadwal lama membutuhkan pemeriksaan. Atur ulang melalui YouTube Studio.');
}

// Claim only the current eligible job while sharing the cancellation/create lock.
export async function claimUploadJob({readDb,writeDb,withLock,jobId,guard=()=>{},now=Date.now}) {
 return withLock(async()=>{
  await guard();const db=await readDb(),job=db.jobs.find(j=>j.id===jobId);
  if(!job||!['queued_upload','uploading_youtube'].includes(job.status)||job.receivedBytes!==job.fileSize||(job.channelId&&db.channel?.id&&job.channelId!==db.channel.id))return null;
  job.status='uploading_youtube';job.error=null;job.attempts=(job.attempts||0)+1;job.updatedAt=new Date(now()).toISOString();await writeDb(db);return job;
 });
}

// Preserve the selected job and native publishAt; never modify an unrelated queue item.
export async function runUploadWorker({readDb,writeDb,upload,schedule,sync,now=Date.now,onError=()=>{}}){
  let selected=null,kind=null;
  try{
    const db=await readDb(),time=now();
    if(db.youtubeWorker?.code==='youtube_auth_required')return {state:'paused',code:'youtube_auth_required'};
    if(db.youtubeWorker?.retryAt&&Date.parse(db.youtubeWorker.retryAt)>time)return {state:'paused',retryAt:db.youtubeWorker.retryAt};
    const available=j=>(!db.channel?.id||!j.channelId||j.channelId===db.channel.id)&&(!j.nextWorkerAt||Date.parse(j.nextWorkerAt)<=time);
    selected=db.jobs.filter(j=>j.status==='waiting_publish'&&j.youtubeVideoId&&available(j)).sort((a,b)=>Date.parse(a.scheduledAt)-Date.parse(b.scheduledAt))[0];
    if(selected){kind='schedule';await schedule(selected.id)}
    else{
      selected=db.jobs.filter(j=>j.status==='scheduled_youtube'&&Date.parse(j.scheduledAt)<=time&&available(j)).sort((a,b)=>Date.parse(a.scheduledAt)-Date.parse(b.scheduledAt))[0];
      if(selected){kind='sync';await sync(selected.id)}
      else{selected=db.jobs.filter(j=>['queued_upload','uploading_youtube'].includes(j.status)&&j.receivedBytes===j.fileSize&&available(j)).sort((a,b)=>a.order-b.order)[0];if(selected){kind='upload';await upload(selected.id)}}
    }
    if(!selected)return {state:'idle'};
    const fresh=await readDb(),job=fresh.jobs.find(j=>j.id===selected.id);
    if(job){job.nextWorkerAt=kind==='sync'&&job.status==='scheduled_youtube'?new Date(now()+60000).toISOString():null;if(kind==='sync')job.lastYouTubeCheckAt=new Date(now()).toISOString();}
    fresh.youtubeWorker=null;await writeDb(fresh);return {state:'success',jobId:selected.id};
  }catch(error){
    const failure=workerFailure(error,now());onError(failure);
    if(!selected)return {state:'error',...failure};
    const fresh=await readDb(),job=fresh.jobs.find(j=>j.id===selected.id);
    if(job&&job.status!=='cancelled'){job.error=failure.message;job.updatedAt=new Date(now()).toISOString();job.nextWorkerAt=failure.retryAt;if(!failure.retryAt&&failure.code!=='youtube_auth_required')job.status='failed';}
    if(['quota_exceeded','youtube_auth_required'].includes(failure.code))fresh.youtubeWorker={retryAt:failure.retryAt,code:failure.code,message:failure.message};
    await writeDb(fresh);return {state:'error',jobId:selected.id,...failure};
  }
}
