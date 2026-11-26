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
