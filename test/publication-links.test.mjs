import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
import {detectPublicationLink} from '../public/publication-links.mjs';import {ContentStore} from '../content-store.mjs';
test('publication platforms detect real hosts, mobile variants and short links without removing content identifiers',()=>{
 for(const [url,platform] of [['facebook.com/reel/123','facebook'],['https://m.facebook.com/story.php?story_fbid=123&id=456','facebook'],['https://web.facebook.com/watch/?v=123','facebook'],['https://fb.watch/ABC/','facebook'],['https://www.tiktok.com/@creator/video/123','tiktok'],['https://vm.tiktok.com/ABC/','tiktok'],['https://vt.tiktok.com/ABC/','tiktok'],['www.instagram.com/reel/ABC/?igsh=tracking','instagram'],['https://instagram.com/p/ABC/','instagram'],['https://instagr.am/p/ABC/','instagram']])assert.equal(detectPublicationLink(url).platform,platform);
 assert.deepEqual(detectPublicationLink(' http://m.facebook.com/watch/?v=123&utm_source=x&fbclid=y#comment '),{url:'https://www.facebook.com/watch/?v=123',platform:'facebook'});
 assert.equal(detectPublicationLink('https://facebook.com/story.php?story_fbid=123&id=456').url,'https://www.facebook.com/story.php?story_fbid=123&id=456');
 assert.equal(detectPublicationLink('https://vm.tiktok.com/ABC/?_t=tracking&_r=1').url,'https://vm.tiktok.com/ABC/');
});
test('unsupported hosts, executable schemes, deceptive credentials and arbitrary ports are rejected',()=>{
 for(const value of ['',null,{},'javascript:alert(1)','data:text/html,x','file:///etc/passwd','https://facebook.com.evil.test/reel/1','https://notinstagram.com/p/a','https://tiktok.com@evil.test/video/1','https://evil.test@facebook.com/post','https://facebook.com:123/reel/1','https://youtu.be/abcdefghijk'])assert.throws(()=>detectPublicationLink(value));
});
async function fixture(t){const dir=await fs.mkdtemp(path.join(os.tmpdir(),'publication-links-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));const file=path.join(dir,'contents.json');return {file,store:new ContentStore(file)};}
test('links derive platform on the server, support edits/removals and survive restart/history without changing YouTube',async t=>{
 const {file,store}=await fixture(t),script='Narasi utuh.',youtubeVideoId='abcdefghijk';let c=await store.create({title:'Multi platform',script,youtubeVideoId,publicationLinks:[{url:'instagram.com/reel/ABC/?igsh=tracking',platform:'facebook',status:'published'}]});assert.equal(c.publicationLinks[0].platform,'instagram');assert.equal(c.publicationLinks[0].status,undefined);const original=c.publicationLinks,id=original[0].id;
 c=await store.update(c.id,{revision:c.revision,publicationLinks:[{id,url:'https://tiktok.com/@creator/video/123'}, {url:'https://fb.watch/ABC/'}]});assert.equal(c.publicationLinks.length,2);assert.equal(c.publicationLinks[0].id,id);assert.equal(c.publicationLinks[0].platform,'tiktok');assert.equal(c.history[0].publicationLinks[0].platform,'instagram');assert.equal(c.script,script);assert.equal(c.youtubeVideoId,youtubeVideoId);assert.equal(c.youtubePublication,null);
 const restarted=new ContentStore(file);assert.deepEqual((await restarted.read()).contents[0].publicationLinks,c.publicationLinks);
 const copy=await restarted.duplicate(c.id);assert.deepEqual(copy.publicationLinks,[]);assert.equal(copy.youtubeVideoId,'');assert.equal(copy.script,script);
 c=await restarted.update(c.id,{revision:c.revision,publicationLinks:[]});assert.deepEqual(c.publicationLinks,[]);c=await restarted.update(c.id,{revision:c.revision,restoreRevision:1});assert.deepEqual(c.publicationLinks,original);
 c=await restarted.update(c.id,{revision:c.revision,script:'Revisi naskah'});assert.deepEqual(c.publicationLinks,original);
});
test('stale, duplicate and invalid link updates cannot partially change stored content',async t=>{
 const {store}=await fixture(t);const c=await store.create({title:'Data tetap',publicationLinks:[{url:'https://facebook.com/watch/?v=123'}]});
 for(const publicationLinks of [{},[null],[{url:'https://evil.test'}],[{url:'instagram.com/p/A/'},{url:'www.instagram.com/p/A/?igsh=track'}],[{id:c.publicationLinks[0].id,url:'instagram.com/p/A/'},{id:c.publicationLinks[0].id,url:'tiktok.com/@a/video/1'}]])await assert.rejects(store.update(c.id,{revision:c.revision,publicationLinks}),e=>e.status===400);
 await assert.rejects(store.update(c.id,{revision:0,publicationLinks:[]}),e=>e.status===409);assert.deepEqual((await store.read()).contents[0],c);
});
