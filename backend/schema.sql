-- Run once in the Supabase SQL Editor. Safe to rerun.
create table if not exists public.portfolio_admins (
  user_id uuid primary key references auth.users(id) on delete cascade
);
alter table public.portfolio_admins enable row level security;
revoke all on public.portfolio_admins from anon, authenticated;
grant select on public.portfolio_admins to authenticated;
drop policy if exists admin_self on public.portfolio_admins;
create policy admin_self on public.portfolio_admins for select to authenticated using (user_id = (select auth.uid()));

create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(trim(title)) between 1 and 80),
  category text not null check (char_length(btrim(category)) between 1 and 30),
  deleted_at timestamptz,
  description text not null default '' check (length(description) <= 1000),
  image_path text unique check (image_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpg|png|webp)$'),
  static_image text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);
alter table public.projects enable row level security;
revoke all on public.projects from anon, authenticated;
grant select on public.projects to anon, authenticated;
grant insert, update on public.projects to authenticated;
drop policy if exists public_read on public.projects;
create policy public_read on public.projects for select to anon, authenticated using (true);
drop policy if exists admin_insert on public.projects;
create policy admin_insert on public.projects for insert to authenticated with check (exists (select 1 from public.portfolio_admins where user_id = (select auth.uid())));
drop policy if exists admin_update on public.projects;
create policy admin_update on public.projects for update to authenticated using (exists (select 1 from public.portfolio_admins where user_id = (select auth.uid()))) with check (exists (select 1 from public.portfolio_admins where user_id = (select auth.uid())));

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('portfolio', 'portfolio', true, 8388608, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set public = true, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
drop policy if exists portfolio_upload on storage.objects;
create policy portfolio_upload on storage.objects for insert to authenticated with check (
  bucket_id = 'portfolio' and (storage.foldername(name))[1] = (select auth.uid())::text
  and exists (select 1 from public.portfolio_admins where user_id = (select auth.uid()))
);
drop policy if exists portfolio_cleanup on storage.objects;
create policy portfolio_cleanup on storage.objects for delete to authenticated using (
  bucket_id = 'portfolio' and exists (select 1 from public.portfolio_admins where user_id = (select auth.uid()))
  and not exists (select 1 from public.projects where image_path = name)
);
drop policy if exists portfolio_admin_read on storage.objects;
create policy portfolio_admin_read on storage.objects for select to authenticated using (
  bucket_id = 'portfolio' and exists (select 1 from public.portfolio_admins where user_id = (select auth.uid()))
);

-- Seed only on first installation. Existing artwork stays intact on rerun.
insert into public.projects (id,title,category,static_image,sort_order) values
('00000000-0000-4000-8000-000000000001','十佳歌手节目单 2026','节目单','images/singer-contest-program-2026.jpg',6),
('00000000-0000-4000-8000-000000000002','烟雨杭州扑克概念','概念设计','images/misty-hangzhou-poker.jpg',5),
('00000000-0000-4000-8000-000000000003','生日抽奖券','海报','images/birthday-raffle-ticket.jpg',4),
('00000000-0000-4000-8000-000000000004','院徽重绘','概念设计','images/college-emblem-redraw.jpg',3),
('00000000-0000-4000-8000-000000000005','信息华章 PPT','PPT','images/information-huazhang-ppt.jpg',2),
('00000000-0000-4000-8000-000000000006','摄影作品','摄影','images/photography.jpg',1)
on conflict (id) do nothing;

-- Also upgrade existing installations when rerunning this setup.
-- Existing projects: run this migration once (safe to rerun).
begin;
alter table public.projects add column if not exists deleted_at timestamptz;
alter table public.projects drop constraint if exists projects_category_check;
alter table public.projects add constraint projects_category_check
  check (char_length(btrim(category)) between 1 and 30);
drop policy if exists public_read on public.projects;
create policy public_read on public.projects for select to anon, authenticated
  using (deleted_at is null);
drop policy if exists admin_read_all on public.projects;
create policy admin_read_all on public.projects for select to authenticated
  using (exists (select 1 from public.portfolio_admins where user_id = (select auth.uid())));
-- Existing admin-only UPDATE policy controls both archive and restore.
-- No physical DELETE permission is granted. Images remain available for restoration.
commit;
notify pgrst, 'reload schema';

-- 多页作品升级。可重复执行，不删除任何已有作品或图片。
begin;
alter table public.projects add column if not exists images jsonb;

-- 兼容已有单图，第一张图作为封面。
update public.projects set images = case
  when image_path is not null then jsonb_build_array(jsonb_build_object('path',image_path,'caption',''))
  when static_image is not null then jsonb_build_array(jsonb_build_object('static_image',static_image,'caption',''))
  else '[]'::jsonb end
where images is null;

create or replace function public.valid_portfolio_images(pages jsonb)
returns boolean language plpgsql immutable set search_path = '' as $$
declare page jsonb; source text; seen text[] := '{}';
begin
  if pages is null then return true; end if;
  if jsonb_typeof(pages) <> 'array' then return false; end if;
  if jsonb_array_length(pages) > 30 then return false; end if;
  for page in select value from jsonb_array_elements(pages) loop
    if jsonb_typeof(page) <> 'object' then return false; end if;
    if page ? 'caption' and (jsonb_typeof(page->'caption') <> 'string' or char_length(page->>'caption') > 80) then return false; end if;
    if (page ? 'path') = (page ? 'static_image') then return false; end if;
    if page ? 'path' then
      if jsonb_typeof(page->'path') <> 'string' or (page->>'path') !~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpg|png|webp)$' then return false; end if;
      source := page->>'path';
    else
      if jsonb_typeof(page->'static_image') <> 'string' or (page->>'static_image') !~ '^images/[a-zA-Z0-9._-]+$' then return false; end if;
      source := page->>'static_image';
    end if;
    if source = any(seen) then return false; end if;
    seen := array_append(seen, source);
  end loop;
  return true;
