create schema if not exists private;

revoke all on schema private from public, anon, authenticated;

create table public.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  display_name text check (display_name is null or char_length(display_name) between 1 and 120),
  locale text not null default 'en-CA' check (char_length(locale) between 2 and 35),
  timezone text not null default 'Etc/UTC' check (char_length(timezone) between 3 and 100),
  marketing_consent_at timestamptz,
  terms_version text,
  terms_accepted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_terms_evidence_complete check (
    (terms_version is null and terms_accepted_at is null)
    or (terms_version is not null and terms_accepted_at is not null)
  )
);

create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  kind text not null default 'personal' check (kind = 'personal'),
  name text not null default 'My workspace' check (char_length(name) between 1 and 120),
  owner_user_id uuid not null references auth.users (id) on delete cascade,
  status text not null default 'active' check (status in ('active', 'suspended', 'deleting', 'deleted')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint workspaces_deleted_state_consistent check (
    (status = 'deleted' and deleted_at is not null)
    or (status <> 'deleted' and deleted_at is null)
  )
);

create unique index workspaces_one_personal_per_owner
  on public.workspaces (owner_user_id)
  where kind = 'personal' and status <> 'deleted';

create table public.workspace_members (
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null default 'owner' check (role = 'owner'),
  status text not null default 'active' check (status in ('active', 'removed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

alter table public.profiles enable row level security;
alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;

revoke all on table public.profiles from anon, authenticated;
revoke all on table public.workspaces from anon, authenticated;
revoke all on table public.workspace_members from anon, authenticated;

grant select on table public.profiles to authenticated;
grant update (display_name, locale, timezone, marketing_consent_at)
  on table public.profiles to authenticated;
grant select on table public.workspaces to authenticated;
grant select on table public.workspace_members to authenticated;

create policy "profiles_select_own"
  on public.profiles
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "profiles_update_own"
  on public.profiles
  for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "workspaces_select_active_personal_owner"
  on public.workspaces
  for select
  to authenticated
  using (
    owner_user_id = (select auth.uid())
    and kind = 'personal'
    and status = 'active'
    and exists (
      select 1
      from public.workspace_members membership
      where membership.workspace_id = workspaces.id
        and membership.user_id = (select auth.uid())
        and membership.role = 'owner'
        and membership.status = 'active'
    )
  );

create policy "workspace_members_select_self_active"
  on public.workspace_members
  for select
  to authenticated
  using (
    user_id = (select auth.uid())
    and status = 'active'
  );

create function private.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

revoke all on function private.set_updated_at() from public, anon, authenticated;

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function private.set_updated_at();

create trigger workspaces_set_updated_at
  before update on public.workspaces
  for each row execute function private.set_updated_at();

create trigger workspace_members_set_updated_at
  before update on public.workspace_members
  for each row execute function private.set_updated_at();

create function private.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  personal_workspace_id uuid := gen_random_uuid();
begin
  insert into public.profiles (user_id)
  values (new.id);

  insert into public.workspaces (id, owner_user_id)
  values (personal_workspace_id, new.id);

  insert into public.workspace_members (workspace_id, user_id)
  values (personal_workspace_id, new.id);

  return new;
end;
$$;

revoke all on function private.handle_new_auth_user() from public, anon, authenticated;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_auth_user();
