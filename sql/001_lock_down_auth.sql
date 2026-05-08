-- =====================================================================
-- 001_lock_down_auth.sql
-- Run once in Supabase SQL Editor.
-- Fixes 4 auth holes:
--   1. profiles UPDATE policy let users set role = 'superadmin'
--   2. update_user_role RPC had no caller check
--   3. delete_user RPC had no caller check
--   4. get_all_profiles RPC leaked all emails to any authenticated user
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Block direct UPDATEs on profiles for end users.
--    All role transitions must go through one of the RPCs:
--      upgrade_to_pro      (self: free → pro)
--      downgrade_to_free   (self: pro  → free)
--      update_user_role    (superadmin only)
--    RPCs are SECURITY DEFINER so they bypass this revoke.
--    The existing "profiles: update own" RLS policy is dropped — it's
--    redundant once table-level UPDATE is gone.
-- ---------------------------------------------------------------------
drop policy if exists "profiles: update own" on profiles;
revoke update on profiles from authenticated, anon;

-- ---------------------------------------------------------------------
-- 2. update_user_role: only superadmins can call it,
--    and superadmin role itself can never be assigned via this RPC.
-- ---------------------------------------------------------------------
create or replace function update_user_role(target_id uuid, new_role text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_role text;
begin
  select role into caller_role from profiles where id = auth.uid();

  if caller_role is null or caller_role <> 'superadmin' then
    raise exception 'not authorized';
  end if;

  if new_role not in ('free', 'pro', 'admin') then
    raise exception 'invalid role';
  end if;

  -- Don't allow demoting another superadmin via this RPC.
  if exists (select 1 from profiles where id = target_id and role = 'superadmin') then
    raise exception 'cannot modify superadmin';
  end if;

  update profiles set role = new_role where id = target_id;
end;
$$;

-- ---------------------------------------------------------------------
-- 3. delete_user: only superadmins, and they cannot delete a superadmin
--    (including themselves) through this RPC.
-- ---------------------------------------------------------------------
create or replace function delete_user(target_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_role text;
begin
  select role into caller_role from profiles where id = auth.uid();

  if caller_role is null or caller_role <> 'superadmin' then
    raise exception 'not authorized';
  end if;

  if exists (select 1 from profiles where id = target_id and role = 'superadmin') then
    raise exception 'cannot delete superadmin';
  end if;

  delete from auth.users where id = target_id;
end;
$$;

-- ---------------------------------------------------------------------
-- 4. get_all_profiles: only admins / superadmins can read all profiles.
-- ---------------------------------------------------------------------
create or replace function get_all_profiles()
returns table (id uuid, email text, role text, created_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_role text;
begin
  select role into caller_role from profiles where id = auth.uid();

  if caller_role is null or caller_role not in ('admin', 'superadmin') then
    raise exception 'not authorized';
  end if;

  return query
    select p.id, p.email, p.role, p.created_at
    from profiles p
    order by p.created_at desc;
end;
$$;

-- ---------------------------------------------------------------------
-- 5. downgrade_to_free: lets a Pro user voluntarily go back to Free.
--    The new profiles UPDATE policy blocks self-role-changes, so this
--    RPC is the only way Account.jsx can do it.
-- ---------------------------------------------------------------------
create or replace function downgrade_to_free()
returns void
language sql
security definer
set search_path = public
as $$
  update profiles
  set role = 'free'
  where id = auth.uid()
    and role = 'pro';
$$;

-- ---------------------------------------------------------------------
-- Sanity grants (these are usually already correct, but explicit is fine).
-- ---------------------------------------------------------------------
revoke execute on function update_user_role(uuid, text) from anon;
revoke execute on function delete_user(uuid)            from anon;
revoke execute on function get_all_profiles()           from anon;
revoke execute on function downgrade_to_free()          from anon;

grant execute on function update_user_role(uuid, text) to authenticated;
grant execute on function delete_user(uuid)            to authenticated;
grant execute on function get_all_profiles()           to authenticated;
grant execute on function downgrade_to_free()          to authenticated;

-- =====================================================================
-- Verification queries (run after to confirm):
--
-- select policyname, cmd, qual, with_check
-- from pg_policies where schemaname='public' and tablename='profiles';
--
-- select proname, prosecdef, pg_get_functiondef(oid)
-- from pg_proc where proname in
--   ('update_user_role','delete_user','get_all_profiles','upgrade_to_pro');
-- =====================================================================