end $$;
alter table public.projects drop constraint if exists projects_images_check;
alter table public.projects add constraint projects_images_check check (public.valid_portfolio_images(images));

-- 同步兼容字段，让旧版页面也能读取封面；旧版换图只替换第一张，不丢失内页。
create or replace function public.sync_portfolio_cover()
returns trigger language plpgsql set search_path = '' as $$
declare cover jsonb;
begin
  if tg_op = 'UPDATE' then
    if new.images is not distinct from old.images and
       (new.image_path is distinct from old.image_path or new.static_image is distinct from old.static_image) then
      if new.image_path is not null then
        cover := jsonb_build_object('path',new.image_path,'caption','');
      elsif new.static_image is not null then
        cover := jsonb_build_object('static_image',new.static_image,'caption','');
      end if;
      if cover is not null then new.images := jsonb_set(coalesce(new.images,'[]'::jsonb),'{0}',cover,true); end if;
    end if;
  end if;
  if new.images is null then
    new.images := case
      when new.image_path is not null then jsonb_build_array(jsonb_build_object('path',new.image_path,'caption',''))
      when new.static_image is not null then jsonb_build_array(jsonb_build_object('static_image',new.static_image,'caption',''))
      else '[]'::jsonb end;
  end if;
  new.image_path := new.images->0->>'path';
  new.static_image := new.images->0->>'static_image';
  return new;
end $$;
drop trigger if exists sync_portfolio_cover on public.projects;
create trigger sync_portfolio_cover before insert or update on public.projects
for each row execute function public.sync_portfolio_cover();

-- 失败清理不能删除已被任何内页引用的图片（包括回收站作品）。
drop policy if exists portfolio_cleanup on storage.objects;
create policy portfolio_cleanup on storage.objects for delete to authenticated using (
  bucket_id = 'portfolio'
  and exists (select 1 from public.portfolio_admins where user_id = (select auth.uid()))
  and not exists (
    select 1 from public.projects p
    where p.image_path = storage.objects.name
       or p.images @> jsonb_build_array(jsonb_build_object('path',storage.objects.name))
  )
);
commit;
notify pgrst, 'reload schema';
