/* Render the writing formats returned by AI. All source HTML stays literal. */
window.HubScriptFormat=(()=>{
  const escape=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function inline(value){
    return escape(value).replace(/\*\*([^*\n]+)\*\*/g,'<strong>$1</strong>').replace(/__([^_\n]+)__/g,'<strong>$1</strong>').replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g,'<em>$1</em>');
  }
  function cells(line){
    return line.trim().replace(/^\|/,'').replace(/(?<!\\)\|$/,'').split(/(?<!\\)\|/).map(c=>c.trim().replace(/\\\|/g,'|'));
  }
  function render(value){
    const lines=String(value||'').replace(/\r\n?/g,'\n').split('\n'),out=[];
    let paragraph=[],list=[],listTag='';
    const flushParagraph=()=>{if(paragraph.length){out.push('<p>'+paragraph.map(inline).join('<br>')+'</p>');paragraph=[];}};
    const flushList=()=>{if(list.length){out.push('<'+listTag+'>'+list.map(x=>'<li>'+inline(x)+'</li>').join('')+'</'+listTag+'>');list=[];}listTag='';};
    for(let i=0;i<lines.length;i++){
      const line=lines[i],trim=line.trim();
      if(!trim){flushParagraph();flushList();continue;}
      const header=cells(line),separator=i+1<lines.length?cells(lines[i+1]):[];
      if(header.length>1&&separator.length===header.length&&separator.every(c=>/^:?-{3,}:?$/.test(c))){
        flushParagraph();flushList();let rows='';i++;
        while(i+1<lines.length&&lines[i+1].includes('|')){const row=cells(lines[i+1]);if(row.length!==header.length)break;i++;rows+='<tr>'+row.map(c=>'<td>'+inline(c)+'</td>').join('')+'</tr>';}
        out.push('<table><thead><tr>'+header.map(c=>'<th>'+inline(c)+'</th>').join('')+'</tr></thead><tbody>'+rows+'</tbody></table>');continue;
      }
      const heading=trim.match(/^#{1,6}\s+(.+?)\s*#*$/),standalone=trim.match(/^\*\*([^*]+)\*\*$/);
      if(heading||standalone){flushParagraph();flushList();out.push('<h3>'+inline((heading||standalone)[1])+'</h3>');continue;}
      const item=trim.match(/^([-+*]|\d+[.)])\s+(.+)$/);
      if(item){flushParagraph();const tag=/^\d/.test(item[1])?'ol':'ul';if(listTag&&tag!==listTag)flushList();listTag=tag;list.push(item[2]);continue;}
      flushList();if(/^>\s?/.test(trim)){flushParagraph();out.push('<blockquote>'+inline(trim.replace(/^>\s?/,''))+'</blockquote>');continue;}
      paragraph.push(line);
    }
    flushParagraph();flushList();return out.join('');
  }
  return {render};
})();
