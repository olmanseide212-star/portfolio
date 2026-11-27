-- 关于我 / 联系方式升级（2026-11-27）。可重复执行，不影响作品和图片。
begin;
create table if not exists public.site_profile (
  id smallint primary key default 1 check (id = 1),
  intro text not null default '' check (char_length(intro) <= 300),
  contacts jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

-- 与前端 profile.js 相同的规则：最多 12 条；平台白名单；链接必须 https://；邮箱基本格式。
create or replace function public.valid_profile_contacts(items jsonb)
returns boolean language plpgsql immutable set search_path = '' as $$
declare item jsonb; platform text; val text;
begin
  if items is null or jsonb_typeof(items) <> 'array' or jsonb_array_length(items) > 12 then return false; end if;
  for item in select value from jsonb_array_elements(items) loop
    if jsonb_typeof(item) <> 'object' then return false; end if;
    if jsonb_typeof(item->'platform') is distinct from 'string' or jsonb_typeof(item->'value') is distinct from 'string' then return false; end if;
    if item ? 'label' and (jsonb_typeof(item->'label') <> 'string' or char_length(item->>'label') > 40) then return false; end if;
    platform := item->>'platform';
    val := item->>'value';
    if val <> btrim(val) or char_length(val) not between 1 and 200 then return false; end if;
    if platform = 'email' then
      if val !~ '^[^[:space:]@?#]+@[^[:space:]@?#]+\.[^[:space:]@?#]+$' then return false; end if;
    elsif platform = 'wechat' then
      if val ~ '[[:space:]]' then return false; end if;
    elsif platform in ('xiaohongshu','bilibili','weibo','douyin','instagram','behance','website') then
      if val !~ '^https://[^[:space:]]+$' then return false; end if;
    else
      return false;
    end if;
  end loop;
  return true;
end $$;
alter table public.site_profile drop constraint if exists site_profile_contacts_check;
alter table public.site_profile add constraint site_profile_contacts_check check (public.valid_profile_contacts(contacts));

-- 访客只读；白名单管理员只能修改这唯一一行，不能新增或删除。
alter table public.site_profile enable row level security;
revoke all on public.site_profile from anon, authenticated;
grant select on public.site_profile to anon, authenticated;
grant update on public.site_profile to authenticated;
drop policy if exists profile_public_read on public.site_profile;
create policy profile_public_read on public.site_profile for select to anon, authenticated using (true);
drop policy if exists profile_admin_update on public.site_profile;
create policy profile_admin_update on public.site_profile for update to authenticated
  using (exists (select 1 from public.portfolio_admins where user_id = (select auth.uid())))
  with check (exists (select 1 from public.portfolio_admins where user_id = (select auth.uid())));

insert into public.site_profile (id) values (1) on conflict (id) do nothing;
commit;
notify pgrst, 'reload schema';
