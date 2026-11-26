import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PortfolioAPI } from '../backend-client.js';
const response = (data, status = 200) => new Response(data === null ? null : JSON.stringify(data), { status });
function client(handler) {
  const api = new PortfolioAPI({ url: 'https://example.supabase.co', publicKey: 'public-key' }, handler);
  api.setSession({ access_token: 'token', refresh_token: 'refresh', expires_in: 3600, user: { id: 'admin-id' } });
  return api;
}
const work = { title: '作品', category: '摄影', description: '', file: new Blob(['image'], { type: 'image/png' }) };
test('login invokes fetch with the browser global receiver', async () => {
  const calls = [];
  const api = client(async function (url, options) {
    assert.equal(this, globalThis, 'native browser fetch rejects an API instance receiver');
    calls.push(url);
    if (url.includes('grant_type=password')) {
      assert.deepEqual(JSON.parse(options.body), { email: 'admin@example.com', password: 'test-password' });
      return response({ access_token: 'token', refresh_token: 'r', expires_in: 3600, user: { id: 'admin-id' } });
    }
    return response([{ user_id: 'admin-id' }]);
  });
  await api.login('admin@example.com', 'test-password');
  assert.equal(calls.length, 2);
  assert.equal(api.session.user.id, 'admin-id');
});
test('anonymous reads do not send an admin token', async () => {
  const api = client(async (url, options) => {
    assert.match(url, /projects\?select/); assert.equal(options.headers.Authorization, undefined); return response([]);
  }); await api.list();
});
test('upload precedes insert and stores a path, never image data', async () => {
  const calls = [];
  const api = client(async (url, options) => { calls.push({ url, ...options }); return response(url.includes('/rest/') ? [{ id: 'new' }] : { Key: 'image' }); });
  await api.save(work);
  assert.equal(calls.length, 2); assert.equal(calls[0].body, work.file);
  assert.equal(calls[0].headers.Authorization, 'Bearer token');
  const saved = JSON.parse(calls[1].body); assert.match(saved.image_path, /^admin-id\/.+\.png$/); assert.equal(saved.title, '作品');
});
test('failed database insert compensates by removing uploaded object', async () => {
  const calls = [];
  const api = client(async (url, options) => { calls.push({ url, ...options }); return url.includes('/rest/') ? response({}, 403) : response({}); });
  await assert.rejects(api.save(work), /权限/);
  assert.equal(calls[2].method, 'DELETE'); assert.equal(JSON.parse(calls[2].body).prefixes.length, 1);
});
test('invalid files and unauthenticated writes never call server', async () => {
  const api = client(() => { throw new Error('must not call'); });
  await assert.rejects(api.save({ ...work, file: new Blob(['x'], { type: 'image/svg+xml' }) }), /8 MB/);
  api.session = null; await assert.rejects(api.save(work), /登录/);
});
test('editing without a file preserves the existing image', async () => {
  const api = client(async (url, options) => {
    assert.match(url, /id=eq.existing/); assert.equal(options.method, 'PATCH');
    assert.equal('image_path' in JSON.parse(options.body), false); return response([{ id: 'existing' }]);
  }); await api.save({ ...work, id: 'existing', file: undefined });
});
test('expired session refreshes before authenticated write', async () => {
  const calls = [];
  const api = client(async (url, options) => {
    calls.push(url);
    if (url.includes('refresh_token')) return response({ access_token: 'renewed', refresh_token: 'r2', expires_in: 3600, user: { id: 'admin-id' } });
    assert.equal(options.headers.Authorization, 'Bearer renewed'); return response([{ id: 'existing' }]);
  }); api.session.expiresAt = 0; await api.save({ ...work, id: 'existing', file: undefined }); assert.equal(calls.length, 2);
});
test('empty update result is treated as failure and uploaded object is cleaned', async () => {
  const calls = [];
  const api = client(async (url, options) => { calls.push(options.method); return response(url.includes('/rest/') ? [] : {}); });
  await assert.rejects(api.save({ ...work, id: 'missing' }), /未保存/);
  assert.deepEqual(calls, ['POST', 'PATCH', 'DELETE']);
});
test('non-admin login clears the session', async () => {
  const api = client(async url => {
    if (url.includes('grant_type=password')) return response({ access_token: 'token', refresh_token: 'r', expires_in: 3600, user: { id: 'ordinary' } });
    if (url.includes('portfolio_admins')) return response([]);
    return response(null, 204);
  }); await assert.rejects(api.login('ordinary@example.com', 'password'), /没有作品管理权限/); assert.equal(api.session, null);
});
test('oversized upload is rejected before making any request', async () => {
  const api = client(() => { throw new Error('must not call'); });
  await assert.rejects(api.save({ ...work, file: { type: 'image/jpeg', size: 8388609 } }), /8 MB/);
});
test('cleanup failure is surfaced instead of claiming a clean rollback', async () => {
  const api = client(async (url, options) => {
    if (options.method === 'DELETE') return response({}, 500);
    return url.includes('/rest/') ? response({}, 403) : response({});
  }); await assert.rejects(api.save(work), /清理未确认/);
});
for (const [code, message] of [
  ['invalid_credentials', /邮箱或密码错误/],
  ['email_not_confirmed', /邮箱尚未验证/],
  ['email_provider_disabled', /未开启邮箱登录/],
  ['captcha_failed', /验证码/]
]) {
  test(`login explains Supabase ${code} instead of a generic 400`, async () => {
    const api = client(async () => response({ code }, 400));
    await assert.rejects(api.login('test@example.com', 'test-password'), message);
  });
}
test('non-JSON auth errors still produce a usable message', async () => {
  const api = client(async () => new Response('Bad gateway', { status: 400 }));
  await assert.rejects(api.login('test@example.com', 'test-password'), /登录请求被拒绝/);
});
test('logout failure does not mask missing admin permissions', async () => {
  const api = client(async url => {
    if (url.includes('grant_type=password')) return response({ access_token: 'token', refresh_token: 'r', expires_in: 3600, user: { id: 'ordinary' } });
    if (url.includes('portfolio_admins')) return response([]);
    return response({}, 500);
  });
  await assert.rejects(api.login('test@example.com', 'test-password'), /没有作品管理权限/);
  assert.equal(api.session, null);
});
test('unknown Auth errors preserve server diagnostics for troubleshooting', async () => {
  const api = client(async () => response({ error: 'invalid_grant', error_description: 'Login method unavailable' }, 400));
  await assert.rejects(api.login('test@example.com', 'test-password'), /认证失败（400）：invalid_grant：Login method unavailable/);
});
test('unknown Auth message is bounded and does not include submitted password', async () => {
  const api = client(async () => response({ code: 'unknown_code', msg: 'reason'.repeat(100) }, 400));
  await assert.rejects(api.login('test@example.com', 'secret-test-password'), error => {
    assert.ok(error.message.length < 300);
    assert.ok(!error.message.includes('secret-test-password'));
    return true;
  });
});
test('custom categories are trimmed and saved', async () => {
  const api = client(async (url, options) => {
    assert.equal(JSON.parse(options.body).category, '品牌设计'); return response([{ id:'existing' }]);
  });
  await api.save({ ...work, id:'existing', file:undefined, category:' 品牌设计 ' });
});
test('blank or overly long categories are rejected before network calls', async () => {
  const api = client(() => { throw new Error('must not call'); });
  for (const category of ['   ', 'a'.repeat(31)]) await assert.rejects(api.save({ ...work, category }), /分类需为/);
});
test('archiving and restoration update metadata without deleting the image', async () => {
  const calls = [];
  const api = client(async (url, options) => { calls.push({ url, ...options }); return response([{id:'existing'}]); });
  await api.setArchived('existing',true); await api.setArchived('existing',false);
  assert.equal(calls.length,2); assert.ok(calls.every(c => c.method === 'PATCH' && c.headers.Authorization === 'Bearer token'));
  assert.ok(Date.parse(JSON.parse(calls[0].body).deleted_at)); assert.equal(JSON.parse(calls[1].body).deleted_at,null);
});
test('trash requires authentication and public list excludes archived records', async () => {
  const api = client(async url => { assert.match(url, /deleted_at=is.null/); return response([]); });
  await api.list(); api.session = null;
  await assert.rejects(api.list(true), /登录/); await assert.rejects(api.setArchived('existing',true), /登录/);
});
test('empty archive update is not reported as success', async () => {
  const api = client(async () => response([])); await assert.rejects(api.setArchived('missing',true), /操作未完成/);
});
test('old schema still serves existing public artwork until migration is applied', async () => {
  const api = client(async url => url.includes('deleted_at=') ? response({code:'42703'},400) : response([{id:'legacy'}]));
  assert.deepEqual(await api.list(),[{id:'legacy'}]); assert.equal(api.needsSchemaUpgrade,true);
  await assert.rejects(api.list(true), /数据库需要升级/);
});
const albumPath = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb.jpg';
test('album saves existing and newly uploaded pages in one ordered database write', async () => {
  const calls = [];
  const api = client(async (url,options) => {
    calls.push({url,...options});
    return response(url.includes('limit=0') ? [] : url.includes('/rest/') ? [{id:'existing'}] : {});
  });
  await api.save({...work,id:'existing',pages:[{path:albumPath,caption:'正面'},{file:work.file,caption:'背面'}]});
  assert.equal(calls.length,3); assert.equal(calls[1].method,'POST'); assert.equal(calls[2].method,'PATCH');
  const record=JSON.parse(calls[2].body); assert.equal(record.images.length,2); assert.equal(record.images[0].path,albumPath);
  assert.equal(record.images[1].caption,'背面'); assert.equal(record.images[1].file,undefined);
});
test('reorder and remove pages without uploading or deleting existing files', async () => {
  const calls=[];
  const api=client(async(url,options)=>{calls.push({url,...options});return response(url.includes('limit=0')?[]:[{id:'existing'}]);});
  await api.save({...work,id:'existing',file:undefined,pages:[{path:albumPath,caption:'保留这一页'}]});
  assert.equal(calls.length,2); assert.ok(calls.every(c=>c.url.includes('/rest/')));
});
test('missing album schema is rejected before uploading any file', async () => {
  const calls=[];
  const api=client(async(url)=>{calls.push(url);return response({code:'42703'},400);});
  await assert.rejects(api.save({...work,pages:[{file:work.file}]}),/多页作品升级脚本/);
  assert.equal(calls.length,1); assert.match(calls[0],/select=images/);
});
test('failed second upload cleans attempted new files and never changes the project', async () => {
  const calls=[];let uploads=0;
  const api=client(async(url,options)=>{
    calls.push({url,...options});
    if(options.method==='POST' && ++uploads===2) return response({},500);
    return response(url.includes('limit=0')?[]:{});
  });
  await assert.rejects(api.save({...work,id:'existing',pages:[{path:albumPath},{file:work.file},{file:work.file}]}),/500/);
  assert.ok(!calls.some(c=>c.method==='PATCH'));
  const cleanup=calls.at(-1);assert.equal(cleanup.method,'DELETE');
  const paths=JSON.parse(cleanup.body).prefixes;assert.equal(paths.length,2);assert.ok(!paths.includes(albumPath));
});
test('database failure after all uploads cleans the whole new batch', async () => {
  const calls=[];
  const api=client(async(url,options)=>{calls.push({url,...options});return url.includes('/rest/')&&options.method==='POST'?response({},403):response(url.includes('limit=0')?[]:{});});
  await assert.rejects(api.save({...work,pages:[{file:work.file},{file:work.file}]}),/权限/);
  assert.equal(JSON.parse(calls.at(-1).body).prefixes.length,2);
});
test('new empty album and invalid page lists fail before network access', async () => {
  const api=client(()=>{throw new Error('must not call');});
  await assert.rejects(api.save({...work,pages:[]}),/至少需要/);
  await assert.rejects(api.save({...work,pages:[{path:albumPath},{path:albumPath}]}),/重复/);
});
