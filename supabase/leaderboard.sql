-- TigerPath Hall Cup: weekly step leaderboard between residence halls.
--
-- Privacy: students can only read and write their own row. Everyone else sees
-- hall totals through hall_leaderboard(), and only for halls with 3+ walkers,
-- so no one's individual count can be worked out.

create table if not exists public.weekly_steps (
  user_id uuid not null references auth.users (id) on delete cascade default auth.uid(),
  week text not null check (week ~ '^\d{4}-W\d{2}$'),
  hall text not null check (char_length(hall) between 1 and 12),
  steps integer not null check (steps between 0 and 250000), -- ~35k/day: generous but not absurd
  updated_at timestamptz not null default now(),
  primary key (user_id, week)
);

alter table public.weekly_steps enable row level security;

drop policy if exists "read own steps" on public.weekly_steps;
drop policy if exists "insert own steps" on public.weekly_steps;
drop policy if exists "update own steps" on public.weekly_steps;
drop policy if exists "delete own steps" on public.weekly_steps;
create policy "read own steps"   on public.weekly_steps for select using (auth.uid() = user_id);
create policy "insert own steps" on public.weekly_steps for insert with check (auth.uid() = user_id);
create policy "update own steps" on public.weekly_steps for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "delete own steps" on public.weekly_steps for delete using (auth.uid() = user_id);

create index if not exists weekly_steps_week_hall on public.weekly_steps (week, hall);

-- Hall totals for a week. Halls with fewer than 3 walkers are listed with
-- null numbers so the app can show them as "needs 3 walkers".
create or replace function public.hall_leaderboard(p_week text)
returns table (hall text, walkers integer, total_steps bigint, avg_steps integer)
language sql
stable
security definer
set search_path = public
as $$
  select hall,
         count(*)::integer as walkers,
         case when count(*) >= 3 then sum(steps) end as total_steps,
         case when count(*) >= 3 then (sum(steps) / count(*))::integer end as avg_steps
  from public.weekly_steps
  where week = p_week and steps > 0
  group by hall
  order by (count(*) >= 3) desc, avg_steps desc nulls last, walkers desc;
$$;

revoke all on function public.hall_leaderboard(text) from public;
grant execute on function public.hall_leaderboard(text) to anon, authenticated;
