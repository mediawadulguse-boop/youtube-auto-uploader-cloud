// A central status page. Reading it never runs provider tests or consumes AI quota.
const preferencesUi={panel:null,tab:'connections',data:{},errors:{},checked:{},busy:new Set(),tasks:new Map(),provider:'',publicationMessage:''};
function preferencesPanel(){return hub.view==='preferences'&&preferencesUi.panel?.isConnected?preferencesUi.panel:null}
const preferenceDate=value=>value?storageDate(value):'Belum diperiksa';
function preferenceBadge(label,tone='waiting'){return `<span class="preference-badge ${tone}">${esc(label)}</span>`}
function preferenceLink(view,label){return `<button type="button" class="btn mini" data-preference-go="${view}">${esc(label)}</button>`}
function preferenceCard(id,title,description,actions){return `<section class="hub-panel preference-card"><div class="preference-card-head"><h3>${title}</h3><div data-preference-badge="${id}">${preferenceBadge('Memeriksa')}</div></div><p class="hint">${description}</p><div data-preference-detail="${id}" class="preference-detail" aria-live="polite">Memuat status…</div><div class="preference-actions">${actions}</div><p data-preference-error="${id}" class="preference-error" role="alert"></p></section>`}
window.renderPreferences=body=>{
  if(body.querySelector('#preferencesPanel'))return;
  body.innerHTML=`<div id="preferencesPanel"><div class="preference-toolbar"><p class="hint">Status koneksi dan kesehatan aplikasi dalam satu tempat.</p><button type="button" class="btn" data-preference-reload>Muat ulang status</button></div>
  <div class="preference-tabs" role="tablist" aria-label="Bagian pengaturan">${[['connections','Koneksi'],['system','Status sistem'],['workspace','Workspace']].map(([id,label])=>`<button type="button" role="tab" id="preference-tab-${id}" aria-controls="preference-${id}" data-preference-tab="${id}">${label}</button>`).join('')}</div>
  <div id="preference-connections" role="tabpanel" aria-labelledby="preference-tab-connections" class="preference-grid">
  ${preferenceCard('youtube','YouTube','Koneksi channel untuk upload dan pembaruan status publikasi.',`<a class="btn primary" href="/auth/google" data-preference-connect="youtube">Hubungkan YouTube</a><button type="button" class="btn" data-preference-check="youtube">Cek API YouTube</button><button type="button" class="btn" data-preference-sync>Sinkronkan status tayang</button>${preferenceLink('upload','Upload & antrean')}`)}
  ${preferenceCard('analytics','YouTube Analytics','Izin laporan channel diperiksa terpisah dari koneksi upload.',`<a class="btn primary" href="/auth/google?analytics=1">Hubungkan Analytics</a><button type="button" class="btn" data-preference-check="analytics">Cek Analytics</button>${preferenceLink('analytics','Buka laporan')}`)}
  ${preferenceCard('ai','Provider AI','Engine Radar tetap dapat bekerja tanpa AI. Pemeriksaan katalog model tidak membuat naskah.',`<label class="preference-provider">Provider yang diperiksa<select aria-label="Provider AI yang diperiksa" data-preference-provider></select></label><button type="button" class="btn" data-preference-check="ai">Cek koneksi & model</button>${preferenceLink('radar','Buka Radar')}`)}
  ${preferenceCard('drive','Google Drive','Koneksi akun dan keberhasilan backup ditampilkan secara terpisah.',`<a class="btn primary" href="/auth/google?drive=1" data-preference-connect="drive">Hubungkan Google Drive</a>${preferenceLink('storage','Kelola backup Drive')}`)}
  </div>
  <div id="preference-system" role="tabpanel" aria-labelledby="preference-tab-system" class="preference-grid" hidden>
  ${preferenceCard('health','Kesehatan aplikasi','Respons server, akses penyimpanan, dan versi aplikasi.',preferenceLink('updates','Riwayat update'))}
  ${preferenceCard('database','Database & backup','Kapasitas dan salinan pemulihan data aplikasi.',preferenceLink('storage','Dashboard data & backup'))}
  ${preferenceCard('retention','Retensi Radar','Pembersihan data otomatis setelah backup Drive terverifikasi.',preferenceLink('storage','Atur retensi 7 / 14 hari'))}
  <section class="hub-panel preference-card"><h3>Status publikasi</h3><p>Video yang sudah ditautkan ke konten diperiksa otomatis sekitar setiap 5 menit. Status kalender mengikuti hasil pemeriksaan YouTube.</p><p class="hint">Untuk upload manual di YouTube Studio, tautkan video melalui YouTube Analytics agar kalender dapat mengikuti statusnya.</p><div class="preference-actions">${preferenceLink('analytics','Tautkan video manual')}${preferenceLink('calendar','Buka kalender')}</div></section>
  </div>
  <div id="preference-workspace" role="tabpanel" aria-labelledby="preference-tab-workspace" class="preference-grid" hidden>
  <section class="hub-panel preference-card"><h3>Pilar konten</h3><p>Atur nama dan warna pilar untuk kalender, kartu produksi, dan daftar konten.</p>${preferenceLink('settings','Kelola pilar konten')}</section>
  <section class="hub-panel preference-card"><h3>Tahap produksi</h3><p>Atur kolom dan urutan pekerjaan melalui menu Kolom di Kanban.</p>${preferenceLink('kanban','Atur papan Kanban')}</section>
  <section class="hub-panel preference-card"><h3>Topik, sumber & prompt</h3><p>Kelola topik riset, sumber berita, channel pantauan, serta pustaka prompt di Radar.</p>${preferenceLink('radar','Kelola Radar')}</section>
  <section class="hub-panel preference-card"><h3>Waktu & penyimpanan</h3><p>Kalender dan ringkasan harian / mingguan menggunakan WIB (Asia/Jakarta). Naskah, Note dan pengaturan workspace ikut dalam backup data aplikasi.</p>${preferenceLink('storage','Lihat kategori data')}</section>
  </div><p class="hint preference-footnote">Muat ulang membaca status tersimpan. Cek API menjalankan pemeriksaan layanan yang dipilih. Pilihan provider di sini digunakan untuk pemeriksaan; provider utama mengikuti konfigurasi server.</p></div>`;
  preferencesUi.panel=body.querySelector('#preferencesPanel');
  const panel=preferencesUi.panel;
  panel.onclick=e=>{
    const tab=e.target.closest('[data-preference-tab]'),go=e.target.closest('[data-preference-go]'),check=e.target.closest('[data-preference-check]');
    if(tab){preferencesUi.tab=tab.dataset.preferenceTab;paintPreferencesTabs();}
    if(go)navigate(go.dataset.preferenceGo);
    if(check)void checkPreference(check.dataset.preferenceCheck);
    if(e.target.closest('[data-preference-sync]'))void syncPreferencePublications();
    if(e.target.closest('[data-preference-reload]'))void loadPreferences();
  };
  panel.onkeydown=e=>{
    if(!e.target.matches('[role="tab"]')||!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;
    e.preventDefault();const tabs=[...panel.querySelectorAll('[role="tab"]')],index=tabs.indexOf(e.target),next=e.key==='Home'?0:e.key==='End'?tabs.length-1:(index+(e.key==='ArrowRight'?1:-1)+tabs.length)%tabs.length;
    tabs[next].click();tabs[next].focus();
  };
  panel.querySelector('[data-preference-provider]').onchange=e=>{preferencesUi.provider=e.target.value;void loadPreference('ai','/api/radar/ai/status?provider='+encodeURIComponent(preferencesUi.provider));};
  paintPreferencesTabs();paintPreferences();void loadPreferences();
};
function paintPreferencesTabs(){const panel=preferencesPanel();if(!panel)return;for(const button of panel.querySelectorAll('[data-preference-tab]')){const selected=button.dataset.preferenceTab===preferencesUi.tab;button.setAttribute('aria-selected',String(selected));button.tabIndex=selected?0:-1;panel.querySelector('#preference-'+button.dataset.preferenceTab).hidden=!selected;}}
function paintPreference(id,label,tone,detail,error=''){
  const panel=preferencesPanel();if(!panel)return;
  panel.querySelector(`[data-preference-badge="${id}"]`).innerHTML=preferenceBadge(label,tone);
  panel.querySelector(`[data-preference-detail="${id}"]`).innerHTML=detail;
  panel.querySelector(`[data-preference-error="${id}"]`).textContent=error;
}
function paintPreferences(){
  const panel=preferencesPanel();if(!panel)return;
  const {data,errors,checked,busy}=preferencesUi,c=data.connections,y=c?.youtube,a=c?.analytics,s=data.storage,d=s?.drive,h=data.health,ai=data.ai;
  const line=(label,value)=>`<p><span>${esc(label)}</span><strong>${esc(value)}</strong></p>`;
  const unknown=(key)=>errors[key]?'Belum dapat diperiksa':'Memeriksa';
  const failed=state=>['error','reconnect_required'].includes(state);
  let yLabel=!y?unknown('connections'):y.auth==='reconnect_required'?'Hubungkan ulang':!y.connected?'Belum terhubung':failed(y.connection?.state)?'Perlu perhatian':y.connection?.state==='ready'?'API terverifikasi':'Izin tersimpan';
  paintPreference('youtube',errors.connections?'Belum dapat diperiksa':errors.youtube?'Pemeriksaan gagal':yLabel,!errors.connections&&!errors.youtube&&y?.connected&&y.connection?.state==='ready'?'ready':'waiting',y?line('Channel',y.channel?.title||'Belum dipilih')+line('Pemeriksaan API',preferenceDate(y.connection?.checkedAt))+`<p class="hint">${esc(y.connection?.message||'Tekan Cek API YouTube untuk memeriksa koneksi langsung.')}</p>`:'Menunggu respons koneksi.',errors.connections||errors.youtube||errors.publications||'');
  const diag=a?.diagnostics,analyticsReady=a?.authorized&&['ready','empty'].includes(diag?.channel);
  paintPreference('analytics',errors.connections?'Belum dapat diperiksa':errors.analytics?'Pemeriksaan gagal':!a?unknown('connections'):!a.authorized?'Belum diberi izin':diag?.channel==='error'?'Perlu perhatian':analyticsReady?'API terverifikasi':'Izin tersimpan',!errors.connections&&!errors.analytics&&analyticsReady?'ready':'waiting',a?line('Izin pendapatan',a.monetaryAuthorized?'Diberikan':'Belum diberikan')+line('Pemeriksaan API',preferenceDate(diag?.checkedAt))+`<p class="hint">${esc(diag?.errors?.map(e=>e.message).filter(Boolean).join(' · ')||(!a.authorized?'Hubungkan Analytics pada channel yang sama.':diag?.channel==='empty'?'API merespons; laporan belum memiliki data.':'Lihat laporan untuk rincian data channel.'))}</p>`:'Menunggu respons koneksi.',errors.connections||errors.analytics||'');
  const activeTest=ai?.generationTest,aiReady=ai?.configured&&ai.connection?.state==='connected';
  paintPreference('ai',errors.ai?'Belum dapat diperiksa':!ai?unknown('ai'):!ai.configured?'Belum dikonfigurasi':aiReady?'Katalog terhubung':failed(ai.connection?.state)?'Perlu perhatian':'Belum diperiksa',!errors.ai&&aiReady?'ready':'waiting',ai?line('Model',ai.model||'—')+line('Pratinjau hari ini',`${ai.used} / ${ai.limit}`)+line('Uji jawaban',activeTest?.message||'Belum diuji')+`<p class="hint">${esc(ai.connection?.message||ai.setupMessage||'')}</p><p class="hint">Provider utama: ${esc(ai.defaultProvider)} · Perpindahan cadangan ${ai.autoFallback?'aktif':'nonaktif'}.</p>`:'Menunggu respons provider.',errors.ai||'');
  if(preferencesUi.publicationMessage)panel.querySelector('[data-preference-detail="youtube"]').insertAdjacentHTML('beforeend',`<p class="hint" role="status">${esc(preferencesUi.publicationMessage)}</p>`);
  const select=panel.querySelector('[data-preference-provider]');
  if(ai?.providers){const signature=JSON.stringify(ai.providers.map(p=>[p.providerId,p.provider,p.configured]));if(select.dataset.signature!==signature){select.dataset.signature=signature;select.innerHTML=ai.providers.map(p=>`<option value="${esc(p.providerId)}">${esc(p.provider)}${p.configured?'':' — belum dikonfigurasi'}</option>`).join('');}select.value=preferencesUi.provider||ai.providerId;}
  select.disabled=busy.has('ai')||!ai;
  paintPreference('drive',errors.storage?'Belum dapat diperiksa':!d?unknown('storage'):d.error?'Perlu perhatian':d.connected?'Izin tersimpan':'Belum terhubung','waiting',d?line('Backup terverifikasi',d.lastVerifiedAt?preferenceDate(d.lastVerifiedAt):'Belum ada')+line('Proses backup',d.busy?'Sedang berjalan':'Tidak sedang berjalan')+`<p class="hint">${esc(d.error||'Verifikasi backup dilakukan saat proses backup Drive, bukan saat membuka halaman.')}</p>`:'Menunggu respons penyimpanan.',errors.storage||'');
  paintPreference('health',errors.health?'Belum dapat diperiksa':!h?unknown('health'):h.ok?'Sehat':'Perlu perhatian',!errors.health&&h?.ok?'ready':'waiting',h?line('Versi','v'+h.version)+line('Penyimpanan',h.storage==='postgresql'?'PostgreSQL':'File JSON')+line('Diperiksa',preferenceDate(checked.health)):'Menunggu respons server.',errors.health||'');
  const cap=s?.capacity,last=s?.backups?.slice().sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt)))[0];
  paintPreference('database',errors.storage?'Belum dapat diperiksa':!s?unknown('storage'):!s.ready||['critical','warning'].includes(cap?.level)?'Perlu perhatian':'Tersedia',!errors.storage&&s?.ready&&!['critical','warning'].includes(cap?.level)?'ready':'waiting',s?line('Mode',s.mode==='postgresql'?'PostgreSQL':'File JSON')+line('Salinan backup',String(s.backups?.length||0))+line('Backup terakhir',last?preferenceDate(last.createdAt):'Belum ada')+line('Estimasi database + WAL',Number.isFinite(cap?.estimateBytes)?storageBytes(cap.estimateBytes):'Belum tersedia')+`<p class="hint">${esc(s.backupWarning||cap?.note||'Lihat dashboard untuk grafik kapasitas dan kategori data.')}</p>`:'Menunggu respons penyimpanan.',errors.storage||'');
  const r=s?.retention;
  paintPreference('retention',errors.storage?'Belum dapat diperiksa':!r?unknown('storage'):r.error?'Perlu perhatian':r.enabled?'Aktif':'Nonaktif',!errors.storage&&r?.enabled&&!r.error?'ready':'waiting',r?line('Periode',r.days+' hari')+line('Pembersihan terakhir',r.lastRunAt?preferenceDate(r.lastRunAt):'Belum berjalan')+`<p class="hint">${esc(r.error||'Naskah, referensi tersimpan dan data yang dilindungi tetap dipertahankan.')}</p>`:'Menunggu respons kebijakan.',errors.storage||'');
  for(const link of panel.querySelectorAll('[data-preference-connect]'))link.textContent=link.dataset.preferenceConnect==='youtube'?(y?.connected||y?.auth==='reconnect_required'?'Hubungkan ulang YouTube':'Hubungkan YouTube'):(d?.connected?'Hubungkan ulang Drive':'Hubungkan Google Drive');
  for(const button of panel.querySelectorAll('[data-preference-check]')){const key=button.dataset.preferenceCheck;button.disabled=busy.has(key)||busy.has('connections')||(key==='ai'&&!ai?.configured)||(key==='analytics'&&!a?.authorized)||(key==='youtube'&&!y?.connected);button.textContent=busy.has(key)?'Memeriksa…':({youtube:'Cek API YouTube',analytics:'Cek Analytics',ai:'Cek koneksi & model'})[key];}
  const sync=panel.querySelector('[data-preference-sync]');sync.disabled=busy.has('publications')||busy.has('youtube')||busy.has('connections')||!!errors.connections||!y?.connected||y.auth==='reconnect_required';sync.textContent=busy.has('publications')?'Menyinkronkan…':'Sinkronkan status tayang';
  panel.querySelector('[data-preference-reload]').disabled=busy.size>0;
}
async function loadPreference(key,url,options={}){
  if(preferencesUi.tasks.has(key))return preferencesUi.tasks.get(key);
  preferencesUi.busy.add(key);paintPreferences();
  const task=(async()=>{
    try{preferencesUi.data[key]=await storageRequest(url,options,options.method?90000:30000);preferencesUi.checked[key]=new Date().toISOString();delete preferencesUi.errors[key];}
    catch(e){preferencesUi.errors[key]=e.message+(preferencesUi.data[key]?' Data terakhir tetap ditampilkan.':'');}
    finally{preferencesUi.busy.delete(key);preferencesUi.tasks.delete(key);paintPreferences();}
  })();preferencesUi.tasks.set(key,task);return task;
}
async function loadPreferences(){return Promise.allSettled([loadPreference('connections','/api/settings/connections'),loadPreference('storage','/api/storage'),loadPreference('health','/api/health'),loadPreference('ai','/api/radar/ai/status'+(preferencesUi.provider?'?provider='+encodeURIComponent(preferencesUi.provider):''))]);}
async function checkPreference(key){
  if(preferencesUi.busy.has(key)||preferencesUi.busy.has('connections'))return;
  if(key==='ai')return loadPreference('ai','/api/radar/ai/check',{method:'POST',body:JSON.stringify({provider:preferencesUi.provider||preferencesUi.data.ai?.providerId})});
  preferencesUi.busy.add(key);delete preferencesUi.errors[key];paintPreferences();
  try{await storageRequest(key==='youtube'?'/api/youtube/check':'/api/analytics/diagnostics',{method:'POST',body:'{}'},90000);await loadPreference('connections','/api/settings/connections');}
  catch(e){preferencesUi.errors[key]=e.message;}
  finally{preferencesUi.busy.delete(key);paintPreferences();}
}

async function syncPreferencePublications(){
  if(preferencesUi.busy.has('publications')||preferencesUi.busy.has('youtube')||preferencesUi.busy.has('connections'))return;
  preferencesUi.busy.add('publications');delete preferencesUi.errors.publications;preferencesUi.publicationMessage='';paintPreferences();
  try{
    const result=await storageRequest('/api/youtube/sync-publications',{method:'POST',body:'{}'},90000);
    preferencesUi.publicationMessage=result.busy?'Sinkronisasi sedang berjalan.':'Status tayang diperbarui: '+(result.updated||0)+' konten.';
  }catch(e){preferencesUi.errors.publications=e.message;}
  finally{await refresh();await loadPreference('connections','/api/settings/connections');preferencesUi.busy.delete('publications');paintPreferences();}
}
