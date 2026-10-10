/* Trends describe stored coverage; they do not estimate Google search volume. */
window.HubRadarTrends=(()=>{
 const state={period:24,topic:'',platform:'',initialized:false,epoch:0,selected:'',report:null};
 const date=value=>new Date(value).toLocaleString('id-ID',{timeZone:'Asia/Jakarta',day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'});
 function graph(item,report){
  const values=item.buckets.map(b=>b.count),max=Math.max(1,...values),points=values.map((v,i)=>[44+i*610/Math.max(1,values.length-1),158-v/max*125]);
  return `<div class="radar-trend-line"><svg viewBox="0 0 680 200" role="img" aria-label="Kemunculan ${esc(item.label)}: ${report.period===24?'per jam':'per 24 jam'}, ${item.count} sumber"><line x1="44" y1="158" x2="654" y2="158" class="trend-axis"/><line x1="44" y1="33" x2="654" y2="33" class="trend-guide"/><text x="10" y="37">${max}</text><text x="20" y="162">0</text><polyline points="${points.map(p=>p.join(',')).join(' ')}" class="trend-path"/>${points.map(([x,y],i)=>`<circle cx="${x}" cy="${y}" r="4" class="trend-point"><title>${esc(date(item.buckets[i].startAt))}–${esc(date(item.buckets[i].endAt))} WIB: ${values[i]} sumber</title></circle>`).join('')}<text x="44" y="190">${esc(date(report.startAt))}</text><text x="654" y="190" text-anchor="end">${esc(date(report.endAt))} WIB</text></svg></div>`;
 }
 function body(host){
  const report=state.report,root=host.querySelector('[data-trends-body]');if(!report||!root)return;
  if(!report.keywords.length){root.innerHTML=`<div class="empty">Belum ada kata kunci dari sumber bertanggal yang sesuai dalam ${report.period===24?'24 jam':'7 hari'} terakhir.</div><p class="hint">Pilih topik lain atau sinkronkan Radar untuk mengambil sumber baru.</p><p class="hint">${esc(report.note)}</p>`;return;}
  const item=report.keywords.find(k=>k.key===state.selected)||report.keywords[0];state.selected=item.key;
  root.innerHTML=`<p class="hint">${report.sourceCount} sumber unik · ${report.publishers} penerbit/akun · ${report.platforms.YouTube||0} video YouTube · ${date(report.startAt)} → ${date(report.endAt)} WIB</p><div class="radar-trends-grid"><div class="radar-trend-ranking" role="group" aria-label="Kata kunci teratas">${report.keywords.map(k=>`<button type="button" data-trend-key="${esc(k.key)}" aria-pressed="${k.key===item.key}" class="radar-trend-row"><span>${esc(k.label)}</span><strong>${k.count} <small>sumber</small></strong><i><b style="width:${Math.max(3,k.count/report.keywords[0].count*100)}%"></b></i><small>${k.previousCount} sebelumnya · ${k.delta>0?'+':''}${k.delta} sumber</small></button>`).join('')}</div><div class="radar-trend-detail"><h3>${esc(item.label)}</h3><p class="hint">${item.count} sumber · ${item.share}% sumber pada filter ini · ${item.publishers} penerbit/akun</p><p class="hint">${report.period===24?'Per jam dalam 24 jam terakhir':'Per 24 jam dalam 7 hari terakhir'} · jumlah sumber, bukan indeks Google</p>${graph(item,report)}<details><summary>Rincian angka grafik</summary><div class="radar-trend-table"><table><thead><tr><th>Mulai (WIB)</th><th>Selesai (WIB)</th><th>Sumber</th></tr></thead><tbody>${item.buckets.map(b=>`<tr><td>${date(b.startAt)}</td><td>${date(b.endAt)}</td><td>${b.count}</td></tr>`).join('')}</tbody></table></div></details><h4>Sumber terbaru</h4><ol class="radar-trend-sources">${item.sources.map(s=>`<li><a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">${esc(s.title)} ↗</a><small>${esc(s.publisher||s.platform)} · ${esc(s.platform)} · ${date(s.publishedAt)} WIB</small><button type="button" class="btn mini" data-trend-issue="${esc(s.issueId)}">Buka isu</button></li>`).join('')}</ol></div></div><p class="hint radar-trend-note">${esc(report.note)}</p><p class="hint">Tidak dihitung: ${report.excluded.undated} sumber tanpa tanggal, ${report.excluded.future} bertanggal mendatang, ${report.excluded.reposts} repost, ${report.excluded.duplicates} duplikat. Retensi memengaruhi data pembanding.</p>`;
 }
 async function load(host){
  const epoch=++state.epoch,root=host.querySelector('[data-trends-body]');if(!root)return;
  root.innerHTML='<p class="hint" role="status">Menghitung tren kata kunci…</p>';
  host.querySelectorAll('[data-trends-period]').forEach(button=>{const active=Number(button.dataset.trendsPeriod)===state.period;button.classList.toggle('primary',active);button.setAttribute('aria-selected',String(active));});
  try{
   const params=new URLSearchParams({period:state.period,topic:state.topic,platform:state.platform});
   const report=await api('/api/radar/trends?'+params);
   if(epoch!==state.epoch||!host.isConnected)return;
   state.report=report;body(host);
  }catch(error){if(epoch!==state.epoch||!host.isConnected)return;root.innerHTML='<p class="notice" role="alert">Tren belum dapat dimuat: '+esc(error.message)+'</p><button type="button" class="btn" data-trends-retry>Coba lagi</button>';}
 }
 function render(host,data){
  if(!host)return;const topics=data.topics.filter(t=>t.enabled);
  if(!state.initialized){state.topic=topics.some(t=>t.id==='focus-politics')?'focus-politics':'';state.initialized=true;}
  if(state.topic&&!topics.some(t=>t.id===state.topic))state.topic='';
  host.innerHTML=`<div class="radar-trends-heading"><div><span class="eyebrow">TREN LIPUTAN</span><h3>Kata kunci yang ramai</h3><p class="hint">Dari berita dan YouTube di Radar · Engine tanpa kuota AI</p></div><div class="radar-trends-controls"><div role="tablist" aria-label="Periode tren"><button type="button" class="btn" role="tab" data-trends-period="24">24 jam</button><button type="button" class="btn" role="tab" data-trends-period="168">7 hari</button></div><select data-trends-topic aria-label="Topik tren"><option value="">Semua topik aktif</option>${topics.map(t=>'<option value="'+esc(t.id)+'">'+esc(t.name)+'</option>').join('')}</select><select data-trends-platform aria-label="Sumber tren"><option value="">Berita & YouTube</option><option value="Berita / Web">Artikel / berita</option><option value="YouTube">Video YouTube</option></select></div></div><div data-trends-body aria-live="polite"></div>`;
  host.querySelector('[data-trends-topic]').value=state.topic;host.querySelector('[data-trends-platform]').value=state.platform;
  host.onchange=e=>{if(e.target.matches('[data-trends-topic]'))state.topic=e.target.value;else if(e.target.matches('[data-trends-platform]'))state.platform=e.target.value;else return;state.selected='';void load(host);};
  host.onclick=e=>{const b=e.target.closest('button');if(!b)return;if(b.hasAttribute('data-trends-period')){state.period=Number(b.dataset.trendsPeriod);void load(host);}else if(b.hasAttribute('data-trends-retry'))void load(host);else if(b.hasAttribute('data-trend-key')){state.selected=b.dataset.trendKey;body(host);}else if(b.dataset.trendIssue)radarRun(()=>radarIssue(b.dataset.trendIssue));};
  void load(host);
 }
 return {render};
})();
