import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { URL } from 'node:url';
import { ContentStore } from './content-store.mjs';
import { RadarStore } from './radar-store.mjs';
import { RADAR_METHOD } from './radar-methodology.mjs';
import { RadarSync } from './radar-sync.mjs';
import {buildRadarDigest} from './radar-digest.mjs';
import {buildIssueReport} from './radar-engine.mjs';
import {explainIssueGrouping} from './radar-grouping.mjs';
import { RadarAIProviders } from './radar-ai.mjs';
import { runAISmoke } from './ai-smoke.mjs';
import { NotesStore } from './notes-store.mjs';
import { ANALYTICS_SCOPES, hasAnalyticsAccess, analyticsRange, analyticsError, reportRows, validateVideoId } from './analytics.mjs';
import { runUploadWorker,legacyJobAction } from './worker-policy.mjs';
import { YouTubeManager } from './youtube-manager.mjs';
import { StudioAnalytics, MONETARY_SCOPE, hasMonetaryAccess } from './studio-analytics.mjs';
import { PostgresStorage } from './postgres-store.mjs';
import { gzipSync } from 'node:zlib';
import { APP_VERSION, RELEASES } from './releases.mjs';

const PORT = Number(process.env.PORT || 3000);
const APP_URL = (process.env.APP_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const APP_SECRET = process.env.APP_SECRET || '';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || '';
const DATA_DIR = process.env.DATA_DIR || path.resolve('data');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
const DB_FILE = path.join(DATA_DIR, 'db.json');
let storage=null;
const contentStore = new ContentStore(path.join(DATA_DIR, 'contents.json'));
const radarStore=new RadarStore(contentStore);
const radarAI=new RadarAIProviders(radarStore);
const radarSync=new RadarSync(radarStore,async url=>{const db=await readDb();if(Date.parse(db.youtubeWorker?.retryAt)>Date.now())throw Object.assign(new Error('Kuota YouTube sedang dibatasi.'),{code:'quota_exceeded'});if(process.env.YOUTUBE_API_KEY){const u=new URL(url);u.searchParams.set('key',process.env.YOUTUBE_API_KEY);return fetch(u,{signal:AbortSignal.timeout(15000)})}return youtubeFetch(url,{signal:AbortSignal.timeout(15000)});});
const notesStore = new NotesStore(path.join(DATA_DIR, 'notes.json'));
const TOKEN_FILE = path.join(DATA_DIR, 'youtube-token.enc.json');
const ANALYTICS_TOKEN_FILE = path.join(DATA_DIR, 'youtube-analytics-token.enc.json');
const PUBLIC_DIR = path.resolve('public');
const WORKER_INTERVAL_MS = Math.max(2000, Number(process.env.WORKER_INTERVAL_MS || 5000));
const YT_CHUNK = Math.max(1, Number(process.env.YOUTUBE_CHUNK_MB || 8)) * 1024 * 1024;
const MAX_BROWSER_CHUNK = 16 * 1024 * 1024;
const YOUTUBE_SCOPE = 'https://www.googleapis.com/auth/youtube.force-ssl';
const analytics = new StudioAnalytics(analyticsFetch, { file:path.join(DATA_DIR,'analytics.json'), monetary:async()=>hasMonetaryAccess(await loadAnalyticsToken()) });
const youtubeManager=new YouTubeManager(youtubeFetch);
let tokenGeneration = 0;
let analyticsTokenGeneration = 0;
const refreshPromises = new Map();

await fsp.mkdir(UPLOAD_DIR, { recursive: true });

function initialDb() {
  return { version: 1, channel: null, jobs: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
}

let dbLoad = null;
async function readDb() {
  if(storage){if(!dbLoad)dbLoad=storage.read('uploads');try{return await dbLoad}catch(e){dbLoad=null;throw e}}
  if (!dbLoad) dbLoad = (async () => {
    try {
      const parsed = JSON.parse(await fsp.readFile(DB_FILE, 'utf8'));
      if (!Array.isArray(parsed.jobs)) throw new Error('Struktur jobs tidak valid');
      return parsed;
    } catch (e) {
      if (e.code !== 'ENOENT') throw Object.assign(new Error('Database gagal dibaca. File asli dipertahankan.'), { status: 503 });
      const db = initialDb(); await writeDb(db); return db;
    }
  })();
  try { return await dbLoad; } catch (e) { dbLoad = null; throw e; }
}

let writeChain = Promise.resolve();
function writeDb(db) {
  db.updatedAt = new Date().toISOString();
  const payload = JSON.stringify(db, null, 2);
  writeChain = writeChain.catch(() => {}).then(async () => {
    if(storage){await storage.write('uploads',JSON.parse(payload));return;}
    const tmp = DB_FILE + '.tmp';
    await fsp.mkdir(path.dirname(DB_FILE), { recursive: true });
    await fsp.writeFile(tmp, payload, 'utf8');
    await fsp.rename(tmp, DB_FILE);
  });
  return writeChain;
}

if(process.env.DATABASE_URL){
  try{
    const candidate=await PostgresStorage.connect(process.env.DATABASE_URL,{backupDir:path.join(DATA_DIR,'backups')});
    await candidate.initialize(async()=>({documents:{uploads:await readDb(),contents:await contentStore.load(),notes:await notesStore.load(),analytics:await analytics.store.load()},files:{uploads:DB_FILE,contents:contentStore.file,notes:notesStore.file,analytics:analytics.store.file}}));
    storage=candidate;contentStore.persistence=storage;notesStore.persistence=storage;analytics.store.persistence=storage;dbLoad=null;
    const status=await storage.status();console.log('Storage:',JSON.stringify({mode:'postgresql',migrationVerified:true,migratedAt:status.migratedAt,backupCount:status.backups.length}));
  }catch(e){console.error('Storage initialization failed. Original files preserved; refusing empty fallback.',e.code||'migration_error');process.exit(1);}
}
const radarBefore=await contentStore.read();
if(radarBefore.radar && radarBefore.radar.clusteringVersion!==RADAR_METHOD.version){
 if(storage)await storage.backup('manual');
 else{const prior=radarBefore.radar.clusteringVersion,backupVersion=Number.isInteger(prior)&&prior>0&&prior<100?prior:1;try{await fsp.copyFile(contentStore.file,path.join(DATA_DIR,'contents.radar-v'+backupVersion+'.backup.json'),fs.constants.COPYFILE_EXCL)}catch(error){if(error.code!=='EEXIST')throw error;}}
 console.log('Radar methodology:',JSON.stringify(await radarStore.recluster()));
}
console.log('Radar status:',JSON.stringify({methodology:RADAR_METHOD.version,...(await radarStore.read()).radarSummary}));
let backupBusy=false;
async function backupTick(){if(!storage||backupBusy)return;backupBusy=true;try{await storage.backup('daily')}catch(e){console.error('Backup:',e.code||'backup_failed')}finally{backupBusy=false}}
setInterval(backupTick,3600000).unref();

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

function normalizeHttpUrl(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  try {
    const u = new URL(raw);
    if (!['http:', 'https:'].includes(u.protocol)) return '';
    return u.toString().slice(0, 2048);
  } catch {
    return '';
  }
}

function extractYouTubeVideoId(value) {
  const raw = String(value ?? '').trim();
  if (/^[A-Za-z0-9_-]{11}$/.test(raw)) return raw;
  try {
    const u = new URL(raw);
    if (u.hostname === 'youtu.be') {
      const id = u.pathname.split('/').filter(Boolean)[0];
      return /^[A-Za-z0-9_-]{11}$/.test(id || '') ? id : '';
    }
    if (u.hostname.endsWith('youtube.com')) {
      const watch = u.searchParams.get('v');
      if (/^[A-Za-z0-9_-]{11}$/.test(watch || '')) return watch;
      const parts = u.pathname.split('/').filter(Boolean);
      if (['shorts','live','embed'].includes(parts[0]) && /^[A-Za-z0-9_-]{11}$/.test(parts[1] || '')) return parts[1];
    }
  } catch {}
  return '';
}

function buildYoutubeDescription(base, relatedUrl) {
  const url = normalizeHttpUrl(relatedUrl);
  const suffix = url ? `\n\nKonten terkait:\n${url}` : '';
  const maxBase = Math.max(0, 5000 - suffix.length);
  return cleanStr(base, maxBase) + suffix;
}

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
let tokenWriteChain = Promise.resolve();
function tokenFile(kind) { return kind === 'analytics' ? ANALYTICS_TOKEN_FILE : TOKEN_FILE; }
function tokenVersion(kind) { return kind === 'analytics' ? analyticsTokenGeneration : tokenGeneration; }
async function saveToken(token, generation, kind = 'upload') {
  generation ??= tokenVersion(kind);
  const payload = JSON.stringify(encrypt(token));
  const work = tokenWriteChain.catch(() => {}).then(async () => {
    if (generation !== tokenVersion(kind)) throw new Error('Koneksi YouTube berubah. Ulangi permintaan.');
    const file = tokenFile(kind), tmp = file + '.tmp';
    await fsp.writeFile(tmp, payload, { mode: 0o600 });
    if (generation !== tokenVersion(kind)) { await fsp.unlink(tmp).catch(() => {}); throw new Error('Koneksi YouTube berubah. Ulangi permintaan.'); }
    await fsp.rename(tmp, file);
  });
  tokenWriteChain = work; return work;
}
async function loadToken(kind = 'upload') {
  try { return decrypt(JSON.parse(await fsp.readFile(tokenFile(kind), 'utf8'))); }
  catch (e) { if (e.code !== 'ENOENT') console.error('Token read/decrypt error', e.message); return null; }
}
async function deleteToken(kind = 'upload') {
  const work = tokenWriteChain.catch(() => {}).then(async () => { try { await fsp.unlink(tokenFile(kind)); } catch (e) { if (e.code !== 'ENOENT') throw e; } });
  tokenWriteChain = work; return work;
}
async function loadAnalyticsToken() {
  const db = await readDb(), separate = await loadToken('analytics');
  if (separate && separate.channel_id === db.channel?.id) return separate;
  // Existing v4.1 combined tokens remain supported without migration or reconnection.
  const upload = await loadToken();
  return hasAnalyticsAccess(upload) ? { ...upload, channel_id: db.channel?.id } : null;
}

async function oauthToken(params) {
  const body = new URLSearchParams(params);
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body, signal: AbortSignal.timeout(20_000)
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`OAuth token gagal (${r.status}): ${data.error_description || data.error || 'unknown error'}`);
  return data;
}
async function getAccessToken(kind = 'upload') {
  const token = kind === 'analytics' ? await loadAnalyticsToken() : await loadToken();
  if (!token?.refresh_token && !token?.access_token) throw new Error('Akun YouTube belum terhubung');
  if (token.access_token && token.expires_at && token.expires_at > Date.now() + 60_000) return token.access_token;
  if (!token.refresh_token) return token.access_token;
  if (refreshPromises.has(kind)) return refreshPromises.get(kind);
  const generation = tokenVersion(kind);
  const work = (async () => {
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
  if (generation !== tokenVersion(kind)) throw new Error('Koneksi YouTube berubah. Ulangi permintaan.');
  await saveToken(merged, generation, kind);
  return merged.access_token;
  })();
  refreshPromises.set(kind, work);
  try { return await work; } finally { if (refreshPromises.get(kind) === work) refreshPromises.delete(kind); }
}
async function youtubeFetch(url, options = {}, retryAuth = true, kind = 'upload') {
  const access = await getAccessToken(kind);
  const headers = new Headers(options.headers || {});
  headers.set('authorization', `Bearer ${access}`);
  const r = await fetch(url, { ...options, headers });
  if (r.status === 401 && retryAuth) {
    const token = kind === 'analytics' ? await loadAnalyticsToken() : await loadToken();
    if (token?.access_token === access) { token.expires_at = 0; await saveToken(token, tokenVersion(kind), kind); }
    return youtubeFetch(url, options, false, kind);
  }
  return r;
}
function analyticsFetch(url, options = {}) { return youtubeFetch(url, options, true, 'analytics'); }
async function validateAnalyticsChannel(accessToken, channelId) {
  const range = analyticsRange(new URLSearchParams('days=7'));
  const params = new URLSearchParams({ ids: `channel==${channelId}`, startDate: range.startDate, endDate: range.endDate, metrics: 'views' });
  const r = await fetch('https://youtubeanalytics.googleapis.com/v2/reports?' + params, { headers: { authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(20_000) });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw analyticsError(r.status, data);
  // Success authorizes this exact existing channel. Empty rows are also valid for channels without activity.
  reportRows(data);
}
async function fetchChannel(accessToken) {
  const url = 'https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true';
  const r = accessToken ? await fetch(url, { headers: { authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(20_000) }) : await youtubeFetch(url);
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

let jobCreateChain = Promise.resolve();
function createJob(body) {
  const work = jobCreateChain.catch(() => {}).then(() => createJobUnlocked(body));
  jobCreateChain = work;
  return work;
}
async function createJobUnlocked(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw Object.assign(new Error('Data upload tidak valid'), { status: 400 });
  let videoFormat=body.videoFormat??'';
  if(!['','long','shorts','live','other'].includes(videoFormat))throw Object.assign(new Error('Kategori video tidak valid'),{status:400});
  const contentId = cleanStr(body.contentId, 100);
  if (contentId) {
    const data = await contentStore.read();
    const content = data.contents.find(c => c.id === contentId);
    if (!content || content.archived) throw Object.assign(new Error('Konten tidak tersedia untuk upload'), { status: 400 });
    if(content.youtubeVideoId)throw Object.assign(new Error('Konten sudah terhubung ke video YouTube. Duplikasikan konten untuk membuat video baru.'),{status:409});
    videoFormat=content.format;
    const db = await readDb();
    if (db.jobs.some(j => j.contentId === contentId && !['cancelled', 'failed'].includes(j.status)))
      throw Object.assign(new Error('Konten ini sudah memiliki antrean upload. Periksa antrean terlebih dahulu.'), { status: 409 });
  }
  const fileName = cleanStr(body.fileName, 255);
  const fileSize = Number(body.fileSize);
  if (!fileName || !Number.isFinite(fileSize) || fileSize <= 0) throw Object.assign(new Error('File video tidak valid'), { status: 400 });
  if (!validSchedule(body.scheduledAt)) throw Object.assign(new Error('Jadwal tayang tidak valid'), { status: 400 });
  const jobId = id();
  const safeExt = path.extname(fileName).slice(0, 12).replace(/[^.a-zA-Z0-9]/g, '') || '.video';
  const job = {
    id: jobId,
    contentId: contentId || null,
    videoFormat,
    channelId:(await readDb()).channel?.id||null,
    order: Number(body.order || Date.now()),
    fileName,
    fileSize,
    mimeType: cleanStr(body.mimeType || 'application/octet-stream', 120),
    title: cleanStr(body.title || fileName.replace(/\.[^.]+$/, ''), 100),
    description: cleanStr(body.description, 5000),
    relatedVideoId: cleanStr(body.relatedVideoId, 32),
    relatedVideoTitle: cleanStr(body.relatedVideoTitle, 200),
    relatedVideoUrl: normalizeHttpUrl(body.relatedVideoUrl),
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
      publishAt: job.scheduledAt,
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
      job.status = 'scheduled_youtube';
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
      job.status = 'scheduled_youtube';
      job.updatedAt = nowIso();
      await writeDb(db);
      await safeDelete(job.filePath);
      return;
    }
  } finally {
    await fh.close();
  }
}

async function fetchYouTubeStatus(videoId) {
  const r = await youtubeFetch(`https://www.googleapis.com/youtube/v3/videos?part=status&id=${encodeURIComponent(videoId)}`);
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error?.message || `Gagal membaca status YouTube (${r.status})`);
  const video = data.items?.[0];
  if (!video) throw new Error('Video YouTube tidak ditemukan');
  return video.status || {};
}

// Migrasi job versi lama: video sudah ter-upload sebagai Private tetapi belum memakai publishAt.
// Setelah fungsi ini berhasil, YouTube Studio akan menampilkannya sebagai Scheduled.
async function scheduleExistingPrivateJob(jobId) {
  let db = await readDb();
  const job = db.jobs.find(x => x.id === jobId);
  if (!job?.youtubeVideoId) throw new Error('Video YouTube belum tersedia');

  const current = await fetchYouTubeStatus(job.youtubeVideoId);
  const action=legacyJobAction(current,job.scheduledAt);
  if(action!=='schedule'){
    // An old quota failure used to downgrade native scheduled jobs to waiting_publish.
    // Respect YouTube's existing visibility and schedule instead of rewriting them.
    job.status=action;job.error=null;job.updatedAt=nowIso();
    if(action==='published')job.publishedAt??=nowIso();
    else if(Number.isFinite(Date.parse(current.publishAt)))job.scheduledAt=current.publishAt;
    await writeDb(db);return;
  }
  const status = {
    privacyStatus: 'private',
    publishAt: job.scheduledAt,
    selfDeclaredMadeForKids: current.selfDeclaredMadeForKids ?? !!job.madeForKids,
    containsSyntheticMedia: current.containsSyntheticMedia ?? !!job.containsSyntheticMedia
  };
  if (typeof current.embeddable === 'boolean') status.embeddable = current.embeddable;
  if (current.license) status.license = current.license;
  if (typeof current.publicStatsViewable === 'boolean') status.publicStatsViewable = current.publicStatsViewable;

  const r = await youtubeFetch('https://www.googleapis.com/youtube/v3/videos?part=status', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id: job.youtubeVideoId, status })
  });
  if (!r.ok) {
    const d = await r.json().catch(() => ({}));
    throw new Error(d.error?.message || `Gagal menjadwalkan video di YouTube (${r.status})`);
  }

  db = await readDb();
  const fresh = db.jobs.find(x => x.id === jobId);
  if (fresh) {
    fresh.status = 'scheduled_youtube';
    fresh.error = null;
    fresh.updatedAt = nowIso();
    await writeDb(db);
  }
}

