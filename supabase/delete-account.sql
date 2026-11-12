-- Full account deletion from inside the app (required by the App Store, guideline 5.1.1(v)).
-- A signed-in student can delete only their own login; their user_data row and Hall Cup
-- entries go with it (both reference auth.users with "on delete cascade").
create or replace function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;
  delete from auth.users where id = auth.uid();
end;
$$;

revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;
