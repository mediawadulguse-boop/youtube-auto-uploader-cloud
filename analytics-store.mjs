import fs from 'node:fs/promises';
import path from 'node:path';

const initial = () => ({version:1,channels:{}});
export const newChannel = () => ({videos:{},catalog:{},reporting:{},reach:{}});

// One instance, serialized atomic writes; independent of production scripts and Notes.
export class AnalyticsStore {
  constructor(file) { this.file=file;this.chain=Promise.resolve();this.loaded=null; }
  async load() {
    if(this.persistence)return this.persistence.read('analytics');
    if (!this.loaded) this.loaded=(async()=>{
      try {
        const db=JSON.parse(await fs.readFile(this.file,'utf8'));
        if(db.version!==1||!db.channels||typeof db.channels!=='object'||Array.isArray(db.channels))throw Error('Invalid schema');
        return db;
      } catch(e) {
        if(e.code==='ENOENT')return initial();
        throw Object.assign(Error('Penyimpanan Analytics gagal dibaca. Data asli dipertahankan.'),{status:503,code:'storage_error'});
      }
    })();
    try{return await this.loaded}catch(e){this.loaded=null;throw e}
  }
  async read(channelId) {
    await this.chain.catch(()=>{});
    return structuredClone((await this.load()).channels[channelId]||newChannel());
  }
  mutate(channelId,fn) {
    if(this.persistence)return this.persistence.mutate('analytics',async db=>{const channel=db.channels[channelId]??=newChannel();return fn(channel)});
    const work=this.chain.catch(()=>{}).then(async()=>{
      const next=structuredClone(await this.load());
      const channel=next.channels[channelId]??=newChannel();
      const result=await fn(channel);
      await fs.mkdir(path.dirname(this.file),{recursive:true});
      await fs.writeFile(this.file+'.tmp',JSON.stringify(next),{mode:0o600});
      await fs.rename(this.file+'.tmp',this.file);
      this.loaded=Promise.resolve(next);
      return structuredClone(result);
    });
    this.chain=work;return work;
  }
  async remove(channelId) {
    await this.mutate(channelId,c=>{for(const k of Object.keys(c))delete c[k];Object.assign(c,newChannel())});
  }
}
