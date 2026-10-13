import sanitizeHtml from 'sanitize-html';
import { parseDocument } from 'htmlparser2';

export const RICH_FIELDS = ['brief','hook','script','cta','productionNotes','description'];
const color = /^(?:#[\da-f]{3}(?:[\da-f]{3})?|rgb\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*\)|rgba\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*(?:0(?:\.\d+)?|1(?:\.0+)?)\s*\))$/i;
const blocks = new Set(['p','div','li','blockquote','h2','h3']);
const fail = message => Object.assign(new Error(message), {status:400});
export function safeLink(value) {
  try { const u = new URL(value); return ['https:','http:','mailto:'].includes(u.protocol) ? u.href : ''; } catch { return ''; }
}
export function cleanRichHtml(value) {
  if (typeof value !== 'string') throw fail('Format teks tidak valid');
  return sanitizeHtml(value, {
    allowedTags:['p','div','br','b','strong','i','em','u','s','strike','ul','ol','li','blockquote','h2','h3','font','span','a','table','thead','tbody','tr','th','td'],
    allowedAttributes:{'*':['style'],a:['href','target','rel'],font:['size','color'],td:['colspan','rowspan'],th:['colspan','rowspan']},
    allowedStyles:{'*':{color:[color],'background-color':[color]}},
    allowedSchemes:['https','http','mailto'], allowProtocolRelative:false,
    transformTags:{
      a:(_tag,attrs)=>({tagName:'a',attribs:safeLink(attrs.href)?{href:safeLink(attrs.href),target:'_blank',rel:'noopener noreferrer'}:{}}),
      font:(_tag,attrs)=>({tagName:'font',attribs:{...(/^[1-7]$/.test(attrs.size)?{size:attrs.size}:{}),...(color.test(attrs.color||'')?{color:attrs.color}:{}),...(attrs.style?{style:attrs.style}:{})}}),
      ...Object.fromEntries(['td','th'].map(tag=>[tag,(_tag,attrs)=>({tagName:tag,attribs:{...(attrs.style?{style:attrs.style}:{}),...Object.fromEntries(['colspan','rowspan'].filter(k=>/^\d+$/.test(attrs[k]||'')&&Number(attrs[k])>0&&Number(attrs[k])<=100).map(k=>[k,attrs[k]]))}})]))
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
export function richField(input, base, key, htmlKey) {
  if(Object.hasOwn(input,htmlKey)) {
    const html=cleanRichHtml(input[htmlKey]);
    if(!html)return {text:input[key]??base[key]??'',html:''};
    const text=richPlainText(html);
    return {text,html:text.trim()?html:''};
  }
  return {text:input[key]??base[key]??'',html:Object.hasOwn(input,key)&&input[key]!==base[key]?'':base[htmlKey]||''};
}
