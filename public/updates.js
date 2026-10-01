const updatesUi={data:null,error:'',task:null,query:'',type:'all'};
window.renderUpdates=body=>{
  if(body.querySelector('#updatesPanel'))return;
  body.innerHTML=`<section id="updatesPanel"><div class="hub-panel updates-toolbar"><div><span class="eyebrow">VERSI APLIKASI</span><h3 id="updatesCurrent">Memuat riwayat…</h3><p class="hint">Catatan fitur dan perbaikan pada setiap rilis.</p></div><div class="updates-controls"><input id="updatesSearch" type="search" aria-label="Cari riwayat update" placeholder="Cari versi atau perubahan…"><select id="updatesType" aria-label="Jenis perubahan"><option value="all">Semua perubahan</option><option value="feature">Fitur baru</option><option value="fix">Perbaikan</option></select></div></div><div id="updatesError" class="notice hide" role="alert"></div><button id="updatesRetry" type="button" class="btn hide">Coba lagi</button><div id="updatesList"></div></section>`;
  body.querySelector('#updatesSearch').value=updatesUi.query;body.querySelector('#updatesType').value=updatesUi.type;
  body.querySelector('#updatesSearch').oninput=e=>{updatesUi.query=e.target.value;paintUpdates()};body.querySelector('#updatesType').onchange=e=>{updatesUi.type=e.target.value;paintUpdates()};body.querySelector('#updatesRetry').onclick=loadUpdates;
  paintUpdates();if(!updatesUi.data)void loadUpdates();
};
function paintUpdates(){
  const panel=hub.view==='updates'?document.querySelector('#updatesPanel'):null;if(!panel)return;
  panel.querySelector('#updatesCurrent').textContent=updatesUi.data?'Versi terpasang: v'+updatesUi.data.currentVersion:'Memuat riwayat…';
  panel.querySelector('#updatesError').textContent=updatesUi.error;panel.querySelector('#updatesError').classList.toggle('hide',!updatesUi.error);panel.querySelector('#updatesRetry').classList.toggle('hide',!updatesUi.error);
  const q=updatesUi.query.trim().toLocaleLowerCase('id-ID'),releases=(updatesUi.data?.releases||[]).filter(r=>[r.version,r.title,...r.changes.map(c=>c.text)].join(' ').toLocaleLowerCase('id-ID').includes(q)&&r.changes.some(c=>updatesUi.type==='all'||c.type===updatesUi.type));
  panel.querySelector('#updatesList').innerHTML=releases.map(r=>`<details class="hub-panel update-release" ${r.version===updatesUi.data.currentVersion?'open':''}><summary><div><span class="update-version">v${esc(r.version)}</span>${r.version===updatesUi.data.currentVersion?'<span class="history-status ready">Terpasang</span>':''}<h3>${esc(r.title)}</h3></div><time datetime="${esc(r.date)}">${esc(anDate(r.date))}</time></summary><ul class="update-changes">${r.changes.filter(c=>updatesUi.type==='all'||c.type===updatesUi.type).map(c=>`<li><span class="update-type ${c.type==='fix'?'fix':'feature'}">${c.type==='fix'?'Perbaikan':'Fitur baru'}</span><p>${esc(c.text)}</p></li>`).join('')}</ul></details>`).join('')||(updatesUi.data?'<div class="hub-panel empty">Tidak ada update yang sesuai pencarian.</div>':'');
}
async function loadUpdates(){if(updatesUi.task)return updatesUi.task;updatesUi.error='';updatesUi.task=(async()=>{try{updatesUi.data=await storageRequest('/api/releases')}catch(e){updatesUi.error=e.message}finally{updatesUi.task=null;paintUpdates()}})();return updatesUi.task}
