export const ANALYTICS_SCOPE = 'https://www.googleapis.com/auth/yt-analytics.readonly';
export const READONLY_SCOPE = 'https://www.googleapis.com/auth/youtube.readonly';
export const ANALYTICS_SCOPES = [ANALYTICS_SCOPE, READONLY_SCOPE];
const METRICS = ['views', 'estimatedMinutesWatched', 'averageViewDuration', 'subscribersGained', 'subscribersLost', 'likes', 'comments', 'shares'];
const DAY_MS = 86_400_000;

export function hasAnalyticsAccess(token) {
  const scopes = new Set(String(token?.scope || '').split(/\s+/));
  return scopes.has(ANALYTICS_SCOPE) && scopes.has(READONLY_SCOPE);
}

export function pacificToday(now = Date.now()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(now)).map(x => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}
function shift(date, days) { return new Date(Date.parse(date + 'T00:00:00Z') + days * DAY_MS).toISOString().slice(0, 10); }
function validDate(date) { return /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(Date.parse(date + 'T00:00:00Z')) && new Date(date + 'T00:00:00Z').toISOString().slice(0, 10) === date; }
export function analyticsRange(params, now = Date.now()) {
  const latestEnd = shift(pacificToday(now), -1);
  let startDate = params.get('startDate'), endDate = params.get('endDate');
  if (startDate !== null || endDate !== null) {
    if (!validDate(startDate || '') || !validDate(endDate || '')) throw Object.assign(new Error('Isi kedua tanggal dengan format YYYY-MM-DD.'), { status: 400 });
  } else {
    const days = params.get('days') || '28';
    if (!['7', '28', '90', '365'].includes(days)) throw Object.assign(new Error('Periode harus 7, 28, 90, atau 365 hari.'), { status: 400 });
    endDate = latestEnd; startDate = shift(endDate, 1 - Number(days));
  }
  const days = Math.round((Date.parse(endDate) - Date.parse(startDate)) / DAY_MS) + 1;
  if (startDate < '2009-01-01' || endDate > latestEnd || days < 1 || days > 366) throw Object.assign(new Error('Pilih rentang 1–366 hari, mulai tahun 2009 dan berakhir paling lambat kemarin menurut waktu YouTube (Pacific).'), { status: 400 });
  const previousEnd = shift(startDate, -1), previousStart = shift(previousEnd, 1 - days);
  return { startDate, endDate, days, previousStart, previousEnd, latestEnd, timeZone: 'America/Los_Angeles' };
}

export function reportRows(report) {
  const headers = report.columnHeaders;
  if (!Array.isArray(headers) || !headers.every(x => typeof x.name === 'string') || (report.rows !== undefined && !Array.isArray(report.rows)))
    throw Object.assign(new Error('Format laporan YouTube tidak valid. Coba muat ulang.'), { status: 502, code: 'invalid_report' });
  return (report.rows || []).map(row => {
    if (!Array.isArray(row) || row.length !== headers.length || headers.some((h, i) => h.columnType === 'METRIC' && !Number.isFinite(Number(row[i]))))
      throw Object.assign(new Error('Nilai laporan YouTube tidak valid.'), { status: 502, code: 'invalid_report' });
    return Object.fromEntries(headers.map((h, i) => [h.name, row[i]]));
  });
}
function metrics(row) {
  const out = Object.fromEntries(METRICS.map(k => [k, Number(row?.[k] || 0)]));
  out.watchHours = out.estimatedMinutesWatched / 60;
  out.netSubscribers = out.subscribersGained - out.subscribersLost;
  return out;
}
export function analyticsError(status, data = {}, apiName = 'YouTube Analytics API') {
  const details = data.error?.details || [];
  const reasons = [...(data.error?.errors || []).map(e => e.reason), ...details.map(e => e.reason)].join(' ');
  const message = String(data.error?.message || '');
  let code = 'upstream_error', error = 'YouTube belum dapat memberikan laporan. Coba lagi nanti.';
  if (/quota|rateLimit|RESOURCE_EXHAUSTED/i.test(reasons) || status === 429 || /quota/i.test(message)) {
    code = 'quota_exceeded'; error = 'Kuota API YouTube sedang habis atau dibatasi. Coba lagi setelah kuota tersedia.';
  } else if (/accessNotConfigured|SERVICE_DISABLED|serviceDisabled/i.test(reasons) || /has not been used|is disabled/i.test(message)) {
    code = 'api_disabled'; error = `Aktifkan ${apiName} di proyek Google Cloud yang digunakan aplikasi, lalu coba lagi.`;
  } else if (status === 401 || /insufficient|ACCESS_TOKEN_SCOPE_INSUFFICIENT|authError|UNAUTHENTICATED/i.test(reasons) || /insufficient.*permission/i.test(message)) {
    code = 'authorization_required'; error = 'Berikan izin Analytics melalui tombol Hubungkan Analytics dengan akun channel yang sama.';
  } else if (status === 403) {
    code = 'access_denied'; error = 'Akun Google belum dapat membaca Analytics channel ini. Hubungkan ulang dengan akun pemilik channel dan berikan semua izin yang diminta.';
  }
  return Object.assign(new Error(error), { status: status === 429 ? 429 : 502, code });
}

