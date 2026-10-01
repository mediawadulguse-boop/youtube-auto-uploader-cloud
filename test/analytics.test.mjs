import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { YouTubeAnalytics, analyticsRange, reportRows, analyticsError, ANALYTICS_SCOPES, hasAnalyticsAccess } from '../analytics.mjs';
const uploadScope = 'https://www.googleapis.com/auth/youtube.force-ssl';
const fakeScopes = [uploadScope, ...ANALYTICS_SCOPES].join(' ');
const range = analyticsRange(new URLSearchParams('days=7'), Date.parse('2026-10-01T15:00:00Z'));
function report(params, multiplier = 1) {
  const dimension = params.get('dimensions'), names = params.get('metrics').split(',');
  const values = { views: 120, estimatedMinutesWatched: 180, averageViewDuration: 90, subscribersGained: 8, subscribersLost: 3, likes: 9, comments: 4, shares: 2 };
  return { columnHeaders: [...(dimension ? [{ name: dimension, columnType: 'DIMENSION', dataType: 'STRING' }] : []), ...names.map(name => ({ name, columnType: 'METRIC', dataType: 'FLOAT' }))], rows: [...(dimension === 'day' ? [params.get('startDate'), params.get('endDate')] : [dimension === 'video' ? 'abcdefghijk' : null])].map(value => [...(dimension ? [value] : []), ...names.map(name => values[name] * multiplier)]) };
}
test('Pacific dates, custom validation, metrics mapping and error classification', () => {
  const r = analyticsRange(new URLSearchParams('days=28'), Date.parse('2026-10-01T06:30:00Z')); // still Sep 30 in Pacific
  assert.equal(r.endDate, '2026-09-29'); assert.equal(r.startDate, '2026-09-02'); assert.equal(r.previousEnd, '2026-09-01'); assert.equal(r.days, 28);
  assert.throws(() => analyticsRange(new URLSearchParams('startDate=2026-02-30&endDate=2026-03-05')), e => e.status === 400);
  assert.throws(() => analyticsRange(new URLSearchParams('days=999')), e => e.status === 400);
  assert.throws(() => analyticsRange(new URLSearchParams('startDate=2026-09-01')), e => e.status === 400);
  assert.throws(() => analyticsRange(new URLSearchParams('startDate=2025-01-01&endDate=2026-10-01')), e => e.status === 400);
  assert.equal(hasAnalyticsAccess({ scope: fakeScopes }), true); assert.equal(hasAnalyticsAccess({ scope: uploadScope }), false);
  assert.equal(analyticsError(403, { error: { errors: [{ reason: 'quotaExceeded' }] } }).code, 'quota_exceeded');
  assert.equal(analyticsError(403, { error: { details: [{ reason: 'SERVICE_DISABLED' }] } }).code, 'api_disabled');
  assert.equal(analyticsError(403, { error: { details: [{ reason: 'ACCESS_TOKEN_SCOPE_INSUFFICIENT' }] } }).code, 'authorization_required');
  assert.throws(() => reportRows({ columnHeaders: [{ name: 'views', columnType: 'METRIC' }], rows: [['invalid']] }), e => e.code === 'invalid_report');
});
test('reports share in-flight work, preserve totals, cache, expire and isolate channels', async () => {
  let calls = 0, now = Date.now(); const urls = [];
  const api = new YouTubeAnalytics(async url => {
    calls++; urls.push(new URL(url)); await new Promise(r => setTimeout(r, 5));
    const u = new URL(url); let data;
    if (u.hostname === 'youtubeanalytics.googleapis.com') data = report(u.searchParams, u.searchParams.get('startDate') === range.previousStart ? .5 : 1);
    else if (u.pathname.endsWith('/channels')) data = { items: [{ id: u.searchParams.get('id'), snippet: { title: 'REFRAME' }, statistics: { subscriberCount: '123', viewCount: '4567', videoCount: '25' } }] };
    else data = { items: [{ id: 'abcdefghijk', snippet: { title: '<script>Test title</script>' } }] };
    return Response.json(data);
  }, { ttl: 1000, now: () => now });
  const reports = await Promise.all(Array.from({ length: 4 }, () => api.get('channelA', range)));
  assert.equal(calls, 6); const d = reports[0]; assert.equal(d.summary.watchHours, 3); assert.equal(d.summary.netSubscribers, 5); assert.equal(d.summary.averageViewDuration, 90); assert.equal(d.previous.views, 60); assert.equal(d.topVideos[0].title, '<script>Test title</script>');
  assert.equal(d.daily.length, 2); // Missing dates are not invented as zero.
  assert.equal(d.lastReportedDay, range.endDate); assert.ok(urls.filter(u => u.hostname.includes('youtubeanalytics')).every(u => u.searchParams.get('ids') === 'channel==channelA'));
  assert.equal((await api.get('channelA', range)).cached, true); assert.equal(calls, 6);
  now += 1001; await api.get('channelA', range); assert.equal(calls, 12);
  await api.get('channelB', range); assert.equal(calls, 18); api.clear(); await api.get('channelA', range); assert.equal(calls, 24);
});
test('Data API quota failure preserves Analytics; report failures are not fake zeros or cached', async () => {
  let failed = true;
  const api = new YouTubeAnalytics(async url => {
    const u = new URL(url);
    if (failed && u.hostname === 'www.googleapis.com') return Response.json({ error: { errors: [{ reason: 'quotaExceeded' }] } }, { status: 403 });
    if (u.hostname.includes('youtubeanalytics')) return Response.json(report(u.searchParams));
    return Response.json({ items: [] });
  });
  const partial = await api.get('channel', range); assert.equal(partial.summary.views, 120); assert.equal(partial.channel, null); assert.equal(partial.topVideos[0].title, null); assert.equal(partial.warnings.length, 2);
  failed = false; const recovered = await api.get('channel', range); assert.equal(recovered.cached, false); assert.deepEqual(recovered.warnings, []);
  const denied = new YouTubeAnalytics(async () => Response.json({ error: { errors: [{ reason: 'insufficientPermissions' }] } }, { status: 403 }));
  await assert.rejects(denied.get('channel', range), e => e.code === 'authorization_required');
  const empty = new YouTubeAnalytics(async url => { const u = new URL(url); const data = u.hostname.includes('youtubeanalytics') ? report(u.searchParams) : { items: [] }; if (data.rows) data.rows = []; return Response.json(data); });
  const d = await empty.get('channel', range); assert.equal(d.hasData, false); assert.deepEqual(d.daily, []); assert.deepEqual(d.topVideos, []);
});
test('disconnect invalidates a report already in flight', async () => {
  let resolve; const blocked = new Promise(r => resolve = r);
  const api = new YouTubeAnalytics(async url => { await blocked; const u = new URL(url); return Response.json(u.hostname.includes('youtubeanalytics') ? report(u.searchParams) : { items: [] }); });
  const work = api.get('channel', range); api.clear(); resolve(); await assert.rejects(work, e => e.code === 'channel_changed'); assert.equal(api.cache.size, 0);
});

