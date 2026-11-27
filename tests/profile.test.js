import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PLATFORMS, MAX_CONTACTS, normalizeProfile, contactHref, contactText, publicContacts } from '../profile.js';

test('profile is trimmed and optional labels are dropped when blank', () => {
  const result = normalizeProfile({ intro: '  设计与摄影  ', contacts: [
    { platform: 'email', value: ' hi@example.com ', label: '' },
    { platform: 'wechat', value: 'anno_design', label: ' 微信 ' },
    { platform: 'xiaohongshu', value: 'https://www.xiaohongshu.com/user/profile/abc' }
  ] });
  assert.equal(result.intro, '设计与摄影');
  assert.deepEqual(result.contacts, [
    { platform: 'email', value: 'hi@example.com' },
    { platform: 'wechat', value: 'anno_design', label: '微信' },
    { platform: 'xiaohongshu', value: 'https://www.xiaohongshu.com/user/profile/abc' }
  ]);
});

test('unsafe or malformed contacts are rejected with a readable reason', () => {
  const cases = [
    [{ platform: 'website', value: 'javascript:alert(1)' }, /https:\/\//],
    [{ platform: 'bilibili', value: 'http://space.bilibili.com/1' }, /https:\/\//],
    [{ platform: 'email', value: 'not-an-email' }, /邮箱格式/],
    [{ platform: 'email', value: 'a@b.co?subject=x' }, /邮箱格式/],
    [{ platform: 'wechat', value: 'has space' }, /空格/],
    [{ platform: 'wechat', value: '   ' }, /还没有填写/],
    [{ platform: 'unknown', value: 'x' }, /平台无效/],
    [{ platform: 'website', value: `https://a.com/${'x'.repeat(200)}` }, /200/],
    [{ platform: 'wechat', value: 'id', label: '名'.repeat(41) }, /显示文字/]
  ];
  for (const [contact, message] of cases) assert.throws(() => normalizeProfile({ contacts: [contact] }), message);
  assert.throws(() => normalizeProfile({ intro: '字'.repeat(301) }), /300/);
  assert.throws(() => normalizeProfile({ contacts: Array.from({ length: MAX_CONTACTS + 1 }, () => ({ platform: 'wechat', value: 'id' })) }), /最多/);
  assert.throws(() => normalizeProfile({ contacts: 'nope' }), /格式无效/);
});

test('only mailto and https links are produced', () => {
  assert.equal(contactHref({ platform: 'email', value: 'hi@example.com' }), 'mailto:hi@example.com');
  assert.equal(contactHref({ platform: 'website', value: 'https://anno.dev' }), 'https://anno.dev');
  assert.equal(contactHref({ platform: 'website', value: 'javascript:alert(1)' }), null);
  assert.equal(contactHref({ platform: 'website', value: 'http://anno.dev' }), null);
  assert.equal(contactHref({ platform: 'wechat', value: 'anno' }), null);
  assert.equal(contactHref({ platform: 'evil', value: 'https://x.com' }), null);
});

test('display text prefers the label and shortens long links', () => {
  assert.equal(contactText({ platform: 'wechat', value: 'anno', label: '扫码加我' }), '扫码加我');
  assert.equal(contactText({ platform: 'wechat', value: 'anno' }), 'anno');
  assert.equal(contactText({ platform: 'bilibili', value: 'https://www.bilibili.com/' }), 'bilibili.com');
  assert.ok(contactText({ platform: 'website', value: `https://example.com/${'a'.repeat(60)}` }).endsWith('…'));
});

test('public rendering drops unknown platforms and unsafe stored links', () => {
  const rows = [
    { platform: 'wechat', value: 'anno' },
    { platform: 'website', value: 'javascript:alert(1)' },
    { platform: 'email', value: 'bad' },
    { platform: 'unknown', value: 'x' },
    null,
    { platform: 'behance', value: 'https://www.behance.net/anno', label: 'Behance' }
  ];
  assert.deepEqual(publicContacts(rows), [
    { platform: 'wechat', value: 'anno' },
    { platform: 'behance', value: 'https://www.behance.net/anno', label: 'Behance' }
  ]);
  assert.deepEqual(publicContacts(undefined), []);
  assert.ok(Object.keys(PLATFORMS).includes('xiaohongshu'));
});
