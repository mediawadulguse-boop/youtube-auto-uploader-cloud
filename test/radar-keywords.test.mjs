import test from 'node:test';
import assert from 'node:assert/strict';
import {extractTrendKeywords,trendText,trendKeywordMention} from '../radar-keywords.mjs';
const extract=title=>extractTrendKeywords({title});

test('question and filler words never form keywords and a name alone is insufficient',()=>{
 const terms=extract('Apakah Gibran membantah tuduhan ijazah demi menjawab kritik?');
 assert.ok(terms.has('gibran · ijazah'));
 assert.ok([...terms.keys()].every(key=>!/(?:^|[ ·])(?:demi|apakah|tuduhan|bantahan)(?:$|[ ·])/.test(key)));
 assert.equal(extract('Apakah Gibran hadir demi rakyat?').size,0);
 assert.equal(extract('Demi apakah?').size,0);
});

test('issue phrases and institutional acronyms retain their context',()=>{
 assert.ok(extract('MK membantah kritik putusan').has('mk · putusan'));
 assert.ok(extract('KPK mengusut dugaan korupsi').has('kpk · korupsi'));
 assert.ok(extract('Warga menolak kenaikan PPN').has('kenaikan ppn'));
 assert.ok(extract('Dugaan konflik kepentingan dipersoalkan').has('konflik kepentingan'));
 assert.ok(extract('Bantahan kebocoran data pribadi').has('data pribadi'));
 assert.ok(extract('Gibran membantah ijazah palsu').has('ijazah palsu'));
 assert.deepEqual([...extract('Kebocoran Data Pribadi dipersoalkan').values()].filter(t=>t.kind==='context'),[]);
 assert.ok(extract('Gibran membantah tuduhan ijazah SMA').has('gibran · ijazah sma'));
});

test('unrelated sentences and title versus excerpt do not invent contextual pairs',()=>{
 assert.ok(!extract('Gibran menghadiri acara. Ijazah dipersoalkan.').has('gibran · ijazah'));
 const term=extract('Gibran membantah tuduhan ijazah').get('gibran · ijazah');
 assert.equal(trendKeywordMention(trendText({title:'Gibran menghadiri acara',excerpt:'Ijazah dipersoalkan.'}),term),false);
 assert.equal(trendKeywordMention(trendText({title:'Gibran menghadiri acara. Ijazah dipersoalkan.'}),term),false);
});

test('all occurrences are checked and a repeated entity near an issue is counted once',()=>{
 const term=extract('Gibran membantah tuduhan ijazah').get('gibran · ijazah');
 const far='Gibran '+Array(15).fill('acara').join(' ')+' ijazah';
 assert.equal(trendKeywordMention(trendText({title:far}),term),false);
 assert.equal(trendKeywordMention(trendText({title:far+' Gibran'}),term),true);
});

test('title-case verbs and issue modifiers are not mistaken for named entities',()=>{
 assert.ok(!extract('MK Tolak Gugatan Ijazah').has('mk tolak · ijazah'));
 assert.ok(extract('MK Tolak Gugatan Ijazah').has('mk · ijazah'));
 assert.ok(![...extract('Apakah Jokowi dan Gibran Terlibat Dugaan Ijazah Palsu?').keys()].some(key=>key.startsWith('palsu ·')));
 assert.deepEqual([...extract('Data Pribadi Dijual: Apakah Platform Untung?').values()].filter(t=>t.kind==='context'),[]);
 assert.ok(extract('Menteri Ratna membantah dugaan korupsi').has('ratna · korupsi'));
});
