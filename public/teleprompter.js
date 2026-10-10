'use strict';
const $=id=>document.getElementById(id), icon=n=>'<svg><use href="#i-'+n+'"/></svg>', KEY='yt-hub.teleprompter.studio.v1';
const defaults={voiceLang:'id-ID',voiceReadColor:'#ed65a3',voiceNextColor:'#8cdbff',font:'Arial',size:48,weight:500,line:1.65,gap:24,spacing:0,align:'left',uppercase:false,width:82,margin:5,bg:'#10141d',color:'#ffffff',accent:'#ed65a3',focus:true,focusPosition:35,focusHeight:70,mirrorX:false,mirrorY:false,orientation:'auto',fitGuide:true,snapLines:true,scrollMode:'text',speed:35,wpm:150,target:60,countdown:3,loop:false,wake:true,autoHide:false,showCues:true,topExtra:0,bottomExtra:80};
const builtins={host:{...defaults},vo:{...defaults,size:42,line:1.8,speed:28,countdown:5,wpm:140,width:78},presentation:{...defaults,size:58,line:1.6,speed:27,countdown:3,wpm:130,width:88,focusPosition:40}};
const sample=[{id:'sample-host',title:"Opening • Wadul Gus’e",category:'Host',text:"# OPENING\nHalo, warga Jember! Kembali lagi bersama Wadul Gus’e.\n\nHari ini, kita akan mendengar cerita, melihat langsung kondisi di lapangan, dan menyampaikan aspirasi masyarakat.\n\n[JEDA • SENYUM]\n\n# ISI\nSetiap aduan punya cerita. Ada harapan yang ingin didengar, ada persoalan yang perlu dipahami.\n\nKarena itu, kami ingin mendengar langsung dari warga. Apa yang terjadi? Apa yang paling dibutuhkan? Dan perubahan apa yang diharapkan?\n\n[BERI RUANG UNTUK NARASUMBER]\n\n# CLOSING\nTerima kasih kepada warga yang telah menyampaikan aspirasinya.\n\n==Suara Anda berarti.== Mari terus kawal bersama, untuk Jember yang lebih baik.",updated:new Date().toISOString()},{id:'sample-vo',title:'VO • Cerita yang dekat',category:'Voice Over',text:'# OPENING\nPernah merasa cerita yang paling sederhana justru paling membekas?\n\n[JEDA]\n\n# ISI\nBukan karena kata-katanya rumit. Tetapi karena kita mengenali diri sendiri di dalamnya.\n\nAda perjalanan yang terasa jauh. Ada usaha yang tidak terlihat. Ada harapan yang tetap dijaga, meski langkahnya kecil.\n\n==Cerita yang baik dimulai dengan mendengar.==\n\n# CLOSING\nHari ini, luangkan waktu untuk mendengar satu cerita. Mungkin, dari sanalah sudut pandang kita berubah.',updated:new Date().toISOString()},{id:'sample-reframe',title:'REFRAME • Sudut pandang',category:'Reframe',text:'# HOOK\nBagaimana kalau hal yang selama ini kita anggap biasa, ternyata layak dipertanyakan?\n\n[JEDA]\n\n# ISI\nKita sering melihat hasil akhirnya, lalu melewatkan proses yang membentuknya.\n\nSiapa yang membuat keputusan? Insentif apa yang bekerja? Dan siapa yang merasakan dampaknya?\n\nPertanyaan itu bukan jawaban. Tetapi bisa menjadi pintu masuk untuk memahami sebuah persoalan.\n\n# CLOSING\n==Ubah pertanyaannya. Perluas sudut pandangnya.==\n\nSelamat datang di Reframe.',updated:new Date().toISOString()}];
let state={scripts:sample,active:'sample-host',settings:{...defaults},presets:[],preset:'host'};
let storageAvailable=true, storageError='', pendingSave=0, playback='idle', elapsedMs=0, lastFrame=0, frameId=0, countTimer=0, countdownLeft=0, readMode=false, sectionNodes=[], activeSettingTab='text', toastTimer=0, hideTimer=0, wakeLock=null, previousFocus=null, modalResolve=null, isManualScroll=false, scrollPosition=0, readingLines=[], totalReadWords=0, wordCursor=0, layoutVersion=0, measuredSignature='', appliedGeometry='', manualSnapTimer=0, manualPointerDown=false;
let voiceWords=[],voiceTokens=[],voiceCursor=0,voiceConfirmed=0,voiceRecognition=null,voiceWanted=false,voiceRunning=false,voiceModeSelected=false,voiceStyled=false,voiceSegments=new Map(),voiceRestartTimer=0,voiceClockFrame=0,voiceLastFrame=0,voiceRetries=0,voiceMessage='Siap mengikuti suara';
function escapeHtml(s){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function uid(){return 'n-'+(globalThis.crypto?.randomUUID?.()||Date.now().toString(36)+'-'+Math.random().toString(36).slice(2));}
function current(){return state.scripts.find(s=>s.id===state.active)||state.scripts[0];}
function cleanSettings(raw){const s={...defaults};if(!raw||typeof raw!=='object')return s;const ranges={size:[20,110],weight:[400,800],line:[1,2.8],gap:[0,100],spacing:[-1,6],width:[35,100],margin:[0,20],focusPosition:[15,75],focusHeight:[20,200],speed:[5,180],wpm:[60,260],target:[10,3600],countdown:[0,10],topExtra:[0,300],bottomExtra:[0,500]};for(const [k,v]of Object.entries(raw)){if(k in ranges){const n=Number(v);if(Number.isFinite(n))s[k]=Math.max(ranges[k][0],Math.min(ranges[k][1],n));}else if(['uppercase','focus','mirrorX','mirrorY','loop','wake','autoHide','showCues','snapLines','fitGuide'].includes(k)){s[k]=v===true;}else if(['bg','color','accent','voiceReadColor','voiceNextColor'].includes(k)&&/^#[0-9a-f]{6}$/i.test(v)){s[k]=v;}else if(k==='voiceLang'&&['id-ID','en-US'].includes(v)){s[k]=v;}else if(k==='scrollMode'&&['text','pixel'].includes(v)){s[k]=v;}else if(k==='font'&&['Arial','Verdana','Georgia','Trebuchet MS','Courier New','system-ui'].includes(v)){s[k]=v;}else if(k==='align'&&['left','center','right'].includes(v)){s[k]=v;}else if(k==='orientation'&&['auto','portrait','landscape'].includes(v)){s[k]=v;}}return s;}
function validateData(raw){if(!raw||!Array.isArray(raw.scripts)||!raw.scripts.length||raw.scripts.length>500)throw Error('Cadangan tidak memiliki daftar naskah yang valid (maksimal 500).');let ids=new Set();const scripts=raw.scripts.map(x=>{if(!x||typeof x.text!=='string'||typeof x.title!=='string')throw Error('Format naskah tidak valid atau terlalu panjang.');const id=typeof x.id==='string'&&!ids.has(x.id)?x.id:uid();ids.add(id);return {id,title:x.title||'Tanpa judul',category:typeof x.category==='string'?x.category:'',text:x.text,updated:!isNaN(Date.parse(x.updated))?x.updated:new Date().toISOString()};});const presets=Array.isArray(raw.presets)?raw.presets.slice(0,30).filter(p=>p&&typeof p.name==='string').map(p=>({id:typeof p.id==='string'?p.id:uid(),name:p.name.slice(0,50),settings:cleanSettings(p.settings)})):[];return {scripts,active:scripts.some(x=>x.id===raw.active)?raw.active:scripts[0].id,settings:cleanSettings(raw.settings),presets,preset:typeof raw.preset==='string'?raw.preset:''};}
function load(){try{const saved=localStorage.getItem(KEY);if(saved)state=validateData(JSON.parse(saved));localStorage.setItem('tp-probe','1');localStorage.removeItem('tp-probe');}catch(e){storageAvailable=false;storageError=e.message;}}
function saveNow(){clearTimeout(pendingSave);pendingSave=0;try{localStorage.setItem(KEY,JSON.stringify(state));storageAvailable=true;$('saveStatus').innerHTML='<span class="dot"></span>Tersimpan';}catch(e){storageAvailable=false;$('saveStatus').innerHTML='<span class="dot" style="background:#e59c3d"></span>Belum tersimpan';toast('Penyimpanan browser tidak tersedia/penuh. Ekspor cadangan untuk menyimpan data.');}}
function saveSoon(){clearTimeout(pendingSave);$('saveStatus').innerHTML='<span class="dot" style="background:#e8b35c"></span>Menyimpan…';pendingSave=setTimeout(saveNow,450);}
function toast(msg){$('toast').textContent=msg;$('toast').classList.remove('hidden');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').classList.add('hidden'),4500);}
function wordCount(text){return text.split('\n').filter(l=>!/^\s*#/.test(l)&&!/^\s*\[.*\]\s*$/.test(l)).join(' ').replace(/\[[^\]\n]*\]/g,' ').replace(/[=*]/g,'').trim().split(/\s+/).filter(Boolean).length;}
function fmtTime(ms){const secs=Math.floor(ms/1000);return (Math.floor(secs/60)).toString().padStart(2,'0')+':'+(secs%60).toString().padStart(2,'0');}
function renderList(){const q=$('searchScripts').value.trim().toLowerCase();$('scriptList').replaceChildren();state.scripts.filter(s=>(s.title+' '+s.category).toLowerCase().includes(q)).forEach(s=>{const b=document.createElement('button');b.className='script-card'+(s.id===state.active?' active':'');b.setAttribute('aria-current',s.id===state.active?'true':'false');b.innerHTML=icon('file')+'<span><b>'+escapeHtml(s.title)+'</b><small>'+escapeHtml(s.category||'Naskah')+' · '+wordCount(s.text)+' kata</small></span>';b.onclick=()=>selectScript(s.id);$('scriptList').append(b);});if(!$('scriptList').children.length)$('scriptList').innerHTML='<div class="no-results">Naskah tidak ditemukan.</div>';}
function stats(){const words=wordCount(current().text), seconds=words/state.settings.wpm*60;const sections=current().text.split('\n').filter(l=>/^\s*#\s+/.test(l)).length;$('editorWords').textContent=words+' kata';$('wordStat').textContent=words+' kata';$('durationStat').textContent=fmtTime(seconds*1000);$('tempoStat').textContent='Estimasi · '+state.settings.wpm+' kata/menit';$('sectionStat').textContent=sections+' bagian';$('modifiedLabel').textContent='Diperbarui '+new Date(current().updated).toLocaleDateString('id-ID',{day:'numeric',month:'short'});}

function appendSpeechText(parent,text){
 for(const part of text.match(/\s+|\S+/g)||[]){
  if(/^\s+$/.test(part)){parent.append(document.createTextNode(part));continue;}
  const word=document.createElement('span');word.className='spoken-word';word.textContent=part;word.setAttribute('data-word',voiceWords.length);
  voiceWords.push(word);voiceTokens.push(normalizeVoiceWord(part));parent.append(word);
 }
}

function inlineText(parent,text){const pattern=/(\*\*[^*]+\*\*|==[^=]+==|\*[^*]+\*|\[[^\]\n]+\])/g;let pos=0,m;while((m=pattern.exec(text))){appendSpeechText(parent,text.slice(pos,m.index));let el;if(m[0].startsWith('**')){el=document.createElement('strong');appendSpeechText(el,m[0].slice(2,-2));}else if(m[0].startsWith('==')){el=document.createElement('mark');appendSpeechText(el,m[0].slice(2,-2));}else if(m[0].startsWith('*')){el=document.createElement('em');appendSpeechText(el,m[0].slice(1,-1));}else{el=document.createElement('span');el.className='cue';el.style.border='0';el.style.padding='0';el.textContent=state.settings.showCues?m[0]:'';}parent.append(el);pos=m.index+m[0].length;}appendSpeechText(parent,text.slice(pos));}
function renderText(preserve=false){const anchor=preserve?wordCursor:0;const content=$('readContent');content.replaceChildren();sectionNodes=[];voiceWords=[];voiceTokens=[];const blocks=current().text.split(/\n\s*\n/);blocks.forEach(block=>{let p=null;for(const line of block.split('\n')){if(/^\s*#\s+/.test(line)){p=null;const el=document.createElement('div');el.className='section';el.textContent=line.replace(/^\s*#\s+/,'');content.append(el);sectionNodes.push(el);}else if(/^\s*\[.*\]\s*$/.test(line)){p=null;if(state.settings.showCues){const el=document.createElement('p');el.className='cue';el.textContent=line.trim();content.append(el);}}else if(line.trim()){if(!p){p=document.createElement('p');content.append(p);}else p.append(document.createElement('br'));inlineText(p,line);}}});if(!content.children.length){const p=document.createElement('p');p.textContent='Tulis naskah Anda di editor, lalu tekan Mulai.';p.style.opacity='.4';content.append(p);}voiceCursor=voiceConfirmed=Math.min(voiceWords.length,Math.floor(anchor));layoutVersion++;setPadding();measureReadingLines(true);moveToWord(anchor);paintVoiceProgress();}


function normalizeVoiceWord(word){return String(word).normalize('NFKD').replace(/\p{M}/gu,'').toLocaleLowerCase('id-ID').replace(/[^\p{L}\p{N}]/gu,'');}
function speechTokens(text){return String(text).split(/\s+/).map(normalizeVoiceWord).filter(Boolean);}
function similarVoiceWord(a,b){
 if(!a||!b)return false;if(a===b)return true;
 if(Math.min(a.length,b.length)<5||Math.abs(a.length-b.length)>1)return false;
 let i=0,j=0,errors=0;while(i<a.length&&j<b.length){if(a[i]===b[j]){i++;j++;}else{if(++errors>1)return false;if(a.length>b.length)i++;else if(b.length>a.length)j++;else{i++;j++;}}}
 return errors+(a.length-i)+(b.length-j)<=1;
}
function matchVoiceTranscript(script,transcript,anchor){
 const heard=speechTokens(transcript).slice(0,512);anchor=Math.max(0,Math.min(script.length,Math.floor(anchor)));
 if(!heard.length||anchor>=script.length)return {end:anchor,matches:0};
 let best={end:anchor,matches:0,score:-Infinity};
 for(let begin=anchor;begin<Math.min(script.length,anchor+13);begin++){
  let i=0,j=begin,matches=0,skipped=0,missed=0;
  while(i<heard.length&&j<script.length){
   if(!script[j]){j++;continue;}
   if(similarVoiceWord(script[j],heard[i])){matches++;i++;j++;continue;}
   if(heard[i+1]&&script[j]===heard[i]+heard[i+1]){matches+=2;i+=2;j++;continue;}
   if(script[j+1]&&heard[i]===script[j]+script[j+1]){matches++;i++;j+=2;continue;}
   let ahead=0;for(let step=1;step<=3&&j+step<script.length;step++){if(similarVoiceWord(script[j+step],heard[i])){ahead=step;break;}}
   if(ahead){skipped+=ahead;j+=ahead;}else{i++;missed++;}
  }
  const single=heard.length===1&&begin===anchor&&script[anchor]===heard[0];
  if(!single&&(matches<2||matches/Math.max(1,heard.length)<.55))continue;
  const score=matches*3-skipped*.7-missed*.9-(begin-anchor)*.45;
  if(score>best.score)best={end:j,matches,score};
 }
 return {end:best.end,matches:best.matches};
}
function paintVoiceProgress(){
 document.documentElement.style.setProperty('--voice-read-color',state.settings.voiceReadColor);
 document.documentElement.style.setProperty('--voice-next-color',state.settings.voiceNextColor);
 document.body.classList.toggle('voice-styled',voiceStyled);
 let line=readingLines.length?readingLines[findWordLine(Math.min(voiceCursor,Math.max(0,totalReadWords-1)))]:null;
 const nextEnd=line?line.start+line.words:voiceCursor+1;
 voiceWords.forEach((word,i)=>{word.classList.toggle('voice-read',i<voiceCursor);word.classList.toggle('voice-next',i===voiceCursor);word.classList.toggle('voice-upcoming',i>=voiceCursor&&i<nextEnd);});
}
function voiceStatus(message){voiceMessage=message;$('voiceStatus').textContent=message;$('voiceBtn').setAttribute('aria-pressed',voiceWanted?'true':'false');$('voiceButtonLabel').textContent=voiceWanted?'Matikan suara':voiceModeSelected?'Lanjutkan suara':'Ikuti suara';document.body.classList.toggle('voice-listening',voiceRunning);}
function voiceTick(ts){if(!voiceWanted)return;if(voiceRunning){if(!voiceLastFrame)voiceLastFrame=ts;elapsedMs+=Math.min(120,ts-voiceLastFrame);voiceLastFrame=ts;$('elapsed').textContent=fmtTime(elapsedMs);}else voiceLastFrame=0;voiceClockFrame=requestAnimationFrame(voiceTick);}
function stopVoice(message='Suara dijeda'){
 voiceWanted=false;voiceRunning=false;clearTimeout(voiceRestartTimer);cancelAnimationFrame(voiceClockFrame);voiceLastFrame=0;
 const rec=voiceRecognition;voiceRecognition=null;voiceSegments.clear();if(rec){try{rec.abort();}catch(e){}}
 if(playback==='voice')playback=elapsedMs>0?'paused':'idle';voiceStatus(message);
}
function voiceResult(event,rec){
 if(!voiceWanted||rec!==voiceRecognition)return;voiceRetries=0;
 for(const key of voiceSegments.keys()){if(key>=event.results.length)voiceSegments.delete(key);}
 for(let i=event.resultIndex;i<event.results.length;i++){
  const result=event.results[i],transcript=result[0]?.transcript||'';
  let segment=voiceSegments.get(i);if(!segment){segment={anchor:voiceConfirmed,final:false,transcript:''};voiceSegments.set(i,segment);}
  if(segment.final&&segment.transcript===transcript)continue;
  const found=matchVoiceTranscript(voiceTokens,transcript,segment.anchor);
  $('voiceTranscript').textContent=transcript.trim();
  if(found.matches){voiceCursor=found.end;voiceStatus(result.isFinal?'Teks dikenali · mendengarkan':'Mengikuti ucapan…');}
  else{voiceCursor=Math.max(voiceConfirmed,segment.anchor);voiceStatus('Mendengarkan · baca sesuai naskah');}
  segment.transcript=transcript;segment.final=result.isFinal;
  if(result.isFinal)voiceConfirmed=Math.max(voiceConfirmed,voiceCursor);
  moveToWord(voiceCursor);paintVoiceProgress();
 }
 if(voiceCursor>=voiceTokens.length&&voiceTokens.length){stopVoice('Naskah selesai');voiceModeSelected=false;voiceStatus('Naskah selesai');updatePlayUI();releaseWake();}
}
function startVoiceSession(){
 if(!voiceWanted)return;const Ctor=window.SpeechRecognition||window.webkitSpeechRecognition;
 const rec=new Ctor();voiceRecognition=rec;voiceSegments.clear();rec.lang=state.settings.voiceLang;rec.continuous=true;rec.interimResults=true;rec.maxAlternatives=1;
 rec.onstart=()=>{if(rec!==voiceRecognition||!voiceWanted){try{rec.abort();}catch(e){}return;}voiceRunning=true;playback='voice';voiceStatus('Mendengarkan · silakan baca');updatePlayUI();requestWake();scheduleHide();};
 rec.onresult=e=>voiceResult(e,rec);
 rec.onerror=e=>{
  if(rec!==voiceRecognition||!voiceWanted)return;
  if(e.error==='no-speech'){voiceStatus('Belum ada ucapan · menunggu');return;}
  const messages={'not-allowed':'Izin mikrofon ditolak. Izinkan mikrofon di browser, lalu coba lagi.','service-not-allowed':'Layanan suara tidak diizinkan browser. Buka aplikasi di tab baru.','audio-capture':'Mikrofon tidak ditemukan atau sedang dipakai aplikasi lain.','network':'Pengenalan suara gagal terhubung. Periksa koneksi internet.','language-not-supported':'Bahasa pengenalan tidak didukung browser ini.','aborted':'Pengenalan suara dihentikan.'};
  const message=messages[e.error]||'Pengenalan suara berhenti: '+e.error;stopVoice(message);updatePlayUI();releaseWake();toast(message);
 };
 rec.onend=()=>{
  if(rec!==voiceRecognition||!voiceWanted)return;voiceRecognition=null;voiceRunning=false;voiceConfirmed=Math.max(voiceConfirmed,voiceCursor);
  if(++voiceRetries>3){stopVoice('Mikrofon berhenti. Klik Lanjutkan suara.');updatePlayUI();releaseWake();return;}
  voiceStatus('Menyambung mikrofon kembali…');voiceRestartTimer=setTimeout(()=>{if(voiceWanted)startVoiceSession();},500);
 };
 try{rec.start();}catch(e){stopVoice('Mikrofon belum bisa dimulai. Klik lagi untuk mencoba.');updatePlayUI();toast('Buka aplikasi di tab browser biasa dan izinkan mikrofon.');}
}
function startVoice(){
 const Ctor=window.SpeechRecognition||window.webkitSpeechRecognition;
 if(!Ctor){voiceModeSelected=false;voiceStatus('Browser ini belum mendukung pengenalan suara.');toast('Pengenalan suara tidak tersedia di browser ini. Buka tautan aplikasi di Chrome yang mendukung SpeechRecognition.');return;}
 if(!voiceTokens.length){toast('Isi naskah terlebih dahulu.');return;}
 pause();measureReadingLines();if(wordCursor>=voiceTokens.length)reset();
 voiceModeSelected=true;voiceWanted=true;voiceRunning=false;voiceStyled=true;voiceRetries=0;
 voiceCursor=voiceConfirmed=Math.max(0,Math.min(voiceTokens.length,Math.floor(wordCursor)));
 moveToWord(voiceCursor);paintVoiceProgress();$('voiceTranscript').textContent='';voiceStatus('Meminta akses mikrofon…');updatePlayUI();voiceLastFrame=0;voiceClockFrame=requestAnimationFrame(voiceTick);startVoiceSession();
}
function toggleVoice(){if(voiceWanted){voiceModeSelected=false;pause();voiceStatus('Mode suara dimatikan');}else startVoice();}

function focusY(){return $('viewport').clientHeight*state.settings.focusPosition/100;}
function contentY(rect){const v=$('viewport'),vr=v.getBoundingClientRect();return v.scrollTop+(state.settings.mirrorY?vr.bottom-rect.bottom:rect.top-vr.top);}
function readingLayoutKey(){const v=$('viewport'),s=state.settings;return [readMode,v.clientWidth,v.clientHeight,s.font,s.size,s.weight,s.line,s.gap,s.spacing,s.width,s.margin,s.orientation,s.uppercase,s.focusPosition,s.topExtra,s.bottomExtra,s.mirrorX,s.mirrorY].join('|');}
function measureReadingLines(force=false){
 const v=$('viewport'),settings=state.settings;
 const signature=layoutVersion+'|'+readingLayoutKey();
 if(!force&&signature===measuredSignature)return;
 measuredSignature=signature;readingLines=[];totalReadWords=wordCount(current().text);
 if(!document.createTreeWalker||!document.createRange||v.clientHeight<=0)return;
 const range=document.createRange();let start=0;
 for(const paragraph of $('readContent').querySelectorAll('p:not(.cue)')){
  if(!totalReadWords)break;
  const walker=document.createTreeWalker(paragraph,NodeFilter.SHOW_TEXT);let textNode;
  while((textNode=walker.nextNode())){
   if(textNode.parentElement.closest('.cue'))continue;
   const text=textNode.nodeValue;const matches=text.matchAll(/\S+/g);
   for(const m of matches){
    range.setStart(textNode,m.index);range.setEnd(textNode,m.index+m[0].length);
    const rect=range.getBoundingClientRect();if(!rect.height)continue;
    const top=contentY(rect),center=top+rect.height/2;
    let line=readingLines[readingLines.length-1];
    if(!line||Math.abs(line.top-top)>4){line={top,center,height:rect.height,start,words:0,paragraph};readingLines.push(line);}
    line.words++;start++;
   }
  }
 }
 if(start)totalReadWords=start;
}
function scrollForWord(word){
 const count=totalReadWords;
 if(!count)return 0;
 if(!readingLines.length)return Math.min(maxScroll(),Math.max(0,word/count*maxScroll()));
 const index=findWordLine(word),line=readingLines[index],next=readingLines[index+1];
 const fraction=Math.max(0,Math.min(1,(word-line.start)/Math.max(1,line.words)));
 const center=(voiceWanted||state.settings.snapLines)?line.center:next?line.center+(next.center-line.center)*fraction:line.center;
 return Math.min(maxScroll(),Math.max(0,center-focusY()));
}
function findWordLine(word){let lo=0,hi=readingLines.length-1;while(lo<hi){const mid=Math.ceil((lo+hi)/2);if(readingLines[mid].start<=word)lo=mid;else hi=mid-1;}return lo;}
function wordAtScroll(scroll){
 if(!readingLines.length)return maxScroll()?Math.max(0,Math.min(totalReadWords,scroll/maxScroll()*totalReadWords)):0;
 const y=scroll+focusY();let lo=0,hi=readingLines.length-1;
 while(lo<hi){const mid=Math.ceil((lo+hi)/2);if(readingLines[mid].center<=y+.1)lo=mid;else hi=mid-1;}
 const line=readingLines[lo],next=readingLines[lo+1];
 const fraction=next?Math.max(0,Math.min(1,(y-line.center)/Math.max(1,next.center-line.center))):Math.max(0,Math.min(1,(y-line.center)/Math.max(1,line.height)));
 return Math.max(0,Math.min(totalReadWords,line.start+line.words*fraction));
}
function moveToWord(word){wordCursor=Math.max(0,Math.min(totalReadWords,word));scrollPosition=scrollForWord(wordCursor);$('viewport').scrollTop=scrollPosition;if(!voiceWanted&&voiceModeSelected){voiceCursor=voiceConfirmed=Math.floor(wordCursor);paintVoiceProgress();}updateProgress();}

function updateFocusGuide(){
 const v=$('viewport'),s=state.settings;
 if(!readingLines.length){$('focusGuide').style.top='';$('focusGuide').style.height='';document.documentElement.style.setProperty('--focus-top',(s.mirrorY?100-s.focusPosition:s.focusPosition)+'%');return;}
 const line=readingLines[findWordLine(wordCursor)];
 const y=line.center-v.scrollTop,visualY=s.mirrorY?v.clientHeight-y:y;
 const guide=$('focusGuide');
 guide.style.top=visualY+'px';
 // Center the band on the actual glyph box, not a guessed font offset.
 guide.style.height=(s.fitGuide?line.height+12:(readMode?s.focusHeight:s.focusHeight*.6))+'px';
}
function snapToNearestLine(){
 if(!state.settings.snapLines||!readingLines.length)return;
 const y=$('viewport').scrollTop+focusY();let index=findWordLine(wordAtScroll($('viewport').scrollTop));
 if(readingLines[index+1]&&Math.abs(readingLines[index+1].center-y)<Math.abs(readingLines[index].center-y))index++;
 moveToWord(readingLines[index].start);
}
function scheduleManualSnap(){clearTimeout(manualSnapTimer);if(!manualPointerDown&&state.settings.snapLines)manualSnapTimer=setTimeout(()=>{if(playback!=='running'&&!voiceWanted&&!manualPointerDown)snapToNearestLine();},180);}

function seekProgress(percent){pause();measureReadingLines();moveToWord(totalReadWords*percent/100);scheduleHide();}
function scrollLine(direction){
 pause();measureReadingLines();
 if(!readingLines.length){$('viewport').scrollTop=Math.max(0,Math.min(maxScroll(),$('viewport').scrollTop+direction*(readMode?state.settings.size:state.settings.size*.56)*state.settings.line));scrollPosition=$('viewport').scrollTop;wordCursor=wordAtScroll(scrollPosition);updateProgress();return;}
 const index=findWordLine(wordCursor),line=readingLines[index];
 const destination=direction<0&&wordCursor>line.start+.1?index:Math.max(0,Math.min(readingLines.length-1,index+direction));
 moveToWord(readingLines[destination].start);scheduleHide();
}
function scrollPage(direction){pause();measureReadingLines();$('viewport').scrollTop=Math.max(0,Math.min(maxScroll(),$('viewport').scrollTop+direction*$('viewport').clientHeight*.75));scrollPosition=$('viewport').scrollTop;wordCursor=wordAtScroll(scrollPosition);snapToNearestLine();updateProgress();}
function changeTempo(delta){const key=state.settings.scrollMode==='text'?'wpm':'speed';setSetting(key,state.settings[key]+delta);}
function refreshTempo(){const textMode=state.settings.scrollMode==='text',s=state.settings;$('speedQuick').min=textMode?60:5;$('speedQuick').max=textMode?260:180;$('speedQuick').value=textMode?s.wpm:s.speed;$('speedLabel').textContent=(textMode?s.wpm:s.speed)+(textMode?' kpm':' px/s');$('speedQuick').setAttribute('aria-label',textMode?'Tempo baca dalam kata per menit':'Kecepatan gulir dalam piksel per detik');}

function maxScroll(){return Math.max(0,$('viewport').scrollHeight-$('viewport').clientHeight);}
function setPadding(){const h=$('viewport').clientHeight,s=state.settings;$('readContent').style.setProperty('--pad-top',(h*s.focusPosition/100+s.topExtra)+'px');$('readContent').style.setProperty('--pad-bottom',(h*(1-s.focusPosition/100)+s.bottomExtra)+'px');}
function applySettings(preserve=true){const s=state.settings;const v=$('viewport'),anchor=preserve?wordCursor:0;const geometryKey=readingLayoutKey(),geometryChanged=geometryKey!==appliedGeometry;appliedGeometry=geometryKey;const root=document.documentElement.style;root.setProperty('--read-font',s.font==='system-ui'?'system-ui':'"'+s.font+'"');root.setProperty('--read-size',(readMode?s.size:Math.min(s.size*.56,46))+'px');root.setProperty('--read-weight',s.weight);root.setProperty('--read-line',s.line);root.setProperty('--read-gap',(readMode?s.gap:s.gap*.65)+'px');root.setProperty('--read-spacing',s.spacing+'px');root.setProperty('--read-align',s.align);root.setProperty('--read-case',s.uppercase?'uppercase':'none');root.setProperty('--read-width',Math.min(s.width,100-s.margin*2)+'%');root.setProperty('--read-bg',s.bg);root.setProperty('--read-color',s.color);root.setProperty('--read-accent',s.accent);root.setProperty('--focus-top',(s.mirrorY?100-s.focusPosition:s.focusPosition)+'%');root.setProperty('--focus-size',(readMode?s.focusHeight:s.focusHeight*.6)+'px');root.setProperty('--mx',s.mirrorX?-1:1);root.setProperty('--my',s.mirrorY?-1:1);$('focusGuide').style.top='';$('focusGuide').style.height='';$('focusGuide').classList.toggle('hidden',!s.focus);document.body.classList.toggle('read-portrait',s.orientation==='portrait');document.body.classList.toggle('read-landscape',s.orientation==='landscape');refreshTempo();setPadding();measureReadingLines(geometryChanged);moveToWord(anchor);paintVoiceProgress();stats();renderPresets();}
function renderPresets(){$('customPresets').replaceChildren();state.presets.forEach(p=>{const b=document.createElement('button');b.className='preset-btn'+(state.preset===p.id?' selected':'');b.textContent=p.name;b.title='Gunakan preset '+p.name;b.onclick=()=>applyPreset(p.id);$('customPresets').append(b);});document.querySelectorAll('[data-preset]').forEach(b=>b.classList.toggle('selected',b.dataset.preset===state.preset));}
function applyPreset(id){pause();const s=builtins[id]||state.presets.find(p=>p.id===id)?.settings;if(!s)return;state.settings=cleanSettings(s);state.preset=id;renderText(true);applySettings();if(!isHidden('settingsDrawer'))renderSettings();saveSoon();toast('Preset diterapkan.');}
function selectScript(id){pause();voiceModeSelected=false;voiceStyled=false;voiceStatus('Siap mengikuti suara');saveNow();state.active=id;elapsedMs=0;playback='idle';$('scriptTitle').value=current().title;$('scriptCategory').value=current().category;$('scriptEditor').value=current().text;$('readTitle').textContent=current().title;renderText();applySettings(false);renderList();updatePlayUI();saveSoon();document.body.classList.remove('sidebar-open');}
function updateScript(){if(voiceWanted||playback==='running'||playback==='countdown')pause();const s=current();s.title=$('scriptTitle').value||'Tanpa judul';s.category=$('scriptCategory').value;s.text=$('scriptEditor').value;s.updated=new Date().toISOString();$('readTitle').textContent=s.title;renderText(true);stats();renderList();saveSoon();}
function updateProgress(){const v=$('viewport'),pct=totalReadWords?Math.min(100,Math.max(0,wordCursor/totalReadWords*100)):0;$('progressText').textContent=Math.round(pct)+'%';$('progressBar').style.width=pct+'%';$('positionSeek').value=pct;$('positionLabel').textContent=Math.round(pct)+'%';$('elapsed').textContent=fmtTime(elapsedMs);let section='Naskah';for(const n of sectionNodes){const top=n.getBoundingClientRect?contentY(n.getBoundingClientRect()):n.offsetTop;if(top<=v.scrollTop+focusY()+10)section=n.textContent;}$('currentSection').textContent=section;updateFocusGuide();}
function updatePlayUI(){const running=playback==='running'||voiceWanted,counting=playback==='countdown';$('playIcon').innerHTML='<use href="#i-'+(running||counting?'pause':'play')+'"/>';$('playLabel').textContent=counting?'Batal':running?'Jeda':elapsedMs>0?'Lanjutkan':'Mulai';document.body.classList.toggle('running',running);if(!running)document.body.classList.remove('auto-hidden');}
function animate(ts){
 if(playback!=='running')return;
 if(!lastFrame)lastFrame=ts;
 const dt=Math.min(120,ts-lastFrame);lastFrame=ts;elapsedMs+=dt;
 const v=$('viewport'),textMode=state.settings.scrollMode==='text';
 if(textMode){wordCursor=Math.min(totalReadWords,wordCursor+state.settings.wpm*dt/60000);scrollPosition=scrollForWord(wordCursor);v.scrollTop=scrollPosition;}
 else{scrollPosition=Math.min(maxScroll(),scrollPosition+state.settings.speed*dt/1000);v.scrollTop=scrollPosition;wordCursor=wordAtScroll(scrollPosition);}
 updateProgress();
 const finished=textMode?wordCursor>=totalReadWords:scrollPosition>=maxScroll()-.5||(readingLines.length&&scrollPosition>=scrollForWord(totalReadWords)+readingLines[readingLines.length-1].height);
 if(finished){if(state.settings.loop){moveToWord(0);elapsedMs=0;}else{wordCursor=totalReadWords;updateProgress();pause();toast('Naskah selesai. Tekan R untuk kembali ke awal.');return;}}
 frameId=requestAnimationFrame(animate);
}
async function requestWake(){if(!readMode||!state.settings.wake||(playback!=='running'&&!voiceWanted))return;if(!('wakeLock' in navigator)){toast('Layar tetap aktif tidak didukung di browser ini.');return;}try{if(!wakeLock)wakeLock=await navigator.wakeLock.request('screen');wakeLock.addEventListener('release',()=>{wakeLock=null;});}catch(e){toast('Layar tetap aktif belum tersedia. Periksa pengaturan perangkat.');}}
function releaseWake(){if(wakeLock){wakeLock.release().catch(()=>{});wakeLock=null;}}
function startRunning(){clearTimeout(manualSnapTimer);measureReadingLines();if(state.settings.snapLines)moveToWord(wordCursor);playback='running';lastFrame=0;scrollPosition=$('viewport').scrollTop;updatePlayUI();frameId=requestAnimationFrame(animate);requestWake();scheduleHide();}
function play(){if(voiceWanted){pause();return;}if(voiceModeSelected){startVoice();return;}if(playback==='running'||playback==='countdown'){pause();return;}if(!wordCount(current().text)){toast('Isi naskah terlebih dahulu.');return;}if(totalReadWords&&wordCursor>=totalReadWords-.01){reset();}if(elapsedMs===0&&state.settings.countdown>0){playback='countdown';countdownLeft=Math.round(state.settings.countdown);$('countdownNumber').textContent=countdownLeft;$('countdownOverlay').classList.remove('hidden');updatePlayUI();countTimer=setInterval(()=>{countdownLeft--;if(countdownLeft<=0){clearInterval(countTimer);$('countdownOverlay').classList.add('hidden');startRunning();}else $('countdownNumber').textContent=countdownLeft;},1000);}else startRunning();}
function pause(){if(voiceWanted)stopVoice();clearTimeout(manualSnapTimer);clearInterval(countTimer);cancelAnimationFrame(frameId);$('countdownOverlay').classList.add('hidden');playback=elapsedMs>0?'paused':'idle';lastFrame=0;updatePlayUI();releaseWake();}
function reset(){pause();elapsedMs=0;measureReadingLines();moveToWord(0);updatePlayUI();}
function jumpSection(direction){pause();if(!sectionNodes.length){toast('Tambahkan penanda bagian menggunakan # OPENING.');return;}const focus=$('viewport').scrollTop+focusY();const positions=sectionNodes.map(n=>n.getBoundingClientRect?contentY(n.getBoundingClientRect()):n.offsetTop);let idx;if(direction>0){idx=positions.findIndex(p=>p>focus+10);if(idx<0)idx=positions.length-1;}else{idx=-1;positions.forEach((p,i)=>{if(p<focus-10)idx=i;});if(idx<0)idx=0;}jumpTo(idx);}
function jumpTo(idx){pause();const n=sectionNodes[idx];if(!n)return;const top=n.getBoundingClientRect?contentY(n.getBoundingClientRect()):n.offsetTop;const first=readingLines.find(line=>line.top>=top);if(state.settings.snapLines&&first){moveToWord(first.start);return;}$('viewport').scrollTop=Math.max(0,top-focusY());scrollPosition=$('viewport').scrollTop;wordCursor=wordAtScroll(scrollPosition);updateProgress();}
function setRead(on){pause();readMode=on;document.body.classList.toggle('read-mode',on);document.body.classList.remove('sidebar-open');applySettings();if(on)$('viewport').focus({preventScroll:true});else if(document.fullscreenElement)document.exitFullscreen().catch(()=>{});}
async function fullscreen(){if(!readMode)setRead(true);try{if(document.fullscreenElement)await document.exitFullscreen();else if(document.documentElement.requestFullscreen)await document.documentElement.requestFullscreen();else toast('Layar penuh tidak tersedia. Mode baca tetap bisa digunakan.');}catch(e){toast('Layar penuh tidak tersedia. Mode baca tetap bisa digunakan.');}}
function scheduleHide(){clearTimeout(hideTimer);document.body.classList.remove('auto-hidden');if(readMode&&(playback==='running'||voiceWanted)&&state.settings.autoHide)hideTimer=setTimeout(()=>document.body.classList.add('auto-hidden'),3500);}
function isHidden(id){return $(id).classList.contains('hidden');}
function setSetting(key,value){if(key==='voiceLang'&&voiceWanted)pause();const old={...state.settings};state.settings=cleanSettings({...state.settings,[key]:value});state.preset='';if(key==='showCues')renderText(true);applySettings();if(key==='wake'){if(!value)releaseWake();else requestWake();}if(key==='autoHide')scheduleHide();saveSoon();return old;}
function range(k,label,min,max,step,suffix=''){const value=state.settings[k];return '<div class="control"><label for="set-'+k+'">'+label+'<output id="out-'+k+'">'+value+suffix+'</output></label><input id="set-'+k+'" data-setting="'+k+'" type="range" min="'+min+'" max="'+max+'" step="'+step+'" value="'+value+'"></div>';}
function selectControl(k,label,options){return '<div class="control"><label for="set-'+k+'">'+label+'</label><select data-setting="'+k+'" id="set-'+k+'">'+options.map(([v,l])=>'<option value="'+v+'"'+(String(state.settings[k])===String(v)?' selected':'')+'>'+l+'</option>').join('')+'</select></div>';}
function toggle(k,label,description=''){return '<label class="control-inline"><span>'+label+(description?'<small>'+description+'</small>':'')+'</span><input type="checkbox" data-setting="'+k+'"'+(state.settings[k]?' checked':'')+' aria-label="'+label+'"></label>';}
function renderSettings(){const s=state.settings;let h='';if(activeSettingTab==='text'){h='<div class="setting-group"><h3>Tipografi</h3>'+selectControl('font','Jenis huruf',[['Arial','Arial'],['Verdana','Verdana'],['Georgia','Georgia (serif)'],['Trebuchet MS','Trebuchet MS'],['Courier New','Courier New'],['system-ui','Font perangkat']])+range('size','Ukuran huruf mode baca',20,110,1,' px')+selectControl('weight','Ketebalan',[['400','Normal'],['500','Medium'],['600','Semibold'],['700','Bold'],['800','Extra bold']])+range('line','Jarak antarbaris',1,2.8,.05,' ×')+range('gap','Jarak antarparagraf',0,100,1,' px')+range('spacing','Jarak antarkarakter',-1,6,.1,' px')+selectControl('align','Perataan',[['left','Rata kiri'],['center','Rata tengah'],['right','Rata kanan']])+toggle('uppercase','Semua huruf kapital')+toggle('showCues','Tampilkan catatan produksi','Catatan [JEDA] tidak dihitung sebagai kata bacaan.')+'</div><div class="help-card">Format: <strong>**tebal**</strong>, <strong>*miring*</strong>, <strong>==sorotan==</strong>, dan <strong># BAGIAN</strong>. Pratinjau memakai ukuran lebih kecil; mode baca menggunakan ukuran asli.</div>';}else if(activeSettingTab==='display'){h='<div class="setting-group"><h3>Warna & tema</h3><div class="theme-row"><button data-theme="dark">Gelap</button><button data-theme="light">Terang</button><button data-theme="reframe">Reframe</button></div><div class="color-row" style="margin-top:17px">'+[['bg','Latar'],['color','Teks'],['accent','Sorotan']].map(([k,l])=>'<label class="color-control">'+l+'<input data-setting="'+k+'" type="color" value="'+s[k]+'" aria-label="Warna '+l+'"></label>').join('')+'</div></div><div class="setting-group"><h3>Area baca</h3>'+range('width','Lebar kolom teks',35,100,1,' %')+range('margin','Margin minimum sisi',0,20,1,' %')+selectControl('orientation','Layout bacaan',[['auto','Otomatis'],['portrait','Portrait · kolom lebih sempit'],['landscape','Landscape · kolom lebar']])+'<p class="orientation-note">Layout menyesuaikan area teks. Putar perangkat secara manual untuk mengganti orientasi layar.</p>'+range('topExtra','Ruang tambahan sebelum naskah',0,300,5,' px')+range('bottomExtra','Ruang tambahan setelah naskah',0,500,5,' px')+'</div><div class="setting-group"><h3>Panduan mata & mirror</h3>'+toggle('focus','Panduan fokus baca')+range('focusPosition','Posisi panduan dari atas',15,75,1,' %')+toggle('fitGuide','Tinggi panduan mengikuti baris','Panduan membingkai baris yang aktif. Matikan untuk memakai tinggi manual.')+range('focusHeight','Tinggi area fokus manual',20,200,1,' px')+toggle('mirrorX','Mirror horizontal','Untuk kaca teleprompter.')+toggle('mirrorY','Mirror vertikal')+'</div>';}else if(activeSettingTab==='play'){h='<div class="setting-group"><h3>Ikuti suara</h3>'+selectControl('voiceLang','Bahasa mikrofon',[['id-ID','Bahasa Indonesia'],['en-US','English']])+'<div class="color-row" style="grid-template-columns:1fr 1fr;margin-bottom:18px"><label class="color-control">Sudah dibaca<input type="color" data-setting="voiceReadColor" value="'+s.voiceReadColor+'" aria-label="Warna kata terbaca"></label><label class="color-control">Baris berikutnya<input type="color" data-setting="voiceNextColor" value="'+s.voiceNextColor+'" aria-label="Warna baris berikutnya"></label></div><div class="help-card">Klik <strong>Ikuti suara</strong> dan izinkan mikrofon. Kata yang dikenali berubah warna; baris berikutnya ditandai otomatis. Gulir mengikuti ucapan dan berhenti ketika Anda diam.</div><p class="voice-help">Pengenalan dapat memakai layanan browser dan membutuhkan internet. Audio dan transkrip tidak disimpan aplikasi. Jika mikrofon diblokir di tampilan sematan, buka aplikasi di tab baru.</p></div><div class="setting-group"><h3>Tempo & durasi</h3>'+toggle('snapLines','Kunci teks tepat pada garis fokus','Teks berpindah per baris dan berhenti lurus di tengah panduan. Gulir manual dirapikan setelah dilepas.')+selectControl('scrollMode','Metode gulir',[['text','Ikuti teks · kata per menit'],['pixel','Piksel per detik']])+range('speed','Kecepatan gulir',5,180,1,' px/s')+'<div class="control"><label for="speedNumber">Kecepatan manual (px/detik)</label><input type="number" id="speedNumber" data-setting="speed" min="5" max="180" step="1" value="'+s.speed+'"></div>'+range('wpm','Tempo gulir mengikuti teks',60,260,5,' kata/menit')+'<div class="control"><label for="set-target">Target durasi (detik)</label><input type="number" id="set-target" data-setting="target" min="10" max="3600" step="1" value="'+s.target+'"><small id="targetInfo">'+targetInfo()+'</small></div><button class="btn" id="fitTarget" style="width:100%;margin-bottom:20px">Sesuaikan estimasi dengan target</button><div class="help-card">Mode Ikuti teks menahan setiap baris sesuai jumlah katanya, lalu berpindah ke baris berikutnya. Font dan lebar layar boleh berubah; posisi bacaan tetap mengikuti kata. Mode piksel memakai kecepatan tetap.</div></div><div class="setting-group"><h3>Alur pemutaran</h3>'+selectControl('countdown','Hitung mundur',[['0','Tanpa hitung mundur'],['3','3 detik'],['5','5 detik'],['10','10 detik']])+toggle('loop','Ulang otomatis setelah selesai')+toggle('wake','Jaga layar tetap aktif','Bergantung dukungan browser. Aktif saat membaca.')+toggle('autoHide','Sembunyikan kontrol otomatis','Kontrol menghilang setelah 3,5 detik. Sentuh layar untuk menampilkan.')+'</div>';}else{h='<div class="setting-group"><h3>Pintasan teleprompter</h3><div class="about-shortcuts"><span><kbd>Space</kbd>Mulai / jeda</span><span><kbd>R</kbd>Kembali ke awal</span><span><kbd>↑ ↓</kbd>Gulir satu baris</span><span><kbd>← →</kbd>Pindah bagian</span><span><kbd>F</kbd>Layar penuh</span><span><kbd>Esc</kbd>Kembali ke editor</span></div></div><div class="help-card">Remote atau pedal yang mengirim tombol keyboard bisa memakai pintasan ini. Pintasan aktif di editor dan mode baca saat Anda tidak sedang mengetik. Gunakan +/− untuk tempo, Page Up/Down untuk satu layar, dan Home/End untuk awal/akhir.</div><div class="setting-group" style="margin-top:25px"><h3>Data & preset</h3><button class="btn" id="drawerPreset" style="width:100%;margin-bottom:10px">Simpan sebagai preset</button><button class="btn" id="managePresets" style="width:100%;margin-bottom:10px">Kelola preset pribadi</button><button class="btn" id="drawerBackup" style="width:100%">Ekspor cadangan JSON</button></div><div class="help-card"><strong>Penyimpanan lokal.</strong> Naskah tersimpan di browser dan perangkat ini. Data belum tersinkron antarperangkat. Gunakan cadangan JSON untuk memindahkan data.</div>';} $('settingBody').innerHTML=h;document.querySelectorAll('[data-tab]').forEach(b=>{b.classList.toggle('active',b.dataset.tab===activeSettingTab);b.setAttribute('aria-selected',b.dataset.tab===activeSettingTab);});$('settingBody').querySelectorAll('[data-setting]').forEach(el=>{el.addEventListener('input',()=>{const k=el.dataset.setting,value=el.type==='checkbox'?el.checked:el.type==='range'||el.type==='number'?Number(el.value):el.value;if(el.type==='number'&&!el.value)return;setSetting(k,value);const out=$('out-'+k);if(out)out.textContent=state.settings[k]+({size:' px',line:' ×',gap:' px',spacing:' px',width:' %',margin:' %',focusPosition:' %',focusHeight:' px',topExtra:' px',bottomExtra:' px',speed:' px/s',wpm:' kata/menit'}[k]||'');if(k==='speed'){$('set-speed')&&($('set-speed').value=state.settings.speed);$('speedNumber')&&($('speedNumber').value=state.settings.speed);}if($('targetInfo'))$('targetInfo').textContent=targetInfo();});});document.querySelectorAll('[data-theme]').forEach(b=>b.onclick=()=>{const themes={dark:{bg:'#10141d',color:'#ffffff',accent:'#ed65a3'},light:{bg:'#fffafc',color:'#1c2637',accent:'#d71978'},reframe:{bg:'#080b09',color:'#edf6f0',accent:'#a4ff46'}};state.settings={...state.settings,...themes[b.dataset.theme]};state.preset='';applySettings();saveSoon();renderSettings();});if($('fitTarget'))$('fitTarget').onclick=()=>{const wpm=Math.round(wordCount(current().text)*60/state.settings.target);setSetting('wpm',wpm);setSetting('scrollMode','text');renderSettings();toast(wpm<60||wpm>260?'Tempo dibatasi 60–260 kata/menit. Sesuaikan panjang naskah atau target durasinya.':'Tempo gulir mengikuti teks telah disesuaikan dengan target durasi.');};if($('drawerPreset'))$('drawerPreset').onclick=savePreset;if($('managePresets'))$('managePresets').onclick=managePresets;if($('drawerBackup'))$('drawerBackup').onclick=backup;}
function targetInfo(){const words=wordCount(current().text),wpm=Math.round(words*60/state.settings.target);return words+' kata untuk '+state.settings.target+' detik ≈ '+wpm+' kata/menit.';}
function openSettings(){pause();previousFocus=document.activeElement;renderSettings();$('settingsScrim').classList.remove('hidden');$('settingsDrawer').classList.remove('hidden');$('closeSettings').focus();}
function closeSettings(){$('settingsScrim').classList.add('hidden');$('settingsDrawer').classList.add('hidden');previousFocus?.focus?.({preventScroll:true});}
function modal(html){pause();$('modalContent').innerHTML=html;$('modalOverlay').classList.remove('hidden');setTimeout(()=>$('modalContent').querySelector('input,button,select')?.focus(),0);}
function closeModal(){$('modalOverlay').classList.add('hidden');if(modalResolve){modalResolve(null);modalResolve=null;}}
function confirmModal(title,message,action='Lanjutkan'){return new Promise(resolve=>{modal('<h2>'+escapeHtml(title)+'</h2><p>'+escapeHtml(message)+'</p><div class="modal-actions"><button class="btn" id="modalCancel">Batal</button><button class="btn primary" id="modalAccept">'+escapeHtml(action)+'</button></div>');modalResolve=resolve;$('modalCancel').onclick=closeModal;$('modalAccept').onclick=()=>{modalResolve=null;closeModal();resolve(true);};});}
async function newScript(){if(state.scripts.length>=500){toast('Maksimal 500 naskah. Ekspor cadangan dan hapus yang tidak diperlukan.');return;}const s={id:uid(),title:'Naskah baru',category:'Host',text:'# OPENING\n\n# ISI\n\n# CLOSING\n',updated:new Date().toISOString()};state.scripts.unshift(s);selectScript(s.id);$('scriptTitle').focus();$('scriptTitle').select();}
function duplicate(){if(state.scripts.length>=500)return toast('Maksimal 500 naskah.');const s={...current(),id:uid(),title:(current().title+' • Salinan'),updated:new Date().toISOString()};state.scripts.unshift(s);selectScript(s.id);toast('Salinan naskah dibuat.');}
async function removeScript(){const s=current();if(!await confirmModal('Hapus naskah?','Naskah “'+s.title+'” akan dihapus dari perangkat ini.','Hapus'))return;state.scripts=state.scripts.filter(x=>x.id!==s.id);if(!state.scripts.length)state.scripts=[{id:uid(),title:'Naskah baru',category:'',text:'',updated:new Date().toISOString()}];selectScript(state.scripts[0].id);saveNow();toast('Naskah dihapus.');}
function download(name,text,type){const url=URL.createObjectURL(new Blob([text],{type}));const a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),2000);}
function backup(){saveNow();download('Teleprompter-Cadangan-'+new Date().toISOString().slice(0,10)+'.json',JSON.stringify({version:1,exportedAt:new Date().toISOString(),...state},null,2),'application/json');toast('Cadangan mencakup naskah, preset, dan pengaturan.');}
function exportTxt(){const title=current().title.replace(/[<>:"/\\|?*]/g,'-');download((title||'Naskah')+'.txt',current().text,'text/plain;charset=utf-8');}
async function importFile(file){if(!file)return;if(file.size>10*1024*1024){toast('Batas ukuran impor adalah 10 MB.');return;}try{const text=await file.text();if(file.name.toLowerCase().endsWith('.json')){const incoming=validateData(JSON.parse(text));modal('<h2>Impor cadangan</h2><p>'+incoming.scripts.length+' naskah dan '+incoming.presets.length+' preset ditemukan. Pilih cara mengimpor.</p><div class="modal-actions"><button class="btn" id="modalCancel">Batal</button><button class="btn" id="mergeImport">Tambahkan</button><button class="btn primary" id="replaceImport">Ganti semua</button></div>');$('modalCancel').onclick=closeModal;$('mergeImport').onclick=()=>{if(state.scripts.length+incoming.scripts.length>500){toast('Jumlah gabungan melebihi 500 naskah.');return;}const scripts=incoming.scripts.map(s=>({...s,id:uid()}));state.scripts=[...scripts,...state.scripts];state.presets=[...state.presets,...incoming.presets.map(p=>({...p,id:uid()}))].slice(0,30);closeModal();selectScript(scripts[0].id);saveNow();toast('Naskah ditambahkan. Pengaturan aktif tetap digunakan.');};$('replaceImport').onclick=async()=>{closeModal();if(!await confirmModal('Ganti seluruh data?','Naskah, preset, dan pengaturan saat ini akan diganti isi cadangan. Ekspor data lama terlebih dahulu jika diperlukan.','Ganti seluruh data'))return;state=incoming;selectScript(state.active);renderPresets();saveNow();toast('Cadangan berhasil dipulihkan.');};}else{if(state.scripts.length>=500)throw Error('Maksimal 500 naskah.');const s={id:uid(),title:file.name.replace(/\.txt$/i,'')||'Naskah impor',category:'Impor',text,updated:new Date().toISOString()};state.scripts.unshift(s);selectScript(s.id);saveNow();toast('Naskah TXT berhasil diimpor.');}}catch(e){toast('Impor gagal: '+e.message);}}
function savePreset(){if(state.presets.length>=30){toast('Maksimal 30 preset. Kelola preset di tab Kontrol.');return;}modal('<h2>Simpan preset</h2><p>Simpan pengaturan teks, tampilan, dan pemutaran saat ini.</p><input id="presetName" maxlength="50" placeholder="Misalnya: Gus • Rekaman HP" aria-label="Nama preset"><div class="modal-actions"><button class="btn" id="modalCancel">Batal</button><button class="btn primary" id="modalSave">Simpan</button></div>');$('modalCancel').onclick=closeModal;$('modalSave').onclick=()=>{const name=$('presetName').value.trim();if(!name){$('presetName').focus();return;}const p={id:uid(),name,settings:{...state.settings}};state.presets.push(p);state.preset=p.id;renderPresets();saveNow();closeModal();toast('Preset disimpan.');};$('presetName').onkeydown=e=>{if(e.key==='Enter')$('modalSave').click();};}
function managePresets(){modal('<h2>Preset pribadi</h2><p>Preset bawaan Host, Voice Over, dan Presentasi selalu tersedia.</p><div id="presetManageList"></div><div class="modal-actions"><button class="btn" id="modalCancel">Tutup</button></div>');const list=$('presetManageList');if(!state.presets.length)list.innerHTML='<p>Belum ada preset pribadi.</p>';state.presets.forEach(p=>{const row=document.createElement('div');row.style.cssText='display:flex;align-items:center;justify-content:space-between;padding:10px 0;border-bottom:1px solid #eee;gap:10px';const name=document.createElement('span');name.textContent=p.name;name.style.fontSize='12px';const del=document.createElement('button');del.className='icon-btn danger';del.setAttribute('aria-label','Hapus preset '+p.name);del.innerHTML=icon('trash');del.onclick=()=>{state.presets=state.presets.filter(x=>x.id!==p.id);if(state.preset===p.id)state.preset='';saveNow();renderPresets();row.remove();};row.append(name,del);list.append(row);});$('modalCancel').onclick=closeModal;}
function formatting(type){const e=$('scriptEditor'),start=e.selectionStart,end=e.selectionEnd,selection=e.value.slice(start,end);let before='',after='',text=selection;if(type==='bold'){before='**';after='**';text=text||'kata penting';}if(type==='italic'){before='*';after='*';text=text||'kata';}if(type==='highlight'){before='==';after='==';text=text||'pesan utama';}if(type==='cue'){before=(start&&e.value[start-1]!=='\n'?'\n\n':'');text='[JEDA]';after='\n\n';}if(type==='section'){before=(start&&e.value[start-1]!=='\n'?'\n\n':'')+'# ';text=text||'BAGIAN BARU';after='\n\n';}if(type==='paragraph'){before='\n\n';text='';}e.setRangeText(before+text+after,start,end,'end');e.focus();e.setSelectionRange(start+before.length,start+before.length+text.length);updateScript();}
function sectionsModal(){modal('<h2>Penanda bagian</h2><p>Klik bagian untuk memindahkan posisi bacaan.</p><div class="section-list" id="sectionList"></div><div class="modal-actions"><button class="btn" id="modalCancel">Tutup</button></div>');if(!sectionNodes.length)$('sectionList').innerHTML='<p>Tambahkan penanda dengan format # OPENING.</p>';sectionNodes.forEach((n,i)=>{const b=document.createElement('button');b.textContent=(i+1)+'. '+n.textContent;b.onclick=()=>{jumpTo(i);closeModal();};$('sectionList').append(b);});$('modalCancel').onclick=closeModal;}
function showHelp(){modal('<h2>Siap, atur, baca.</h2><p><strong>1. Siapkan naskah.</strong> Tulis atau impor TXT. Gunakan # OPENING, # ISI, # CLOSING sebagai penanda bagian.</p><p><strong>2. Atur tampilan.</strong> Pilih preset atau buka Pengaturan. Sorot kata dengan ==sorotan== dan beri catatan [JEDA].</p><p><strong>3. Mulai membaca.</strong> Buka Mode baca, lalu tekan Mulai. Scrollbar, roda mouse, sentuhan, tombol Naik/Turun, dan penggeser posisi aktif. Gulir manual menjeda otomatis; tekan Lanjutkan untuk meneruskan dari posisi baru.</p><div class="about-shortcuts"><span><kbd>Space</kbd>Mulai / jeda</span><span><kbd>R</kbd>Kembali ke awal</span><span><kbd>↑ ↓</kbd>Gulir satu baris</span><span><kbd>← →</kbd>Pindah bagian</span><span><kbd>F</kbd>Layar penuh</span><span><kbd>Esc</kbd>Kembali ke editor</span></div><p><strong>Data & offline.</strong> Naskah tersimpan di browser ini. Ekspor JSON untuk cadangan atau pindah perangkat. Unduh aplikasi HTML untuk membuka editor dan teleprompter tanpa internet. Dukungan layar penuh dan layar tetap aktif tergantung browser.</p><p>Klik Ikuti suara untuk mengubah warna teks sesuai ucapan dan menggulir ke baris berikutnya. Izinkan mikrofon; layanan pengenalan bergantung browser dan internet. Jika pengenalan meleset, gunakan tombol Naik/Turun untuk mengoreksi posisi. Kamera tidak direkam.</p><div class="modal-actions"><button class="btn primary" id="modalCancel">Mengerti</button></div>');$('modalCancel').onclick=closeModal;}
function keyboard(e){
 if(e.key==='Escape'){if(!isHidden('modalOverlay')){closeModal();return;}if(!isHidden('settingsDrawer')){closeSettings();return;}if(document.body.classList.contains('sidebar-open')){document.body.classList.remove('sidebar-open');return;}if(readMode){setRead(false);return;}}
 const typing=e.target.closest('input,textarea,select,[contenteditable]');
 if(typing||!isHidden('settingsDrawer')||!isHidden('modalOverlay')||e.ctrlKey||e.metaKey||e.altKey)return;
 const keys=[' ','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','PageUp','PageDown','Home','End','+','=','-','_','r','R','f','F'];
 if(!keys.includes(e.key))return;e.preventDefault();
 if(e.key===' ')play();if(e.key==='ArrowUp')scrollLine(-1);if(e.key==='ArrowDown')scrollLine(1);
 if(e.key==='PageUp')scrollPage(-1);if(e.key==='PageDown')scrollPage(1);
 if(e.key==='Home')seekProgress(0);if(e.key==='End')seekProgress(100);
 if(['+','='].includes(e.key))changeTempo(5);if(['-','_'].includes(e.key))changeTempo(-5);
 if(e.key==='ArrowLeft')jumpSection(-1);if(e.key==='ArrowRight')jumpSection(1);
 if(e.key.toLowerCase()==='r')reset();if(e.key.toLowerCase()==='f')fullscreen();scheduleHide();
}
function trapFocus(e){if(e.key!=='Tab')return;let root=!isHidden('modalOverlay')?$('modalContent'):!isHidden('settingsDrawer')?$('settingsDrawer'):null;if(!root)return;const els=[...root.querySelectorAll('button,a,input,select,textarea,[tabindex="0"]')].filter(x=>!x.disabled&&x.getClientRects().length);if(!els.length)return;const first=els[0],last=els[els.length-1];if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}}
$('newScript').onclick=newScript;$('duplicateScript').onclick=duplicate;$('deleteScript').onclick=removeScript;$('scriptTitle').oninput=updateScript;$('scriptCategory').oninput=updateScript;$('scriptEditor').oninput=updateScript;$('searchScripts').oninput=renderList;
$('settingsBtn').onclick=openSettings;$('readSettings').onclick=openSettings;$('closeSettings').onclick=closeSettings;$('doneSettings').onclick=closeSettings;$('settingsScrim').onclick=closeSettings;$('resetSettings').onclick=async()=>{if(await confirmModal('Reset pengaturan?','Pengaturan kembali ke preset Host. Naskah dan preset pribadi tetap tersedia.','Reset')){state.settings={...defaults};state.preset='host';renderText(true);applySettings();renderSettings();saveNow();}};
$('enterRead').onclick=()=>setRead(true);$('previewExpand').onclick=()=>setRead(true);$('exitRead').onclick=()=>setRead(false);$('fullScreen').onclick=fullscreen;$('playBtn').onclick=play;$('resetBtn').onclick=reset;$('prevSection').onclick=()=>jumpSection(-1);$('nextSection').onclick=()=>jumpSection(1);$('speedQuick').oninput=e=>{setSetting(state.settings.scrollMode==='text'?'wpm':'speed',Number(e.target.value));};$('slowerBtn').onclick=()=>changeTempo(-5);$('fasterBtn').onclick=()=>changeTempo(5);$('scrollUpBtn').onclick=()=>scrollLine(-1);$('scrollDownBtn').onclick=()=>scrollLine(1);$('positionSeek').oninput=e=>seekProgress(Number(e.target.value));
document.querySelectorAll('[data-preset]').forEach(b=>b.onclick=()=>applyPreset(b.dataset.preset));document.querySelectorAll('[data-tab]').forEach(b=>b.onclick=()=>{activeSettingTab=b.dataset.tab;renderSettings();});document.querySelectorAll('[data-format]').forEach(b=>b.onclick=()=>formatting(b.dataset.format));
$('voiceBtn').onclick=toggleVoice;$('savePreset').onclick=savePreset;$('sectionsBtn').onclick=sectionsModal;$('exportTxt').onclick=exportTxt;$('backupBtn').onclick=backup;$('importBtn').onclick=()=>{$('importFile').value='';$('importFile').click();};$('importFile').onchange=e=>importFile(e.target.files[0]);$('helpBtn').onclick=showHelp;
$('menuBtn').onclick=()=>document.body.classList.toggle('sidebar-open');$('sidebarScrim').onclick=()=>document.body.classList.remove('sidebar-open');$('brandLink').onclick=e=>{e.preventDefault();setRead(false);document.body.classList.remove('sidebar-open');};$('modalOverlay').onclick=e=>{if(e.target===$('modalOverlay'))closeModal();};document.addEventListener('keydown',keyboard);document.addEventListener('keydown',trapFocus);
$('viewport').addEventListener('scroll',()=>{if(playback!=='running'&&!voiceWanted&&Math.abs($('viewport').scrollTop-scrollPosition)>.75){scrollPosition=$('viewport').scrollTop;wordCursor=wordAtScroll(scrollPosition);scheduleManualSnap();}updateProgress();},{passive:true});['wheel','touchstart','pointerdown'].forEach(type=>$('viewport').addEventListener(type,()=>{if(voiceWanted||playback==='running'||playback==='countdown')pause();scheduleHide();},{passive:true}));document.addEventListener('pointermove',scheduleHide,{passive:true});document.addEventListener('pointerdown',scheduleHide,{passive:true});
$('viewport').addEventListener('pointerdown',()=>{manualPointerDown=true;clearTimeout(manualSnapTimer);},{passive:true});
window.addEventListener('pointerup',()=>{if(manualPointerDown){manualPointerDown=false;scheduleManualSnap();}},{passive:true});window.addEventListener('pointercancel',()=>{manualPointerDown=false;scheduleManualSnap();},{passive:true});
window.addEventListener('resize',()=>{applySettings();});document.addEventListener('visibilitychange',()=>{if(document.hidden){pause();saveNow();}else if(playback==='running')requestWake();});window.addEventListener('beforeunload',()=>{if(voiceWanted)stopVoice();if(pendingSave)saveNow();});
if(location.protocol==='file:')$('downloadApp').href=location.href;
load();selectScript(state.active);renderPresets();if(!storageAvailable)toast('Penyimpanan lokal tidak tersedia. Gunakan ekspor cadangan.');

// A trusted Hub tab sends one snapshot; practice edits never write the content API.
const hubToken=new URLSearchParams(location.hash.slice(1)).get('hub');
if(hubToken&&window.opener){
 let imported=false;
 document.body.classList.add('hub-session');
 document.querySelectorAll('.hub-return').forEach(button=>{button.classList.remove('hidden');button.onclick=()=>{pause();saveNow();try{window.opener.focus();}catch{}window.close();};});
 document.querySelector('.local-note').textContent='Salinan latihan disimpan di perangkat ini. Untuk mengubah naskah konten, kembali ke Script. Membuka ulang dari Script memuat versi terbaru.';
 const receive=e=>{
  if(imported||e.origin!==location.origin||e.source!==window.opener||e.data?.type!=='hub-teleprompter-load'||e.data.token!==hubToken)return;
  const data=e.data.script;
  if(!data||typeof data.id!=='string'||typeof data.text!=='string'||typeof data.title!=='string'||!data.text.trim())return;
  imported=true;window.removeEventListener('message',receive);
  const id='hub-content-'+data.id;
  const copy={id,title:data.title||'Naskah konten',category:typeof data.category==='string'?data.category:'Konten',text:data.text,updated:new Date().toISOString()};
  const index=state.scripts.findIndex(item=>item.id===id);
  if(index<0)state.scripts.unshift(copy);else state.scripts[index]=copy;
  selectScript(id);saveNow();setRead(true);
  history.replaceState(null,'',location.pathname+location.search);
  window.opener.postMessage({type:'hub-teleprompter-loaded',token:hubToken},location.origin);
 };
 window.addEventListener('message',receive);
 window.opener.postMessage({type:'hub-teleprompter-ready',token:hubToken},location.origin);
}

// Keep the downloadable app self-contained after separating the deployed asset.
if(location.protocol!=='file:')$('downloadApp').onclick=async e=>{
 e.preventDefault();
 try{
  const response=await fetch('/teleprompter.js');
  if(!response.ok||!response.headers.get('content-type')?.includes('javascript'))throw Error('Aplikasi belum dapat diunduh. Muat ulang dan coba lagi.');
  const code=await response.text(),copy=document.documentElement.cloneNode(true);
  const tag=copy.querySelector('script[src="/teleprompter.js"]');tag.removeAttribute('src');tag.textContent=code;
  copy.querySelector('body').className='';copy.querySelectorAll('.hub-return').forEach(button=>button.classList.add('hidden'));
  download('Teleprompter-Studio.html','<!DOCTYPE html>\n'+copy.outerHTML,'text/html');
 }catch(e){toast(e.message);}
};
