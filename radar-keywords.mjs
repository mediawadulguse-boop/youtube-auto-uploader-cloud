import {plainSource} from './radar-engine.mjs';
import {displayHeadline} from './radar-methodology.mjs';

// Headline-grounded phrases, not arbitrary pairs or reconstructed allegations.
const COMMON=new Set(('di ke dari pada dalam dengan dan atau untuk yang ini itu tersebut oleh sebagai adalah akan sudah telah juga para ia mereka kami kita kamu saya nya namun tetapi karena agar jika saat ketika setelah sebelum tentang atas hingga lalu masih lebih paling sangat jadi menjadi bisa dapat punya memiliki ada tidak tak bukan belum hari minggu bulan tahun jam terbaru update breaking news video foto live shorts youtube subscribe like share berita politik ekonomi kebijakan kontroversi kontroversial polemik sebut menyebut disebut kata ujar mengatakan kritik mengkritik dikritik dipersoalkan dipertanyakan mempertanyakan bantah membantah dibantah bantahan tuduhan diduga dugaan menilai dinilai menolak ditolak penolakan wacana rencana ungkap mengungkapkan menurut soal terkait mengenai tanggapi tanggapan baca juga selengkapnya simak begini berikut kini kembali minta meminta beri memberi bikin pak bu bapak ibu hal secara tengah terus resmi indonesia nasional demi apakah apa siapa kenapa mengapa bagaimana kapan dimana mana berapa akankah benarkah mungkinkah bukankah haruskah bisakah memang bahkan justru hanya saja pun lah kah kok dong nih sih juga walau walaupun meski meskipun supaya sehingga sebab sebabnya maka tanpa antara maupun baik semua setiap banyak beberapa lain lainnya serta sebuah seorang sesuatu suatu segala tetap makin semakin lagi pernah sedang bakal dapatnya langsung tiba akhirnya ternyata ternyata benarkah ternyata fakta lengkap viral ramai heboh geger sorotan terungkap membongkar bongkar menguak mengungkap rahasia mengejutkan terbaru eksklusif tonton simak wajib perlu harus penting besar kecil tajam gelap terang nasib wajah masa depan jalan panjang rakyat masyarakat warga publik negara pemerintah presiden wakil menteri politikus ketua pejabat gubernur bupati walikota umum pemerintahannya menghadiri hadiri hadir sambut menyambut resmikan meresmikan membuka buka muncul dilakukan melakukan berlangsung memastikan pastikan dorong mendorong membebani naik turun meningkatkan kenaikan penurunan mendapatkan dapatkan temui menemui bertemu memilih pilih menjelaskan jelaskan serahkan menyerahkan beri memberikan serta berarti').split(/\s+/));
const NAMES=new Set('mk kpk dpr dprd bpk ma bpjs ojk bi kpu bawaslu komnas ham polri tni pbb who imf voc'.split(' '));
const ENTITY_NAMES=new Set('gibran jokowi jokowidodo prabowo anies ahok megawati ganjar bahlil purbaya mahfud ridwan sri mulyani suharto soeharto sby yudhoyono habibie gusdur soekarno sukarno pertamina pln telkom gojek grab google meta tiktok facebook apple microsoft openai samsung'.split(' '));
const ENTITY_ROLES=new Set('presiden menteri gubernur bupati walikota ketua politikus senator direktur ceo pt cv perusahaan bank universitas'.split(' '));
for(const word of 'tolak gugat usut jual dijual palsu asli sah batal cabut potong dampak akibat ancaman risiko manfaat untung rugi terlibat terjerat platform aplikasi dana'.split(' '))COMMON.add(word);
const ANCHORS=new Set('ijazah pajak ppn subsidi anggaran apbn apbd korupsi suap gratifikasi nepotisme monopoli kartel upah gaji phk utang investasi pinjol asuransi tarif bansos privasi data izin perizinan tambang limbah polusi pencemaran eksploitasi perbudakan diskriminasi ketimpangan kemiskinan pemilu pilkada putusan gugatan sengketa regulasi ruu uu vaksin pemalsuan penipuan penggelapan konsesi cukai beasiswa penggusuran pendidikan layanan hukum'.split(' '));
const PHRASES=['konflik kepentingan','pencucian uang','data pribadi','kebocoran data','pencurian data','biaya hidup','hak pekerja','sengketa tanah','politik uang','dinasti politik','rantai pasok','fast fashion','pelayanan publik','pemalsuan ijazah','ijazah palsu','ijazah asli','ijazah sah','ijazah sma','kenaikan pajak','kenaikan ppn','pemotongan upah','pemotongan gaji','pencabutan subsidi','subsidi listrik','tarif listrik','tarif bpjs','harga beras','harga minyak','harga pangan','harga bbm','upah minimum','upah murah','gagal bayar','utang negara','anggaran pendidikan','anggaran kesehatan','dana desa','dana bansos','bantuan sosial','perbudakan modern','pencemaran lingkungan','eksploitasi buruh','eksploitasi pekerja','sisi gelap','cipta kerja','ruu perampasan aset','perampasan aset'];
const normalized=value=>String(value||'').normalize('NFKD').replace(/\p{M}/gu,'').toLocaleLowerCase('id-ID');
const tokenize=value=>(String(value).match(/[\p{L}\p{N}]+/gu)||[]).map(raw=>({raw,word:normalized(raw)}));
const segments=value=>plainSource(value).split(/[.!?;\n]+/).map(tokenize).filter(x=>x.length);
const nominal=word=>word.length>=3&&!COMMON.has(word)&&!ANCHORS.has(word)&&!/^[\p{N}]+$/u.test(word)&&! /^(?:meng|meny|mem|ber|ter|diper)/.test(word);
const titleCase=value=>String(value).replace(/^\p{L}/u,x=>x.toLocaleUpperCase('id-ID'));
const indexOf=(tokens,words)=>{for(let i=0;i<=tokens.length-words.length;i++)if(words.every((word,n)=>tokens[i+n].word===word))return i;return -1;};
const positionsOf=(tokens,words)=>{const positions=[];for(let i=0;i<=tokens.length-words.length;i++)if(words.every((word,n)=>tokens[i+n].word===word))positions.push(i);return positions;};
export function trendText(source){return {title:segments(displayHeadline(source.title||'',source.publisher||'')),all:segments(displayHeadline(source.title||'',source.publisher||'')+'\n'+(source.excerpt||''))};}

