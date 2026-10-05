import crypto from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {checksum} from './postgres-store.mjs';
export const DRIVE_SCOPE='https://www.googleapis.com/auth/drive.file';
const API='https://www.googleapis.com/drive/v3';
const FIELDS='id,name,size,md5Checksum,webViewLink,parents,trashed';
export class DriveBackup {
 constructor({snapshot,loadToken,getAccessToken,readState,saveState,fetch:request=fetch,now=Date.now}){Object.assign(this,{snapshot,loadToken,getAccessToken,readState,saveState,request,now});this.busy=false;this.error=null;}
 async status(){const token=await this.loadToken(),state=await this.readState();return {...state,connected:!!token&&!token.reconnectRequired,busy:this.busy,error:this.error||state.error||null};}
 async call(url,options={}){const access=await this.getAccessToken();const response=await this.request(url,{...options,redirect:'error',signal:AbortSignal.timeout(60000),headers:{...options.headers,authorization:'Bearer '+access}});if(!response.ok)throw Object.assign(Error(response.status===401||response.status===403?'Izin Google Drive belum tersedia. Hubungkan ulang Drive dan pastikan API Drive aktif.':'Backup Drive belum berhasil (HTTP '+response.status+').'),{status:503,code:'drive_unavailable'});return response;}
 async folder(state){if(state.folderId){const item=await this.call(API+'/files/'+encodeURIComponent(state.folderId)+'?fields=id,mimeType,trashed').then(r=>r.json());if(item.trashed||item.mimeType!=='application/vnd.google-apps.folder')throw Error('Folder backup Drive tidak tersedia.');return state.folderId;}
  const q="trashed = false and mimeType = 'application/vnd.google-apps.folder' and appProperties has { key='contentHubBackup' and value='folder' }";
  const found=await this.call(API+'/files?'+new URLSearchParams({q,fields:'files(id)',pageSize:'1'})).then(r=>r.json());const folder=found.files?.[0]||await this.call(API+'/files?fields=id',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name:'Reframe Content Hub Backups — Otomatis',mimeType:'application/vnd.google-apps.folder',appProperties:{contentHubBackup:'folder'}})}).then(r=>r.json());if(!folder.id)throw Error('Folder Drive belum berhasil dibuat.');await this.saveState({folderId:folder.id});return folder.id;
 }
 async run({force=false}={}) {
  if(this.busy)throw Object.assign(Error('Backup Drive sedang berjalan.'),{status:409});this.busy=true;
  try {const token=await this.loadToken();if(!token||token.reconnectRequired)throw Object.assign(Error('Hubungkan Google Drive di Data & Backup. Pembersihan Radar ditunda sampai backup Drive terverifikasi.'),{status:409});
   const state=await this.readState();if(force&&this.now()-Date.parse(state.lastAttemptAt||'')<60000)throw Object.assign(Error('Tunggu satu menit sebelum backup Drive berikutnya.'),{status:429});
   if(!force&&state.lastVerifiedAt&&new Date(this.now()).toISOString().slice(0,10)===state.lastVerifiedAt.slice(0,10))return {...state,skipped:true};
   await this.saveState({lastAttemptAt:new Date(this.now()).toISOString()});
   const {bundle,digest}=await this.snapshot();if(checksum(bundle)!==digest)throw Error('Checksum snapshot tidak cocok.');
   const body=gzipSync(JSON.stringify({...bundle,digest})),md5=crypto.createHash('md5').update(body).digest('hex'),folderId=await this.folder(state);
   const q="trashed = false and '"+folderId+"' in parents and appProperties has { key='snapshotDigest' and value='"+digest+"' }";
   const existing=await this.call(API+'/files?'+new URLSearchParams({q,fields:'files('+FIELDS+')',pageSize:'1'})).then(r=>r.json());let file=existing.files?.[0];
   if(!file){const metadata={name:'content-hub-'+bundle.createdAt.replace(/[:.]/g,'-')+'.json.gz',parents:[folderId],mimeType:'application/gzip',appProperties:{snapshotDigest:digest}};
    const session=await this.call('https://www.googleapis.com/upload/drive/v3/files?'+new URLSearchParams({uploadType:'resumable',fields:FIELDS}),{method:'POST',headers:{'content-type':'application/json','x-upload-content-type':'application/gzip','x-upload-content-length':String(body.length)},body:JSON.stringify(metadata)});
    const location=new URL(session.headers.get('location'));if(location.protocol!=='https:'||location.hostname!=='www.googleapis.com'||!location.pathname.startsWith('/upload/drive/'))throw Error('Alamat unggah Drive tidak valid.');
    file=await this.call(location.href,{method:'PUT',headers:{'content-type':'application/gzip','content-length':String(body.length)},body}).then(r=>r.json());
   }
   if(!file?.id)throw Error('File backup Drive belum tersedia.');
   const verified=await this.call(API+'/files/'+encodeURIComponent(file.id)+'?'+new URLSearchParams({fields:FIELDS})).then(r=>r.json());
   if(verified.trashed||Number(verified.size)!==body.length||verified.md5Checksum!==md5||!verified.parents?.includes(folderId))throw Error('Verifikasi ukuran/checksum backup Drive gagal. Pembersihan Radar ditunda.');
   const receipt={folderId,fileId:verified.id,fileName:verified.name,fileUrl:'https://drive.google.com/file/d/'+encodeURIComponent(verified.id)+'/view',digest,bytes:body.length,lastVerifiedAt:new Date(this.now()).toISOString(),error:null};await this.saveState(receipt);this.error=null;return receipt;
  } catch(error){this.error=error.status===429||error.status===409?error.message:error.code==='drive_unavailable'?error.message:'Backup Drive belum terverifikasi. Periksa koneksi dan coba lagi; data Radar dipertahankan.';if(error.status!==429)await this.saveState({error:this.error}).catch(()=>{});throw Object.assign(Error(this.error),{status:error.status||503});}finally{this.busy=false;}
 }
}