// Sinkronkan status sesudah waktu tayang agar dashboard berubah menjadi "Tayang".
// Proses publikasinya sendiri dilakukan oleh scheduler native YouTube.
async function syncScheduledJob(jobId) {
  let db = await readDb();
  const job = db.jobs.find(x => x.id === jobId);
  if (!job?.youtubeVideoId) return;
  const status = await fetchYouTubeStatus(job.youtubeVideoId);

  if (status.privacyStatus === 'public') {
    db = await readDb();
    const fresh = db.jobs.find(x => x.id === jobId);
    if (fresh) {
      fresh.status = 'published';
      fresh.publishedAt = nowIso();
      fresh.updatedAt = nowIso();
      await writeDb(db);
    }
  }
}

async function safeDelete(file) { try { await fsp.unlink(file); } catch {} }

let workerBusy=false;
async function workerTick(){
  if(workerBusy)return;workerBusy=true;
  try{await runUploadWorker({readDb,writeDb,upload:uploadJobToYouTube,schedule:scheduleExistingPrivateJob,sync:syncScheduledJob,onError:failure=>console.error('Worker:',failure.code,failure.message)})}
  catch(e){console.error('Worker storage error:',e.message)}finally{workerBusy=false}
}
setInterval(workerTick, WORKER_INTERVAL_MS).unref();
setTimeout(workerTick, 1000).unref();

