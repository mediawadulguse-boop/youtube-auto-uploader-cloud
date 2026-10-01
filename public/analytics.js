const analyticsUi = { mode:'channel', period: '28', startDate: '', endDate: '', metric: 'views', data: null, error: null, loading: false, key: '', serial: 0, loadedAt: 0 };
const analyticsOAuthMessages = {
  denied: 'Persetujuan Google dibatalkan. Koneksi sebelumnya tetap tersedia.',
  authorization_required: 'Izin Analytics belum lengkap. Hubungkan kembali dan centang izin Analytics serta melihat akun YouTube.',
  not_connected: 'Hubungkan channel YouTube terlebih dahulu melalui menu Upload & Antrean.',
  offline_required: 'Google belum memberikan token offline. Ulangi Hubungkan Analytics.',
  quota_exceeded: 'API Analytics sedang membatasi permintaan. Koneksi upload sebelumnya tetap tersedia. Coba lagi nanti.',
  api_disabled: 'Aktifkan YouTube Analytics API pada proyek Google Cloud aplikasi, lalu ulangi Hubungkan Analytics.',
  access_denied: 'Akun/channel yang dipilih tidak dapat membaca Analytics channel terhubung. Pilih akun pemilik dan channel yang sama.',
  connection_failed: 'Koneksi Analytics belum berhasil. Koneksi upload sebelumnya dipertahankan. Coba hubungkan kembali.',
  invalid_report: 'Google mengembalikan laporan yang tidak valid. Coba hubungkan kembali.',
  upstream_error: 'Google belum dapat memvalidasi Analytics. Coba hubungkan kembali.'
};
let analyticsOAuthIssue = analyticsOAuthMessages[new URLSearchParams(location.search).get('oauth')] || '';
const anNumber = (value, digits = 0) => Number(value || 0).toLocaleString('id-ID', { maximumFractionDigits: digits });
const anDate = value => value ? new Date(value + 'T12:00:00Z').toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) : '—';
function anDuration(value) { const s = Math.round(value || 0); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; }
function analyticsChannelKey() { return `${state.server?.channel?.id || ''}:${!!state.server?.youtubeConnected}:${!!state.server?.analyticsAuthorized}`; }
function anChange(value, previous) {
  if (previous === null || previous === undefined) return '<span class="an-delta">Perbandingan belum tersedia</span>';
  if (!previous) return `<span class="an-delta">${value ? 'Periode sebelumnya 0' : 'Sama dengan periode sebelumnya'}</span>`;
  const percent = (value - previous) / Math.abs(previous) * 100;
  return `<span class="an-delta ${percent > 0 ? 'positive' : percent < 0 ? 'negative' : ''}">${percent > 0 ? '+' : ''}${anNumber(percent, 1)}% dari periode sebelumnya</span>`;
}
window.renderAnalytics = body => {
  const key = analyticsChannelKey();
  if (analyticsUi.key !== key) { analyticsUi.key = key; analyticsUi.data = null; analyticsUi.error = null; analyticsUi.loading = false; analyticsUi.loadedAt = 0; analyticsUi.serial++; window.resetVideoAnalytics?.(); }
  if (body.querySelector('#analyticsPanel') && body.dataset.analyticsKey === key) return;
  body.dataset.analyticsKey = key;
  body.innerHTML = `<div id="analyticsPanel"><div class="an-toolbar hub-panel"><div class="an-channel"><div class="an-avatar">▶</div><div><strong>${esc(state.server?.channel?.title || 'Channel YouTube')}</strong><div class="hint">Performa channel terhubung</div></div></div><div class="an-controls"><label>Periode<select id="analyticsPeriod"><option value="7">7 hari terakhir</option><option value="28">28 hari terakhir</option><option value="90">90 hari terakhir</option><option value="365">365 hari terakhir</option><option value="custom">Tanggal khusus</option></select></label><button id="analyticsReload" class="btn">Muat ulang</button><button id="analyticsExport" class="btn" disabled>Ekspor CSV</button></div><form id="analyticsDates" class="an-dates hide"><label>Dari<input type="date" id="analyticsStart" required></label><label>Sampai<input type="date" id="analyticsEnd" required></label><button class="btn" type="submit">Terapkan</button></form></div>${videoAnalyticsShell()}<div id="analyticsResults" aria-live="polite"></div></div>`;
  $('#analyticsPeriod').value = analyticsUi.period; $('#analyticsStart').value = analyticsUi.startDate; $('#analyticsEnd').value = analyticsUi.endDate;
  $('#analyticsDates').classList.toggle('hide', analyticsUi.period !== 'custom');
  $('#analyticsPeriod').onchange = e => { analyticsUi.period = e.target.value; $('#analyticsDates').classList.toggle('hide', analyticsUi.period !== 'custom'); if (analyticsUi.period !== 'custom') reloadAnalyticsView(); };
  $('#analyticsDates').onsubmit = e => { e.preventDefault(); analyticsUi.startDate = $('#analyticsStart').value; analyticsUi.endDate = $('#analyticsEnd').value; reloadAnalyticsView(); };
  $('#analyticsReload').onclick = () => { if (analyticsUi.period === 'custom') { analyticsUi.startDate = $('#analyticsStart').value; analyticsUi.endDate = $('#analyticsEnd').value; } reloadAnalyticsView(); };
  $('#analyticsExport').onclick = () => analyticsUi.mode==='videos'?exportVideoAnalytics():exportAnalytics();
  bindVideoAnalytics();
  renderAnalyticsResults();
  if (analyticsUi.mode==='channel' && !analyticsOAuthIssue && !analyticsUi.data && !analyticsUi.error && !analyticsUi.loading && state.server?.analyticsAuthorized) loadAnalytics();
};
async function loadAnalytics() {
  analyticsOAuthIssue = '';
  const serial = ++analyticsUi.serial, key = analyticsChannelKey();
  analyticsUi.loading = true; analyticsUi.error = null; analyticsUi.data = null; renderAnalyticsResults();
  const query = analyticsUi.period === 'custom' ? new URLSearchParams({ startDate: analyticsUi.startDate, endDate: analyticsUi.endDate }) : new URLSearchParams({ days: analyticsUi.period });
  try {
    const r = await fetch('/api/analytics?' + query, { credentials: 'same-origin', signal: AbortSignal.timeout(75_000) });
    const d = await r.json(); if (!r.ok) throw Object.assign(new Error(d.error || `HTTP ${r.status}`), { code: d.code });
    if (serial !== analyticsUi.serial || key !== analyticsChannelKey()) return;
    analyticsUi.data = d; analyticsUi.loadedAt = Date.now();
  } catch (e) { if (serial !== analyticsUi.serial || key !== analyticsChannelKey()) return; analyticsUi.error = { message: e.name === 'TimeoutError' ? 'YouTube membutuhkan waktu lebih lama. Coba muat ulang.' : e.message, code: e.code }; }
  finally { if (serial === analyticsUi.serial) { analyticsUi.loading = false; renderAnalyticsResults(); } }
}
function analyticsConnect(message) {
  return `<div class="hub-panel an-setup"><div class="an-mark">↗</div><h2>Kenali performa kontenmu</h2><p>${esc(message)}</p><a class="btn primary" href="/auth/google?analytics=1">Hubungkan Analytics</a><p class="hint">Pilih akun pemilik dan channel yang sama. Centang izin Analytics serta melihat akun YouTube. Koneksi upload tetap tersedia.</p><details><summary>Jika API belum diaktifkan</summary><p>Aktifkan YouTube Analytics API pada proyek Google Cloud yang sama dengan koneksi YouTube aplikasi.</p><a target="_blank" rel="noopener" href="https://console.cloud.google.com/apis/library/youtubeanalytics.googleapis.com">Buka pengaturan YouTube Analytics API</a></details></div>`;
}
function renderAnalyticsResults() {
  if(analyticsUi.mode==='videos'){renderVideoAnalytics();return}
  $('#analyticsVideoBrowser')?.classList.add('hide');$('#analyticsResults')?.classList.remove('hide');
  const result = $('#analyticsResults'); if (!result) return;
  $('#analyticsReload').disabled = analyticsUi.loading; $('#analyticsExport').disabled = !analyticsUi.data?.hasData || analyticsUi.loading;
  if (analyticsOAuthIssue) { result.innerHTML = analyticsConnect(analyticsOAuthIssue); return; }
  if (!state.server?.youtubeConnected || !state.server?.analyticsAuthorized) { result.innerHTML = analyticsConnect('Berikan izin baca untuk menampilkan data YouTube langsung di ruang kerja ini.'); return; }
  if (analyticsUi.loading) { result.innerHTML = '<div class="hub-panel empty">Mengambil laporan YouTube…</div>'; return; }
  const error = analyticsUi.error;
  if (error) {
    if (['authorization_required', 'access_denied', 'not_connected'].includes(error.code)) { result.innerHTML = analyticsConnect(error.message); return; }
    result.innerHTML = `<div class="hub-panel an-error" role="alert"><h3>Laporan belum tersedia</h3><p>${esc(error.message)}</p>${error.code === 'api_disabled' ? '<a class="btn" href="https://console.cloud.google.com/apis/library/youtubeanalytics.googleapis.com" target="_blank" rel="noopener">Aktifkan YouTube Analytics API</a>' : ''}<p class="hint">Klik Muat ulang setelah masalah teratasi.</p></div>`; return;
  }
  const d = analyticsUi.data; if (!d) { result.innerHTML = '<div class="hub-panel empty">Pilih tanggal, lalu terapkan periode.</div>'; return; }
  const s = d.summary, p = d.previous;
  const stats = [['Views', 'views', anNumber(s.views)], ['Jam tonton', 'watchHours', anNumber(s.watchHours, 1)], ['Subscriber bersih', 'netSubscribers', (s.netSubscribers > 0 ? '+' : '') + anNumber(s.netSubscribers)], ['Durasi tonton rata-rata', 'averageViewDuration', anDuration(s.averageViewDuration)], ['Likes', 'likes', anNumber(s.likes)], ['Komentar', 'comments', anNumber(s.comments)], ['Dibagikan', 'shares', anNumber(s.shares)], ['Subscriber baru', 'subscribersGained', anNumber(s.subscribersGained)]];
  const c = d.channel;
  result.innerHTML = `<div class="an-period"><div><strong>${anDate(d.range.startDate)} – ${anDate(d.range.endDate)}</strong><div class="hint">Dibanding ${anDate(d.range.previousStart)} – ${anDate(d.range.previousEnd)}</div></div><span class="hint">Diambil ${new Date(d.generatedAt).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta', dateStyle: 'short', timeStyle: 'short' })} WIB${d.cached ? ' · cache 10 menit' : ''}</span></div>${d.warnings.length ? `<div class="notice an-warning">${d.warnings.map(w => `<div>${esc(({channel:'Statistik channel', videoDetails:'Judul video', previous:'Perbandingan', daily:'Tren harian', topVideos:'Video teratas'})[w.section] || w.section)}: ${esc(w.message)}</div>`).join('')}</div>` : ''}${!d.hasData ? '<div class="notice">YouTube belum mengembalikan data untuk periode ini. Pilih periode lain atau coba kembali setelah data diproses.</div>' : ''}<div class="an-stats">${stats.map(([label, key, val]) => `<div class="stat-card"><span>${label}</span><strong>${d.hasData ? val : '—'}</strong>${d.hasData ? anChange(s[key], p?.hasData ? p[key] : null) : '<span class="hint">Belum ada laporan</span>'}</div>`).join('')}</div>${c ? `<div class="an-lifetime hub-panel"><strong>Channel saat ini</strong><span><b>${c.subscribers === null ? 'Disembunyikan' : anNumber(c.subscribers)}</b> subscriber</span><span><b>${anNumber(c.lifetimeViews)}</b> total views</span><span><b>${anNumber(c.videoCount)}</b> video</span><span class="hint">Subscriber dapat dibulatkan oleh YouTube. Total channel berbeda dari periode laporan.</span></div>` : ''}<div class="hub-panel an-chart-panel"><div class="an-section-head"><div><h3>Tren harian</h3><p class="hint">Baris harian terakhir: ${anDate(d.lastReportedDay)}</p></div><select id="analyticsMetric" aria-label="Metrik grafik"><option value="views">Views</option><option value="watchHours">Jam tonton</option><option value="netSubscribers">Subscriber bersih</option></select></div><div id="analyticsChart"></div><details class="an-daily-details"><summary>Lihat angka harian</summary><div class="an-table-scroll">${analyticsDailyTable(d.daily)}</div></details></div><div class="hub-panel an-video-panel"><div class="an-section-head"><div><h3>10 video teratas</h3><p class="hint">Diurutkan berdasarkan views pada periode yang dipilih, termasuk video yang diupload di luar aplikasi.</p></div></div>${analyticsVideoTable(d.topVideos)}</div><p class="hub-footer">Tanggal laporan mengikuti waktu YouTube (Pacific), sementara kalender produksi memakai WIB. Data dapat terlambat atau direvisi oleh YouTube. Hari tanpa baris laporan tidak dianggap nol. Subscriber bersih = baru − berhenti (${anNumber(s.subscribersLost)}). Jam tonton Analytics bukan perhitungan jam tayang publik untuk monetisasi.</p>`;
  $('#analyticsMetric').value = analyticsUi.metric; $('#analyticsMetric').onchange = e => { analyticsUi.metric = e.target.value; renderAnalyticsChart(); };
  result.querySelectorAll('[data-video-analytics]').forEach(button=>button.onclick=()=>openVideoAnalytics(button.dataset.videoAnalytics));
  result.querySelectorAll('[data-analytics-content]').forEach(button => button.onclick = () => openContent(button.dataset.analyticsContent));
  renderAnalyticsChart();
}
function analyticsDailyTable(rows) {
  if (!rows?.length) return '<div class="empty">Belum ada baris harian yang tersedia.</div>';
  return `<table class="an-table"><thead><tr><th>Tanggal (Pacific)</th><th>Views</th><th>Jam tonton</th><th>Subscriber bersih</th></tr></thead><tbody>${rows.map(r => `<tr><td>${anDate(r.day)}</td><td>${anNumber(r.views)}</td><td>${anNumber(r.watchHours, 1)}</td><td>${anNumber(r.netSubscribers)}</td></tr>`).join('')}</tbody></table>`;
}
function analyticsVideoTable(videos) {
  if (!videos?.length) return '<div class="empty">Belum ada laporan video teratas untuk periode ini.</div>';
  return `<div class="an-table-scroll"><table class="an-table"><thead><tr><th>Video</th><th>Views</th><th>Jam tonton</th><th>Rata-rata tonton</th><th>Likes</th><th>Komentar</th><th>Subscriber baru</th></tr></thead><tbody>${videos.map((v, i) => `<tr><td><div class="an-video"><span class="an-rank">${i + 1}</span>${v.thumbnail && /^https:\/\/(?:i\.ytimg\.com|img\.youtube\.com)\//.test(v.thumbnail) ? `<img src="${esc(v.thumbnail)}" loading="lazy" alt="">` : ''}<div><a href="https://youtu.be/${encodeURIComponent(v.id)}" target="_blank" rel="noopener">${esc(v.title)}</a><button class="an-content-link" data-video-analytics="${esc(v.id)}">Lihat Analytics video</button>${v.contentId ? `<button class="an-content-link" data-analytics-content="${esc(v.contentId)}">Buka script & produksi</button>` : ''}</div></div></td><td>${anNumber(v.views)}</td><td>${anNumber(v.watchHours, 1)}</td><td>${anDuration(v.averageViewDuration)}</td><td>${anNumber(v.likes)}</td><td>${anNumber(v.comments)}</td><td>+${anNumber(v.subscribersGained)}</td></tr>`).join('')}</tbody></table></div>`;
}
function renderAnalyticsChart() {
  const box = $('#analyticsChart'); if (!box) return;
  const d = analyticsUi.data, rows = d?.daily, metric = analyticsUi.metric;
  if (!rows?.length) { box.innerHTML = '<div class="empty">Belum ada data tren harian.</div>'; return; }
  const width = Math.max(340, Math.min(900, box.clientWidth || 900)), height = 265, left = 65, right = 20, top = 20, bottom = 40;
  const values = rows.map(r => r[metric]), min = Math.min(0, ...values), max = Math.max(1, ...values), span = max - min;
  const start = Date.parse(d.range.startDate), end = Date.parse(d.range.endDate), x = date => left + (end === start ? .5 : (Date.parse(date) - start) / (end - start)) * (width - left - right), y = v => height - bottom - (v - min) / span * (height - top - bottom);
  let line = '', previousDay = null;
  for (const r of rows) { const contiguous = previousDay !== null && Date.parse(r.day) - Date.parse(previousDay) === 86400000; line += `${contiguous ? 'L' : 'M'}${x(r.day).toFixed(2)},${y(r[metric]).toFixed(2)} `; previousDay = r.day; }
  const name = { views: 'Views', watchHours: 'Jam tonton', netSubscribers: 'Subscriber bersih' }[metric];
  box.innerHTML = `<svg class="an-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="${name} harian. Angka lengkap tersedia pada tabel di bawah.">${Array.from({ length: 5 }, (_, i) => { const v = min + span * i / 4; return `<line x1="${left}" y1="${y(v)}" x2="${width - right}" y2="${y(v)}" stroke="#e8edf5"/><text x="${left - 10}" y="${y(v) + 4}" text-anchor="end">${anNumber(v, metric === 'watchHours' ? 1 : 0)}</text>`; }).join('')}<path d="${line}" fill="none" stroke="#ff0033" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>${rows.map(r => `<circle cx="${x(r.day)}" cy="${y(r[metric])}" r="${rows.length > 90 ? 1.5 : 3}" fill="#ff0033"><title>${anDate(r.day)}: ${anNumber(r[metric], 1)} ${name}</title></circle>`).join('')}<text x="${left}" y="${height - 10}">${anDate(d.range.startDate)}</text><text x="${width - right}" y="${height - 10}" text-anchor="end">${anDate(d.range.endDate)}</text></svg>`;
}
window.addEventListener('resize', () => requestAnimationFrame(renderAnalyticsChart));
function exportAnalytics() {
  const d = analyticsUi.data; if (!d?.hasData) return;
  const cell = value => { let s = String(value ?? ''); if (/^[\s]*[=+@-]/.test(s) && typeof value !== 'number') s = "'" + s; return '"' + s.replaceAll('"', '""') + '"'; };
  const rows = [['YouTube Analytics', d.connectedChannel.title], ['Dari', d.range.startDate, 'Sampai', d.range.endDate, 'Zona waktu', d.range.timeZone], ['Diambil', d.generatedAt], [], ['Ringkasan', 'Views', 'Jam tonton', 'Subscriber bersih', 'Durasi rata-rata (detik)', 'Likes', 'Komentar', 'Dibagikan'], ['Periode dipilih', d.summary.views, d.summary.watchHours, d.summary.netSubscribers, d.summary.averageViewDuration, d.summary.likes, d.summary.comments, d.summary.shares], [], ['Tanggal (Pacific)', 'Views', 'Jam tonton', 'Subscriber baru', 'Subscriber berhenti', 'Subscriber bersih'], ...(d.daily || []).map(r => [r.day, r.views, r.watchHours, r.subscribersGained, r.subscribersLost, r.netSubscribers]), [], ['Video ID', 'Judul', 'Views', 'Jam tonton', 'Durasi rata-rata (detik)', 'Likes', 'Komentar', 'Dibagikan', 'Subscriber baru'], ...(d.topVideos || []).map(v => [v.id, v.title, v.views, v.watchHours, v.averageViewDuration, v.likes, v.comments, v.shares, v.subscribersGained]), [], ['Catatan', 'Data YouTube dapat terlambat atau direvisi. Hari tanpa baris laporan tidak dianggap nol.'], ...d.warnings.map(w => ['Laporan parsial', w.section, w.message])];
  const url = URL.createObjectURL(new Blob(['\uFEFF' + rows.map(row => row.map(cell).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a'); link.href = url; link.download = `youtube-analytics-${d.range.startDate}-${d.range.endDate}.csv`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
