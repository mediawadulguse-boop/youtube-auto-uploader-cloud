/* Editable production sheet. Stored in the existing productionNotes rich field. */
window.HubStoryboard=(()=>{
 const headers=['No','Timecode / Estimasi','Durasi','Narasi Lengkap (Voice Over)','Arahan Visual & Jenis Footage','Teknik Editing CapCut & SFX'];
 const labels=['Timecode / Estimasi','Durasi','Narasi lengkap (VO)','Visual & jenis footage','Editing CapCut & SFX'];
 const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const normalized=value=>String(value).replace(/\s+/g,' ').trim().toLowerCase();
 const sameHeaders=cells=>cells.length===6&&cells.every((c,i)=>normalized(c.replace(/\*\*|__/g,''))===normalized(headers[i]));
 const attached=new WeakMap();
 function parseTSV(text){
  const rows=[];let row=[],cell='',quoted=false,atStart=true;
  const input=String(text).replace(/^\uFEFF/,'').replace(/\r\n?/g,'\n');
  for(let i=0;i<input.length;i++){
   const c=input[i];if(quoted){if(c==='"'&&input[i+1]==='"'){cell+='"';i++;}else if(c==='"')quoted=false;else cell+=c;continue;}
   if(c==='"'&&atStart){quoted=true;atStart=false;}else if(c==='\t'){row.push(cell);cell='';atStart=true;}else if(c==='\n'){row.push(cell);rows.push(row);row=[];cell='';atStart=true;}else{cell+=c;atStart=false;}
  }
  if(quoted)throw Error('Ada sel spreadsheet dengan tanda kutip yang belum ditutup.');
  if(cell||row.length){row.push(cell);rows.push(row);}return rows;
 }
 function importRows(text){
  const lines=String(text).replace(/\r\n?/g,'\n').split('\n');
  const cells=line=>line.trim().replace(/^\|/,'').replace(/(?<!\\)\|$/,'').split(/(?<!\\)\|/).map(c=>c.trim().replace(/\\\|/g,'|').replace(/<br\s*\/?>/gi,'\n'));
  const start=lines.findIndex((line,i)=>sameHeaders(cells(line))&&cells(lines[i+1]||'').every(c=>/^:?-{3,}:?$/.test(c))&&cells(lines[i+1]||'').length===6);
  let rows;
  if(start>=0){rows=[];for(let i=start+2;i<lines.length&&lines[i].includes('|');i++)rows.push(cells(lines[i]));}
  else{rows=parseTSV(text);if(sameHeaders(rows[0]||[]))rows.shift();}
  if(!rows.length||rows.some(row=>row.length!==6))throw Error('Gunakan tabel Markdown atau salinan spreadsheet dengan enam kolom sesuai template Storyboard.');
  return rows.map(row=>row.slice(1));
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
  let state={rows:[],notes:'',total:''},history=[],group=null;
  root.innerHTML=`<div class="storyboard-heading"><div><h3>Storyboard produksi</h3><p class="hint">Narasi, visual dan arahan editing dalam satu lembar kerja.</p></div><div class="storyboard-actions"><button type="button" id="storyboardAI" class="btn primary">Script → Storyboard · AI</button><button type="button" id="storyboardAdd" class="btn">+ Shot</button></div></div><div class="storyboard-toolbar"><strong id="storyboardStats" role="status"></strong><button type="button" id="storyboardUndo" class="btn mini" disabled>Urungkan</button><button type="button" id="storyboardTimecode" class="btn mini">Hitung timecode</button><button type="button" id="storyboardCopy" class="btn mini">Salin Markdown</button><button type="button" id="storyboardExport" class="btn mini">Ekspor spreadsheet</button></div><p class="hint storyboard-help">Klik sel untuk mengedit. Tab: sel berikutnya · Ctrl+Enter: shot berikutnya. Bisa tempel dari Excel/Sheets.</p><div class="storyboard-scroll" tabindex="0" aria-label="Tabel storyboard, geser untuk melihat semua kolom"><table class="storyboard-table"><caption class="sr-only">Storyboard produksi yang dapat diedit</caption><colgroup><col class="sb-number"><col class="sb-time"><col class="sb-duration"><col class="sb-narration"><col class="sb-visual"><col class="sb-edit"><col class="sb-actions"></colgroup><thead><tr>${['No',...labels,'Shot'].map(h=>'<th scope="col">'+escape(h)+'</th>').join('')}</tr></thead><tbody id="storyboardRows"></tbody></table><div id="storyboardEmpty" class="empty">Belum ada shot. Tambahkan shot atau ubah Script menjadi Storyboard melalui AI.</div></div><details class="storyboard-import"><summary>Impor tabel Markdown / spreadsheet</summary><p class="hint">Tempel tabel enam kolom dari template. Catatan produksi tetap dipertahankan.</p><textarea id="storyboardImportText" rows="5" aria-label="Tabel storyboard untuk diimpor" placeholder="Tempel tabel Markdown atau enam kolom dari Excel / Google Sheets"></textarea><div class="storyboard-actions"><select id="storyboardImportMode" aria-label="Cara impor"><option value="append">Tambahkan shot</option><option value="replace">Ganti seluruh shot</option></select><button type="button" id="storyboardImportApply" class="btn">Impor tabel</button></div></details><details class="storyboard-notes"><summary>Catatan produksi <span id="storyboardNotesBadge"></span></summary><p class="hint">Catatan lama, lokasi, kebutuhan aset dan arahan umum tetap tersedia di sini.</p><div class="rich-field"><label for="storyboardNotes">Catatan produksi</label><textarea id="storyboardNotes" rows="4" placeholder="Catatan tambahan untuk produksi"></textarea></div></details>`;
  const q=selector=>root.querySelector(selector),notes=q('#storyboardNotes');HubRichText.attach(notes);
  const snapshot=()=>({rows:state.rows.map(row=>[...row]),notes:state.notes,total:state.total});
  function remember(key=null){if(key&&group===key)return;history.push(snapshot());if(history.length>20)history.shift();group=key;q('#storyboardUndo').disabled=false;}
  function status(){q('#storyboardStats').textContent=state.rows.length+' shot · '+totalText(state.rows);q('#storyboardCopy').disabled=q('#storyboardExport').disabled=!state.rows.length;q('#storyboardTimecode').disabled=!state.rows.length;q('#storyboardNotesBadge').textContent=notes.value.trim()?'· Ada catatan':'';}
  function sync(){HubRichText.setFormatted(field,html(state.rows,state.notes,state.total));status();changed();}
  function render(focus){q('#storyboardRows').innerHTML=state.rows.map((row,i)=>`<tr><th scope="row">${i+1}</th>${row.map((cell,j)=>`<td><textarea data-shot="${i}" data-cell="${j}" aria-label="Shot ${i+1}: ${escape(labels[j])}" rows="4" spellcheck="${j>1}" placeholder="${escape(['00:00:00–00:00:05','5 detik','Seluruh narasi pada shot ini','[DOK] / [ARSIP] / [B-ROLL] / [MOTION]','Teknik CapCut dan kata kunci SFX'][j])}">${escape(cell)}</textarea></td>`).join('')}<td class="storyboard-row-actions"><button type="button" data-shot-up="${i}" aria-label="Pindahkan shot ${i+1} ke atas"${i===0?' disabled':''}>↑</button><button type="button" data-shot-down="${i}" aria-label="Pindahkan shot ${i+1} ke bawah"${i===state.rows.length-1?' disabled':''}>↓</button><button type="button" data-shot-delete="${i}" aria-label="Hapus shot ${i+1}">×</button></td></tr>`).join('');q('#storyboardEmpty').hidden=!!state.rows.length;status();if(focus)q(`[data-shot="${focus[0]}"][data-cell="${focus[1]}"]`)?.focus();}
  function load(){
   const text=field.value,markup=HubRichText.html(field);state=parseHTML(markup);
   if(!state.rows.length&&text.includes('|')){try{const rows=importRows(text),rendered=HubScriptFormat.render(text),parsed=parseHTML(rendered);if(parsed.rows.length)state={...parsed,rows};}catch{}}
   HubRichText.setFormatted(notes,state.notes);history=[];group=null;q('#storyboardUndo').disabled=true;q('#storyboardImportText').value='';q('.storyboard-import').open=false;q('.storyboard-notes').open=false;render();q('.storyboard-scroll').scrollLeft=0;q('.storyboard-scroll').scrollTop=0;
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
  q('#storyboardImportApply').onclick=()=>{try{const rows=importRows(q('#storyboardImportText').value);operation(()=>{state.rows=q('#storyboardImportMode').value==='replace'?rows:[...state.rows,...rows];state.total='';});q('#storyboardImportText').value='';q('.storyboard-import').open=false;notify(rows.length+' shot diimpor.');}catch(error){notify(error.message);}};
  q('#storyboardCopy').onclick=async()=>{try{await navigator.clipboard.writeText(markdown(state.rows));notify('Storyboard Markdown disalin.');}catch{notify('Akses clipboard belum tersedia. Gunakan Ekspor spreadsheet.');}};
  q('#storyboardExport').onclick=()=>{const url=URL.createObjectURL(new Blob(['\uFEFF'+tsv(state.rows,true)],{type:'text/tab-separated-values;charset=utf-8'})),a=document.createElement('a');a.href=url;a.download='storyboard.tsv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
  const editor={load,setFormatted(markup){HubRichText.setFormatted(field,markup+state.notes);load();},rows:()=>state.rows.map(row=>[...row])};attached.set(field,editor);load();return editor;
 }
 return {attach,parseTSV,importRows,seconds,duration,clock,markdown,tsv,html,patch,setFormatted:(field,markup)=>{const editor=attached.get(field);if(editor)editor.setFormatted(markup);else HubRichText.setFormatted(field,markup);}};
})();