async function serveStatic(res, pathname) {
  const rel = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  if (!['index.html', 'app.js', 'content.js', 'content.css', 'analytics.js', 'analytics.css', 'base.css', 'ui.css', 'ui.js', 'notes.js', 'board-settings.js', 'video-analytics.js', 'studio.js', 'history.js', 'storage.js', 'features.css', 'rich-text.js', 'rich-text.css', 'updates.js', 'storage.css', 'radar.js', 'radar.css', 'script-format.js', 'writing.css'].includes(rel)) return false;
  try {
    const data = await fsp.readFile(path.join(PUBLIC_DIR, rel));
    const type = rel.endsWith('.js') ? 'text/javascript; charset=utf-8' : rel.endsWith('.css') ? 'text/css; charset=utf-8' : 'text/html; charset=utf-8';
    res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store' });
    res.end(data);
    return true;
  } catch {
    return false;
  }
}

let validationWork=null;
async function verifyAnalytics(){
  if(validationWork)return validationWork;
  validationWork=(async()=>{
    const db=await readDb(),token=await loadAnalyticsToken(),channelId=db.channel?.id;
    if(!channelId||!hasAnalyticsAccess(token))return {channel:'not_authorized',video:'not_checked',revenue:'not_authorized',reach:'not_checked',catalog:'not_checked',errors:[]};
    const generation=tokenGeneration,analyticsGeneration=analytics.generation;
    const result={version:'4.5.0',checkedAt:nowIso(),channel:'not_checked',video:'not_checked',revenue:'not_authorized',errors:[]};
    try{
      const range=analyticsRange(new URLSearchParams({days:'7'})),report=await analytics.get(channelId,range);
      result.channel=report.hasData?'ready':'empty';result.lastReportedDay=report.lastReportedDay;result.revenue=report.revenue?.status==='ready'?'ready':report.revenue?.status==='authorization_required'?'not_authorized':'empty';
      const video=report.topVideos?.[0];if(video){try{const detail=await analytics.getVideo(channelId,video.id,range);result.video=detail.hasData?'ready':'empty';}catch(e){result.video='error';result.errors.push({section:'video',code:e.code||'upstream_error',message:e.message})}}
      result.errors.push(...report.warnings.filter(w=>['daily','revenue'].includes(w.section)));
    }catch(e){result.channel='error';result.errors.push({section:'channel',code:e.code||'upstream_error',message:e.message})}
    const c=await analytics.store.read(channelId);result.catalog=c.catalog.status||'not_checked';result.reach=c.reporting.status||'not_started';if(c.catalog.error)result.errors.push({section:'catalog',...c.catalog.error});if(c.reporting.error)result.errors.push({section:'reach',...c.reporting.error});
    if(generation!==tokenGeneration||analyticsGeneration!==analytics.generation)throw Object.assign(Error('Koneksi channel berubah'),{status:409});
    await analytics.store.mutate(channelId,channel=>{channel.validation=result});
    console.log('Analytics verification:',JSON.stringify({channel:result.channel,video:result.video,lastReportedDay:result.lastReportedDay||null,catalog:result.catalog,reach:result.reach,revenue:result.revenue,errorCodes:result.errors.map(e=>e.code)}));
    return result;
  })().finally(()=>{validationWork=null});return validationWork;
}
let studioSyncBusy=false;
async function studioSyncTick(){
  if(studioSyncBusy)return;studioSyncBusy=true;
  try{
    const db=await readDb();if(!db.channel?.id||!hasAnalyticsAccess(await loadAnalyticsToken()))return;
    const c=await analytics.store.read(db.channel.id);
    if(!c.catalog.lastSync||c.catalog.status==='partial'||Date.now()-Date.parse(c.catalog.lastSync)>86400000)await analytics.syncCatalog(db.channel.id);
    if(!c.dailySync?.lastSync||Date.now()-Date.parse(c.dailySync.lastSync)>6*3600000)await analytics.syncDaily(db.channel.id);
    if((c.reporting.job&&(!c.reporting.lastSync||Date.now()-Date.parse(c.reporting.lastSync)>6*3600000))||(!c.reporting.job&&!c.reporting.lastAttempt))await analytics.syncReach(db.channel.id);
    if(c.validation?.version!=='4.5.0')await verifyAnalytics();
  }catch(e){console.error('Analytics sync:',e.code||e.message)}finally{studioSyncBusy=false}
}
setInterval(studioSyncTick,30*60*1000).unref();setTimeout(studioSyncTick,15000).unref();

