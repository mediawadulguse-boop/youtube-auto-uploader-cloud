import fs from 'node:fs/promises';
const original=globalThis.fetch;
globalThis.fetch=async(input,options={})=>{
 const u=new URL(String(input));
 if(u.hostname==='oauth2.googleapis.com'){
  await fs.appendFile(process.env.PUBLICATION_TEST_CALLS,'refresh\n');
  return new Response(JSON.stringify({error:'invalid_grant',error_description:'Token has been expired or revoked.'}),{status:400});
 }
 if(u.hostname==='www.googleapis.com'&&u.pathname==='/youtube/v3/videos'){
  const ids=(u.searchParams.get('id')||'').split(','),status=process.env.PUBLICATION_TEST_STATUS?JSON.parse(await fs.readFile(process.env.PUBLICATION_TEST_STATUS,'utf8')):{};
  return new Response(JSON.stringify({items:ids.map(id=>({id,snippet:{title:'Vid '+id,channelId:id==='xxxxxxxxxxx'?'UC-other':'UC-test',publishedAt:'2026-10-04T12:00:00Z',description:'Description',tags:['test']},status:status[id]||{privacyStatus:'public',uploadStatus:'processed'}}))}));
 }
 if(['127.0.0.1','localhost'].includes(u.hostname))return original(input,options);
 throw Error('Network disabled in publication test');
};
