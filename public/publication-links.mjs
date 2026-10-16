// Shared by the server and browser. Detection reads the URL only; no network requests.
export const PUBLICATION_PLATFORMS=Object.freeze({facebook:'Facebook',tiktok:'TikTok',instagram:'Instagram'});
export function detectPublicationLink(value){
 if(typeof value!=='string'||!value.trim())throw new Error('Tempel link publikasi terlebih dahulu.');
 let url;try{const raw=value.trim();url=new URL(/^[a-z][a-z\d+.-]*:/i.test(raw)?raw:'https://'+raw);}catch{throw new Error('Link belum valid. Tempel tautan lengkap dari platform.');}
 if(!['https:','http:'].includes(url.protocol)||url.username||url.password||url.port)throw new Error('Gunakan link http atau https tanpa akun dan port tambahan.');
 const host=url.hostname.toLowerCase(),domain=name=>host===name||host.endsWith('.'+name);let platform;
 if(domain('facebook.com')||domain('fb.com')||host==='fb.watch')platform='facebook';
 else if(domain('tiktok.com'))platform='tiktok';
 else if(domain('instagram.com')||host==='instagr.am')platform='instagram';
 else throw new Error('Platform belum didukung. Gunakan link Facebook, TikTok atau Instagram.');
 url.protocol='https:';url.hash='';
 const domains={facebook:'facebook.com',instagram:'instagram.com',tiktok:'tiktok.com'},base=domains[platform];
 if([base,'www.'+base,'m.'+base,'web.'+base].includes(host))url.hostname='www.'+base;
 for(const key of [...url.searchParams.keys()])if(/^utm_/i.test(key)||['fbclid','igsh','igshid','ttclid','_t','_r','is_from_webapp','sender_device','web_id'].includes(key.toLowerCase()))url.searchParams.delete(key);
 return {url:url.href,platform};
}
