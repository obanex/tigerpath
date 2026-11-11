-- TigerPath cloud accounts: one JSON document per student.
create table if not exists public.user_data (
  id uuid primary key references auth.users (id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.user_data enable row level security;

-- Each student can only see and change their own row.
create policy "read own data"   on public.user_data for select using (auth.uid() = id);
create policy "insert own data" on public.user_data for insert with check (auth.uid() = id);
create policy "update own data" on public.user_data for update using (auth.uid() = id) with check (auth.uid() = id);
create policy "delete own data" on public.user_data for delete using (auth.uid() = id);