let server, stub, directory, base, cookie, stubBase, captured = [], refreshes = 0;
const secret = 'test-only-analytics-secret', password = 'test-only-password';
function decryptToken(payload) { const key = crypto.createHash('sha256').update(secret).digest(); const d = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(payload.iv, 'base64')); d.setAuthTag(Buffer.from(payload.tag, 'base64')); return JSON.parse(Buffer.concat([d.update(Buffer.from(payload.data, 'base64')), d.final()])); }
async function readToken() { return decryptToken(JSON.parse(await fs.readFile(path.join(directory, 'youtube-token.enc.json'), 'utf8'))); }
async function request(route, { method = 'GET', body, authed = true, extraCookie = '' } = {}) { return fetch(base + route, { method, redirect: 'manual', headers: { 'content-type': 'application/json', ...(authed ? { cookie: cookie + (extraCookie ? '; ' + extraCookie : '') } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) }); }
before(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'yt-analytics-test-'));
  stub = http.createServer(async (req, res) => {
    const u = new URL(req.url, 'http://localhost'); captured.push(u);
    let data, status = 200;
    if (u.pathname === '/token') {
      const chunks = []; for await (const c of req) chunks.push(c); const params = new URLSearchParams(Buffer.concat(chunks).toString()); const code = params.get('code');
      if (params.get('grant_type') === 'refresh_token') { refreshes++; await new Promise(r => setTimeout(r, 30)); }
      data = { access_token: code === 'bad-channel' ? 'bad-channel' : code === 'different-no-refresh' ? 'other' : 'test-access', expires_in: code === 'expired' ? -1 : 3600, scope: code === 'legacy' ? uploadScope : fakeScopes, ...(code?.includes('no-refresh') ? {} : { refresh_token: 'test-refresh' }) };
    } else if (u.pathname.endsWith('/channels')) {
      if (req.headers.authorization === 'Bearer bad-channel') { status = 403; data = { error: { message: 'Test channel unavailable' } }; }
      else data = { items: [{ id: req.headers.authorization === 'Bearer other' ? 'channel-other' : 'channel-test', snippet: { title: 'REFRAME Test' }, statistics: { subscriberCount: '100' } }] };
    } else if (u.pathname === '/v2/reports') data = report(u.searchParams);
    else data = { items: [{ id: 'abcdefghijk', snippet: { title: 'Video from API', channelId: 'channel-test' }, status: { privacyStatus: 'public' } }] };
    res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(data));
  });
  await new Promise(r => stub.listen(0, '127.0.0.1', r)); stubBase = `http://127.0.0.1:${stub.address().port}`;
  const reservation = http.createServer(); await new Promise(r => reservation.listen(0, '127.0.0.1', r)); const port = reservation.address().port; await new Promise(r => reservation.close(r)); base = `http://127.0.0.1:${port}`;
  // Test-only preload redirects Google requests to the local stub. No test switches exist in production code.
  const preload = path.join(directory, 'google-stub.mjs');
  await fs.writeFile(preload, `const actualFetch = globalThis.fetch; globalThis.fetch = (input, options) => { const u = new URL(input); if (['oauth2.googleapis.com','www.googleapis.com','youtubeanalytics.googleapis.com'].includes(u.hostname)) return actualFetch(${JSON.stringify(stubBase)} + u.pathname + u.search, options); return actualFetch(input, options); };`);
  server = spawn(process.execPath, ['--import', preload, 'server.mjs'], { cwd: process.cwd(), env: { ...process.env, PORT: String(port), APP_URL: base, APP_SECRET: secret, ADMIN_PASSWORD: password, DATA_DIR: directory, GOOGLE_CLIENT_ID: 'test-client', GOOGLE_CLIENT_SECRET: 'test-client-secret', WORKER_INTERVAL_MS: '600000' }, stdio: 'ignore' });
  for (let i = 0; i < 100; i++) { try { if ((await fetch(base + '/api/health')).ok) break; } catch {} await new Promise(r => setTimeout(r, 50)); }
  const login = await request('/api/login', { method: 'POST', body: { password }, authed: false }); assert.equal(login.status, 200); cookie = login.headers.get('set-cookie').split(';')[0];
});
after(async () => { server?.kill(); if (server) await new Promise(r => server.exitCode !== null ? r() : server.once('exit', r)); if (stub) await new Promise(r => stub.close(r)); await fs.rm(directory, { recursive: true, force: true }); });
async function connect(code, analytics = true) {
  const start = await request(analytics ? '/auth/google?analytics=1' : '/auth/google');
  const location = new URL(start.headers.get('location')); const state = location.searchParams.get('state'), extraCookie = start.headers.get('set-cookie').split(';')[0];
  return { response: await request('/auth/google/callback?' + new URLSearchParams({ state, code }), { extraCookie }), location };
}
test('authenticated routes and incremental consent; old upload connection remains usable', async () => {
  assert.equal((await request('/api/analytics', { authed: false })).status, 401);
  assert.equal((await request('/api/analytics')).status, 409);
  assert.equal((await request('/api/analytics?days=999')).status, 400);
  const legacy = await connect('legacy', false); assert.equal(legacy.response.status, 302); assert.equal(legacy.location.searchParams.get('scope'), uploadScope);
  const denied = await request('/api/analytics'); assert.equal(denied.status, 403); assert.equal((await denied.json()).code, 'authorization_required');
  const state = await (await request('/api/state')).json(); assert.equal(state.youtubeConnected, true); assert.equal(state.analyticsAuthorized, false); assert.equal(state.access_token, undefined);
  const good = await connect('good'); assert.equal(good.response.status, 302); assert.equal(good.response.headers.get('location'), '/?oauth=ok&view=analytics'); assert.equal(good.location.searchParams.get('scope'), fakeScopes); assert.equal(good.location.searchParams.get('include_granted_scopes'), 'true');
  const api = await request('/api/analytics?days=7'); assert.equal(api.status, 200); assert.equal(api.headers.get('cache-control'), 'no-store'); const d = await api.json(); assert.equal(d.summary.views, 120); assert.equal(d.topVideos[0].title, 'Video from API'); assert.equal(d.connectedChannel.id, 'channel-test'); assert.equal(d.access_token, undefined); assert.equal(d.refresh_token, undefined);
  assert.equal((await request('/analytics.js')).status, 200); assert.equal((await request('/analytics.css')).status, 200);
  assert.equal((await readToken()).refresh_token, 'test-refresh'); assert.ok(!String(await fs.readFile(path.join(directory, 'youtube-token.enc.json'))).includes('test-refresh'));
});
test('failed reconnection and wrong-channel missing refresh token preserve existing credentials', async () => {
  const beforeToken = await fs.readFile(path.join(directory, 'youtube-token.enc.json'), 'utf8');
  assert.equal((await connect('bad-channel')).response.status, 500); assert.equal(await fs.readFile(path.join(directory, 'youtube-token.enc.json'), 'utf8'), beforeToken);
  assert.equal((await connect('different-no-refresh')).response.status, 400); assert.equal(await fs.readFile(path.join(directory, 'youtube-token.enc.json'), 'utf8'), beforeToken);
  assert.equal((await (await request('/api/state')).json()).channel.id, 'channel-test');
});
test('concurrent Analytics/YouTube requests refresh once; disconnect removes access and cached reports', async () => {
  await connect('expired'); refreshes = 0;
  const results = await Promise.all([request('/api/analytics?days=28'), ...Array.from({ length: 4 }, () => request('/api/youtube/related-video?url=abcdefghijk'))]); assert.ok(results.every(r => r.status === 200)); assert.equal(refreshes, 1);
  const scopes = (await readToken()).scope; assert.equal(scopes, fakeScopes);
  assert.equal((await request('/api/youtube/disconnect', { method: 'POST', body: {} })).status, 200); assert.equal((await request('/api/analytics')).status, 409);
  await assert.rejects(fs.readFile(path.join(directory, 'youtube-token.enc.json')), e => e.code === 'ENOENT');
});
