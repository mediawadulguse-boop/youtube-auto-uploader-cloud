import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { URL } from 'node:url';

const PORT = Number(process.env.PORT || 3000);
const APP_URL = (process.env.APP_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const APP_SECRET = process.env.APP_SECRET || '';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || '';
const DATA_DIR = process.env.DATA_DIR || path.resolve('data');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const TOKEN_FILE = path.join(DATA_DIR, 'youtube-token.enc.json');
const PUBLIC_DIR = path.resolve('public');
const WORKER_INTERVAL_MS = Math.max(2000, Number(process.env.WORKER_INTERVAL_MS || 5000));
const YT_CHUNK = Math.max(1, Number(process.env.YOUTUBE_CHUNK_MB || 8)) * 1024 * 1024;
const MAX_BROWSER_CHUNK = 16 * 1024 * 1024;
const YOUTUBE_SCOPE = 'https://www.googleapis.com/auth/youtube.force-ssl';

await fsp.mkdir(UPLOAD_DIR, { recursive: true });

function initialDb() {
  return { version: 1, channel: null, jobs: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
}

async function readDb() {
  try {
    const raw = await fsp.readFile(DB_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed.jobs)) parsed.jobs = [];
    return parsed;
  } catch (e) {
    if (e.code !== 'ENOENT') console.error('DB read error', e);
    const db = initialDb();
    await writeDb(db);
    return db;
  }
}

let writeChain = Promise.resolve();
function writeDb(db) {
  db.updatedAt = new Date().toISOString();
  writeChain = writeChain.then(async () => {
    const tmp = DB_FILE + '.tmp';
    await fsp.mkdir(path.dirname(DB_FILE), { recursive: true });
    await fsp.writeFile(tmp, JSON.stringify(db, null, 2), 'utf8');
    await fsp.rename(tmp, DB_FILE);
  });
  return writeChain;
}

function json(res, status, data, headers = {}) {
  const body = JSON.stringify(data);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(body), ...headers });
  res.end(body);
}
function text(res, status, body, headers = {}) {
  res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8', ...headers });
  res.end(body);
}
function redirect(res, location, headers = {}) {
  res.writeHead(302, { location, ...headers });
  res.end();
}
function parseCookies(req) {
  const out = {};
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}
function hmac(value) {
  return crypto.createHmac('sha256', APP_SECRET).update(value).digest('base64url');
}
function safeEqual(a, b) {
  const A = Buffer.from(String(a)); const B = Buffer.from(String(b));
  return A.length === B.length && crypto.timingSafeEqual(A, B);
}
function sessionValue() {
  const payload = 'admin:v1';
  return `${payload}.${hmac(payload)}`;
}
function isAuthed(req) {
  if (!ADMIN_PASSWORD || !APP_SECRET) return false;
  const c = parseCookies(req).yt_admin;
  return c ? safeEqual(c, sessionValue()) : false;
}
function sessionCookie(value, maxAge = 60 * 60 * 24 * 30) {
  const secure = APP_URL.startsWith('https://') ? '; Secure' : '';
  return `yt_admin=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}
async function readJson(req, max = 1024 * 1024) {
  const chunks = []; let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > max) throw Object.assign(new Error('Payload terlalu besar'), { status: 413 });
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw Object.assign(new Error('JSON tidak valid'), { status: 400 }); }
}
function cleanStr(v, max = 5000) { return String(v ?? '').trim().slice(0, max); }

// YouTube membatasi total snippet.tags hingga 500 karakter.
// Koma pemisah dan tanda kutip implisit untuk tag yang mengandung spasi ikut dihitung.
// Gunakan batas 480 sebagai buffer agar metadata tidak ditolak.
function normalizeYouTubeTags(values) {
  if (!Array.isArray(values)) return [];
  const result = [];
  const seen = new Set();
  let total = 0;

  for (const raw of values) {
    let tag = String(raw ?? '')
      .replace(/[\u0000-\u001F\u007F]/g, ' ')
      .replace(/[",<>]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 100)
      .trim();

    if (!tag) continue;
    const key = tag.toLocaleLowerCase('id-ID');
    if (seen.has(key)) continue;

    const contribution = tag.length + (tag.includes(' ') ? 2 : 0) + (result.length ? 1 : 0);
    if (total + contribution > 480) continue;

    seen.add(key);
    result.push(tag);
    total += contribution;
  }
  return result;
}

function id() { return crypto.randomUUID(); }
function nowIso() { return new Date().toISOString(); }
function publicJob(j) {
  const { filePath, uploadSessionUrl, ...safe } = j;
  return safe;
}
function configMissing() {
  return [
    !APP_SECRET && 'APP_SECRET',
    !ADMIN_PASSWORD && 'ADMIN_PASSWORD',
    !GOOGLE_CLIENT_ID && 'GOOGLE_CLIENT_ID',
    !GOOGLE_CLIENT_SECRET && 'GOOGLE_CLIENT_SECRET'
  ].filter(Boolean);
}

function deriveKey() { return crypto.createHash('sha256').update(APP_SECRET).digest(); }
function encrypt(obj) {
  const iv = crypto.randomBytes(12); const key = deriveKey();
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(obj), 'utf8'), cipher.final()]);
  return { v: 1, iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: ciphertext.toString('base64') };
}
function decrypt(payload) {
  const key = deriveKey(); const iv = Buffer.from(payload.iv, 'base64');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(Buffer.from(payload.tag, 'base64'));
  return JSON.parse(Buffer.concat([decipher.update(Buffer.from(payload.data, 'base64')), decipher.final()]).toString('utf8'));
}
async function saveToken(token) { await fsp.writeFile(TOKEN_FILE, JSON.stringify(encrypt(token)), { mode: 0o600 }); }
async function loadToken() {
  try { return decrypt(JSON.parse(await fsp.readFile(TOKEN_FILE, 'utf8'))); }
  catch (e) { if (e.code !== 'ENOENT') console.error('Token read/decrypt error', e.message); return null; }
}
async function deleteToken() { try { await fsp.unlink(TOKEN_FILE); } catch {} }

async function oauthToken(params) {
  const body = new URLSearchParams(params);
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`OAuth token gagal (${r.status}): ${data.error_description || data.error || 'unknown error'}`);
  return data;
}
async function getAccessToken() {
  const token = await loadToken();
  if (!token?.refresh_token && !token?.access_token) throw new Error('Akun YouTube belum terhubung');
  if (token.access_token && token.expires_at && token.expires_at > Date.now() + 60_000) return token.access_token;
  if (!token.refresh_token) return token.access_token;
  const fresh = await oauthToken({
    client_id: GOOGLE_CLIENT_ID,
    client_secret: GOOGLE_CLIENT_SECRET,
    refresh_token: token.refresh_token,
    grant_type: 'refresh_token'
  });
  const merged = {
    ...token, ...fresh,
    refresh_token: fresh.refresh_token || token.refresh_token,
    expires_at: Date.now() + (fresh.expires_in || 3600) * 1000
  };
  await saveToken(merged);
  return merged.access_token;
}
async function youtubeFetch(url, options = {}, retryAuth = true) {
  const access = await getAccessToken();
  const headers = new Headers(options.headers || {});
  headers.set('authorization', `Bearer ${access}`);
  const r = await fetch(url, { ...options, headers });
  if (r.status === 401 && retryAuth) {
    const token = await loadToken();
    if (token) { token.expires_at = 0; await saveToken(token); }
    return youtubeFetch(url, options, false);
  }
  return r;
}
async function fetchChannel() {
  const r = await youtubeFetch('https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true');
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error?.message || `Gagal membaca channel (${r.status})`);
  const c = data.items?.[0];
  if (!c) throw new Error('Akun Google ini tidak memiliki channel YouTube yang dapat diakses');
  return { id: c.id, title: c.snippet?.title || 'YouTube Channel', thumbnail: c.snippet?.thumbnails?.default?.url || null };
}

function validSchedule(value) {
  const d = new Date(value);
  return Number.isFinite(d.getTime()) && d.getTime() > Date.now() - 5 * 60_000;
}

async function createJob(body) {
  const fileName = cleanStr(body.fileName, 255);
  const fileSize = Number(body.fileSize);
  if (!fileName || !Number.isFinite(fileSize) || fileSize <= 0) throw Object.assign(new Error('File video tidak valid'), { status: 400 });
  if (!validSchedule(body.scheduledAt)) throw Object.assign(new Error('Jadwal tayang tidak valid'), { status: 400 });
  const jobId = id();
  const safeExt = path.extname(fileName).slice(0, 12).replace(/[^.a-zA-Z0-9]/g, '') || '.video';
  const job = {
    id: jobId,
    order: Number(body.order || Date.now()),
    fileName,
    fileSize,
    mimeType: cleanStr(body.mimeType || 'application/octet-stream', 120),
    title: cleanStr(body.title || fileName.replace(/\.[^.]+$/, ''), 100),
    description: cleanStr(body.description, 5000),
    tags: normalizeYouTubeTags(body.tags),
    categoryId: cleanStr(body.categoryId || '22', 10),
    madeForKids: Boolean(body.madeForKids),
    containsSyntheticMedia: Boolean(body.containsSyntheticMedia),
    scheduledAt: new Date(body.scheduledAt).toISOString(),
    status: 'receiving',
    filePath: path.join(UPLOAD_DIR, `${jobId}${safeExt}`),
    receivedBytes: 0,
    youtubeVideoId: null,
    youtubeUploadOffset: 0,
    uploadSessionUrl: null,
    attempts: 0,
    error: null,
    createdAt: nowIso(),
    updatedAt: nowIso(),
    publishedAt: null
  };
  await fsp.writeFile(job.filePath, '');
  const db = await readDb();
  db.jobs.push(job);
  await writeDb(db);
  return job;
}

async function appendChunk(req, job, offset) {
  if (offset !== job.receivedBytes) throw Object.assign(new Error(`Offset salah. Server menunggu ${job.receivedBytes}`), { status: 409 });
  const contentLength = Number(req.headers['content-length'] || 0);
  if (!contentLength || contentLength > MAX_BROWSER_CHUNK) throw Object.assign(new Error('Ukuran chunk tidak valid'), { status: 413 });
  if (job.receivedBytes + contentLength > job.fileSize) throw Object.assign(new Error('Data melebihi ukuran file'), { status: 400 });
  await new Promise((resolve, reject) => {
    const stream = fs.createWriteStream(job.filePath, { flags: 'r+', start: offset });
    req.pipe(stream);
    req.on('error', reject);
    stream.on('error', reject);
    stream.on('finish', resolve);
  });
  const db = await readDb();
  const current = db.jobs.find(x => x.id === job.id);
  if (!current) throw Object.assign(new Error('Job tidak ditemukan'), { status: 404 });
  current.receivedBytes += contentLength;
  current.updatedAt = nowIso();
  if (current.receivedBytes === current.fileSize) current.status = 'queued_upload';
  await writeDb(db);
  return current;
}

async function startYouTubeSession(job) {
  const metadata = {
    snippet: {
      title: cleanStr(job.title, 100),
      description: cleanStr(job.description, 5000),
      categoryId: cleanStr(job.categoryId || '22', 10)
    },
    status: {
      privacyStatus: 'private',
      selfDeclaredMadeForKids: !!job.madeForKids,
      containsSyntheticMedia: !!job.containsSyntheticMedia
    }
  };

  const safeTags = normalizeYouTubeTags(job.tags);
  if (safeTags.length) metadata.snippet.tags = safeTags;

  const requestSession = async payload => {
    const r = await youtubeFetch('https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status', {
      method: 'POST',
      headers: {
        'content-type': 'application/json; charset=UTF-8',
        'x-upload-content-length': String(job.fileSize),
        'x-upload-content-type': job.mimeType || 'application/octet-stream'
      },
      body: JSON.stringify(payload)
    });
    if (r.ok) return r;

    const d = await r.json().catch(() => ({}));
    const reasons = Array.isArray(d.error?.errors) ? d.error.errors.map(x => x.reason) : [];

    // Fallback defensif: jika YouTube tetap menolak keyword,
    // buat sesi tanpa tags agar video tidak gagal hanya karena metadata tag.
    if (reasons.includes('invalidTags') && payload.snippet.tags) {
      const withoutTags = {
        ...payload,
        snippet: { ...payload.snippet }
      };
      delete withoutTags.snippet.tags;
      const retry = await youtubeFetch('https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status', {
        method: 'POST',
        headers: {
          'content-type': 'application/json; charset=UTF-8',
          'x-upload-content-length': String(job.fileSize),
          'x-upload-content-type': job.mimeType || 'application/octet-stream'
        },
        body: JSON.stringify(withoutTags)
      });
      if (retry.ok) return retry;
      const rd = await retry.json().catch(() => ({}));
      throw new Error(rd.error?.message || `Gagal membuat sesi upload YouTube (${retry.status})`);
    }

    throw new Error(d.error?.message || `Gagal membuat sesi upload YouTube (${r.status})`);
  };

  const r = await requestSession(metadata);
  const location = r.headers.get('location');
  if (!location) throw new Error('YouTube tidak mengembalikan resumable upload URL');
  return location;
}

async function queryYouTubeOffset(job) {
  if (!job.uploadSessionUrl) return 0;
  const access = await getAccessToken();
  const r = await fetch(job.uploadSessionUrl, {
    method: 'PUT',
    headers: {
      authorization: `Bearer ${access}`,
      'content-length': '0',
      'content-range': `bytes */${job.fileSize}`
    }
  });
  if (r.status === 308) {
    const range = r.headers.get('range');
    if (!range) return 0;
    const m = range.match(/bytes=0-(\d+)/);
    return m ? Number(m[1]) + 1 : 0;
  }
  if (r.ok) {
    const d = await r.json().catch(() => ({}));
    return { done: true, videoId: d.id };
  }
  return 0;
}

async function uploadJobToYouTube(jobId) {
  let db = await readDb();
  let job = db.jobs.find(x => x.id === jobId);
  if (!job) return;
  if (!(await loadToken())) throw new Error('YouTube belum terhubung');

  job.status = 'uploading_youtube';
  job.error = null;
  job.attempts = (job.attempts || 0) + 1;
  job.updatedAt = nowIso();
  await writeDb(db);

  if (!job.uploadSessionUrl) {
    const session = await startYouTubeSession(job);
    db = await readDb();
    job = db.jobs.find(x => x.id === jobId);
    job.uploadSessionUrl = session;
    job.youtubeUploadOffset = 0;
    await writeDb(db);
  } else {
    const q = await queryYouTubeOffset(job);
    if (typeof q === 'object' && q.done) {
      db = await readDb();
      job = db.jobs.find(x => x.id === jobId);
      job.youtubeVideoId = q.videoId;
      job.status = 'waiting_publish';
      job.youtubeUploadOffset = job.fileSize;
      job.updatedAt = nowIso();
      await writeDb(db);
      await safeDelete(job.filePath);
      return;
    }
    db = await readDb();
    job = db.jobs.find(x => x.id === jobId);
    job.youtubeUploadOffset = Number(q || job.youtubeUploadOffset || 0);
    await writeDb(db);
  }

  const fh = await fsp.open(job.filePath, 'r');
  try {
    let offset = job.youtubeUploadOffset || 0;
    while (offset < job.fileSize) {
      const length = Math.min(YT_CHUNK, job.fileSize - offset);
      const buffer = Buffer.allocUnsafe(length);
      const { bytesRead } = await fh.read(buffer, 0, length, offset);
      if (!bytesRead) throw new Error('Gagal membaca file video');
      const end = offset + bytesRead - 1;
      let r, lastErr;
      for (let attempt = 0; attempt < 5; attempt++) {
        try {
          const access = await getAccessToken();
          r = await fetch(job.uploadSessionUrl, {
            method: 'PUT',
            headers: {
              authorization: `Bearer ${access}`,
              'content-type': job.mimeType || 'application/octet-stream',
              'content-length': String(bytesRead),
              'content-range': `bytes ${offset}-${end}/${job.fileSize}`
            },
            body: buffer.subarray(0, bytesRead)
          });
          if (r.status === 308 || r.ok) break;
          if (![429, 500, 502, 503, 504].includes(r.status)) break;
          lastErr = new Error(`YouTube sementara gagal (${r.status})`);
        } catch (e) {
          lastErr = e;
        }
        await new Promise(resolve => setTimeout(resolve, Math.min(30_000, 1000 * 2 ** attempt)));
      }
      if (!r) throw lastErr || new Error('Upload YouTube gagal');
      if (r.status === 308) {
        const range = r.headers.get('range');
        const m = range?.match(/bytes=0-(\d+)/);
        offset = m ? Number(m[1]) + 1 : end + 1;
        db = await readDb();
        job = db.jobs.find(x => x.id === jobId);
        job.youtubeUploadOffset = offset;
        job.updatedAt = nowIso();
        await writeDb(db);
        continue;
      }
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        throw new Error(d.error?.message || `Upload YouTube gagal (${r.status})`);
      }
      const data = await r.json().catch(() => ({}));
      db = await readDb();
      job = db.jobs.find(x => x.id === jobId);
      job.youtubeVideoId = data.id;
      job.youtubeUploadOffset = job.fileSize;
      job.status = 'waiting_publish';
      job.updatedAt = nowIso();
      await writeDb(db);
      await safeDelete(job.filePath);
      return;
    }
  } finally {
    await fh.close();
  }
}

async function publishJob(jobId) {
  let db = await readDb();
  const job = db.jobs.find(x => x.id === jobId);
  if (!job?.youtubeVideoId) throw new Error('Video YouTube belum tersedia');
  job.status = 'publishing';
  job.error = null;
  job.updatedAt = nowIso();
  await writeDb(db);

  const body = {
    id: job.youtubeVideoId,
    status: {
      privacyStatus: 'public',
      selfDeclaredMadeForKids: !!job.madeForKids,
      containsSyntheticMedia: !!job.containsSyntheticMedia
    }
  };
  const r = await youtubeFetch('https://www.googleapis.com/youtube/v3/videos?part=status', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!r.ok) {
    const d = await r.json().catch(() => ({}));
    throw new Error(d.error?.message || `Gagal mempublikasikan video (${r.status})`);
  }
  db = await readDb();
  const fresh = db.jobs.find(x => x.id === jobId);
  fresh.status = 'published';
  fresh.publishedAt = nowIso();
  fresh.updatedAt = nowIso();
  await writeDb(db);
}
async function safeDelete(file) { try { await fsp.unlink(file); } catch {} }

let workerBusy = false;
async function workerTick() {
  if (workerBusy) return;
  workerBusy = true;
  try {
    const db = await readDb();
    const publishable = db.jobs
      .filter(j => j.status === 'waiting_publish' && new Date(j.scheduledAt).getTime() <= Date.now())
      .sort((a, b) => new Date(a.scheduledAt) - new Date(b.scheduledAt))[0];
    if (publishable) {
      await publishJob(publishable.id);
      return;
    }
    const uploadable = db.jobs
      .filter(j => ['queued_upload', 'uploading_youtube'].includes(j.status) && j.receivedBytes === j.fileSize)
      .sort((a, b) => a.order - b.order)[0];
    if (uploadable) {
      await uploadJobToYouTube(uploadable.id);
      return;
    }
  } catch (e) {
    console.error('Worker error:', e.message);
    const db = await readDb();
    const current = db.jobs.find(j => ['uploading_youtube', 'publishing'].includes(j.status));
    if (current) {
      current.status = current.youtubeVideoId ? 'waiting_publish' : 'failed';
      current.error = e.message;
      current.updatedAt = nowIso();
      await writeDb(db);
    }
  } finally {
    workerBusy = false;
  }
}
setInterval(workerTick, WORKER_INTERVAL_MS).unref();
setTimeout(workerTick, 1000).unref();

async function serveStatic(res, pathname) {
  const rel = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  if (!['index.html', 'app.js'].includes(rel)) return false;
  try {
    const data = await fsp.readFile(path.join(PUBLIC_DIR, rel));
    const type = rel.endsWith('.js') ? 'text/javascript; charset=utf-8' : 'text/html; charset=utf-8';
    res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store' });
    res.end(data);
    return true;
  } catch {
    return false;
  }
}

const server = http.createServer(async (req, res) => {
  try {
    const u = new URL(req.url, APP_URL);
    const pathname = u.pathname;

    if (req.method === 'GET' && pathname === '/api/health')
      return json(res, 200, { ok: true, version: '3.0.0', time: nowIso() });

    if (req.method === 'GET' && pathname === '/api/session')
      return json(res, 200, { authenticated: isAuthed(req), configMissing: configMissing(), appUrl: APP_URL });

    if (req.method === 'POST' && pathname === '/api/login') {
      const body = await readJson(req);
      if (!ADMIN_PASSWORD || !APP_SECRET)
        return json(res, 503, { error: 'ADMIN_PASSWORD / APP_SECRET belum dikonfigurasi di cloud' });
      if (!safeEqual(body.password || '', ADMIN_PASSWORD))
        return json(res, 401, { error: 'Password salah' });
      return json(res, 200, { ok: true }, { 'set-cookie': sessionCookie(sessionValue()) });
    }

    if (req.method === 'POST' && pathname === '/api/logout')
      return json(res, 200, { ok: true }, { 'set-cookie': sessionCookie('', 0) });

    const isOAuthCallback = pathname === '/auth/google/callback';
    if ((pathname.startsWith('/api/') || (pathname.startsWith('/auth/') && !isOAuthCallback)) && !isAuthed(req))
      return json(res, 401, { error: 'Silakan login' });

    if (req.method === 'GET' && pathname === '/api/state') {
      const db = await readDb();
      const token = await loadToken();
      return json(res, 200, {
        channel: db.channel,
        youtubeConnected: !!token,
        jobs: db.jobs.map(publicJob).sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
        redirectUri: `${APP_URL}/auth/google/callback`
      });
    }

    if (req.method === 'GET' && pathname === '/auth/google') {
      if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET)
        return text(res, 503, 'GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET belum diset.');
      const nonce = crypto.randomBytes(24).toString('base64url');
      const state = `${nonce}.${hmac(nonce)}`;
      const p = new URLSearchParams({
        client_id: GOOGLE_CLIENT_ID,
        redirect_uri: `${APP_URL}/auth/google/callback`,
        response_type: 'code',
        scope: YOUTUBE_SCOPE,
        access_type: 'offline',
        prompt: 'consent',
        include_granted_scopes: 'true',
        state
      });
      const secure = APP_URL.startsWith('https://') ? '; Secure' : '';
      return redirect(res, `https://accounts.google.com/o/oauth2/v2/auth?${p}`, {
        'set-cookie': `yt_oauth_state=${encodeURIComponent(state)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=600${secure}`
      });
    }

    if (req.method === 'GET' && pathname === '/auth/google/callback') {
      const state = u.searchParams.get('state') || '';
      const expected = parseCookies(req).yt_oauth_state || '';
      if (!state || !safeEqual(state, expected))
        return text(res, 400, 'OAuth state tidak valid. Ulangi proses koneksi.');
      if (u.searchParams.get('error')) return redirect(res, '/?oauth=denied');
      const code = u.searchParams.get('code');
      if (!code) return text(res, 400, 'Authorization code tidak ditemukan.');
      const tok = await oauthToken({
        code,
        client_id: GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        redirect_uri: `${APP_URL}/auth/google/callback`,
        grant_type: 'authorization_code'
      });
      tok.expires_at = Date.now() + (tok.expires_in || 3600) * 1000;
      await saveToken(tok);
      const channel = await fetchChannel();
      const db = await readDb();
      db.channel = channel;
      await writeDb(db);
      return redirect(res, '/?oauth=ok');
    }

    if (req.method === 'POST' && pathname === '/api/youtube/disconnect') {
      await deleteToken();
      const db = await readDb();
      db.channel = null;
      await writeDb(db);
      return json(res, 200, { ok: true });
    }

    if (req.method === 'POST' && pathname === '/api/jobs') {
      const body = await readJson(req);
      const job = await createJob(body);
      return json(res, 201, { job: publicJob(job) });
    }

    const chunkMatch = pathname.match(/^\/api\/jobs\/([0-9a-f-]+)\/chunk$/i);
    if (req.method === 'PUT' && chunkMatch) {
      const db = await readDb();
      const job = db.jobs.find(x => x.id === chunkMatch[1]);
      if (!job) return json(res, 404, { error: 'Job tidak ditemukan' });
      if (job.status !== 'receiving') return json(res, 409, { error: 'Job tidak sedang menerima file' });
      const offset = Number(req.headers['x-upload-offset']);
      if (!Number.isFinite(offset)) return json(res, 400, { error: 'X-Upload-Offset wajib diisi' });
      const updated = await appendChunk(req, job, offset);
      return json(res, 200, { job: publicJob(updated) });
    }

    const retryMatch = pathname.match(/^\/api\/jobs\/([0-9a-f-]+)\/retry$/i);
    if (req.method === 'POST' && retryMatch) {
      const db = await readDb();
      const job = db.jobs.find(x => x.id === retryMatch[1]);
      if (!job) return json(res, 404, { error: 'Job tidak ditemukan' });
      if (job.status === 'failed' && job.receivedBytes === job.fileSize) {
        job.status = job.youtubeVideoId ? 'waiting_publish' : 'queued_upload';
        job.error = null;
        job.updatedAt = nowIso();
        await writeDb(db);
        return json(res, 200, { ok: true });
      }
      return json(res, 409, { error: 'Job tidak bisa di-retry pada status ini' });
    }

    const cancelMatch = pathname.match(/^\/api\/jobs\/([0-9a-f-]+)\/cancel$/i);
    if (req.method === 'POST' && cancelMatch) {
      const db = await readDb();
      const job = db.jobs.find(x => x.id === cancelMatch[1]);
      if (!job) return json(res, 404, { error: 'Job tidak ditemukan' });
      if (['published', 'publishing', 'uploading_youtube'].includes(job.status))
        return json(res, 409, { error: 'Job sedang/selesai diproses dan tidak dapat dibatalkan' });
      job.status = 'cancelled';
      job.updatedAt = nowIso();
      await writeDb(db);
      await safeDelete(job.filePath);
      return json(res, 200, { ok: true });
    }

    if (await serveStatic(res, pathname)) return;
    return text(res, 404, 'Not found');
  } catch (e) {
    console.error('Request error:', e);
    if (!res.headersSent) json(res, e.status || 500, { error: e.message || 'Internal server error' });
    else res.destroy();
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`YouTube Auto Uploader Cloud v3.0 listening on :${PORT}`);
  console.log(`APP_URL=${APP_URL}`);
  const missing = configMissing();
  if (missing.length) console.warn('Missing env:', missing.join(', '));
});
