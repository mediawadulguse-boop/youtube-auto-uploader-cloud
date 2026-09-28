const $ = s => document.querySelector(s);
const state = { files: [], server: null, uploading: false, relatedDefault: null };
const CHUNK = 8 * 1024 * 1024;
function toast(msg){const t=$('#toast');t.textContent=msg;t.style.display='block';clearTimeout(window._toast);window._toast=setTimeout(()=>t.style.display='none',2600)}
async function api(url,opt={}){const r=await fetch(url,{credentials:'same-origin',...opt,headers:{...(opt.body instanceof Blob?{}:{'content-type':'application/json'}),...(opt.headers||{})}});let d={};try{d=await r.json()}catch{}if(!r.ok)throw new Error(d.error||`HTTP ${r.status}`);return d}
const pad=n=>String(n).padStart(2,'0');
function localInput(d){return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`}
function fmtDate(v){if(!v)return '—';return new Date(v).toLocaleString('id-ID',{dateStyle:'medium',timeStyle:'short'})}
function esc(v=''){return String(v).replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]))}
function cleanFileTitle(name=''){
  return String(name)
    .replace(/\.[^.]+$/,'')
    .replace(/_/g,' ')
    .replace(/\s+/g,' ')
    .trim();
}
function buildAutoTitle(fileName){
  const prefix=($('#titlePrefix')?.value||'').replace(/_/g,' ').replace(/\s+/g,' ').trim();
  const base=cleanFileTitle(fileName);
  return [prefix,base].filter(Boolean).join(' ').replace(/\s+/g,' ').trim().slice(0,100);
}
function applyTitlePrefix(){
  state.files.forEach(x=>{if(x.autoTitle!==false)x.title=buildAutoTitle(x.file.name)});
  renderFiles();
}
function statusLabel(s){return ({receiving:'Masuk Cloud',queued_upload:'Antre YouTube',uploading_youtube:'Upload YouTube',waiting_publish:'Menyiapkan Jadwal',scheduled_youtube:'Terjadwal YouTube',published:'Tayang',failed:'Gagal',cancelled:'Dibatalkan'})[s]||s}
function statusClass(s){if(s==='published')return 'green';if(['queued_upload','waiting_publish','scheduled_youtube'].includes(s))return 'blue';if(['receiving','uploading_youtube'].includes(s))return 'amber';if(['failed','cancelled'].includes(s))return 'red';return ''}
async function boot(){const sess=await api('/api/session');if(!sess.authenticated){$('#loginView').classList.remove('hide');if(sess.configMissing?.length){$('#configWarning').classList.remove('hide');$('#configWarning').textContent='Cloud belum lengkap: '+sess.configMissing.join(', ')}return}$('#appView').classList.remove('hide');await refresh();setInterval(refresh,4000)}
$('#loginBtn').onclick=async()=>{try{await api('/api/login',{method:'POST',body:JSON.stringify({password:$('#loginPassword').value})});location.reload()}catch(e){toast(e.message)}};
$('#loginPassword').addEventListener('keydown',e=>{if(e.key==='Enter')$('#loginBtn').click()});
$('#logoutBtn').onclick=async()=>{await api('/api/logout',{method:'POST',body:'{}'});location.reload()};
async function refresh(){try{state.server=await api('/api/state');renderServer()}catch(e){if(e.message==='Silakan login')location.reload()}}
function renderServer(){const s=state.server;if(s.youtubeConnected&&s.channel){$('#channelDot').classList.add('on');$('#channelName').textContent=s.channel.title;$('#channelInfo').textContent='Channel terhubung dan worker siap.';$('#connectBtn').classList.add('hide');$('#disconnectBtn').classList.remove('hide')}else{$('#channelDot').classList.remove('on');$('#channelName').textContent='Belum terhubung';$('#channelInfo').textContent='Hubungkan akun YouTube sekali saja.';$('#connectBtn').classList.remove('hide');$('#disconnectBtn').classList.add('hide')}$('#oauthHint').textContent=`OAuth callback: ${s.redirectUri}`;const active=s.jobs.filter(j=>!['published','cancelled'].includes(j.status)).length;$('#sumQueue').textContent=active;const box=$('#jobs');if(!s.jobs.length){box.innerHTML='<div class="hint">Belum ada pekerjaan.</div>';return}box.innerHTML=s.jobs.slice(0,30).map(j=>{const pct=j.fileSize?Math.round((j.receivedBytes||0)/j.fileSize*100):0;return `<div class="job"><div class="jobTop"><div><div class="jobTitle" title="${esc(j.title)}">${esc(j.title)}</div><div class="jobMeta">Tayang ${fmtDate(j.scheduledAt)}</div></div><span class="status ${statusClass(j.status)}">${statusLabel(j.status)}</span></div><div class="jobMeta">${j.youtubeVideoId?`YouTube: ${esc(j.youtubeVideoId)}`:`Cloud: ${pct}%`}${j.error?` • ${esc(j.error)}`:''}</div>${j.status==='receiving'?`<div class="progress"><i style="width:${pct}%"></i></div>`:''}<div class="jobActions">${j.status==='failed'?`<button class="btn mini" data-retry="${j.id}">Retry</button>`:''}${!['published','scheduled_youtube','uploading_youtube','cancelled'].includes(j.status)?`<button class="btn mini" data-cancel="${j.id}">Batalkan</button>`:''}${j.youtubeVideoId?`<a class="btn mini" target="_blank" href="https://youtu.be/${encodeURIComponent(j.youtubeVideoId)}">Buka</a>`:''}${j.youtubeVideoId&&j.relatedVideoId?`<button class="btn mini" data-related-studio="${j.id}">Atur Video Terkait</button>`:''}</div></div>`}).join('')}
$('#jobs').onclick=async e=>{try{if(e.target.dataset.retry){await api(`/api/jobs/${e.target.dataset.retry}/retry`,{method:'POST',body:'{}'});await refresh()}if(e.target.dataset.cancel){await api(`/api/jobs/${e.target.dataset.cancel}/cancel`,{method:'POST',body:'{}'});await refresh()}if(e.target.dataset.relatedStudio){const j=state.server.jobs.find(x=>x.id===e.target.dataset.relatedStudio);if(j?.relatedVideoUrl){try{await navigator.clipboard.writeText(j.relatedVideoUrl)}catch{}window.open(`https://studio.youtube.com/video/${encodeURIComponent(j.youtubeVideoId)}/edit`,'_blank');toast('YouTube Studio dibuka. Pilih Video Terkait: '+(j.relatedVideoTitle||j.relatedVideoId));}}}catch(err){toast(err.message)}};
$('#connectBtn').onclick=()=>location.href='/auth/google';
$('#disconnectBtn').onclick=async()=>{if(!confirm('Putuskan akun YouTube?'))return;await api('/api/youtube/disconnect',{method:'POST',body:'{}'});await refresh()};

$('#checkRelatedBtn').onclick=async()=>{
  const raw=$('#relatedVideoUrl').value.trim();
  if(!raw){state.relatedDefault=null;$('#relatedVideoInfo').textContent='Opsional — pilih video dari channel yang sama.';return}
  try{
    const d=await api('/api/youtube/related-video?url='+encodeURIComponent(raw));
    state.relatedDefault=d.video;
    $('#relatedVideoUrl').value=d.video.url;
    $('#relatedVideoInfo').textContent=`✓ ${d.video.title} • ${d.video.privacyStatus==='public'?'Public':'Unlisted'}`;
    state.files.forEach(x=>{if(!x.relatedVideoId){x.relatedVideoId=d.video.id;x.relatedVideoTitle=d.video.title;x.relatedVideoUrl=d.video.url}});
    renderFiles();
    toast('Video terkait valid.');
  }catch(e){state.relatedDefault=null;$('#relatedVideoInfo').textContent=e.message;toast(e.message)}
};

const input=$('#fileInput'),drop=$('#drop');$('#pickBtn').onclick=()=>input.click();input.onchange=e=>{addFiles(e.target.files);input.value=''};['dragenter','dragover'].forEach(ev=>drop.addEventListener(ev,e=>{e.preventDefault();drop.classList.add('drag')}));['dragleave','drop'].forEach(ev=>drop.addEventListener(ev,e=>{e.preventDefault();drop.classList.remove('drag')}));drop.addEventListener('drop',e=>addFiles(e.dataTransfer.files));
function addFiles(files){const rel=state.relatedDefault;[...files].filter(f=>f.type.startsWith('video/')||/\.(mp4|mov|mkv|webm|avi)$/i.test(f.name)).forEach(f=>state.files.push({file:f,title:buildAutoTitle(f.name),autoTitle:true,when:'',relatedVideoId:rel?.id||'',relatedVideoTitle:rel?.title||'',relatedVideoUrl:rel?.url||''}));autoSchedule();renderFiles()}
function autoSchedule(){const base=new Date($('#startAt').value);const gap=Number($('#gap').value);if(!Number.isFinite(base.getTime()))return;state.files.forEach((x,i)=>x.when=localInput(new Date(base.getTime()+i*gap*60000)))}
function renderFiles(){const q=$('#selectedQueue');$('#sumSelected').textContent=state.files.length;if(!state.files.length){q.innerHTML='<div class="hint">Belum ada video dipilih.</div>';return}q.innerHTML=state.files.map((x,i)=>`<div class="fileRow" style="grid-template-columns:minmax(0,1.3fr) minmax(150px,.65fr) minmax(180px,.85fr) 75px"><div><div class="fileName" style="margin-bottom:4px">Judul final</div><input data-title="${i}" value="${esc(x.title)}"><div class="fileName">${esc(x.file.name)} • ${(x.file.size/1024/1024).toFixed(1)} MB</div></div><input data-when="${i}" type="datetime-local" value="${x.when}"><div class="fileName" title="${esc(x.relatedVideoTitle||'')}">${x.relatedVideoId?'Terkait: '+esc(x.relatedVideoTitle||x.relatedVideoId):'Tanpa video terkait'}</div><button class="btn mini" data-remove="${i}">Hapus</button></div>`).join('')}
$('#selectedQueue').addEventListener('input',e=>{if(e.target.dataset.title!==undefined){const x=state.files[Number(e.target.dataset.title)];x.title=e.target.value;x.autoTitle=false}if(e.target.dataset.when!==undefined)state.files[Number(e.target.dataset.when)].when=e.target.value;});$('#selectedQueue').onclick=e=>{if(e.target.dataset.remove!==undefined){state.files.splice(Number(e.target.dataset.remove),1);autoSchedule();renderFiles()}};
$('#gap').onchange=()=>{autoSchedule();renderFiles()};$('#startAt').onchange=()=>{autoSchedule();renderFiles()};
$('#titlePrefix').addEventListener('input',applyTitlePrefix);
$('#resetAutoTitles').onclick=()=>{state.files.forEach(x=>x.autoTitle=true);applyTitlePrefix();toast('Judul otomatis diterapkan ulang ke semua video.');};
async function uploadFile(jobId,file,onProgress){let offset=0;while(offset<file.size){const chunk=file.slice(offset,Math.min(file.size,offset+CHUNK));const r=await fetch(`/api/jobs/${jobId}/chunk`,{method:'PUT',credentials:'same-origin',headers:{'content-type':'application/octet-stream','x-upload-offset':String(offset)},body:chunk});const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||`Upload cloud gagal (${r.status})`);offset+=chunk.size;onProgress(offset/file.size)}}
$('#startBtn').onclick=async()=>{if(state.uploading)return;if(!state.server?.youtubeConnected)return toast('Hubungkan YouTube terlebih dahulu.');if(!state.files.length)return toast('Pilih video terlebih dahulu.');if(state.files.some(x=>!x.when))return toast('Semua video harus memiliki jadwal.');state.uploading=true;$('#startBtn').disabled=true;$('#startBtn').textContent='Mengirim video...';try{const desc=$('#description').value,tags=$('#tags').value.split(',').map(x=>x.trim()).filter(Boolean),categoryId=$('#category').value,madeForKids=$('#madeForKids').value==='true',containsSyntheticMedia=$('#synthetic').value==='true';for(let i=0;i<state.files.length;i++){const x=state.files[i],f=x.file;$('#startBtn').textContent=`Upload ${i+1}/${state.files.length}: ${f.name}`;const created=await api('/api/jobs',{method:'POST',body:JSON.stringify({order:Date.now()+i,fileName:f.name,fileSize:f.size,mimeType:f.type||'application/octet-stream',title:x.title,description:desc,relatedVideoId:x.relatedVideoId||'',relatedVideoTitle:x.relatedVideoTitle||'',relatedVideoUrl:x.relatedVideoUrl||'',tags,categoryId,madeForKids,containsSyntheticMedia,scheduledAt:new Date(x.when).toISOString()})});await uploadFile(created.job.id,f,p=>{$('#sumCloud').textContent=Math.round(((i+p)/state.files.length)*100)+'%'});await refresh()}toast('Semua file sudah masuk antrean. YouTube akan menjadwalkannya otomatis setelah upload selesai.');state.files=[];renderFiles();$('#sumCloud').textContent='100%'}catch(e){toast(e.message)}finally{state.uploading=false;$('#startBtn').disabled=false;$('#startBtn').textContent='Upload & Jadwalkan'}};
const d=new Date(Date.now()+3600000);d.setMinutes(0,0,0);$('#startAt').value=localInput(d);boot();
