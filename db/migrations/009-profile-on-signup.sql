-- 009 — Create a profile row when someone signs up.
--
-- Every learner-owned table keys on profiles(id), and RLS compares auth.uid() against it.
-- Without this trigger a brand-new user has an auth record but no profile, so every
-- policy denies them and the app looks broken rather than empty.
--
-- SECURITY DEFINER because the inserting role is Supabase's auth machinery, which has no
-- privileges on public.profiles.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    -- The local part of the email is a better default than nothing, and the learner can
    -- change it. We deliberately do not store the email here: auth.users already has it,
    -- and copying personal data into a table everyone's policies touch is how it leaks.
    split_part(coalesce(new.email, ''), '@', 1)
  )
  on conflict (id) do nothing;

  insert into public.streaks (user_id) values (new.id) on conflict (user_id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Promoting a reviewer is deliberately a database action, not a UI one. Approving is the
-- only route high-risk content has to publication, so granting that power should require
-- deliberate access rather than a button someone can be socially engineered into pressing.
--
--   select public.grant_platform_role('expert@example.org', 'reviewer');
create or replace function public.grant_platform_role(user_email text, new_role text)
returns void
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  target uuid;
begin
  if new_role not in ('learner', 'reviewer', 'admin') then
    raise exception 'unknown platform role %', new_role;
  end if;

  select id into target from auth.users where email = user_email;
  if target is null then
    raise exception 'no user with email % — they must sign in once first', user_email;
  end if;

  update profiles set platform_role = new_role where id = target;
end $$;

-- Callable only by someone with direct database access, never by a client.
revoke all on function public.grant_platform_role(text, text) from public, anon, authenticated;