export function extractTrendKeywords(source,text=trendText(source)){
 const candidates=new Map();
 const add=term=>{if(!candidates.has(term.key))candidates.set(term.key,term);};
 for(const tokens of text.title){
  const anchors=[];
  for(const phrase of PHRASES){const words=phrase.split(' '),start=indexOf(tokens,words);if(start<0)continue;
   const term={key:phrase,label:titleCase(phrase),kind:'phrase',parts:[words],words,specificity:words.length+2};
   add(term);anchors.push({start,end:start+words.length,term});
  }
  for(let i=0;i<tokens.length;i++)if(ANCHORS.has(tokens[i].word))anchors.push({start:i,end:i+1,term:{key:tokens[i].word,label:tokens[i].word,words:[tokens[i].word]}});
  const entities=[];
  for(let i=0;i<tokens.length;i++){
   // Capitalization inside a known issue phrase does not make it a person's name.
   if(anchors.some(a=>a.term.words.length>1&&i>=a.start&&i<a.end))continue;
   // A capital letter alone is weak evidence: many publishers use title case.
   const token=tokens[i],isName=NAMES.has(token.word)||nominal(token.word)&&/^\p{Lu}/u.test(token.raw)&&(ENTITY_NAMES.has(token.word)||ENTITY_ROLES.has(tokens[i-1]?.word));
   if(!isName)continue;
   const names=[token];let j=i+1;
   while(j<tokens.length&&nominal(tokens[j].word)&&/^\p{Lu}[\p{Ll}]/u.test(tokens[j].raw)&&!anchors.some(a=>a.term.words.length>1&&j>=a.start&&j<a.end)){names.push(tokens[j]);j++;}
   entities.push({start:i,end:j,words:names.map(t=>t.word),label:names.map(t=>NAMES.has(t.word)?t.raw.toUpperCase():t.raw).join(' ')});i=j-1;
  }
  for(const anchor of anchors){
   for(const entity of entities){
    if(entity.start<anchor.end&&anchor.start<entity.end||Math.max(anchor.start-entity.end,entity.start-anchor.end)>10)continue;
    const words=[...entity.words,...anchor.term.words];
    add({key:entity.words.join(' ')+' · '+anchor.term.key,label:entity.label+' · '+anchor.term.label,kind:'context',parts:[entity.words,anchor.term.words],words,specificity:anchor.term.words.length+entity.words.length+3});
   }
   // A noun immediately beside an issue noun can form a literal phrase.
   if(anchor.term.words.length===1)for(const adjacent of [anchor.start-1,anchor.end]){
    const token=tokens[adjacent];if(!token||!nominal(token.word)||entities.some(e=>adjacent>=e.start&&adjacent<e.end)||anchors.some(a=>a.term.words.length>1&&adjacent>=a.start&&adjacent<a.end))continue;
    const begin=Math.min(anchor.start,adjacent),end=Math.max(anchor.end,adjacent+1),words=tokens.slice(begin,end).map(t=>t.word);
    add({key:words.join(' '),label:titleCase(words.join(' ')),kind:'phrase',parts:[words],words,specificity:2});
   }
  }
 }
 return candidates;
}

export function trendKeywordMention(text,term){
 return text.all.some(tokens=>{
  const positions=term.parts.map(words=>positionsOf(tokens,words));if(positions.some(list=>!list.length))return false;
  return term.kind!=='context'||positions[0].some(a=>positions[1].some(b=>Math.abs(a-b)<=12));
 });
}
