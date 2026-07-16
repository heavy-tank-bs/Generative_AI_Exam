-- AI Study Studio: one cloud progress document per authenticated user.
-- Run this file in the Supabase SQL Editor as a project administrator.

create table if not exists public.quiz_progress (
  user_id uuid primary key references auth.users (id) on delete cascade,
  progress jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  constraint quiz_progress_progress_is_object
    check (jsonb_typeof(progress) = 'object')
);

comment on table public.quiz_progress is
  'One JSONB quiz progress document per Supabase Auth user.';

-- Keep updated_at under database control so updates from any client use the
-- database clock. This function only changes NEW and runs with invoker rights.
create or replace function public.set_quiz_progress_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_quiz_progress_updated_at
  on public.quiz_progress;

create trigger set_quiz_progress_updated_at
before insert or update on public.quiz_progress
for each row
execute function public.set_quiz_progress_updated_at();

-- Tables created through SQL do not necessarily have RLS enabled automatically.
alter table public.quiz_progress enable row level security;

-- The browser must not access progress while unauthenticated. Authenticated
-- users need only CRUD privileges; RLS below still limits each operation to
-- the row whose user_id matches the caller's JWT.
revoke all on table public.quiz_progress from public, anon, authenticated;
grant select, insert, update, delete
  on table public.quiz_progress
  to authenticated;

drop policy if exists "quiz_progress_select_own" on public.quiz_progress;
create policy "quiz_progress_select_own"
on public.quiz_progress
for select
to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "quiz_progress_insert_own" on public.quiz_progress;
create policy "quiz_progress_insert_own"
on public.quiz_progress
for insert
to authenticated
with check ((select auth.uid()) = user_id);

drop policy if exists "quiz_progress_update_own" on public.quiz_progress;
create policy "quiz_progress_update_own"
on public.quiz_progress
for update
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

drop policy if exists "quiz_progress_delete_own" on public.quiz_progress;
create policy "quiz_progress_delete_own"
on public.quiz_progress
for delete
to authenticated
using ((select auth.uid()) = user_id);
