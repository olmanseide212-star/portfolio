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
