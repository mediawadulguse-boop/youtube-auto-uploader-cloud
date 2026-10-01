// Small, local icon set: no external fonts, scripts, or requests.
const HUB_ICONS = {
  dashboard:'<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  calendar:'<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 11h18M8 15h2m4 0h2M8 18h2"/>',
  board:'<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16M15 4v16M6 8v5m6-5v8m6-8v3"/>',
  folder:'<path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/>',
  upload:'<path d="M12 16V3m-5 5 5-5 5 5M4 15v5a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-5"/>',
  chart:'<path d="M4 3v17h17M8 16v-4m5 4V8m5 8V5"/>',
  layers:'<path d="m12 3 10 5-10 5L2 8Zm-9 9 9 5 9-5M3 16l9 5 9-5"/>',
  menu:'<path d="M4 6h16M4 12h16M4 18h16"/>',
  close:'<path d="m6 6 12 12M6 18 18 6"/>',
  plus:'<path d="M12 5v14M5 12h14"/>',
  more:'<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
  filter:'<path d="M4 6h16M7 12h10M10 18h4"/>',
  move:'<path d="M4 12h16m-5-5 5 5-5 5M4 5v14"/>',
  clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  check:'<rect x="3" y="3" width="18" height="18" rx="3"/><path d="m7 12 3 3 7-7"/>',
  text:'<path d="M5 5h14M5 10h14M5 15h10M5 20h7"/>',
  paperclip:'<path d="m8 13 7-7a3 3 0 0 1 4 4L9 20a5 5 0 0 1-7-7L13 2m3 7-8 8a1 1 0 0 1-2-2l8-8"/>',
  logout:'<path d="M9 4H4v16h5m7-13 5 5-5 5M8 12h13"/>',
  spark:'<path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5Z"/>',
  chevron:'<path d="m9 5 7 7-7 7"/>'
};
function hubIcon(name, className=''){return `<svg class="hub-icon ${className}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${HUB_ICONS[name]||HUB_ICONS.text}</svg>`}
document.querySelectorAll('[data-icon]').forEach(el=>el.innerHTML=hubIcon(el.dataset.icon));
let navigationReturnFocus=null;
function setNavigation(open){
  if(open)navigationReturnFocus=document.activeElement;
  document.body.classList.toggle('navigation-open',open);
  syncNavigation();
  $('#navBackdrop').classList.toggle('hide',!open);
  $('#menuToggle').setAttribute('aria-expanded',String(open));
  $('#menuToggle').setAttribute('aria-label',open?'Tutup navigasi':'Buka navigasi');
  if(open)$('#closeNavigation').focus();
  else if(navigationReturnFocus){navigationReturnFocus.focus();navigationReturnFocus=null}
}
$('#menuToggle').onclick=()=>setNavigation(!document.body.classList.contains('navigation-open'));
$('#closeNavigation').onclick=()=>setNavigation(false);
$('#navBackdrop').onclick=()=>setNavigation(false);
document.addEventListener('keydown',e=>{
  if(!document.body.classList.contains('navigation-open'))return;
  if(e.key==='Escape'){e.preventDefault();setNavigation(false)}
  if(e.key==='Tab'){
    const buttons=[...$('#mainNavigation').querySelectorAll('button')].filter(el=>el.getClientRects().length);
    const first=buttons[0],last=buttons.at(-1);
    if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus()}
    else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus()}
  }
});
const mobileNavigation=matchMedia('(max-width: 900px)');
function syncNavigation(){
  const hidden=mobileNavigation.matches&&!document.body.classList.contains('navigation-open');
  $('#mainNavigation').inert=hidden;
  $('#mainNavigation').setAttribute('aria-hidden',String(hidden));
  if(!mobileNavigation.matches&&document.body.classList.contains('navigation-open'))setNavigation(false);
}
new MutationObserver(syncNavigation).observe(document.body,{attributes:true,attributeFilter:['class']});
mobileNavigation.addEventListener('change',syncNavigation);
syncNavigation();
window.updateWorkspaceChrome=function(view,title){
  $('#contentHub').dataset.view=view;
  $('#currentViewName').textContent=title;
  const channel=state.server?.channel;
  $('#workspaceChannel').textContent=channel?.title||'YouTube belum terhubung';
  $('#workspaceDot').classList.toggle('on',!!state.server?.youtubeConnected);
  document.querySelectorAll('.hub-nav [data-view]').forEach(el=>el.setAttribute('aria-current',el.dataset.view===view?'page':'false'));
};
