import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
const migration=await readFile(new URL('../backend/migrations/20261126_albums.sql',import.meta.url),'utf8');
const baseline=(await readFile(new URL('../backend/schema.sql',import.meta.url),'utf8')).split('-- 多页作品升级。')[0];
const admin='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ordinary='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const id='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const front=`${admin}/11111111-1111-4111-8111-111111111111.jpg`;
const back=`${admin}/22222222-2222-4222-8222-222222222222.png`;
const replacement=`${admin}/33333333-3333-4333-8333-333333333333.webp`;

test('album migration on an isolated PostgreSQL database', async t => {
  const db=new PGlite();
  t.after(()=>db.close());
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
  await db.exec(baseline);
  await db.query('insert into auth.users values ($1),($2)',[admin,ordinary]);
  await db.query('insert into public.portfolio_admins values ($1)',[admin]);
  await db.query("insert into public.projects (id,title,category,image_path) values ($1,'节目单','节目单',$2)",[id,front]);
  await db.exec(migration);
  const project=async()=> (await db.query('select * from public.projects where id=$1',[id])).rows[0];
  const asUser=async(role,uid,fn)=>{
    await db.exec(`set role ${role}`); await db.query("select set_config('request.jwt.claim.sub',$1,false)",[uid || '']);
    try{return await fn();}finally{await db.exec('reset role');}
  };
  await t.test('backfills old images without changing the existing file path',async()=>{
    const row=await project(); assert.equal(row.image_path,front); assert.deepEqual(row.images,[{path:front,caption:''}]);
  });
  await t.test('admin adds pages and cover fields follow the first page',async()=>{
    await asUser('authenticated',admin,()=>db.query('update public.projects set images=$1::jsonb where id=$2',[JSON.stringify([{path:back,caption:'背面'},{path:front,caption:'正面'}]),id]));
    const row=await project(); assert.equal(row.image_path,back); assert.equal(row.images.length,2); assert.equal(row.static_image,null);
  });
  await t.test('rerunning migration does not reset order or page captions',async()=>{
    const before=(await project()).images; await db.exec(migration); assert.deepEqual((await project()).images,before);
  });
  await t.test('legacy client cover change preserves the remaining pages',async()=>{
    await asUser('authenticated',admin,()=>db.query('update public.projects set image_path=$1 where id=$2',[replacement,id]));
    const row=await project(); assert.equal(row.images[0].path,replacement); assert.equal(row.images[1].path,front);
  });
  await t.test('database rejects unsafe paths, duplicate images and more than 30 pages',async()=>{
    for(const images of [[{path:'../../secret'}],[{path:front},{path:front}],Array.from({length:31},(_,i)=>({static_image:`images/${i}.jpg`}))]) {
      await assert.rejects(db.query('update public.projects set images=$1::jsonb where id=$2',[JSON.stringify(images),id]),error=>error.code==='23514');
    }
  });
  await t.test('ordinary authenticated users cannot change project pages',async()=>{
    const result=await asUser('authenticated',ordinary,()=>db.query("update public.projects set images='[]'::jsonb where id=$1 returning id",[id]));
    assert.equal(result.rows.length,0); assert.equal((await project()).images.length,2);
  });
  await t.test('storage cleanup protects non-cover pages and only removes unreferenced objects',async()=>{
    await db.query("insert into storage.objects values ('portfolio',$1),('portfolio',$2),('portfolio',$3)",[front,replacement,back]);
    const result=await asUser('authenticated',admin,()=>db.query('delete from storage.objects returning name'));
    assert.deepEqual(result.rows.map(row=>row.name),[back]);
  });
  await t.test('archived albums stay hidden from visitors and preserve protected page files',async()=>{
    await asUser('authenticated',admin,()=>db.query('update public.projects set deleted_at=now() where id=$1',[id]));
    const anonymous=await asUser('anon','',()=>db.query('select * from public.projects where id=$1',[id])); assert.equal(anonymous.rows.length,0);
    const adminRows=await asUser('authenticated',admin,()=>db.query('select * from public.projects where id=$1',[id])); assert.equal(adminRows.rows[0].images.length,2);
    const deleted=await asUser('authenticated',admin,()=>db.query('delete from storage.objects returning name')); assert.equal(deleted.rows.length,0);
  });
  await t.test('removing all pages clears both legacy cover fields',async()=>{
    await asUser('authenticated',admin,()=>db.query("update public.projects set images='[]'::jsonb where id=$1",[id]));
    const row=await project();assert.deepEqual(row.images,[]);assert.equal(row.image_path,null);assert.equal(row.static_image,null);
  });
});
