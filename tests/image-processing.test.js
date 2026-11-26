import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fitDimensions, validateSource } from '../image-processing.js';
test('large images preserve aspect ratio and never upscale', () => {
  assert.deepEqual(fitDimensions(6000,4000),{width:3200,height:2133});
  assert.deepEqual(fitDimensions(4000,6000),{width:2133,height:3200});
  assert.deepEqual(fitDimensions(1200,800),{width:1200,height:800});
  assert.deepEqual(fitDimensions(1,12000),{width:1,height:3200});
});
test('source validation accepts a 20MB image but rejects 51MB, HEIC and empty files', () => {
  assert.doesNotThrow(() => validateSource({type:'image/jpeg',size:20*1024*1024}));
  for (const file of [{type:'image/jpeg',size:51*1024*1024},{type:'image/heic',size:100},{type:'image/png',size:0}]) assert.throws(() => validateSource(file));
});
test('invalid image dimensions fail explicitly', () => {
  for (const width of [0,-1,NaN,Infinity]) assert.throws(() => fitDimensions(width,100));
});

import { prepareImage, MAX_UPLOAD_BYTES } from '../image-processing.js';
function imageEnvironment(t, width, height, encode) {
  const oldBitmap = globalThis.createImageBitmap, oldDocument = globalThis.document;
  let closed = false;
  const canvas = { width:0, height:0, getContext: () => ({drawImage(){}}), toBlob(callback,type,quality) { callback(encode(type,quality)); } };
  globalThis.createImageBitmap = async () => ({width,height,close(){closed=true;}});
  globalThis.document = {createElement: () => canvas};
  t.after(() => {
    if (oldBitmap === undefined) delete globalThis.createImageBitmap; else globalThis.createImageBitmap = oldBitmap;
    if (oldDocument === undefined) delete globalThis.document; else globalThis.document = oldDocument;
  });
  return {canvas,closed:()=>closed};
}
test('large source is resized and encoded, with bitmap and canvas released', async t => {
  const env = imageEnvironment(t,6000,4000,()=>new Blob(['optimized'],{type:'image/webp'}));
  const result = await prepareImage({name:'large.png',type:'image/png',size:20*1024*1024});
  assert.equal(result.file.type,'image/webp'); assert.equal(result.file.name,'large.webp');
  assert.equal(result.width,3200); assert.equal(result.height,2133); assert.equal(result.compressed,true);
  assert.equal(env.closed(),true); assert.equal(env.canvas.width,1);
});
test('small original is preserved without lossy recompression', async t => {
  const env = imageEnvironment(t,800,600,()=>{throw new Error('must not encode');});
  const file = new File(['small'],'small.png',{type:'image/png'});
  const result = await prepareImage(file); assert.equal(result.file,file); assert.equal(result.compressed,false); assert.ok(env.closed());
});
test('encoder failure is reported and releases decoded resources', async t => {
  const env = imageEnvironment(t,6000,4000,()=>null);
  await assert.rejects(prepareImage({name:'large.png',type:'image/png',size:20*1024*1024}),/图片编码失败/);
  assert.ok(env.closed()); assert.equal(env.canvas.width,1);
});
test('unsupported WebP encoder returning PNG uses the correct extension', async t => {
  imageEnvironment(t,6000,4000,()=>new Blob(['png'],{type:'image/png'}));
  const result=await prepareImage({name:'large.jpg',type:'image/jpeg',size:12*1024*1024});
  assert.equal(result.file.type,'image/png'); assert.equal(result.file.name,'large.png');
});
test('compression reduces quality before reducing dimensions and enforces the upload cap', async t => {
  const qualities=[];
  imageEnvironment(t,6000,4000,(type,quality)=>{qualities.push(quality);return new Blob([new Uint8Array(MAX_UPLOAD_BYTES+1)],{type});});
  await assert.rejects(prepareImage({name:'large.png',type:'image/png',size:20*1024*1024}),/压缩后仍超过/);
  assert.deepEqual(qualities.slice(0,3),[0.9,0.82,0.72]); assert.equal(qualities.length,15);
});
