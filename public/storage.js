const storageUi={panel:null,data:null,loading:false,statusTask:null,statusError:'',checkedAt:null,creating:false,message:'',messageKind:'',diagnostics:null,diagnosticError:'',checking:false,diagnosticTask:null,channelKey:'',downloading:new Set(),policyBusy:false};
const storageDate=value=>value?new Date(value).toLocaleString('id-ID',{timeZone:'Asia/Jakarta',dateStyle:'medium',timeStyle:'short'})+' WIB':'—';
function storagePanel(){return hub.view==='storage'&&storageUi.panel?.isConnected?storageUi.panel:null}
async function storageRequest(url,opt={},timeout=30000){
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeout);
  try{const response=await fetch(url,{credentials:'same-origin',...opt,signal:controller.signal,headers:{'content-type':'application/json',...(opt.headers||{})}});let data={};try{data=await response.json()}catch{throw Error('Respons server tidak dapat dibaca. Coba muat ulang.')}if(!response.ok)throw Object.assign(Error(data.error||`HTTP ${response.status}`),{status:response.status,retryAfter:data.retryAfter});return data}
  catch(e){if(e.name==='AbortError')throw Error('Permintaan terlalu lama. Coba muat ulang status.');throw e}finally{clearTimeout(timer)}
}
window.renderStorage=body=>{
  const mounted=body.querySelector('#storagePanel');
  if(mounted){storageUi.panel=mounted;const key=analyticsChannelKey();if(storageUi.channelKey!==key){storageUi.channelKey=key;storageUi.diagnostics=null;void loadStorageDiagnostics()}return}
  body.innerHTML=`<div id="storagePanel" class="storage-panel"><div class="storage-toolbar"><p class="hint">Status diperbarui saat membuka halaman atau menekan Muat ulang.</p><button class="btn" id="storageReload" type="button">Muat ulang</button></div>
  <div id="storageError" class="notice hide" role="alert"></div>
  <section class="hub-panel"><div class="an-section-head"><div><h3 id="storageHeading">Memeriksa penyimpanan…</h3><p id="storageDescription" class="hint"></p></div><span id="storageConnection" class="history-status">Memeriksa</span></div><p id="storageMigration" class="hint"></p><p class="hint">Backup data aplikasi: 14 salinan harian dan 10 manual terakhir. File video dan kredensial OAuth berada di volume aplikasi dan tidak termasuk dalam unduhan ini.</p><p id="storageWarning" class="notice hide"></p><button class="btn primary" id="storageCreate" type="button" disabled>Buat backup sekarang</button><p id="storageMessage" class="storage-message" role="status"></p><p id="storageChecked" class="hint"></p></section>
  <section class="hub-panel"><div class="an-section-head"><h3>Salinan pemulihan</h3><span id="storageCount" class="hint"></span></div><div id="storageBackups"><p class="hint">Memuat daftar backup…</p></div><p class="hint">Unduhan berisi data konten, Note, kategori, Kanban, antrean, dan Analytics. Pemulihan dilakukan oleh administrator saat aplikasi dihentikan.</p></section>
  <section class="hub-panel"><h3>Google Drive & retensi Radar</h3><p class="hint">Rekomendasi: 14 hari untuk bahan Radar otomatis, backup harian ke Drive, dan peringatan kapasitas. Pembersihan hanya berjalan setelah backup terverifikasi. Naskah, kalender, Note, prompt serta referensi yang disimpan tetap dipertahankan.</p><p id="storageCapacity" class="notice" role="status"></p><p id="storageDrive" class="hint"></p><div class="storage-policy-actions"><a class="btn" href="/auth/google?drive=1" id="storageDriveConnect">Hubungkan Google Drive</a><button class="btn" id="storageDriveBackup" type="button">Backup ke Drive sekarang</button><a class="btn hide" id="storageDriveFolder" target="_blank" rel="noopener">Buka folder backup</a></div><p class="hint">Izin Drive terpisah dari YouTube. Aplikasi membuat folder backup otomatis sendiri; file video dan token OAuth tidak termasuk. Salinan Drive tidak dihapus oleh retensi Radar.</p><form id="storageRetentionForm" class="storage-policy-actions"><label><input id="storageRetentionEnabled" type="checkbox"> Pembersihan otomatis</label><label>Retensi <select id="storageRetentionDays"><option value="14">2 minggu · 14 hari</option><option value="7">1 minggu · 7 hari</option></select></label><button class="btn" type="submit" id="storageRetentionSave">Simpan retensi</button><button class="btn" type="button" id="storageCleanup">Bersihkan sekarang</button></form><p id="storageRetention" class="hint"></p><p id="storagePolicyMessage" class="storage-message" role="status"></p></section>
  <section class="hub-panel"><div class="an-section-head"><h3>Status integrasi Analytics</h3><button class="btn" id="storageValidate" type="button">Periksa koneksi Analytics</button></div><div id="storageValidation" class="hint" aria-live="polite">Memuat status Analytics…</div></section></div>`;
  storageUi.panel=body.querySelector('#storagePanel');storageUi.channelKey=analyticsChannelKey();
  body.querySelector('#storageReload').onclick=()=>{void loadStorage();void loadStorageDiagnostics()};
  body.querySelector('#storageCreate').onclick=createStorageBackup;
  body.querySelector('#storageRetentionForm').onsubmit=e=>{e.preventDefault();void storagePolicyAction('retention')};
  body.querySelector('#storageDriveBackup').onclick=()=>storagePolicyAction('drive');
  body.querySelector('#storageCleanup').onclick=()=>storagePolicyAction('cleanup');
  body.querySelector('#storageValidate').onclick=()=>loadStorageDiagnostics(true);
  body.querySelector('#storageBackups').onclick=e=>{const button=e.target.closest('[data-download-backup]');if(button)void downloadStorageBackup(button.dataset.downloadBackup)};
  paintStorage();paintStorageDiagnostics();void loadStorage();void loadStorageDiagnostics();
};
function paintStorage(){
  const panel=storagePanel();if(!panel)return;const q=s=>panel.querySelector(s),data=storageUi.data;
  q('#storageReload').disabled=storageUi.loading;q('#storageReload').textContent=storageUi.loading?'Memuat…':'Muat ulang';
  const error=q('#storageError');error.textContent=storageUi.statusError;error.classList.toggle('hide',!storageUi.statusError);
  q('#storageHeading').textContent=data?(data.mode==='postgresql'?'PostgreSQL aktif':'Penyimpanan JSON'):(storageUi.statusError?'Status belum tersedia':'Memeriksa penyimpanan…');
  q('#storageDescription').textContent=data?(data.mode==='postgresql'?'Data konten dan catatan tersimpan di PostgreSQL.':'Lingkungan ini memakai file JSON; backup PostgreSQL belum tersedia.'):'Menunggu respons penyimpanan.';
  const connection=q('#storageConnection');connection.textContent=storageUi.statusError?'Belum dapat diperiksa':data?.ready?'Terhubung':'Memeriksa';connection.className='history-status '+(storageUi.statusError?'waiting':data?.ready?'ready':'waiting');
  q('#storageMigration').textContent=data?.migratedAt?'Migrasi diverifikasi pada '+storageDate(data.migratedAt)+'.':'';
  q('#storageWarning').textContent=data?.backupWarning||'';q('#storageWarning').classList.toggle('hide',!data?.backupWarning);
  const remaining=data?.manualAvailableAt?Math.max(0,Math.ceil((Date.parse(data.manualAvailableAt)-Date.now())/1000)):0;
  q('#storageCreate').disabled=storageUi.creating||data?.mode!=='postgresql'||!!remaining;
  q('#storageCreate').textContent=storageUi.creating?'Membuat backup…':remaining?`Backup tersedia dalam ${remaining} detik`:'Buat backup sekarang';
  q('#storageMessage').textContent=storageUi.message;q('#storageMessage').className='storage-message '+storageUi.messageKind;
  q('#storageChecked').textContent=storageUi.checkedAt?'Status terakhir diperiksa '+storageDate(storageUi.checkedAt)+'.':'';
  if(!data){if(storageUi.statusError)q('#storageBackups').innerHTML='<p class="hint">Daftar backup belum dapat dimuat. Tekan Muat ulang untuk mencoba lagi.</p>';return}
  paintStoragePolicy(panel,data);
  const backups=data.backups||[];q('#storageCount').textContent=backups.length+' salinan';const signature=JSON.stringify(backups),area=q('#storageBackups');
  if(area.dataset.signature!==signature){const scroll=area.querySelector('.an-table-scroll')?.scrollLeft||0;area.dataset.signature=signature;area.innerHTML=backups.length?`<div class="an-table-scroll"><table class="an-table"><thead><tr><th>Waktu (WIB)</th><th>Jenis</th><th>Unduh</th></tr></thead><tbody>${backups.map(b=>`<tr><td>${esc(storageDate(b.createdAt))}${b.volumeCopy==='missing'?'<small class="storage-copy-warning">Salinan volume belum tersedia</small>':''}</td><td>${b.kind==='daily'?'Harian':'Manual'}</td><td><button class="btn mini" type="button" data-download-backup="${esc(b.id)}">Unduh backup</button></td></tr>`).join('')}</tbody></table></div>`:'<p class="hint">Belum ada backup.</p>';if(area.querySelector('.an-table-scroll'))area.querySelector('.an-table-scroll').scrollLeft=scroll}
  for(const button of area.querySelectorAll('[data-download-backup]')){const busy=storageUi.downloading.has(button.dataset.downloadBackup);button.disabled=busy;button.textContent=busy?'Mengunduh…':'Unduh backup'}
}
async function loadStorage(force=false){
  if(storageUi.statusTask){if(!force)return storageUi.statusTask;await storageUi.statusTask}
  storageUi.loading=true;paintStorage();
  storageUi.statusTask=(async()=>{try{const data=await storageRequest('/api/storage');if(!data||!['postgresql','json'].includes(data.mode)||!Array.isArray(data.backups))throw Error('Status penyimpanan tidak valid.');storageUi.data=data;storageUi.checkedAt=new Date().toISOString();storageUi.statusError=''}catch(e){storageUi.statusError=e.message+(storageUi.data?' Data terakhir tetap ditampilkan.':'')}finally{storageUi.loading=false;storageUi.statusTask=null;paintStorage()}})();return storageUi.statusTask;
}
async function createStorageBackup(){
  if(storageUi.creating||storageUi.data?.mode!=='postgresql')return;storageUi.creating=true;storageUi.message='Membuat salinan data…';storageUi.messageKind='';paintStorage();
  try{const backup=await storageRequest('/api/storage/backups',{method:'POST',body:'{}'},60000);storageUi.message=backup.warning||'Backup berhasil dibuat pada '+storageDate(backup.createdAt)+'. Siap diunduh pada daftar di bawah.';storageUi.messageKind=backup.warning?'warning':'success';await loadStorage(true)}
  catch(e){storageUi.message=e.message+' Periksa daftar backup sebelum mencoba lagi.';storageUi.messageKind='error';await loadStorage(true)}
  finally{storageUi.creating=false;paintStorage()}
}
function paintStorageDiagnostics(){const panel=storagePanel();if(!panel)return;const button=panel.querySelector('#storageValidate');button.disabled=storageUi.checking;button.textContent=storageUi.checking?'Memeriksa…':'Periksa koneksi Analytics';const target=panel.querySelector('#storageValidation');target.innerHTML=(storageUi.diagnostics?storageValidation(storageUi.diagnostics):'<p>Belum ada status Analytics.</p>')+(storageUi.checking?'<p>Memeriksa koneksi Analytics…</p>':'')+(storageUi.diagnosticError?`<p class="notice" role="alert">${esc(storageUi.diagnosticError)}</p>`:'')}
async function loadStorageDiagnostics(manual=false){
  if(storageUi.diagnosticTask)return storageUi.diagnosticTask;storageUi.checking=true;storageUi.diagnosticError='';paintStorageDiagnostics();const key=storageUi.channelKey;
  storageUi.diagnosticTask=(async()=>{try{const result=await storageRequest('/api/analytics/diagnostics',manual?{method:'POST',body:'{}'}:{},manual?90000:30000);if(key===storageUi.channelKey)storageUi.diagnostics=result}catch(e){if(key===storageUi.channelKey)storageUi.diagnosticError=e.message+' Status backup tetap dapat digunakan.'}finally{storageUi.checking=false;storageUi.diagnosticTask=null;paintStorageDiagnostics();if(key!==storageUi.channelKey&&storagePanel())void loadStorageDiagnostics()}})();return storageUi.diagnosticTask;
}
async function downloadStorageBackup(id){
  if(storageUi.downloading.has(id))return;storageUi.downloading.add(id);storageUi.message='Menyiapkan unduhan backup…';storageUi.messageKind='';paintStorage();const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),60000);
  try{const response=await fetch('/api/storage/backups/'+encodeURIComponent(id),{credentials:'same-origin',signal:controller.signal});if(!response.ok){let error={};try{error=await response.json()}catch{}throw Error(error.error||'Unduhan backup belum berhasil.')}if(!response.headers.get('content-type')?.includes('application/gzip'))throw Error('Format unduhan backup tidak sesuai.');const blob=await response.blob();if(blob.size<2)throw Error('Berkas backup kosong.');const head=new Uint8Array(await blob.slice(0,2).arrayBuffer());if(head[0]!==31||head[1]!==139)throw Error('Berkas backup tidak valid.');const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download='content-hub-backup-'+id+'.json.gz';document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);storageUi.message='Backup berhasil diunduh.';storageUi.messageKind='success'}
  catch(e){storageUi.message=e.name==='AbortError'?'Unduhan terlalu lama. Coba lagi.':e.message;storageUi.messageKind='error'}finally{clearTimeout(timer);storageUi.downloading.delete(id);paintStorage()}
}
function storageValidation(v){const labels={ready:'Tersedia',empty:'Belum ada data',error:'Perlu perhatian',not_checked:'Belum diperiksa',not_authorized:'Izin belum diberikan',waiting:'Menunggu laporan',not_started:'Belum diaktifkan'};return `<dl class="storage-checks">${[['Analytics channel',v.channel],['Analytics video',v.video],['Katalog video',v.catalog],['Reach / CTR',v.reach],['Pendapatan',v.revenue]].map(([label,status])=>`<div><dt>${label}</dt><dd>${esc(labels[status]||status||'Belum diperiksa')}</dd></div>`).join('')}</dl>${v.checkedAt?`<p>Diperiksa ${storageDate(v.checkedAt)}${v.lastReportedDay?' · laporan sampai '+anDate(v.lastReportedDay):''}.</p>`:''}${v.errors?.length?`<div class="notice">${v.errors.map(e=>esc(e.message)).join('<br>')}</div>`:''}`}
// Update only cooldown text while this view is open; never remount or refetch.
setInterval(()=>{if(storagePanel()&&storageUi.data?.manualAvailableAt)paintStorage()},1000);

