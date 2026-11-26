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
