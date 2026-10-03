import sanitizeHtml from 'sanitize-html';
import { parseDocument } from 'htmlparser2';

export const RICH_FIELDS = ['brief','hook','script','cta','productionNotes'];
const blocks = new Set(['p','div','li','blockquote','h2','h3']);
const fail = message => Object.assign(new Error(message), {status:400});
export function safeLink(value) {
  try { const u = new URL(value); return ['https:','http:','mailto:'].includes(u.protocol) ? u.href : ''; } catch { return ''; }
}
export function cleanRichHtml(value) {
  if (typeof value !== 'string' || value.length > 1500000) throw fail('Format teks tidak valid atau terlalu panjang');
  return sanitizeHtml(value, {
    allowedTags:['p','div','br','b','strong','i','em','u','s','strike','ul','ol','li','blockquote','h2','h3','font','span','a','table','thead','tbody','tr','th','td'],
    allowedAttributes:{a:['href','target','rel'],font:['size']},
    allowedSchemes:['https','http','mailto'], allowProtocolRelative:false,
    transformTags:{
      a:(_tag,attrs)=>({tagName:'a',attribs:safeLink(attrs.href)?{href:safeLink(attrs.href),target:'_blank',rel:'noopener noreferrer'}:{}}),
      font:(_tag,attrs)=>({tagName:'font',attribs:/^[1-7]$/.test(attrs.size)?{size:attrs.size}:{}})
    }
  });
}
export function richPlainText(html) {
  let text='',trailingBlock=false;
  const walk=node=>{
    if(node.type==='text'){text+=node.data;trailingBlock=false;return;}
    if(node.name==='br'){text+='\n';trailingBlock=false;return;}
    if(node.name==='tr'){if(text&&!text.endsWith('\n'))text+='\n';const cells=(node.children||[]).filter(c=>['th','td'].includes(c.name));cells.forEach((cell,i)=>{if(i)text+='\t';for(const child of cell.children||[])walk(child);});if(!text.endsWith('\n'))text+='\n';trailingBlock=true;return;}
    if(blocks.has(node.name)&&text&&!text.endsWith('\n')){text+='\n';trailingBlock=true;}
    for(const child of node.children||[])walk(child);
    if(blocks.has(node.name)&&!text.endsWith('\n')){text+='\n';trailingBlock=true;}
  };
  walk(parseDocument(html));
  return (trailingBlock?text.replace(/\n$/,''):text).replace(/\u00a0/g,' ');
}
// The HTML is authoritative only when explicitly supplied. Plain text updates
// from older clients clear obsolete formatting instead of reviving stale text.
export function richField(input, base, key, htmlKey, limit) {
  if(Object.hasOwn(input,htmlKey)) {
    const html=cleanRichHtml(input[htmlKey]);
    if(!html)return {text:input[key]??base[key]??'',html:''};
    const text=richPlainText(html);
    if(text.length>limit)throw fail(`Teks melebihi ${limit} karakter`);
    return {text,html:text.trim()?html:''};
  }
  return {text:input[key]??base[key]??'',html:Object.hasOwn(input,key)&&input[key]!==base[key]?'':base[htmlKey]||''};
}