function paintStoragePolicy(panel,data){
 const q=s=>panel.querySelector(s),drive=data.drive||{},r=data.retention||{},capacity=data.capacity||{},mb=n=>(n/1024/1024).toFixed(1)+' MB';
 q('#storageCapacity').textContent=capacity.estimateBytes?`Estimasi database + WAL: ${mb(capacity.estimateBytes)}${capacity.budgetBytes?' / anggaran '+mb(capacity.budgetBytes):''}. ${capacity.level==='critical'?'Kapasitas mendekati batas. ':capacity.level==='warning'?'Kapasitas perlu diperhatikan. ':''}${capacity.note||''}`:capacity.note||'Kapasitas PostgreSQL belum dapat diperiksa.';
 q('#storageCapacity').className='notice '+(capacity.level==='critical'?'error':capacity.level==='warning'?'warning':'');
 q('#storageDrive').textContent=(drive.connected?'Drive terhubung. Backup harian aktif. ':'Drive belum terhubung untuk backup otomatis. ')+(drive.lastVerifiedAt?'Backup terakhir terverifikasi '+storageDate(drive.lastVerifiedAt)+'. ':'')+(drive.error||'');
 q('#storageDriveConnect').textContent=drive.connected?'Hubungkan ulang Drive':'Hubungkan Google Drive';
 q('#storageDriveBackup').disabled=storageUi.policyBusy||!drive.connected||data.mode!=='postgresql';
 const folder=q('#storageDriveFolder');folder.classList.toggle('hide',!drive.folderId);if(drive.folderId)folder.href='https://drive.google.com/drive/folders/'+encodeURIComponent(drive.folderId);
 const form=q('#storageRetentionForm'),signature=JSON.stringify([r.revision,r.enabled,r.days]);if(form.dataset.signature!==signature){form.dataset.signature=signature;q('#storageRetentionEnabled').checked=r.enabled!==false;q('#storageRetentionDays').value=String(r.days||14);}
 q('#storageRetentionSave').disabled=storageUi.policyBusy;q('#storageCleanup').disabled=storageUi.policyBusy||!drive.connected||!r.enabled||data.mode!=='postgresql';
 const p=r.preview||{};q('#storageRetention').textContent=`Kandidat: ${p.sources||0} sumber lama, ${p.issues||0} isu kosong, ${p.reports||0} arsip, ${p.cache||0} cache AI, ${p.channelEntries||0} entri riwayat channel. ${p.protected||0} isu dilindungi. `+(r.lastRunAt?'Pembersihan terakhir '+storageDate(r.lastRunAt)+'. ':'')+(r.error||(!drive.connected?'Pembersihan menunggu koneksi Drive.':''));
}
async function storagePolicyAction(action){
 if(storageUi.policyBusy)return;const panel=storagePanel();if(!panel)return;
 const r=storageUi.data?.retention,body=action==='retention'?{enabled:panel.querySelector('#storageRetentionEnabled').checked,days:Number(panel.querySelector('#storageRetentionDays').value),revision:r?.revision}:{};
 storageUi.policyBusy=true;panel.querySelector('#storagePolicyMessage').textContent=action==='cleanup'?'Memverifikasi backup sebelum pembersihan…':action==='drive'?'Mengunggah dan memverifikasi backup Drive…':'Menyimpan pengaturan…';paintStorage();
 try{const result=await storageRequest('/api/storage/'+action,{method:action==='retention'?'PATCH':'POST',body:JSON.stringify(body)},180000);const target=storagePanel()?.querySelector('#storagePolicyMessage');if(target)target.textContent=action==='retention'?'Retensi berhasil disimpan.':action==='drive'?'Backup Drive berhasil diverifikasi.':result.skipped?'Tidak ada data yang perlu dibersihkan.':`Pembersihan selesai: ${result.sources||0} sumber dan ${result.issues||0} isu lama dihapus.`;await loadStorage(true)}catch(e){const target=storagePanel()?.querySelector('#storagePolicyMessage');if(target)target.textContent=e.message;}finally{storageUi.policyBusy=false;paintStorage()}
}
