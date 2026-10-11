/* Editable production sheet. Stored in the existing productionNotes rich field. */
window.HubStoryboard=(()=>{
 const headers=['No','Timecode / Estimasi','Durasi','Narasi Lengkap (Voice Over)','Arahan Visual & Jenis Footage','Teknik Editing CapCut & SFX'];
 const labels=['Timecode / Estimasi','Durasi','Narasi lengkap (VO)','Visual & jenis footage','Editing CapCut & SFX'];
 const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const normalized=value=>String(value).replace(/\s+/g,' ').trim().toLowerCase();
 const sameHeaders=cells=>cells.length===6&&cells.every((c,i)=>normalized(c.replace(/\*\*|__/g,''))===normalized(headers[i]));
 const attached=new WeakMap();
 const headerNames=[['no','nomor','shot'],['timecode / estimasi','timecode','estimasi','waktu'],['durasi','duration'],['narasi lengkap (voice over)','narasi lengkap (vo)','narasi','voice over','vo'],['arahan visual & jenis footage','visual & jenis footage','arahan visual','visual','footage'],['teknik editing capcut & sfx','editing capcut & sfx','editing & sfx','editing','capcut & sfx']];
 function headerOrder(cells){
  if(cells.length!==6)return null;
  const order=headerNames.map(names=>cells.findIndex(c=>names.includes(normalized(c.replace(/\*\*|__/g,'')))));
  return order.every(i=>i>=0)&&new Set(order).size===6?order:null;
 }
 function parseDelimited(text,delimiter){
  const rows=[];let row=[],cell='',quoted=false,atStart=true,afterQuote=false;
  const input=String(text).replace(/^\uFEFF/,'').replace(/\r\n?/g,'\n');
  for(let i=0;i<input.length;i++){
   const c=input[i];if(quoted){if(c==='"'&&input[i+1]==='"'){cell+='"';i++;}else if(c==='"'){quoted=false;afterQuote=true;}else cell+=c;continue;}
   if(c===delimiter){row.push(cell);cell='';atStart=true;afterQuote=false;}
   else if(c==='\n'){row.push(cell);rows.push(row);row=[];cell='';atStart=true;afterQuote=false;}
   else if(afterQuote){if(c!==' '&&c!=='\t')throw Error('Ada teks di luar tanda kutip sel. Salin ulang tabel atau pilih file sumber.');}
   else if(c==='"'&&atStart){quoted=true;atStart=false;}
   else{cell+=c;atStart=false;}
  }
  if(quoted)throw Error('Ada sel dengan tanda kutip yang belum ditutup. Salin ulang tabel atau pilih file sumber.');
  if(cell||row.length||afterQuote){row.push(cell);rows.push(row);}return rows;
 }
 const parseTSV=text=>parseDelimited(text,'\t');
 function tableRows(rows){
  rows=rows.filter(row=>!(row.length===1&&row[0].trim()===''));
  const order=headerOrder(rows[0]||[]);if(order)rows=rows.slice(1).map(row=>row.length===6?order.map(i=>row[i]):row);
  if(!rows.length||rows.some(row=>row.length!==6||!/^\d+$/.test(row[0].trim())))throw Error('Tabel belum terbaca. Gunakan enam kolom: No, Timecode, Durasi, Narasi, Visual, Editing.');
  return rows.map(row=>row.slice(1));
 }
 function importHTML(markup){
  const template=document.createElement('template');template.innerHTML=markup;
  for(const table of template.content.querySelectorAll('table')){
   const tr=[...table.rows];if(!headerOrder([...tr[0]?.cells||[]].map(textOf)))continue;
   if(tr.some(row=>[...row.cells].some(cell=>cell.colSpan!==1||cell.rowSpan!==1)))throw Error('Ada sel gabungan. Pisahkan sel tabel sebelum menyalinnya.');
   return tableRows(tr.map(row=>[...row.cells].map(textOf)));
  }
  throw Error('Tabel belum terbaca. Salin tabel storyboard lengkap atau pilih file sumber.');
 }
 function importRows(text){
  text=String(text).replace(/^\uFEFF/,'');
  if(/^\s*<(?:table|html|body|div)[\s>]/i.test(text))return importHTML(text);
  const lines=text.replace(/\r\n?/g,'\n').split('\n');
  const cells=line=>line.trim().replace(/^\|/,'').replace(/(?<!\\)\|$/,'').split(/(?<!\\)\|/).map(c=>c.trim().replace(/\\\|/g,'|').replace(/<br\s*\/?>/gi,'\n'));
  const start=lines.findIndex((line,i)=>headerOrder(cells(line))&&cells(lines[i+1]||'').every(c=>/^:?-{3,}:?$/.test(c))&&cells(lines[i+1]||'').length===6);
  if(start>=0){const rows=[cells(lines[start])];for(let i=start+2;i<lines.length&&lines[i].includes('|');i++)rows.push(cells(lines[i]));return tableRows(rows);}
  let quotedError;
  for(const delimiter of ['\t',',',';']){try{return tableRows(parseDelimited(text,delimiter));}catch(error){if(error.message.includes('tanda kutip')&&(!quotedError||error.message.includes('belum ditutup')))quotedError=error;}}
  throw quotedError||Error('Tabel belum terbaca. Pilih file CSV, TSV, Markdown atau TXT berisi storyboard, atau salin tabel lengkap dengan enam kolom.');
 }
 function seconds(value){
  const text=String(value).trim().toLowerCase().replace(/,/g,'.');
  if(/^\d+(?:\.\d+)?$/.test(text))return Number.isFinite(Number(text))?Number(text):null;
  if(/^\d{1,3}:\d{2}(?::\d{2}(?:\.\d+)?)?$/.test(text)){const parts=text.split(':').map(Number);if(parts.slice(1).some(n=>n>=60))return null;return parts.reduce((n,p)=>n*60+p,0);}
  const units=/((?:\d+\.)?\d+|\d+\.\d+)\s*(jam|hours?|h|menit|minutes?|min|m|detik|seconds?|secs?|s)\b/g;let sum=0,match,found=false;
  while((match=units.exec(text))){found=true;sum+=Number(match[1])*({jam:3600,hour:3600,hours:3600,h:3600,menit:60,minute:60,minutes:60,min:60,m:60}[match[2]]||1);}
  return found&&Number.isFinite(sum)&&!text.replace(units,'').trim()?sum:null;
 }
 function duration(rows){const values=rows.map(row=>seconds(row[1]));return {seconds:values.reduce((sum,n)=>sum+(n??0),0),complete:!!rows.length&&values.every(n=>n!==null&&n>0)};}
 function clock(value){const ms=Math.round(value*1000),s=Math.floor(ms/1000);return [Math.floor(s/3600),Math.floor(s%3600/60),s%60].map(n=>String(n).padStart(2,'0')).join(':')+(ms%1000?'.'+String(ms%1000).padStart(3,'0'):'');}
 function totalText(rows){const d=duration(rows);return d.complete?`${Number(d.seconds.toFixed(3)).toLocaleString('id-ID')} detik (estimasi)`:'Belum lengkap — isi durasi tiap shot';}
 function markdown(rows){const cell=value=>String(value).replace(/\|/g,'\\|').replace(/\r\n?|\n/g,'<br>');return '**Total Durasi Keseluruhan: '+totalText(rows)+'**\n\n| '+headers.join(' | ')+' |\n| '+headers.map(()=>'---').join(' | ')+' |'+rows.map((row,i)=>'\n| '+[i+1,...row].map(cell).join(' | ')+' |').join('');}
 function tsv(rows,safe=false){const cell=original=>{const value=safe&&/^\s*[=+@-]/.test(String(original))?"'"+original:String(original);return /[\t\n\r"]/.test(value)?'"'+value.replace(/"/g,'""')+'"':value;};return [headers,...rows.map((row,i)=>[i+1,...row])].map(row=>row.map(cell).join('\t')).join('\n');}
 function html(rows,notes='',total=''){const cell=value=>escape(value).replace(/\r\n?|\n/g,'<br>');return (rows.length?'<p>Total Durasi Keseluruhan: '+escape(duration(rows).complete?totalText(rows):total||totalText(rows))+'</p><table><thead><tr>'+headers.map(h=>'<th>'+escape(h)+'</th>').join('')+'</tr></thead><tbody>'+rows.map((row,i)=>'<tr><td>'+(i+1)+'</td>'+row.map(value=>'<td>'+cell(value)+'</td>').join('')+'</tr>').join('')+'</tbody></table>':'')+notes;}
 function patch(rows,startRow,startColumn,matrix){
  if(startColumn<0||startColumn>4||matrix.some(row=>row.length+startColumn>5))throw Error('Data yang ditempel melebihi kolom Storyboard. Tempel enam kolom lengkap melalui menu Impor tabel.');
  const result=rows.map(row=>[...row]);matrix.forEach((row,i)=>{while(result.length<=startRow+i)result.push(['','','','','']);row.forEach((cell,j)=>result[startRow+i][startColumn+j]=cell);});return result;
 }
 function textOf(node){let text='';const walk=n=>{if(n.nodeType===3){text+=n.data;return;}if(n.nodeName==='BR'){text+='\n';return;}if(['P','DIV','LI'].includes(n.nodeName)&&text&&!text.endsWith('\n'))text+='\n';for(const child of n.childNodes)walk(child);if(['P','DIV','LI'].includes(n.nodeName)&&!text.endsWith('\n'))text+='\n';};walk(node);return text.replace(/\n$/,'').replace(/\u00a0/g,' ');}
 function parseHTML(markup){
  const root=document.createElement('div');root.innerHTML=markup;let table,rows=[];
  for(const candidate of root.querySelectorAll('table')){const tr=[...candidate.rows],head=tr[0];if(!head||!sameHeaders([...head.cells].map(textOf)))continue;if(tr.slice(1).some(r=>r.cells.length!==6))continue;table=candidate;rows=tr.slice(1).map(r=>[...r.cells].slice(1).map(textOf));break;}
  let total='';if(table){const before=table.previousElementSibling;if(before&&/^(?:total\s+durasi\s+keseluruhan)\s*:/i.test(textOf(before))){total=textOf(before).replace(/^[^:]+:\s*/,'');before.remove();}table.remove();}
  return {rows,total,notes:root.innerHTML};
 }
 function attach(field,root,{notify=()=>{},changed=()=>{}}={}){
  if(attached.has(field))return attached.get(field);
  let state={rows:[],notes:'',total:''},history=[],group=null,importEpoch=0;
  root.innerHTML=`<div class="storyboard-toolbar" aria-label="Alat Storyboard"><button type="button" id="storyboardAdd" class="btn mini primary">+ Shot</button><button type="button" id="storyboardUndo" class="btn mini" disabled>Urungkan</button><button type="button" id="storyboardTimecode" class="btn mini">Hitung timecode</button><span class="storyboard-tool-separator" aria-hidden="true"></span><button type="button" id="storyboardAI" class="btn mini">Script → Storyboard · AI</button><details class="storyboard-import"><summary class="btn mini">Impor</summary><div class="storyboard-popover"><h3>Masukkan storyboard</h3><button type="button" id="storyboardChooseFile" class="btn">Pilih file</button><input type="file" id="storyboardImportFile" accept=".csv,.tsv,.md,.txt,text/csv,text/tab-separated-values,text/markdown,text/plain" hidden><span id="storyboardImportFilename" class="hint"></span><label for="storyboardImportText">Atau tempel tabel di sini</label><textarea id="storyboardImportText" rows="4" aria-describedby="storyboardImportStatus" placeholder="Salin tabel dari ChatGPT, Excel atau Google Sheets"></textarea><div class="storyboard-import-preview"><p id="storyboardImportStatus" role="status">Pilih file atau tempel tabel. Kolom dibaca otomatis.</p><p id="storyboardImportSample" hidden></p></div><label id="storyboardReplaceLabel" class="inline-check" hidden><input id="storyboardImportReplace" type="checkbox"> Ganti storyboard yang ada</label><button type="button" id="storyboardImportApply" class="btn primary" disabled>Masukkan storyboard</button></div></details><details class="storyboard-notes"><summary class="btn mini">Catatan <span id="storyboardNotesBadge"></span></summary><div class="storyboard-popover"><h3>Catatan produksi</h3><p class="hint">Catatan lama, lokasi, kebutuhan aset dan arahan umum tetap tersedia di sini.</p><div class="rich-field"><label for="storyboardNotes">Catatan produksi</label><textarea id="storyboardNotes" rows="4" placeholder="Catatan tambahan untuk produksi"></textarea></div></div></details><details class="storyboard-more"><summary class="btn mini">Ekspor</summary><div class="storyboard-popover storyboard-export-menu"><button type="button" id="storyboardCopy" class="btn mini">Salin Markdown</button><button type="button" id="storyboardExport" class="btn mini">Ekspor spreadsheet</button></div></details></div><div class="storyboard-scroll" tabindex="0" aria-label="Tabel storyboard, geser untuk melihat semua kolom"><table class="storyboard-table"><caption class="sr-only">Storyboard produksi yang dapat diedit</caption><colgroup><col class="sb-number"><col class="sb-time"><col class="sb-duration"><col class="sb-narration"><col class="sb-visual"><col class="sb-edit"><col class="sb-actions"></colgroup><thead><tr>${['No',...labels,'Shot'].map(h=>'<th scope="col">'+escape(h)+'</th>').join('')}</tr></thead><tbody id="storyboardRows"></tbody></table><div id="storyboardEmpty" class="empty">Belum ada shot. Tambahkan shot atau ubah Script menjadi Storyboard melalui AI.</div></div><div class="storyboard-statusbar"><strong id="storyboardStats" role="status"></strong><span class="storyboard-help">Tab: sel berikutnya · Ctrl+Enter: shot berikutnya · Tempel dari Excel/Sheets</span></div>`;
  const q=selector=>root.querySelector(selector),notes=q('#storyboardNotes');HubRichText.attach(notes);
  const filledRows=()=>state.rows.filter(row=>row.some(cell=>cell.trim()));
  function previewImport(){
   q('#storyboardReplaceLabel').hidden=!filledRows().length;
   const text=q('#storyboardImportText').value,button=q('#storyboardImportApply'),status=q('#storyboardImportStatus'),sample=q('#storyboardImportSample');
   button.disabled=true;button.textContent='Masukkan storyboard';sample.hidden=true;status.classList.remove('import-error');
   if(!text.trim()){status.textContent='Pilih file atau tempel tabel. Kolom dibaca otomatis.';return;}
   try{const rows=importRows(text);status.textContent=rows.length+' shot siap dimasukkan';sample.textContent=rows[0][2];sample.hidden=false;button.textContent='Masukkan '+rows.length+' shot';button.disabled=false;}
   catch(error){status.textContent=error.message;status.classList.add('import-error');}
  }
  function resetImport(){importEpoch++;q('#storyboardImportText').value='';q('#storyboardImportFile').value='';q('#storyboardImportFilename').textContent='';q('#storyboardImportReplace').checked=false;previewImport();}
  q('#storyboardChooseFile').onclick=()=>{q('#storyboardImportFile').value='';q('#storyboardImportFile').click();};
  q('#storyboardImportFile').onchange=async()=>{
   const file=q('#storyboardImportFile').files[0];if(!file)return;const epoch=++importEpoch;
   q('#storyboardImportApply').disabled=true;q('#storyboardImportStatus').textContent='Membaca file…';
   try{const text=await file.text();if(epoch!==importEpoch)return;q('#storyboardImportText').value=text;q('#storyboardImportFilename').textContent=file.name;previewImport();}
   catch{if(epoch!==importEpoch)return;q('#storyboardImportText').value='';q('#storyboardImportSample').hidden=true;q('#storyboardImportStatus').textContent='File belum bisa dibaca. Pilih ulang file tersebut.';}
  };
  q('#storyboardImportText').oninput=()=>{importEpoch++;q('#storyboardImportFilename').textContent='';previewImport();};
  q('#storyboardImportText').onpaste=e=>{
   const markup=e.clipboardData?.getData('text/html');if(!markup)return;
   try{const rows=importHTML(markup);e.preventDefault();importEpoch++;q('#storyboardImportText').value=tsv(rows);q('#storyboardImportFilename').textContent='';previewImport();}catch{}
  };
  const snapshot=()=>({rows:state.rows.map(row=>[...row]),notes:state.notes,total:state.total});
  function remember(key=null){if(key&&group===key)return;history.push(snapshot());if(history.length>20)history.shift();group=key;q('#storyboardUndo').disabled=false;}
  function status(){q('#storyboardStats').textContent=state.rows.length+' shot · '+totalText(state.rows);q('#storyboardCopy').disabled=q('#storyboardExport').disabled=!state.rows.length;q('#storyboardTimecode').disabled=!state.rows.length;q('#storyboardNotesBadge').textContent=notes.value.trim()?'●':'';}
  function sync(){HubRichText.setFormatted(field,html(state.rows,state.notes,state.total));status();changed();}
  function render(focus){q('#storyboardRows').innerHTML=state.rows.map((row,i)=>`<tr><th scope="row">${i+1}</th>${row.map((cell,j)=>`<td><textarea data-shot="${i}" data-cell="${j}" aria-label="Shot ${i+1}: ${escape(labels[j])}" rows="4" spellcheck="${j>1}" placeholder="${escape(['00:00:00–00:00:05','5 detik','Seluruh narasi pada shot ini','[DOK] / [ARSIP] / [B-ROLL] / [MOTION]','Teknik CapCut dan kata kunci SFX'][j])}">${escape(cell)}</textarea></td>`).join('')}<td class="storyboard-row-actions"><button type="button" data-shot-up="${i}" aria-label="Pindahkan shot ${i+1} ke atas"${i===0?' disabled':''}>↑</button><button type="button" data-shot-down="${i}" aria-label="Pindahkan shot ${i+1} ke bawah"${i===state.rows.length-1?' disabled':''}>↓</button><button type="button" data-shot-delete="${i}" aria-label="Hapus shot ${i+1}">×</button></td></tr>`).join('');q('#storyboardEmpty').hidden=!!state.rows.length;status();previewImport();if(focus)q(`[data-shot="${focus[0]}"][data-cell="${focus[1]}"]`)?.focus();}
  function load(){
   const text=field.value,markup=HubRichText.html(field);state=parseHTML(markup);
   if(!state.rows.length&&text.includes('|')){try{const rows=importRows(text),rendered=HubScriptFormat.render(text),parsed=parseHTML(rendered);if(parsed.rows.length)state={...parsed,rows};}catch{}}
   HubRichText.setFormatted(notes,state.notes);history=[];group=null;q('#storyboardUndo').disabled=true;resetImport();q('.storyboard-import').open=false;q('.storyboard-notes').open=false;render();q('.storyboard-scroll').scrollLeft=0;q('.storyboard-scroll').scrollTop=0;
  }
  function operation(fn,focus){remember();fn();state.total='';render(focus);sync();}
  root.addEventListener('input',e=>{e.stopPropagation();if(e.target.matches('[data-cell]')){const i=Number(e.target.dataset.shot),j=Number(e.target.dataset.cell);remember(i+':'+j);state.rows[i][j]=e.target.value;if(j===1)state.total='';sync();}else if(e.target===notes){remember('notes');state.notes=HubRichText.html(notes);sync();}});
  root.addEventListener('focusout',()=>{group=null;});
  root.addEventListener('change',e=>e.stopPropagation());
  root.addEventListener('paste',e=>{if(!e.target.matches('[data-cell]'))return;const text=e.clipboardData.getData('text/plain');if(!text.includes('\t'))return;e.preventDefault();try{let matrix=parseTSV(text);if(sameHeaders(matrix[0]||[]))matrix.shift();const i=Number(e.target.dataset.shot),j=Number(e.target.dataset.cell);if(j===0&&matrix.every(row=>row.length===6&&/^\d+$/.test(row[0].trim())))matrix=matrix.map(row=>row.slice(1));const next=patch(state.rows,i,j,matrix);operation(()=>state.rows=next,[i,j]);notify('Sel spreadsheet ditempel.');}catch(error){notify(error.message);}});
  root.addEventListener('keydown',e=>{if(e.isComposing||!e.target.matches('[data-cell]'))return;let i=Number(e.target.dataset.shot),j=Number(e.target.dataset.cell);if(e.key==='Tab'){const n=i*5+j+(e.shiftKey?-1:1);if(n<0||n>=state.rows.length*5)return;e.preventDefault();q(`[data-shot="${Math.floor(n/5)}"][data-cell="${n%5}"]`).focus();}else if(e.key==='Enter'&&(e.ctrlKey||e.metaKey)){e.preventDefault();if(i+1===state.rows.length)operation(()=>state.rows.push(['','','','','']),[i+1,j]);else q(`[data-shot="${i+1}"][data-cell="${j}"]`).focus();}});
  root.addEventListener('click',e=>{const b=e.target.closest('[data-shot-up],[data-shot-down],[data-shot-delete]');if(!b)return;const i=Number(b.dataset.shotUp??b.dataset.shotDown??b.dataset.shotDelete);if(b.hasAttribute('data-shot-delete'))operation(()=>state.rows.splice(i,1));else{const next=i+(b.hasAttribute('data-shot-up')?-1:1);if(next<0||next>=state.rows.length)return;operation(()=>[state.rows[i],state.rows[next]]=[state.rows[next],state.rows[i]],[next,0]);}});
  q('#storyboardAdd').onclick=()=>operation(()=>state.rows.push(['','','','','']),[state.rows.length,0]);
  q('#storyboardUndo').onclick=()=>{if(!history.length)return;state=history.pop();group=null;HubRichText.setFormatted(notes,state.notes);render();sync();q('#storyboardUndo').disabled=!history.length;};
  q('#storyboardTimecode').onclick=()=>{if(!duration(state.rows).complete)return notify('Isi durasi angka untuk setiap shot, misalnya 5 detik.');operation(()=>{let from=0;for(const row of state.rows){const to=from+seconds(row[1]);row[0]=clock(from)+'–'+clock(to);from=to;}state.total='';});notify('Timecode dihitung dari durasi shot. Periksa kembali terhadap rekaman VO.');};
  q('#storyboardImportApply').onclick=()=>{try{const rows=importRows(q('#storyboardImportText').value);operation(()=>{state.rows=q('#storyboardImportReplace').checked?rows:[...filledRows(),...rows];state.total='';});resetImport();q('.storyboard-import').open=false;notify(rows.length+' shot dimasukkan. Gunakan Urungkan jika perlu.');}catch(error){previewImport();notify(error.message);}};
  q('#storyboardCopy').onclick=async()=>{try{await navigator.clipboard.writeText(markdown(state.rows));notify('Storyboard Markdown disalin.');}catch{notify('Akses clipboard belum tersedia. Gunakan Ekspor spreadsheet.');}};
  q('#storyboardExport').onclick=()=>{const url=URL.createObjectURL(new Blob(['\uFEFF'+tsv(state.rows,true)],{type:'text/tab-separated-values;charset=utf-8'})),a=document.createElement('a');a.href=url;a.download='storyboard.tsv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
  const editor={load,setFormatted(markup){HubRichText.setFormatted(field,markup+state.notes);load();},rows:()=>state.rows.map(row=>[...row])};attached.set(field,editor);load();return editor;
 }
 return {attach,parseTSV,parseDelimited,importRows,seconds,duration,clock,markdown,tsv,html,patch,setFormatted:(field,markup)=>{const editor=attached.get(field);if(editor)editor.setFormatted(markup);else HubRichText.setFormatted(field,markup);}};
})();
