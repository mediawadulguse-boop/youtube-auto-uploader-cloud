const columnManagerState={columns:[],revision:0,removeId:null,busy:false};
const COLUMN_ICON_NAMES={bulb:'Ide / lampu',pen:'Naskah / pena',camera:'Produksi / kamera',scissors:'Editing / gunting',eye:'Review / mata',check:'Selesai / centang',cloud:'Cloud',clock:'Waktu',upload:'Upload',calendar:'Kalender',play:'Tayang',alert:'Perhatian'};
function isDoneStage(id){return !!hub.data.columns?.find(c=>c.id===id)?.isDone}
function syncBoardColumns(data){
  window.boardColumns=data.columns;
  STAGE_NAMES=Object.fromEntries(data.columns.map(c=>[c.id,c.name]));
  if(hub.composer&&!data.columns.some(c=>c.id===hub.composer.stage))hub.composer.stage=data.columns[0].id;
  if(hub.editing){
    const select=formValue('stage'),stage=select.value;
    if(!data.columns.some(c=>c.id===stage)){
      hub.editing.conflict=true;clearTimeout(hub.timer);showConflict('Kolom konten ini berubah atau dihapus. Muat versi server atau simpan draft sebagai salinan.');
    }else select.innerHTML=options(Object.entries(STAGE_NAMES),stage);
  }
}
function renderColumnManager(){
  const state=columnManagerState;
  $('#columnManagerList').innerHTML=state.columns.map((c,i)=>`<div class="column-setting-row"><div>${statusBadge('production',c.id)}${c.isDone?'<small>Selesai</small>':''}</div><div class="feature-actions"><button class="icon-button" data-column-shift="${c.id}" data-direction="-1" aria-label="Geser ${esc(c.name)} ke kiri"${i===0||state.busy?' disabled':''}>←</button><button class="icon-button" data-column-shift="${c.id}" data-direction="1" aria-label="Geser ${esc(c.name)} ke kanan"${i===state.columns.length-1||state.busy?' disabled':''}>→</button><button class="btn mini" data-column-edit="${c.id}">Ubah</button><button class="btn mini danger" data-column-remove="${c.id}"${state.columns.length===1?' disabled':''}>Hapus</button></div></div>`).join('');
}
function resetColumnForm(){const form=$('#columnForm');form.reset();form.elements.id.value='';form.elements.color.value='#3263e7';$('#columnFormTitle').textContent='Tambah kolom';$('#removeColumnPanel').classList.add('hide');columnManagerState.removeId=null;}
function editColumn(id){const c=columnManagerState.columns.find(c=>c.id===id);if(!c)return;const form=$('#columnForm');for(const key of ['id','name','color','icon'])form.elements[key].value=c[key];form.elements.isDone.checked=c.isDone;$('#columnFormTitle').textContent='Ubah kolom';$('#removeColumnPanel').classList.add('hide');form.elements.name.focus();}
function openColumnManager(editId=null){
  columnManagerState.columns=structuredClone(hub.data.columns);columnManagerState.revision=hub.data.boardRevision;columnManagerState.busy=false;
  hub.columnMenu=null;$('#columnManagerError').classList.add('hide');resetColumnForm();renderColumnManager();$('#columnManager').showModal();if(editId)editColumn(editId);
}
async function saveColumnChange(url,method,body){
  if(columnManagerState.busy)return false;
  columnManagerState.busy=true;$('#columnManagerError').classList.add('hide');$('#columnManager').querySelectorAll('button:not(#closeColumnManager)').forEach(b=>b.disabled=true);
  try{
    const r=await api(url,{method,body:JSON.stringify({...body,boardRevision:columnManagerState.revision})});
    columnManagerState.columns=r.columns;columnManagerState.revision=r.boardRevision;
    hub.data.columns=r.columns;hub.data.boardRevision=r.boardRevision;syncBoardColumns(hub.data);renderHub();
    await loadHub();await loadHub();return true;
  }catch(e){$('#columnManagerError').textContent=e.message+' Tutup lalu buka pengaturan untuk memuat kolom terbaru.';$('#columnManagerError').classList.remove('hide');return false}
  finally{columnManagerState.busy=false;$('#columnManager').querySelectorAll('button').forEach(b=>b.disabled=false);renderColumnManager()}
}
document.addEventListener('click',e=>{const el=e.target.closest('[data-manage-columns],[data-edit-column]');if(el)openColumnManager(el.dataset.editColumn||null)});
$('#closeColumnManager').onclick=()=>{if(!columnManagerState.busy)$('#columnManager').close()};
$('#columnManager').addEventListener('cancel',e=>{if(columnManagerState.busy)e.preventDefault()});
$('#resetColumnForm').onclick=resetColumnForm;
$('#columnForm').elements.icon.innerHTML=Object.entries(COLUMN_ICON_NAMES).map(([value,label])=>`<option value="${value}">${label}</option>`).join('');
$('#columnForm').onsubmit=async e=>{e.preventDefault();const f=e.target,id=f.elements.id.value;if(await saveColumnChange('/api/columns'+(id?'/'+id:''),id?'PATCH':'POST',{name:f.elements.name.value,color:f.elements.color.value,icon:f.elements.icon.value,isDone:f.elements.isDone.checked})){resetColumnForm();toast('Kolom disimpan.')}};
$('#columnManagerList').onclick=async e=>{
  const el=e.target.closest('[data-column-edit],[data-column-remove],[data-column-shift]');if(!el||columnManagerState.busy)return;
  if(el.dataset.columnEdit)editColumn(el.dataset.columnEdit);
  if(el.dataset.columnRemove){const id=el.dataset.columnRemove,c=columnManagerState.columns.find(c=>c.id===id);columnManagerState.removeId=id;const count=hub.data.contents.filter(c=>c.stage===id).length;$('#removeColumnDescription').textContent=`${c.name}: ${count} kartu (termasuk arsip) akan dipindahkan. Script dan riset tetap disimpan.`;$('#columnMoveTo').innerHTML=options(columnManagerState.columns.filter(c=>c.id!==id).map(c=>[c.id,c.name]));$('#removeColumnPanel').classList.remove('hide');$('#removeColumnPanel').scrollIntoView({block:'nearest'});}
  if(el.dataset.columnShift){const ids=columnManagerState.columns.map(c=>c.id),i=ids.indexOf(el.dataset.columnShift),j=i+Number(el.dataset.direction);if(j<0||j>=ids.length)return;[ids[i],ids[j]]=[ids[j],ids[i]];await saveColumnChange('/api/columns/order','POST',{ids});}
};
$('#confirmRemoveColumn').onclick=async()=>{const id=columnManagerState.removeId;if(!id||!confirm('Pindahkan semua kartu, lalu hapus kolom ini?'))return;if(await saveColumnChange('/api/columns/'+id,'DELETE',{moveTo:$('#columnMoveTo').value})){resetColumnForm();toast('Kartu dipindahkan dan kolom dihapus.')}};