if(process.env.RADAR_AUTO_SYNC!=='false'){const tick=()=>radarSync.sync().catch(e=>console.error('Radar sync:',e.message));setInterval(tick,15*60*1000).unref();setTimeout(tick,45000).unref();}

const server = http.createServer(async (req, res) => {
  try {
    const u = new URL(req.url, APP_URL);
    const pathname = u.pathname;

    if (req.method === 'GET' && pathname === '/api/health'){
      if(storage)try{await storage.pool.query('SELECT 1')}catch{return json(res,503,{ok:false,version:APP_VERSION,storage:'postgresql',error:'Penyimpanan belum tersedia'})}
      return json(res, 200, { ok: true, version:APP_VERSION,storage:storage?'postgresql':'json', time: nowIso() });
    }

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

    if(req.method==='GET'&&pathname==='/api/releases')return json(res,200,{currentVersion:APP_VERSION,releases:RELEASES},{'cache-control':'no-store'});
    if(req.method==='GET'&&pathname==='/api/storage')return json(res,200,storage?await storage.status():{mode:'json',ready:true,backups:[]},{'cache-control':'no-store'});
    if(pathname==='/api/analytics/diagnostics'&&req.method==='GET'){const db=await readDb();return json(res,200,db.channel?.id?(await analytics.store.read(db.channel.id)).validation||{channel:'not_checked',video:'not_checked',errors:[]}:{channel:'not_authorized',errors:[]},{'cache-control':'no-store'});}
    if(pathname==='/api/analytics/diagnostics'&&req.method==='POST'){const db=await readDb(),c=db.channel?.id?await analytics.store.read(db.channel.id):null;if(c?.validation?.checkedAt&&Date.now()-Date.parse(c.validation.checkedAt)<60000)return json(res,200,c.validation);if(db.channel?.id&&hasAnalyticsAccess(await loadAnalyticsToken())){analytics.clear();await analytics.syncDaily(db.channel.id,{force:true});await analytics.syncReach(db.channel.id,{force:true});}return json(res,200,await verifyAnalytics(),{'cache-control':'no-store'});}
    if(req.method==='POST'&&pathname==='/api/storage/backups'){
      if(!storage)return json(res,409,{error:'Backup PostgreSQL belum tersedia pada mode JSON.'});
      try{return json(res,201,await storage.backup('manual',{minIntervalMs:60000}),{'cache-control':'no-store'})}
      catch(e){if(e.status===429)return json(res,429,{error:e.message,retryAfter:e.retryAfter},{'retry-after':String(e.retryAfter),'cache-control':'no-store'});throw e}
    }
    const backupMatch=pathname.match(/^\/api\/storage\/backups\/([a-f0-9-]{36})$/);
    if(req.method==='GET'&&backupMatch){
      if(!storage)return json(res,409,{error:'Backup belum tersedia'});const backup=await storage.getBackup(backupMatch[1]),body=gzipSync(JSON.stringify({...backup.bundle,digest:backup.digest}));
      res.writeHead(200,{'content-type':'application/gzip','content-length':body.length,'cache-control':'no-store','content-disposition':`attachment; filename="content-hub-backup-${backup.id}.json.gz"`});res.end(body);return;
    }

    if (req.method === 'GET' && pathname === '/api/state') {
      const db = await readDb();
      const token = await loadToken();
      return json(res, 200, {
        channel: db.channel,
        youtubeConnected: !!token,
        analyticsAuthorized: hasAnalyticsAccess(await loadAnalyticsToken()),
        monetaryAuthorized: hasMonetaryAccess(await loadAnalyticsToken()),
        youtubeWorker:db.youtubeWorker||null,
        jobs: db.jobs.map(publicJob).sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
        redirectUri: `${APP_URL}/auth/google/callback`
      });
    }

    if (pathname === '/api/analytics/sync' && req.method === 'POST') {
      const db=await readDb(),token=await loadAnalyticsToken();
      if(!db.channel?.id||!await loadToken())return json(res,409,{code:'not_connected',error:'Hubungkan YouTube terlebih dahulu.'});
      if(!hasAnalyticsAccess(token))return json(res,403,{code:'authorization_required',error:'Hubungkan Analytics terlebih dahulu.'});
      const body=await readJson(req),generation=tokenGeneration,channelId=db.channel.id;
      if(!['catalog','reach','daily'].includes(body.section))return json(res,400,{error:'Pilih sinkronisasi katalog, Reach, atau statistik harian.'});
      const result=body.section==='catalog'?await analytics.syncCatalog(channelId,{force:true}):body.section==='daily'?await analytics.syncDaily(channelId,{force:true}):await analytics.syncReach(channelId,{force:true});
      if(generation!==tokenGeneration)return json(res,409,{code:'channel_changed',error:'Koneksi channel berubah.'});
      return json(res,200,{section:body.section,...result},{'cache-control':'no-store'});
    }

    if (req.method === 'GET' && pathname === '/api/analytics') {
      const range = analyticsRange(u.searchParams);
      const db = await readDb(), token = await loadAnalyticsToken();
      const uploadToken = await loadToken();
      if (!uploadToken || !db.channel?.id) return json(res, 409, { code: 'not_connected', error: 'Hubungkan akun YouTube terlebih dahulu.' }, { 'cache-control': 'no-store' });
      if (!hasAnalyticsAccess(token)) return json(res, 403, { code: 'authorization_required', error: 'Klik Hubungkan Analytics untuk memberikan izin baca laporan channel.' }, { 'cache-control': 'no-store' });
      const channelId = db.channel.id, generation = tokenGeneration;
      try {
        const report = await analytics.get(channelId, range);
        if (generation !== tokenGeneration) return json(res, 409, { code: 'channel_changed', error: 'Koneksi channel berubah. Muat ulang.' }, { 'cache-control': 'no-store' });
        const jobs = db.jobs.filter(j => j.youtubeVideoId && j.status !== 'cancelled' && (!j.channelId||j.channelId===channelId));
        const productions=(await contentStore.read()).contents;
        return json(res, 200, { ...report, connectedChannel: db.channel, topVideos: report.topVideos?.map(v => {
          const job = jobs.find(j => j.youtubeVideoId === v.id);
          return { ...v, title: v.title || job?.title || 'Judul belum tersedia', contentId: job?.contentId || productions.find(c=>c.youtubeVideoId===v.id)?.id || null };
        }) ?? null }, { 'cache-control': 'no-store' });
      } catch (e) { return json(res, e.status || 502, { code: e.code || 'upstream_error', error: e.message }, { 'cache-control': 'no-store' }); }
    }

    const studioManageMatch=pathname.match(/^\/api\/analytics\/videos\/([A-Za-z0-9_-]{11})\/(details|thumbnail|comments|reply|playlists|production)$/);
    if(studioManageMatch){
      const [,id,action]=studioManageMatch,db=await readDb();
      if(!db.channel?.id||!await loadToken())return json(res,409,{error:'Hubungkan YouTube terlebih dahulu.'});
      const channelId=db.channel.id,generation=tokenGeneration;
      let result;
      if(action==='details'&&req.method==='GET')result=await youtubeManager.details(channelId,id);
      else if(action==='details'&&req.method==='PATCH'){result=await youtubeManager.save(channelId,id,await readJson(req));await analytics.store.mutate(channelId,c=>{if(c.videos[id]){c.videos[id].snippet={...c.videos[id].snippet,...result.snippet};c.videos[id].metadataUpdatedAt=nowIso();c.videos[id].dataUpdatedAt=null}});analytics.cache.clear();}
      else if(action==='thumbnail'&&req.method==='POST'){result=await youtubeManager.thumbnail(channelId,id,await readJson(req,4*1024*1024));await analytics.store.mutate(channelId,c=>{if(c.videos[id])c.videos[id].dataUpdatedAt=null});analytics.cache.clear();}
      else if(action==='comments'&&req.method==='GET')result=await youtubeManager.comments(channelId,id,(u.searchParams.get('pageToken')||'').slice(0,1000));
      else if(action==='reply'&&req.method==='POST')result=await youtubeManager.reply(channelId,id,await readJson(req));
      else if(action==='playlists'&&req.method==='GET')result=await youtubeManager.playlists(channelId,id);
      else if(action==='playlists'&&req.method==='POST')result=await youtubeManager.addPlaylist(channelId,id,await readJson(req));
      else if(action==='production'&&req.method==='POST'){
        const body=await readJson(req),catalog=await analytics.store.read(channelId),video=catalog.videos[id];
        if(video?.snippet?.channelId!==channelId)await youtubeManager.ownVideo(channelId,id);
        const data=await contentStore.read();
        if(body.contentId){const content=data.contents.find(c=>c.id===body.contentId);if(!content)throw Object.assign(Error('Konten tidak ditemukan.'),{status:404});if(content.youtubeVideoId&&content.youtubeVideoId!==id)throw Object.assign(Error('Konten sudah terhubung ke video lain.'),{status:409});result={content:await contentStore.update(content.id,{revision:body.revision,youtubeVideoId:id})};}
        else{const old=data.contents.find(c=>c.youtubeVideoId===id);result={content:old||await contentStore.create({title:body.title,youtubeVideoId:id,format:body.format||'other',pillarId:body.pillarId||''})};}
        analytics.cache.clear();
      } else return json(res,405,{error:'Metode tidak didukung.'});
      if(generation!==tokenGeneration)return json(res,409,{error:'Koneksi channel berubah. Muat ulang.'});
      return json(res,200,result,{'cache-control':'no-store'});
    }

    const videoAnalyticsMatch=pathname.match(/^\/api\/analytics\/videos(?:\/([^/]+))?$/);
    if(req.method==='GET'&&videoAnalyticsMatch){
      const range=analyticsRange(u.searchParams),id=videoAnalyticsMatch[1];if(id)validateVideoId(id);
      const db=await readDb(),token=await loadAnalyticsToken();
      if(!await loadToken()||!db.channel?.id)return json(res,409,{code:'not_connected',error:'Hubungkan akun YouTube terlebih dahulu.'},{'cache-control':'no-store'});
      if(!hasAnalyticsAccess(token))return json(res,403,{code:'authorization_required',error:'Hubungkan Analytics untuk memberikan izin baca.'},{'cache-control':'no-store'});
      const generation=tokenGeneration;
      try{
        const report=id?await analytics.getVideo(db.channel.id,id,range):await analytics.listVideos(db.channel.id,range);
        if(generation!==tokenGeneration)return json(res,409,{code:'channel_changed',error:'Koneksi channel berubah. Muat ulang.'},{'cache-control':'no-store'});
        const jobs=db.jobs.filter(j=>j.youtubeVideoId&&j.status!=='cancelled');const productions=(await contentStore.read()).contents;
        if(id){const job=jobs.find(j=>j.youtubeVideoId===id);return json(res,200,{...report,connectedChannel:db.channel,video:{...report.video,title:report.video.title||job?.title||'Judul belum tersedia',contentId:job?.contentId||productions.find(c=>c.youtubeVideoId===id)?.id||null}},{'cache-control':'no-store'});}
        return json(res,200,{...report,connectedChannel:db.channel,videos:report.videos.map(v=>{const job=jobs.find(j=>j.youtubeVideoId===v.id);return {...v,title:v.title||job?.title||'Judul belum tersedia',contentId:job?.contentId||productions.find(c=>c.youtubeVideoId===v.id)?.id||null}})},{'cache-control':'no-store'});
      }catch(e){return json(res,e.status||502,{code:e.code||'upstream_error',error:e.message},{'cache-control':'no-store'});}
    }
    if(pathname==='/api/radar'&&req.method==='GET')return json(res,200,{...await radarStore.read(),ai:await radarAI.status(u.searchParams.get('aiProvider') || undefined),syncBusy:radarSync.busy});
    if(pathname==='/api/radar/digest'&&req.method==='GET')return json(res,200,buildRadarDigest(await radarStore.read(),{period:u.searchParams.get('period')||'daily',date:u.searchParams.get('date')||undefined,topic:u.searchParams.get('topic')||''}),{'cache-control':'no-store'});
    if(pathname==='/api/radar/sync'&&req.method==='POST')return json(res,200,await radarSync.sync({force:true}));
    if(pathname==='/api/radar/ai/check'&&req.method==='POST')return json(res,200,await radarAI.checkConnection(await readJson(req)));
    if(pathname==='/api/radar/ai/test'&&req.method==='POST')return json(res,200,await radarAI.checkGeneration(await readJson(req)));
    if(pathname==='/api/radar/ai'&&req.method==='POST')return json(res,200,await radarAI.generate(await readJson(req)));
    if(pathname==='/api/radar/sources'&&req.method==='POST'){const body=await readJson(req);return json(res,201,await radarStore.addSources([body],[],body.issueId||null));}
    const summaryMatch=pathname.match(/^\/api\/radar\/issues\/([a-z0-9-]{1,60})\/summary$/);
    if(summaryMatch&&req.method==='GET'){
      const issue=(await radarStore.read()).issues.find(i=>i.id===summaryMatch[1]);
      if(!issue)return json(res,404,{error:'Isu tidak ditemukan.'});
      return json(res,200,buildIssueReport(issue),{'cache-control':'no-store'});
    }
    const groupingMatch=pathname.match(/^\/api\/radar\/issues\/([a-z0-9-]{1,60})\/grouping$/);
    if(groupingMatch&&req.method==='GET'){
      const issue=(await radarStore.read()).issues.find(i=>i.id===groupingMatch[1]);
      if(!issue)return json(res,404,{error:'Isu tidak ditemukan.'});
      return json(res,200,explainIssueGrouping(issue),{'cache-control':'no-store'});
    }
    const radarMatch=pathname.match(/^\/api\/radar\/(topics|feeds|channels|issues)(?:\/([a-z0-9-]{1,60}))?(?:\/(merge|split))?$/);
    if(radarMatch){const [,kind,id,action]=radarMatch;const body=await readJson(req);if(!body||typeof body!=='object'||Array.isArray(body))throw Object.assign(Error('Data Radar tidak valid.'),{status:400});
      if(kind==='topics'&&['POST','PATCH'].includes(req.method)&&!action)return json(res,200,await radarStore.saveTopic(body,id));
      if(kind==='feeds'&&['POST','PATCH'].includes(req.method)&&!action)return json(res,200,await radarStore.saveFeed(body,id));
      if(kind==='channels'&&req.method==='POST'&&!id)return json(res,201,await radarStore.saveChannel(body));
      if(kind==='issues'&&id&&req.method==='PATCH'&&!action)return json(res,200,await radarStore.changeIssue(id,body));
      if(kind==='issues'&&id&&req.method==='POST'&&action==='merge')return json(res,200,await radarStore.merge(id,body));
      if(kind==='issues'&&id&&req.method==='POST'&&action==='split')return json(res,201,await radarStore.split(id,body));
      if(id&&req.method==='DELETE')return json(res,200,kind==='issues'?await radarStore.deleteIssue(id,body):await radarStore.remove(kind,id,body));
    }
    if (req.method === 'GET' && pathname === '/api/contents') {
      const data = await contentStore.read();
      const fields = ['id','title','stage','pillarId','format','priority','owner','deadline','plannedPublishAt','checklist','archived','revision','createdAt','updatedAt','youtubeVideoId'];
      return json(res, 200, {
        pillars: data.pillars, stages: data.columns.map(c=>c.id), columns: data.columns, boardRevision: data.boardRevision,
        contents: data.contents.map(c => ({ ...Object.fromEntries(fields.map(k => [k,c[k]])), scriptLength: c.script.length }))
      });
    }
    if (pathname === '/api/columns' && req.method === 'POST')
      return json(res,201,await contentStore.saveColumn(await readJson(req)));
    if (pathname === '/api/columns/order' && req.method === 'POST')
      return json(res,200,await contentStore.reorderColumns(await readJson(req)));
    const columnMatch=pathname.match(/^\/api\/columns\/([a-z0-9-]{1,60})$/);
    if(columnMatch&&req.method==='PATCH')return json(res,200,await contentStore.saveColumn(await readJson(req),columnMatch[1]));
    if(columnMatch&&req.method==='DELETE')return json(res,200,await contentStore.removeColumn(columnMatch[1],await readJson(req)));
    if(pathname==='/api/notes'&&req.method==='GET'){
      const db=await notesStore.read(),q=(u.searchParams.get('q')||'').slice(0,300).toLocaleLowerCase('id-ID'),kind=u.searchParams.get('kind'),category=u.searchParams.get('category'),format=u.searchParams.get('format'),archived=u.searchParams.get('archived')==='1';
      if(format!==null&&!['','long','shorts'].includes(format))return json(res,400,{error:'Pilih kategori video Long atau Short'});
      const notes=db.notes.filter(n=>n.archived===archived&&(format===null||(n.format||'')===format)&&(!kind||n.kind===kind)&&(category===null||n.category.toLocaleLowerCase('id-ID')===category.toLocaleLowerCase('id-ID'))&&(!q||[n.title,n.body,n.category,...n.tags].join(' ').toLocaleLowerCase('id-ID').includes(q))).sort((a,b)=>Number(b.pinned)-Number(a.pinned)||b.updatedAt.localeCompare(a.updatedAt));
      return json(res,200,{categories:db.categories,categoriesRevision:db.categoriesRevision,notes:notes.map(n=>{const {body,bodyHtml,...rest}=n;return {...rest,format:n.format||'',preview:body.slice(0,280),bodyLength:body.length}})},{'cache-control':'no-store'});
    }
    if(pathname==='/api/note-categories'&&req.method==='POST')return json(res,201,await notesStore.createCategory(await readJson(req)));
    if(pathname==='/api/note-categories'&&['PATCH','DELETE'].includes(req.method))return json(res,200,await notesStore.changeCategory(await readJson(req),req.method==='DELETE'));
    if(pathname==='/api/notes'&&req.method==='POST')return json(res,201,{note:await notesStore.create(await readJson(req,4*1024*1024))});
    const noteMatch=pathname.match(/^\/api\/notes\/([0-9a-f-]{36})$/i);
    if(noteMatch){
      const id=noteMatch[1];
      if(req.method==='GET'){const db=await notesStore.read(),note=db.notes.find(n=>n.id===id);if(!note)return json(res,404,{error:'Catatan tidak ditemukan'});return json(res,200,{note},{'cache-control':'no-store'});}
      if(req.method==='PATCH')return json(res,200,{note:await notesStore.update(id,await readJson(req,4*1024*1024))});
      if(req.method==='DELETE'){const body=await readJson(req);return json(res,200,await notesStore.remove(id,body?.revision));}
    }
    if (req.method === 'POST' && pathname === '/api/contents')
      return json(res, 201, { content: await contentStore.create(await readJson(req,12*1024*1024)) });
    if (req.method === 'POST' && pathname === '/api/pillars')
      return json(res, 200, { pillar: await contentStore.savePillar(await readJson(req)) });
    const contentMatch = pathname.match(/^\/api\/contents\/([0-9a-f-]+)(?:\/(duplicate))?$/i);
    if (contentMatch) {
      const contentId = contentMatch[1];
      if (contentMatch[2] === 'duplicate' && req.method === 'POST')
        return json(res, 201, { content: await contentStore.duplicate(contentId) });
      if (!contentMatch[2] && req.method === 'GET') {
        const data = await contentStore.read();
        const content = data.contents.find(c => c.id === contentId);
        if (!content) return json(res, 404, { error: 'Konten tidak ditemukan' });
        return json(res, 200, { content });
      }
      const linkedJobs = () => readDb().then(db => db.jobs.filter(j => j.contentId === contentId && !['cancelled','failed'].includes(j.status)));
      if (!contentMatch[2] && req.method === 'PATCH') {
        const body = await readJson(req,12*1024*1024);
        const content = await contentStore.update(contentId, body, async (old, next) => {
          if (old.plannedPublishAt !== next.plannedPublishAt && (await linkedJobs()).length)
            throw Object.assign(new Error('Jadwal sudah terhubung ke upload YouTube. Kelola jadwal di YouTube Studio.'), { status: 409 });
        });
        return json(res, 200, { content });
      }
      if (!contentMatch[2] && req.method === 'DELETE') {
        const body = await readJson(req);
        const result = await contentStore.remove(contentId, body?.revision, async () => {
          if ((await linkedJobs()).length) throw Object.assign(new Error('Konten terhubung ke upload YouTube. Gunakan Arsipkan agar riwayat tetap tersedia.'), { status: 409 });
        });
        return json(res, 200, result);
      }
    }

    if (req.method === 'GET' && pathname === '/auth/google') {
      if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET)
        return text(res, 503, 'GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET belum diset.');
      const includeAnalytics = u.searchParams.get('analytics') === '1';
      const monetary = includeAnalytics && u.searchParams.get('monetary') === '1';
      const nonce = (includeAnalytics ? (monetary?'analytics.money.':'analytics.') : '') + crypto.randomBytes(24).toString('base64url');
      const state = `${nonce}.${hmac(nonce)}`;
      const p = new URLSearchParams({
        client_id: GOOGLE_CLIENT_ID,
        redirect_uri: `${APP_URL}/auth/google/callback`,
        response_type: 'code',
        scope: (includeAnalytics ? [...ANALYTICS_SCOPES,...(monetary?[MONETARY_SCOPE]:[])] : [YOUTUBE_SCOPE]).join(' '),
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
      const returnTo = state.startsWith('analytics.') ? '&view=analytics' : '';
      if (u.searchParams.get('error')) return redirect(res, '/?oauth=denied' + returnTo);
      const code = u.searchParams.get('code');
      if (!code) return text(res, 400, 'Authorization code tidak ditemukan.');
      const isAnalytics = state.startsWith('analytics.');
      try {
      const tok = await oauthToken({
        code,
        client_id: GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        redirect_uri: `${APP_URL}/auth/google/callback`,
        grant_type: 'authorization_code'
      });
      tok.expires_at = Date.now() + (tok.expires_in || 3600) * 1000;
      const granted = new Set(String(tok.scope || '').split(/\s+/));
      const db = await readDb();
      if (isAnalytics) {
        if (!db.channel?.id || !await loadToken()) return redirect(res, '/?view=analytics&oauth=not_connected');
        if (state.startsWith('analytics.money.')&&!hasMonetaryAccess(tok)) return redirect(res, '/?view=analytics&oauth=monetary_required');
        if (!hasAnalyticsAccess(tok)) return redirect(res, '/?view=analytics&oauth=authorization_required');
        // Analytics consent never replaces the upload token. Validate ownership via the Analytics API itself.
        await validateAnalyticsChannel(tok.access_token, db.channel.id);
        const previous = await loadAnalyticsToken();
        const previousScopes = new Set(String(previous?.scope || '').split(/\s+/));
        if (!tok.refresh_token && previous?.channel_id === db.channel.id && [...granted].every(s => previousScopes.has(s))) tok.refresh_token = previous?.refresh_token;
        if (!tok.refresh_token) return redirect(res, '/?view=analytics&oauth=offline_required');
        tok.channel_id = db.channel.id;
        analyticsTokenGeneration++; refreshPromises.delete('analytics'); analytics.clear();
        await saveToken(tok, analyticsTokenGeneration, 'analytics');
        return redirect(res, '/?oauth=ok&view=analytics', { 'set-cookie': 'yt_oauth_state=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0' + (APP_URL.startsWith('https://') ? '; Secure' : '') });
      }
      if (!granted.has(YOUTUBE_SCOPE) && !granted.has('https://www.googleapis.com/auth/youtube'))
        return text(res, 400, 'Izin pengelolaan YouTube belum diberikan. Koneksi sebelumnya dipertahankan. Ulangi dan centang izin upload serta Analytics yang diminta.');
      // Validate the newly selected channel before replacing the working encrypted token.
      const channel = await fetchChannel(tok.access_token);
      const previous = await loadToken();
      const previousScopes = new Set(String(previous?.scope || '').split(/\s+/));
      if (!tok.refresh_token && db.channel?.id === channel.id && [...granted].every(s => previousScopes.has(s))) tok.refresh_token = previous?.refresh_token;
      if (!tok.refresh_token) return text(res, 400, 'Google belum memberikan izin akses offline. Koneksi sebelumnya dipertahankan. Ulangi proses Hubungkan YouTube / Analytics.');
      tokenGeneration++; analyticsTokenGeneration++; refreshPromises.clear(); analytics.clear();
      await saveToken(tok);
      if (db.channel?.id !== channel.id) await deleteToken('analytics');
      db.channel = channel;
      await writeDb(db);
      return redirect(res, '/?oauth=ok' + returnTo, { 'set-cookie': 'yt_oauth_state=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0' + (APP_URL.startsWith('https://') ? '; Secure' : '') });
      } catch (e) {
        if (isAnalytics) return redirect(res, '/?view=analytics&oauth=' + encodeURIComponent(e.code || 'connection_failed'));
        throw e;
      }
    }

    if (req.method === 'POST' && pathname === '/api/youtube/disconnect') {
      tokenGeneration++; analyticsTokenGeneration++; refreshPromises.clear(); analytics.clear();
      await deleteToken();
      await deleteToken('analytics');
      const db = await readDb();
      if(db.channel?.id)await analytics.store.remove(db.channel.id);
      db.channel = null;
      await writeDb(db);
      return json(res, 200, { ok: true });
    }

    if (req.method === 'GET' && pathname === '/api/youtube/related-video') {
      const videoId = extractYouTubeVideoId(u.searchParams.get('url') || '');
      if (!videoId) return json(res, 400, { error: 'Link/ID video YouTube tidak valid' });

      const r = await youtubeFetch(`https://www.googleapis.com/youtube/v3/videos?part=snippet,status&id=${encodeURIComponent(videoId)}`);
      const data = await r.json().catch(() => ({}));
      if (!r.ok) return json(res, r.status, { error: data.error?.message || 'Gagal membaca video terkait' });

      const video = data.items?.[0];
      if (!video) return json(res, 404, { error: 'Video terkait tidak ditemukan' });

      const db = await readDb();
      if (db.channel?.id && video.snippet?.channelId !== db.channel.id)
        return json(res, 400, { error: 'Video terkait harus berasal dari channel YouTube yang sama' });

      const privacyStatus = video.status?.privacyStatus || '';
      if (!['public','unlisted'].includes(privacyStatus))
        return json(res, 400, { error: 'Video terkait harus berstatus Public atau Unlisted' });

      return json(res, 200, {
        video: {
          id: videoId,
          title: video.snippet?.title || videoId,
          privacyStatus,
          url: `https://youtu.be/${videoId}`
        }
      });
    }

    if (req.method === 'POST' && pathname === '/api/jobs') {
      const body = await readJson(req);
      const job = await createJob(body);
      return json(res, 201, { job: publicJob(job) });
    }

    const jobFormatMatch=pathname.match(/^\/api\/jobs\/([0-9a-f-]+)\/format$/i);
    if(req.method==='PATCH'&&jobFormatMatch){
      const body=await readJson(req);
      if(!body||!['','long','shorts','live','other'].includes(body.videoFormat)||!['','long','shorts','live','other'].includes(body.previousFormat))return json(res,400,{error:'Kategori video tidak valid'});
      const db=await readDb(),job=db.jobs.find(j=>j.id===jobFormatMatch[1]);
      if(!job)return json(res,404,{error:'Job tidak ditemukan'});
      if(job.contentId)return json(res,409,{error:'Ubah kategori video melalui konten yang terhubung.'});
      if((job.videoFormat||'')!==body.previousFormat)return json(res,409,{error:'Kategori video berubah di tab lain. Tutup lalu buka kembali.'});
      job.videoFormat=body.videoFormat;job.updatedAt=nowIso();await writeDb(db);
      return json(res,200,{job:publicJob(job)});
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
      if (['published', 'scheduled_youtube', 'uploading_youtube'].includes(job.status))
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
  console.log(`YouTube Auto Uploader Content Hub v${APP_VERSION} listening on :${PORT}`);
  console.log(`APP_URL=${APP_URL}`);
  const missing = configMissing();
  if (missing.length) console.warn('Missing env:', missing.join(', '));
  runAISmoke(radarAI,DATA_DIR).catch(()=>console.warn('AI_SMOKE diagnostic stopped.'));
});
