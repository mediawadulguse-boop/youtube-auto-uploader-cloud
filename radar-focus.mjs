import {plainSource,materialText,sentenceParts,classifyClaimText} from './radar-engine.mjs';

export const RADAR_FOCUS_METHOD={version:1,usesAI:false,name:'Fokus investigasi',description:'Kebijakan yang dipersoalkan, politik dan kekuasaan, ekonomi dan korporasi, serta sisi gelap industri. Isu dipilih dari sinyal dalam sumber, bukan penetapan tuduhan sebagai fakta.'};
const normalize=text=>plainSource(text).normalize('NFKC').toLocaleLowerCase('id-ID').replace(/[^\p{L}\p{N}]+/gu,' ').replace(/\s+/g,' ').trim();
const scopes=[
  ['policy','Kebijakan publik',/\b(kebijakan|regulasi|peraturan|undang undang|pajak|ppn|subsidi|anggaran|apbn|apbd|izin|perizinan|birokrasi|pelayanan publik|bansos|tarif listrik|bpjs|bea cukai)\b/],
  ['politics','Politik & kekuasaan',/\b(politik|politikus|partai|pemilu|pilkada|presiden|menteri|pemerintah|dpr|dprd|parlemen|bupati|gubernur|mk|mahkamah|kpk|kekuasaan|rezim|oligarki|kolonial|voc)\b/],
  ['economy','Ekonomi & korporasi',/\b(ekonomi|inflasi|resesi|bank|utang|investasi|investor|perusahaan|korporasi|monopoli|kartel|harga|upah|gaji|biaya hidup|pekerja|buruh|tenaga kerja|phk|konsumen|pelanggan|pinjol|asuransi|pasar modal|bursa)\b/],
  ['industry','Sisi gelap industri',/\b(industri|pabrik|tambang|perkebunan|platform|aplikasi|teknologi|algoritma|data pribadi|fast fashion|perbudakan|eksploitasi|rantai pasok|lingkungan|hutan|polusi|limbah)\b/]
];
const signals=[
  ['dispute','Penolakan / perdebatan',/\b(kontroversi|kontroversial|polemik|diperdebatkan|perdebatan|pro kontra|ditolak|menolak|penolakan|digugat|gugatan|kritik|mengkritik|dikritik|dipersoalkan|dipertanyakan|mempertanyakan|menentang|memprotes|protes|demonstrasi|unjuk rasa|bantah|membantah|dibantah|konflik kepentingan)\b/],
  ['accountability','Dugaan penyimpangan / akuntabilitas',/\b(korupsi|suap|gratifikasi|nepotisme|oligarki|kartel|monopoli|penipuan|manipulasi|pemalsuan|ilegal|pelanggaran|penyalahgunaan|penggelapan|kecurangan|pencucian uang|pencurian data|kebocoran data|menjual data pribadi|penjualan data pribadi|sisi gelap|eksploitasi|perbudakan)\b/],
  ['impact','Risiko / beban yang perlu ditelusuri',/\b(phk|bangkrut|gagal bayar|krisis|resesi|kesenjangan|ketimpangan|diskriminasi|burnout|kemiskinan|kerugian|rugi|tercemar|pencemaran|polusi|limbah beracun|beban|mencekik|upah murah|pemotongan gaji|pemotongan upah|kecelakaan kerja)\b/],
  ['cost','Perubahan biaya / akses',/\b(?:naik|naikkan|menaikkan|kenaikan|melonjak|mahal|dipangkas|dicabut|dihapus|turun|turunkan|menurunkan)\b/]
];
const increased=/\b(naik|naikkan|menaikkan|kenaikan|melonjak|mahal)\b/,reduced=/\b(dipangkas|dicabut|dihapus|turun|turunkan|menurunkan|pemotongan)\b/;
const costRisk=hay=>increased.test(hay)&&/\b(pajak|ppn|tarif listrik|bpjs)\b/.test(hay)||reduced.test(hay)&&/\b(subsidi|bansos|upah|gaji)\b/.test(hay)||increased.test(hay)&&/\b(harga|tarif|biaya)\b/.test(hay)&&/\b(warga|masyarakat|pekerja|buruh|konsumen|biaya hidup|keluarga|pelanggan)\b/.test(hay);
const promotion=/\b(promo|diskon|beli sekarang|subscribe|berlangganan channel|like dan share)\b/;
const ceremony=/\b(peresmian|meresmikan|seremoni|pelantikan|melantik|launching|syukuran|ucapan selamat)\b/;
const caseEvidence=/\b(dugaan|diduga|kasus|skandal|penyelidikan|penyidikan|tersangka|terdakwa|dakwaan|putusan|vonis|audit|terungkap|investigasi|penggelapan|pemalsuan|penipuan|eksploitasi|penyalahgunaan)\b/;
const incident=/\b(gempa|banjir|badai|longsor)\b/;
export function investigateSource(source,number=1){
  const body=plainSource(materialText(source)),title=plainSource(source.title||''),hits=[];
  // Scope and tension must appear in the same title or sentence. Unrelated
  // paragraphs and different sources cannot manufacture a controversy together.
  for(const [text,headlineOnly] of [[title,true],...body.split('\n').flatMap(line=>sentenceParts(line)).map(text=>[text,false])]){
    const hay=normalize(text).replace(/\b(harga diri|utang budi|utang nyawa)\b/g,' '),categories=scopes.filter(([,label,pattern])=>pattern.test(hay)).map(([id,label])=>({id,label}));
    if(!categories.length)continue;
    const found=signals.filter(([id,label,pattern])=>pattern.test(hay)&&(id!=='cost'||costRisk(hay)));
    const strong=found.some(([id])=>['dispute','accountability'].includes(id));
    if(!found.length||(!strong&&(ceremony.test(hay)||incident.test(hay)||promotion.test(hay))))continue;
    if(ceremony.test(hay)&&!found.some(([id])=>id==='dispute')&&!caseEvidence.test(hay))continue;
    const claim=classifyClaimText(text);
    hits.push({text,headlineOnly,sourceNumber:number,url:source.url||'',publisher:source.publisher||'',categories,signals:found.map(([id,label])=>({id,label})),claimKind:claim.kind,attributed:claim.attributed,level:headlineOnly?'headline':source.article?.text||source.transcript?.text?'full':'snippet'});
    // Retain the strongest passage even if it is late in the full material.
  }
  const strength=p=>p.signals.some(s=>s.id==='accountability')?3:p.signals.some(s=>s.id==='dispute')?2:1;
  return hits.toSorted((a,b)=>strength(b)-strength(a)||Number(a.headlineOnly)-Number(b.headlineOnly))[0]||null;
}
export function investigateIssue(issue){
  const passages=(issue.sources||[issue]).map((source,n)=>investigateSource(source,n+1)).filter(Boolean),categories=[...new Map(passages.flatMap(p=>p.categories).map(c=>[c.id,c])).values()],signals=[...new Map(passages.flatMap(p=>p.signals).map(s=>[s.id,s])).values()];
  const strong=signals.some(s=>['dispute','accountability'].includes(s.id));
  return {version:1,usesAI:false,eligible:passages.length>0,categories,signals,passages:passages.slice(0,3),
    label:strong?'Sinyal kontroversi / akuntabilitas':passages.length?'Dampak untuk diselidiki':'Di luar fokus investigasi',
    reason:passages.length?`${categories.map(c=>c.label).join(', ')}: ${signals.map(s=>s.label).join(', ')} disebut dalam sumber.`:'Belum ada konteks kebijakan, politik, ekonomi atau industri beserta sinyal masalah dalam bahan yang sama.',
    note:'Sinyal riset dari bahan sumber. Dugaan, bantahan dan opini belum membuktikan pelanggaran; telusuri dokumen, pihak terdampak, dan tanggapan pihak terkait.'};
}
export const focusAllows=(source,focus)=>focus?.mode!=='controversy'||investigateIssue(source).eligible;
export function focusTopics(){
  return [
    ['policy','Kebijakan yang dipersoalkan',['kebijakan','pajak','subsidi','anggaran','regulasi','bansos','undang undang','bpjs','pelayanan publik','apbn','apbd','perizinan','tarif listrik'],['system','human']],
    ['politics','Politik & kekuasaan',['politik','korupsi','konflik kepentingan','pemilu','dpr','kpk','oligarki','nepotisme','menteri','presiden','pemerintah','partai','pilkada','dprd','gubernur'],['system','history']],
    ['economy','Ekonomi & korporasi',['ekonomi','inflasi','utang','monopoli','kartel','phk','upah','pinjol','investasi','asuransi','bank','perusahaan','konsumen','buruh','pekerja','biaya hidup'],['system','human']],
    ['industry','Sisi gelap industri',['eksploitasi','data pribadi','kebocoran data','fast fashion','tambang','rantai pasok','perbudakan','manipulasi','pencemaran','platform','pabrik','limbah','lingkungan'],['system','history','human']]
  ].map(([id,name,keywords,lenses])=>({id:'focus-'+id,name,keywords,lenses,exclusions:[],language:'id',region:'ID',sources:['news','youtube'],enabled:true,revision:1}));
}
export function withFocus(data,defaultMode='general'){
  const focus={mode:['general','controversy'].includes(data.focus?.mode)?data.focus.mode:defaultMode,revision:data.focus?.revision||1};
  if(focus.mode!=='controversy'||data.focusSetupVersion===1)return {...data,focus};
  const topics=[...data.topics,...focusTopics().filter(t=>!data.topics.some(old=>old.id===t.id))];
  return {...data,focus,topics,focusSetupVersion:1};
}
export function collectionTopics(data,kind){
  const topics=data.topics.filter(t=>t.enabled&&t.sources.includes(kind));
  return data.focus?.mode==='controversy'?topics.toSorted((a,b)=>Number(b.id.startsWith('focus-'))-Number(a.id.startsWith('focus-'))):topics;
}
