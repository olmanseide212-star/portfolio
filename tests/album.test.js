import { test } from 'node:test';
import assert from 'node:assert/strict';
import { projectPages, pageURL, validatePages, movePage, isMissingPlaceholder, countEffectivePages, mergeAddedPages, MAX_PAGES } from '../album.js';
const path = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb.jpg';
test('legacy single images are preserved and explicit empty albums stay empty', () => {
  assert.deepEqual(projectPages({image_path:path}),[{path,caption:''}]);
  assert.deepEqual(projectPages({static_image:'images/front.jpg'}),[{static_image:'images/front.jpg',caption:''}]);
  assert.deepEqual(projectPages({image_path:path,images:[]}),[]);
});
test('editing a page name or order does not mutate the published record', () => {
  const original = {images:[{path,caption:'正面'},{static_image:'images/back.jpg',caption:'背面'}]};
  const draft = movePage(projectPages(original),1,0); draft[0].caption='新的封面';
  assert.equal(original.images[0].caption,'正面'); assert.equal(original.images[1].caption,'背面');
  assert.equal(draft[0].static_image,'images/back.jpg');
});
test('page movement respects boundaries without losing pages', () => {
  const pages=[1,2,3]; assert.deepEqual(movePage(pages,2,0),[3,1,2]);
  assert.deepEqual(movePage(pages,0,-1),pages); assert.deepEqual(movePage(pages,2,3),pages);
});
test('missing static placeholders are replaced when new photos are added', () => {
  const placeholder = {static_image:'images/missing.jpg',caption:'',missingPlaceholder:true};
  const added = [{file:{name:'1.jpg'},caption:''},{file:{name:'2.jpg'},caption:''},{file:{name:'3.jpg'},caption:''}];
  assert.equal(isMissingPlaceholder(placeholder),true);
  assert.equal(countEffectivePages([placeholder]),0);
  const merged = mergeAddedPages([placeholder],added);
  assert.equal(merged.replacedCount,1);
  assert.equal(merged.pages.length,3);
  assert.deepEqual(merged.pages.map(p=>p.file.name),['1.jpg','2.jpg','3.jpg']);
});
test('valid static images and cloud paths are never auto-removed on upload', () => {
  const existing = [
    {path,caption:'云端图',missingPlaceholder:true},
    {static_image:'images/real.jpg',caption:'真实本地图',missingPlaceholder:false},
    {static_image:'images/unchecked.jpg',caption:'未确认'}
  ];
  const added = [{file:{name:'new.jpg'},caption:''}];
  assert.equal(countEffectivePages(existing),3);
  const merged = mergeAddedPages(existing,added);
  assert.equal(merged.replacedCount,0);
  assert.equal(merged.pages.length,4);
  assert.equal(merged.pages[0].path,path);
  assert.equal(merged.pages[3].file.name,'new.jpg');
});
test('missing placeholder does not consume the 30-page upload limit', () => {
  const existing = [{static_image:'images/missing.jpg',caption:'',missingPlaceholder:true}];
  const fullBatch = Array.from({length:MAX_PAGES},(_,i)=>({file:{name:`${i+1}.jpg`},caption:''}));
  assert.equal(countEffectivePages(existing)+fullBatch.length <= MAX_PAGES,true);
  const merged = mergeAddedPages(existing,fullBatch);
  assert.equal(merged.pages.length,MAX_PAGES);
  assert.equal(merged.replacedCount,1);
});
test('album validation rejects oversized lists, duplicate paths and unsafe sources', () => {
  assert.doesNotThrow(()=>validatePages([{path,caption:'正面'},{static_image:'images/back.jpg',caption:'背面'}]));
  for (const pages of [Array(MAX_PAGES+1).fill({path}),[{path},{path}],[{static_image:'javascript:alert(1)'}],[{static_image:'images/../../private'}],[{path,static_image:'images/a.jpg'}],[{path,caption:'a'.repeat(81)}]]) assert.throws(()=>validatePages(pages));
  assert.equal(pageURL({static_image:'https://evil.test/x'},'https://good.test'),null);
  assert.equal(pageURL({path},'https://good.test'),`https://good.test/storage/v1/object/public/portfolio/${path}`);
});