// Only private, short-lived memory caching. No report data or Google credentials go to the browser storage.
export class YouTubeAnalytics {
  constructor(fetcher, { ttl = 600_000, now = Date.now } = {}) {
    this.fetcher = fetcher; this.ttl = ttl; this.now = now; this.cache = new Map(); this.pending = new Map(); this.generation = 0;
  }
  clear() { this.generation++; this.cache.clear(); this.pending.clear(); }
  async request(url) {
    let response;
    try { response = await this.fetcher(url, { signal: AbortSignal.timeout(20_000) }); }
    catch { throw Object.assign(new Error('Koneksi ke YouTube gagal atau terlalu lama. Coba muat ulang.'), { status: 502, code: 'network_error' }); }
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw analyticsError(response.status, data, url.includes('youtubeanalytics.googleapis.com') ? 'YouTube Analytics API' : 'YouTube Data API v3');
    return data;
  }
  async report(channelId, range, extra = {}) {
    const p = new URLSearchParams({ ids: `channel==${channelId}`, startDate: range.startDate, endDate: range.endDate, metrics: METRICS.join(','), ...extra });
    return reportRows(await this.request('https://youtubeanalytics.googleapis.com/v2/reports?' + p));
  }
  async get(channelId, range) {
    const key = `${channelId}:${range.startDate}:${range.endDate}`, generation = this.generation;
    const cached = this.cache.get(key);
    if (cached && this.now() - cached.at < this.ttl) return { ...cached.data, cached: true };
    if (this.pending.has(key)) return this.pending.get(key);
    const work = this.fetchReport(channelId, range).then(data => {
      if (generation !== this.generation) throw Object.assign(new Error('Koneksi channel berubah. Muat ulang Analytics.'), { status: 409, code: 'channel_changed' });
      this.cache.delete(key); if (!data.warnings.length) this.cache.set(key, { at: this.now(), data });
      while (this.cache.size > 12) this.cache.delete(this.cache.keys().next().value);
      return { ...data, cached: false };
    }).finally(() => { if (this.pending.get(key) === work) this.pending.delete(key); });
    this.pending.set(key, work); return work;
  }
  async fetchReport(channelId, range) {
    const totals = await this.report(channelId, range);
    const warnings = [];
    const optional = async (section, call) => {
      try { return await call(); } catch (e) { warnings.push({ section, code: e.code || 'upstream_error', message: e.message }); return null; }
    };
    const [daily, previous, top, channelData] = await Promise.all([
      optional('daily', () => this.report(channelId, range, { dimensions: 'day', sort: 'day' })),
      optional('previous', () => this.report(channelId, { startDate: range.previousStart, endDate: range.previousEnd })),
      optional('topVideos', () => this.report(channelId, range, { dimensions: 'video', sort: '-views', maxResults: '10' })),
      optional('channel', () => this.request('https://www.googleapis.com/youtube/v3/channels?' + new URLSearchParams({ part: 'snippet,statistics', id: channelId })))
    ]);
    let metadata = null;
    if (top?.length) {
      metadata = await optional('videoDetails', () => this.request('https://www.googleapis.com/youtube/v3/videos?' + new URLSearchParams({ part: 'snippet', id: top.map(x => x.video).join(',') })));
    }
    const c = channelData?.items?.find(x => x.id === channelId), snippets = new Map((metadata?.items || []).map(x => [x.id, x.snippet]));
    return {
      range, generatedAt: new Date(this.now()).toISOString(), warnings,
      summary: metrics(totals[0]), hasData: totals.length > 0,
      previous: previous === null ? null : { ...metrics(previous[0]), hasData: previous.length > 0 },
      daily: daily === null ? null : daily.map(x => ({ day: x.day, ...metrics(x) })),
      lastReportedDay: daily?.at(-1)?.day || null,
      channel: c ? { id: c.id, title: c.snippet?.title, thumbnail: c.snippet?.thumbnails?.default?.url || null, subscribers: c.statistics?.hiddenSubscriberCount ? null : Number(c.statistics?.subscriberCount || 0), hiddenSubscriberCount: !!c.statistics?.hiddenSubscriberCount, lifetimeViews: Number(c.statistics?.viewCount || 0), videoCount: Number(c.statistics?.videoCount || 0) } : null,
      topVideos: top === null ? null : top.map(x => ({ id: x.video, ...metrics(x), title: snippets.get(x.video)?.title || null, thumbnail: snippets.get(x.video)?.thumbnails?.medium?.url || null, publishedAt: snippets.get(x.video)?.publishedAt || null }))
    };
  }
}
