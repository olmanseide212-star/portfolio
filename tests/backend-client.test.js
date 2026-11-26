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
