-- Run once in the Supabase SQL Editor for the Pocketwise project.
-- Financial records are stored per authenticated user. Never use a secret/service_role key in the browser.
create table if not exists public.pocketwise_budgets (
  user_id uuid primary key references auth.users(id) on delete cascade,
  version bigint not null default 1 check (version > 0),
  data jsonb not null check (jsonb_typeof(data) = 'object'),
  updated_at timestamptz not null default now()
);

alter table public.pocketwise_budgets enable row level security;
revoke all on public.pocketwise_budgets from anon;
grant select, insert, update on public.pocketwise_budgets to authenticated;

drop policy if exists "read own budget" on public.pocketwise_budgets;
create policy "read own budget" on public.pocketwise_budgets
  for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "create own budget" on public.pocketwise_budgets;
create policy "create own budget" on public.pocketwise_budgets
  for insert to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "update own budget" on public.pocketwise_budgets;
create policy "update own budget" on public.pocketwise_budgets
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create or replace function public.pocketwise_touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists pocketwise_touch_updated_at on public.pocketwise_budgets;
create trigger pocketwise_touch_updated_at before update on public.pocketwise_budgets
for each row execute function public.pocketwise_touch_updated_at();
