import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
const schema = await readFile(new URL('../backend/schema.sql', import.meta.url), 'utf8');
const migration = await readFile(new URL('../backend/migrations/20261127_profile.sql', import.meta.url), 'utf8');
const admin = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ordinary = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const contacts = [{ platform: 'email', value: 'hi@example.com' }, { platform: 'xiaohongshu', value: 'https://www.xiaohongshu.com/user/profile/abc', label: '@anno' }];

test('profile migration on an isolated PostgreSQL database', async t => {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(`
    create role anon; create role authenticated;
    create schema auth; create schema storage;
    grant usage on schema public,auth,storage to anon,authenticated;
    create table auth.users (id uuid primary key);
    create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create table storage.buckets (id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects (bucket_id text,name text);
    alter table storage.objects enable row level security;
    grant select,insert,delete on storage.objects to authenticated;
    create function storage.foldername(name text) returns text[] language sql as $$select array[(string_to_array(name,'/'))[1]]$$;
  `);
  await db.exec(schema);
  await db.exec(migration);
  await db.query('insert into auth.users values ($1),($2)', [admin, ordinary]);
  await db.query('insert into public.portfolio_admins values ($1)', [admin]);
  const asUser = async (role, uid, fn) => {
    await db.exec(`set role ${role}`); await db.query("select set_config('request.jwt.claim.sub',$1,false)", [uid || '']);
    try { return await fn(); } finally { await db.exec('reset role'); }
  };
  const row = async () => (await db.query('select intro,contacts from public.site_profile')).rows;
  const update = (intro, items) => db.query('update public.site_profile set intro=$1, contacts=$2::jsonb where id=1 returning id', [intro, JSON.stringify(items)]);

  await t.test('fresh install seeds exactly one empty profile row', async () => {
    assert.deepEqual(await row(), [{ intro: '', contacts: [] }]);
  });
  await t.test('visitors can read the profile but cannot change it', async () => {
    const visible = await asUser('anon', '', () => db.query('select intro,contacts from public.site_profile'));
    assert.equal(visible.rows.length, 1);
    await assert.rejects(asUser('anon', '', () => update('hack', [])), error => error.code === '42501');
  });
  await t.test('ordinary authenticated users cannot update the profile', async () => {
    const result = await asUser('authenticated', ordinary, () => update('hack', []));
    assert.equal(result.rows.length, 0); assert.equal((await row())[0].intro, '');
  });
  await t.test('admin saves contacts and rerunning the migration keeps them', async () => {
    const result = await asUser('authenticated', admin, () => update('设计与摄影', contacts));
    assert.equal(result.rows.length, 1);
    await db.exec(migration);
    assert.deepEqual(await row(), [{ intro: '设计与摄影', contacts }]);
  });
  await t.test('database rejects unsafe or malformed contacts', async () => {
    const bad = [
      [{ platform: 'website', value: 'javascript:alert(1)' }],
      [{ platform: 'website', value: 'http://example.com' }],
      [{ platform: 'email', value: 'not-email' }],
      [{ platform: 'unknown', value: 'x' }],
      [{ platform: 'wechat', value: '' }],
      [{ platform: 'wechat', value: ' padded' }],
      [{ platform: 'wechat', value: 'has space' }],
      [{ platform: 'email', value: 'a@b.co', label: 'x'.repeat(41) }],
      [{ platform: 'email', value: 1 }],
      Array.from({ length: 13 }, () => ({ platform: 'wechat', value: 'id' })),
      { platform: 'wechat', value: 'not-array' }
    ];
    for (const items of bad) await assert.rejects(update('', items), error => error.code === '23514');
    await assert.rejects(update('字'.repeat(301), []), error => error.code === '23514');
    assert.deepEqual((await row())[0].contacts, contacts);
  });
  await t.test('a second profile row cannot be created', async () => {
    await assert.rejects(asUser('authenticated', admin, () => db.query('insert into public.site_profile (id) values (1)')), error => error.code === '42501');
    await assert.rejects(db.query('insert into public.site_profile (id) values (2)'), error => error.code === '23514');
    assert.equal((await row()).length, 1);
  });
});
