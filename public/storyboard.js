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
 function attach(field,root,{notify=()=>{}}={}){
  if(attached.has(field))return attached.get(field);
  const rich=HubRichText.attach(field),toolbar=document.createElement('div');toolbar.className='storyboard-toolbar';
  toolbar.innerHTML=`<button type="button" id="storyboardAI" class="btn mini">Script → Storyboard · AI</button><details class="storyboard-import"><summary class="btn mini">Impor</summary><div class="storyboard-popover"><h3>Masukkan storyboard</h3><button type="button" id="storyboardChooseFile" class="btn">Pilih file</button><input type="file" id="storyboardImportFile" accept=".csv,.tsv,.md,.txt,text/csv,text/tab-separated-values,text/markdown,text/plain" hidden><span id="storyboardImportFilename" class="hint"></span><label for="storyboardImportText">Atau tempel tabel di sini</label><textarea id="storyboardImportText" rows="4" aria-describedby="storyboardImportStatus" placeholder="Salin tabel dari ChatGPT, Excel atau Google Sheets"></textarea><div class="storyboard-import-preview"><p id="storyboardImportStatus" role="status">Pilih file atau tempel tabel. Kolom dibaca otomatis.</p><p id="storyboardImportSample" hidden></p></div><label id="storyboardReplaceLabel" class="inline-check" hidden><input id="storyboardImportReplace" type="checkbox"> Ganti tabel storyboard</label><button type="button" id="storyboardImportApply" class="btn primary" disabled>Masukkan storyboard</button></div></details><details class="storyboard-more"><summary class="btn mini">Ekspor</summary><div class="storyboard-popover storyboard-export-menu"><button type="button" id="storyboardCopy" class="btn mini">Salin Markdown</button><button type="button" id="storyboardExport" class="btn mini">Ekspor spreadsheet</button></div></details>`;
  const documentArea=document.createElement('div');documentArea.className='storyboard-document';documentArea.append(field,rich.input.closest('.rich-editor'));root.replaceChildren(toolbar,documentArea);
  rich.input.setAttribute('aria-label','Storyboard');rich.input.dataset.placeholder='Tulis storyboard di sini, atau tempel teks dan tabel dari ChatGPT.';
  const q=selector=>root.querySelector(selector);let epoch=0;
  const current=()=>parseHTML(HubRichText.html(field));
  const hasShots=()=>current().rows.some(row=>row.some(c=>c.trim()));
  function preview(){const button=q('#storyboardImportApply'),status=q('#storyboardImportStatus'),sample=q('#storyboardImportSample'),text=q('#storyboardImportText').value;q('#storyboardReplaceLabel').hidden=!hasShots();button.disabled=true;button.textContent='Masukkan storyboard';sample.hidden=true;status.classList.remove('import-error');if(!text.trim()){status.textContent='Pilih file atau tempel tabel. Kolom dibaca otomatis.';return;}try{const rows=importRows(text);status.textContent=rows.length+' shot siap dimasukkan';sample.textContent=rows[0][2];sample.hidden=false;button.disabled=false;button.textContent='Masukkan '+rows.length+' shot';}catch(error){status.textContent=error.message;status.classList.add('import-error');}}
  function load(){epoch++;q('#storyboardImportText').value='';q('#storyboardImportFile').value='';q('#storyboardImportFilename').textContent='';q('#storyboardImportReplace').checked=false;q('.storyboard-import').open=false;q('.storyboard-more').open=false;preview();rich.input.scrollTop=0;rich.input.scrollLeft=0;}
  q('#storyboardChooseFile').onclick=()=>{q('#storyboardImportFile').value='';q('#storyboardImportFile').click();};
  q('#storyboardImportFile').onchange=async()=>{const file=q('#storyboardImportFile').files[0];if(!file)return;const request=++epoch;q('#storyboardImportApply').disabled=true;q('#storyboardImportStatus').textContent='Membaca file…';try{const text=await file.text();if(request!==epoch)return;q('#storyboardImportText').value=text;q('#storyboardImportFilename').textContent=file.name;preview();}catch{if(request!==epoch)return;q('#storyboardImportText').value='';q('#storyboardImportSample').hidden=true;q('#storyboardImportStatus').textContent='File belum bisa dibaca. Pilih ulang file tersebut.';}};
  q('#storyboardImportText').oninput=()=>{epoch++;q('#storyboardImportFilename').textContent='';preview();};
  q('#storyboardImportText').onpaste=e=>{const markup=e.clipboardData?.getData('text/html');if(!markup)return;try{const rows=importHTML(markup);e.preventDefault();epoch++;q('#storyboardImportText').value=tsv(rows);preview();}catch{}};
  toolbar.addEventListener('input',e=>e.stopPropagation());toolbar.addEventListener('change',e=>e.stopPropagation());
  q('.storyboard-import').addEventListener('toggle',()=>{if(q('.storyboard-import').open)preview();});
  q('#storyboardImportApply').onclick=()=>{try{const rows=importRows(q('#storyboardImportText').value),existing=HubRichText.html(field),parsed=current();const keep=q('#storyboardImportReplace').checked||!hasShots()?parsed.notes:existing;rich.replace(keep+html(rows));load();notify(rows.length+' shot dimasukkan. Ctrl+Z untuk urungkan.');}catch(error){preview();notify(error.message);}};
  q('#storyboardCopy').onclick=async()=>{try{const rows=current().rows;await navigator.clipboard.writeText(rows.length?markdown(rows):field.value);notify('Storyboard disalin.');}catch{notify('Akses clipboard belum tersedia.');}};
  q('#storyboardExport').onclick=()=>{const rows=current().rows;if(!rows.length)return notify('Storyboard belum memiliki tabel enam kolom.');const url=URL.createObjectURL(new Blob(['\uFEFF'+tsv(rows,true)],{type:'text/tab-separated-values;charset=utf-8'})),a=document.createElement('a');a.href=url;a.download='storyboard.tsv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
  const editor={load,setFormatted(markup){const parsed=current();rich.replace(markup+parsed.notes);load();},rows:()=>current().rows};attached.set(field,editor);load();return editor;
 }

 return {attach,parseTSV,parseDelimited,importRows,seconds,duration,clock,markdown,tsv,html,patch,setFormatted:(field,markup)=>{const editor=attached.get(field);if(editor)editor.setFormatted(markup);else HubRichText.setFormatted(field,markup);}};
})();
