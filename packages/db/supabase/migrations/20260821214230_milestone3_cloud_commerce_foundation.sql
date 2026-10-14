alter table public.profiles
  add column retain_job_history boolean not null default false,
  add column account_deletion_requested_at timestamptz;

grant update (retain_job_history) on table public.profiles to authenticated;

create table public.subscriptions (
  workspace_id uuid primary key references public.workspaces (id) on delete cascade,
  provider_customer_id text unique,
  provider_subscription_id text unique,
  status text not null default 'none'
    check (status in ('none', 'trialing', 'active', 'past_due', 'paused', 'cancelled', 'unpaid')),
  plan_key text not null default 'free'
    check (plan_key in ('free', 'pro_monthly', 'pro_annual')),
  currency text not null default 'CAD'
    check (currency ~ '^[A-Z]{3}$'),
  current_period_start timestamptz,
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  grace_until timestamptz,
  provider_updated_at timestamptz,
  provider_event_id text,
  updated_at timestamptz not null default now(),
  constraint subscriptions_period_order check (
    current_period_start is null
    or current_period_end is null
    or current_period_end >= current_period_start
  )
);

create table public.entitlement_snapshots (
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  feature_key text not null check (feature_key ~ '^[a-z][a-z0-9]*(\.[a-z0-9_]+)+$'),
  enabled boolean not null,
  limit_value bigint check (limit_value is null or limit_value >= 0),
  limit_unit text check (limit_unit is null or limit_unit in ('jobs', 'pages', 'bytes')),
  source text not null check (source in ('free', 'subscription', 'trial', 'admin_grant')),
  effective_from timestamptz not null default now(),
  effective_until timestamptz,
  revision bigint not null default 1 check (revision >= 1),
  updated_at timestamptz not null default now(),
  primary key (workspace_id, feature_key),
  constraint entitlement_limit_complete check (
    (limit_value is null and limit_unit is null)
    or (limit_value is not null and limit_unit is not null)
  ),
  constraint entitlement_period_order check (
    effective_until is null or effective_until >= effective_from
  )
);

create table public.jobs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  created_by uuid not null references auth.users (id) on delete cascade,
  operation text not null check (operation ~ '^[a-z][a-z0-9]*(\.[a-z0-9]+)*$'),
  operation_version text not null check (operation_version ~ '^\d+\.\d+\.\d+$'),
  state text not null default 'awaiting_upload' check (
    state in (
      'awaiting_upload', 'queued', 'processing', 'retry_wait', 'cancelling', 'cancelled',
      'completed', 'failed', 'expired', 'deleting', 'deleted', 'deletion_attention'
    )
  ),
  options jsonb not null default '{}'::jsonb check (jsonb_typeof(options) = 'object'),
  idempotency_key text not null check (char_length(idempotency_key) between 16 and 200),
  progress_stage text not null default 'authorizing' check (progress_stage ~ '^[a-z][a-z0-9_]*$'),
  progress_value smallint check (progress_value between 0 and 100),
  attempt_count smallint not null default 0 check (attempt_count >= 0),
  max_attempts smallint not null default 3 check (max_attempts between 1 and 10),
  lease_owner text,
  lease_expires_at timestamptz,
  error_code text check (error_code is null or error_code ~ '^[A-Z][A-Z0-9_]*$'),
  warning_codes text[] not null default '{}',
  created_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,
  delete_after timestamptz not null,
  updated_at timestamptz not null default now(),
  unique (workspace_id, idempotency_key),
  constraint jobs_lease_complete check (
    (lease_owner is null and lease_expires_at is null)
    or (lease_owner is not null and lease_expires_at is not null)
  )
);

create table public.job_objects (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs (id) on delete cascade,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  role text not null check (role in ('input', 'output', 'preview', 'temporary')),
  storage_key text not null unique check (char_length(storage_key) between 24 and 512),
  mime_type text not null check (char_length(mime_type) between 3 and 120),
  byte_size bigint check (byte_size is null or byte_size > 0),
  sha256 text check (sha256 is null or sha256 ~ '^[a-f0-9]{64}$'),
  state text not null default 'pending'
    check (state in ('pending', 'uploaded', 'verified', 'deleted', 'delete_failed')),
  delete_attempt_count smallint not null default 0 check (delete_attempt_count >= 0),
  last_delete_error_code text
    check (last_delete_error_code is null or last_delete_error_code ~ '^[A-Z][A-Z0-9_]*$'),
  delete_after timestamptz not null,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint job_objects_deleted_state_consistent check (
    (state = 'deleted' and deleted_at is not null)
    or (state <> 'deleted' and deleted_at is null)
  )
);

create table public.usage_ledger (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  feature_key text not null check (feature_key ~ '^[a-z][a-z0-9]*(\.[a-z0-9_]+)+$'),
  quantity bigint not null check (quantity > 0),
  unit text not null check (unit in ('jobs', 'pages', 'bytes')),
  period_key text not null check (period_key ~ '^\d{4}-\d{2}$'),
  job_id uuid references public.jobs (id) on delete cascade,
  status text not null check (status in ('reserved', 'consumed', 'released')),
  created_at timestamptz not null default now(),
  settled_at timestamptz,
  unique (workspace_id, feature_key, job_id),
  constraint usage_settlement_consistent check (
    (status = 'reserved' and settled_at is null)
    or (status in ('consumed', 'released') and settled_at is not null)
  )
);

create table public.webhook_events (
  provider text not null check (provider in ('stripe')),
  event_id text not null,
  event_type text not null,
  created_at_provider timestamptz not null,
  processing_state text not null default 'received'
    check (processing_state in ('received', 'processed', 'ignored', 'failed')),
  attempt_count smallint not null default 1 check (attempt_count >= 1),
  processed_at timestamptz,
  last_error_code text
    check (last_error_code is null or last_error_code ~ '^[A-Z][A-Z0-9_]*$'),
  received_at timestamptz not null default now(),
  primary key (provider, event_id)
);

create table public.audit_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid references public.workspaces (id) on delete cascade,
  actor_user_id uuid references auth.users (id) on delete set null,
  event_type text not null check (event_type ~ '^[a-z][a-z0-9]*(\.[a-z0-9_]+)+$'),
  request_id text check (request_id is null or char_length(request_id) between 8 and 200),
  safe_context jsonb not null default '{}'::jsonb check (jsonb_typeof(safe_context) = 'object'),
  created_at timestamptz not null default now()
);

create index subscriptions_provider_updated_idx
  on public.subscriptions (provider_updated_at desc nulls last);
create index entitlement_snapshots_workspace_enabled_idx
  on public.entitlement_snapshots (workspace_id, enabled);
create index jobs_workspace_created_idx on public.jobs (workspace_id, created_at desc);
create index jobs_claimable_idx on public.jobs (created_at)
  where state in ('queued', 'retry_wait');
create index jobs_lease_expiry_idx on public.jobs (lease_expires_at)
  where lease_expires_at is not null;
create index jobs_retention_idx on public.jobs (delete_after)
  where state not in ('deleted', 'deleting');
create index job_objects_job_id_idx on public.job_objects (job_id);
create index job_objects_workspace_id_idx on public.job_objects (workspace_id);
create index job_objects_retention_idx on public.job_objects (delete_after)
  where state <> 'deleted';
create index usage_ledger_workspace_period_idx
  on public.usage_ledger (workspace_id, feature_key, period_key, status);
create index usage_ledger_job_id_idx on public.usage_ledger (job_id)
  where job_id is not null;
create index webhook_events_state_received_idx
  on public.webhook_events (processing_state, received_at);
create index audit_events_workspace_created_idx
  on public.audit_events (workspace_id, created_at desc);

alter table public.subscriptions enable row level security;
alter table public.entitlement_snapshots enable row level security;
alter table public.jobs enable row level security;
alter table public.job_objects enable row level security;
alter table public.usage_ledger enable row level security;
alter table public.webhook_events enable row level security;
alter table public.audit_events enable row level security;

revoke all on table public.subscriptions from anon, authenticated;
revoke all on table public.entitlement_snapshots from anon, authenticated;
revoke all on table public.jobs from anon, authenticated;
revoke all on table public.job_objects from anon, authenticated;
revoke all on table public.usage_ledger from anon, authenticated;
revoke all on table public.webhook_events from anon, authenticated;
revoke all on table public.audit_events from anon, authenticated;

grant select (
  workspace_id, status, plan_key, currency, current_period_start, current_period_end,
  cancel_at_period_end, grace_until, updated_at
) on table public.subscriptions to authenticated;
grant select on table public.entitlement_snapshots to authenticated;
grant select (
  id, workspace_id, created_by, operation, operation_version, state, progress_stage,
  progress_value, error_code, warning_codes, created_at, started_at, completed_at,
  cancelled_at, delete_after, updated_at
) on table public.jobs to authenticated;
grant select (
  id, job_id, workspace_id, role, mime_type, byte_size, state, delete_after, deleted_at
) on table public.job_objects to authenticated;
grant select (
  id, workspace_id, feature_key, quantity, unit, period_key, job_id, status, created_at, settled_at
) on table public.usage_ledger to authenticated;
grant select (
  id, workspace_id, actor_user_id, event_type, request_id, safe_context, created_at
) on table public.audit_events to authenticated;

create policy subscriptions_select_active_workspace
  on public.subscriptions for select to authenticated
  using (exists (select 1 from public.workspaces where id = subscriptions.workspace_id));

create policy entitlements_select_active_workspace
  on public.entitlement_snapshots for select to authenticated
  using (exists (select 1 from public.workspaces where id = entitlement_snapshots.workspace_id));

create policy jobs_select_active_workspace
  on public.jobs for select to authenticated
  using (exists (select 1 from public.workspaces where id = jobs.workspace_id));

create policy job_objects_select_active_workspace
  on public.job_objects for select to authenticated
  using (exists (select 1 from public.workspaces where id = job_objects.workspace_id));

create policy usage_select_active_workspace
  on public.usage_ledger for select to authenticated
  using (exists (select 1 from public.workspaces where id = usage_ledger.workspace_id));

create policy audit_select_active_workspace
  on public.audit_events for select to authenticated
  using (exists (select 1 from public.workspaces where id = audit_events.workspace_id));

create view public.safe_job_object_statuses
with (security_invoker = true)
as
select id, job_id, workspace_id, role, mime_type, byte_size, state, delete_after, deleted_at
from public.job_objects;

revoke all on table public.safe_job_object_statuses from anon, authenticated;
grant select on table public.safe_job_object_statuses to authenticated;

create view public.operational_job_summary
with (security_invoker = true)
as
select
  state,
  operation,
  count(*)::bigint as job_count,
  min(created_at) as oldest_created_at,
  count(*) filter (where delete_after < now() and state <> 'deleted')::bigint as overdue_deletion_count
from public.jobs
group by state, operation;

revoke all on table public.operational_job_summary from public, anon, authenticated;
grant select on table public.operational_job_summary to service_role;

create trigger subscriptions_set_updated_at
  before update on public.subscriptions
  for each row execute function private.set_updated_at();
create trigger entitlement_snapshots_set_updated_at
  before update on public.entitlement_snapshots
  for each row execute function private.set_updated_at();
create trigger jobs_set_updated_at
  before update on public.jobs
  for each row execute function private.set_updated_at();
create trigger job_objects_set_updated_at
  before update on public.job_objects
  for each row execute function private.set_updated_at();

create function private.seed_workspace_cloud_foundation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.subscriptions (workspace_id)
  values (new.id)
  on conflict (workspace_id) do nothing;

  insert into public.entitlement_snapshots (
    workspace_id, feature_key, enabled, limit_value, limit_unit, source
  ) values (
    new.id, 'cloud.demo.integrity', true, 3, 'jobs', 'free'
  ) on conflict (workspace_id, feature_key) do nothing;

  return new;
end;
$$;

revoke all on function private.seed_workspace_cloud_foundation() from public, anon, authenticated;

create trigger on_workspace_created_cloud_foundation
  after insert on public.workspaces
  for each row execute function private.seed_workspace_cloud_foundation();

insert into public.subscriptions (workspace_id)
select id from public.workspaces
on conflict (workspace_id) do nothing;

insert into public.entitlement_snapshots (
  workspace_id, feature_key, enabled, limit_value, limit_unit, source
)
select id, 'cloud.demo.integrity', true, 3, 'jobs', 'free'
from public.workspaces
on conflict (workspace_id, feature_key) do nothing;

create function public.is_allowed_job_transition(from_state text, to_state text)
returns boolean
language sql
immutable
security invoker
set search_path = ''
as $$
  select case from_state
    when 'awaiting_upload' then to_state = any (array['queued', 'expired', 'deleting'])
    when 'queued' then to_state = any (array['processing', 'cancelling', 'deleting'])
    when 'processing' then to_state = any (array['completed', 'retry_wait', 'failed', 'cancelling'])
    when 'retry_wait' then to_state = any (array['queued', 'cancelling', 'failed'])
    when 'cancelling' then to_state = any (array['cancelled', 'deleting'])
    when 'cancelled' then to_state = 'deleting'
    when 'completed' then to_state = 'deleting'
    when 'failed' then to_state = 'deleting'
    when 'expired' then to_state = 'deleting'
    when 'deleting' then to_state = any (array['deleted', 'deletion_attention'])
    when 'deletion_attention' then to_state = 'deleting'
    else false
  end;
$$;

revoke all on function public.is_allowed_job_transition(text, text) from public, anon, authenticated;
grant execute on function public.is_allowed_job_transition(text, text) to service_role;

create function public.create_cloud_job_with_reservation(
  target_workspace_id uuid,
  actor_user_id uuid,
  job_operation text,
  job_operation_version text,
  job_options jsonb,
  request_idempotency_key text,
  entitlement_feature_key text,
  usage_quantity bigint,
  usage_unit text,
  usage_period_key text,
  deletion_deadline timestamptz
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  existing_job_id uuid;
  effective_limit bigint;
  effective_enabled boolean;
  current_usage bigint;
  created_job_id uuid;
begin
  select id into existing_job_id
  from public.jobs
  where workspace_id = target_workspace_id
    and idempotency_key = request_idempotency_key;
  if existing_job_id is not null then
    return existing_job_id;
  end if;

  if not exists (
    select 1
    from public.workspaces w
    join public.workspace_members m on m.workspace_id = w.id
    where w.id = target_workspace_id
      and w.status = 'active'
      and m.user_id = actor_user_id
      and m.status = 'active'
  ) then
    raise exception using errcode = '42501', message = 'WORKSPACE_ACCESS_DENIED';
  end if;

  select enabled, limit_value
  into effective_enabled, effective_limit
  from public.entitlement_snapshots
  where workspace_id = target_workspace_id
    and feature_key = entitlement_feature_key
    and effective_from <= now()
    and (effective_until is null or effective_until > now())
  for update;

  if effective_enabled is distinct from true then
    raise exception using errcode = '42501', message = 'ENTITLEMENT_REQUIRED';
  end if;

  select coalesce(sum(quantity), 0)
  into current_usage
  from public.usage_ledger
  where workspace_id = target_workspace_id
    and feature_key = entitlement_feature_key
    and period_key = usage_period_key
    and status in ('reserved', 'consumed');

  if effective_limit is not null and current_usage + usage_quantity > effective_limit then
    raise exception using errcode = 'P0001', message = 'QUOTA_EXCEEDED';
  end if;

  insert into public.jobs (
    workspace_id, created_by, operation, operation_version, options, idempotency_key,
    progress_stage, delete_after
  ) values (
    target_workspace_id, actor_user_id, job_operation, job_operation_version, job_options,
    request_idempotency_key, 'awaiting_upload', deletion_deadline
  )
  returning id into created_job_id;

  insert into public.usage_ledger (
    workspace_id, feature_key, quantity, unit, period_key, job_id, status
  ) values (
    target_workspace_id, entitlement_feature_key, usage_quantity, usage_unit,
    usage_period_key, created_job_id, 'reserved'
  );

  return created_job_id;
end;
$$;

revoke all on function public.create_cloud_job_with_reservation(
  uuid, uuid, text, text, jsonb, text, text, bigint, text, text, timestamptz
) from public, anon, authenticated;
grant execute on function public.create_cloud_job_with_reservation(
  uuid, uuid, text, text, jsonb, text, text, bigint, text, text, timestamptz
) to service_role;

create function public.transition_cloud_job(
  target_job_id uuid,
  expected_state text,
  next_state text,
  next_stage text,
  next_progress smallint default null,
  safe_error_code text default null
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  changed_count integer;
begin
  if not public.is_allowed_job_transition(expected_state, next_state) then
    raise exception using errcode = '22023', message = 'INVALID_JOB_TRANSITION';
  end if;

  update public.jobs
  set
    state = next_state,
    progress_stage = next_stage,
    progress_value = next_progress,
    error_code = safe_error_code,
    started_at = case when next_state = 'processing' then coalesce(started_at, now()) else started_at end,
    completed_at = case when next_state in ('completed', 'failed') then now() else completed_at end,
    cancelled_at = case when next_state = 'cancelled' then now() else cancelled_at end,
    lease_owner = case when next_state in ('processing') then lease_owner else null end,
    lease_expires_at = case when next_state in ('processing') then lease_expires_at else null end
  where id = target_job_id and state = expected_state;

  get diagnostics changed_count = row_count;
  return changed_count = 1;
end;
$$;

revoke all on function public.transition_cloud_job(uuid, text, text, text, smallint, text)
  from public, anon, authenticated;
grant execute on function public.transition_cloud_job(uuid, text, text, text, smallint, text)
  to service_role;

create function public.claim_cloud_job(worker_id text, lease_seconds integer)
returns setof public.jobs
language plpgsql
security invoker
set search_path = ''
as $$
declare
  claimed_job_id uuid;
begin
  if lease_seconds < 15 or lease_seconds > 900 or char_length(worker_id) not between 8 and 120 then
    raise exception using errcode = '22023', message = 'INVALID_LEASE_REQUEST';
  end if;

  select id into claimed_job_id
  from public.jobs
  where
    (state = 'queued')
    or (state = 'retry_wait' and (lease_expires_at is null or lease_expires_at <= now()))
  order by created_at
  for update skip locked
  limit 1;

  if claimed_job_id is null then
    return;
  end if;

  return query
  update public.jobs
  set
    state = 'processing',
    progress_stage = 'starting',
    attempt_count = attempt_count + 1,
    lease_owner = worker_id,
    lease_expires_at = now() + make_interval(secs => lease_seconds),
    started_at = coalesce(started_at, now())
  where id = claimed_job_id
  returning *;
end;
$$;

revoke all on function public.claim_cloud_job(text, integer) from public, anon, authenticated;
grant execute on function public.claim_cloud_job(text, integer) to service_role;

create function public.settle_cloud_job_usage(target_job_id uuid, consume_usage boolean)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  changed_count integer;
begin
  update public.usage_ledger
  set status = case when consume_usage then 'consumed' else 'released' end,
      settled_at = now()
  where job_id = target_job_id and status = 'reserved';
  get diagnostics changed_count = row_count;
  return changed_count > 0;
end;
$$;

revoke all on function public.settle_cloud_job_usage(uuid, boolean) from public, anon, authenticated;
grant execute on function public.settle_cloud_job_usage(uuid, boolean) to service_role;

create function public.request_cloud_job_cancellation(
  target_job_id uuid,
  target_workspace_id uuid,
  actor_user_id uuid
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  changed_count integer;
begin
  if not exists (
    select 1
    from public.workspaces w
    join public.workspace_members m on m.workspace_id = w.id
    where w.id = target_workspace_id
      and w.status = 'active'
      and m.user_id = actor_user_id
      and m.status = 'active'
  ) then
    raise exception using errcode = '42501', message = 'WORKSPACE_ACCESS_DENIED';
  end if;

  update public.jobs
  set state = 'cancelling', progress_stage = 'cancelling', progress_value = null
  where id = target_job_id
    and workspace_id = target_workspace_id
    and state in ('queued', 'processing', 'retry_wait');
  get diagnostics changed_count = row_count;
  return changed_count = 1;
end;
$$;

revoke all on function public.request_cloud_job_cancellation(uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.request_cloud_job_cancellation(uuid, uuid, uuid) to service_role;

create function public.request_cloud_job_deletion(
  target_job_id uuid,
  target_workspace_id uuid,
  actor_user_id uuid
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  changed_count integer;
begin
  if not exists (
    select 1
    from public.workspaces w
    join public.workspace_members m on m.workspace_id = w.id
    where w.id = target_workspace_id
      and w.status = 'active'
      and m.user_id = actor_user_id
      and m.status = 'active'
  ) then
    raise exception using errcode = '42501', message = 'WORKSPACE_ACCESS_DENIED';
  end if;

  update public.jobs
  set state = 'deleting', progress_stage = 'deleting', progress_value = null, delete_after = now()
  where id = target_job_id
    and workspace_id = target_workspace_id
    and state in (
      'awaiting_upload', 'queued', 'cancelled', 'completed', 'failed', 'expired',
      'deletion_attention'
    );
  get diagnostics changed_count = row_count;

  if changed_count = 1 then
    update public.job_objects
    set delete_after = now()
    where job_id = target_job_id and state <> 'deleted';
  end if;
  return changed_count = 1;
end;
$$;

revoke all on function public.request_cloud_job_deletion(uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.request_cloud_job_deletion(uuid, uuid, uuid) to service_role;

create function public.record_job_object_deletion(
  target_object_id uuid,
  deletion_succeeded boolean,
  safe_error_code text default null
)
returns text
language plpgsql
security invoker
set search_path = ''
as $$
declare
  target_job_id uuid;
  new_attempt_count smallint;
  remaining_objects bigint;
begin
  update public.job_objects
  set
    state = case when deletion_succeeded then 'deleted' else 'delete_failed' end,
    delete_attempt_count = delete_attempt_count + 1,
    last_delete_error_code = case when deletion_succeeded then null else safe_error_code end,
    deleted_at = case when deletion_succeeded then now() else null end
  where id = target_object_id and state <> 'deleted'
  returning job_id, delete_attempt_count into target_job_id, new_attempt_count;

  if target_job_id is null then
    return 'unchanged';
  end if;

  if not deletion_succeeded and new_attempt_count >= 3 then
    update public.jobs
    set state = 'deletion_attention', progress_stage = 'deletion_attention', error_code = 'OBJECT_DELETE_FAILED'
    where id = target_job_id and state = 'deleting';
    return 'attention';
  end if;

  if deletion_succeeded then
    select count(*) into remaining_objects
    from public.job_objects
    where job_id = target_job_id and state <> 'deleted';
    if remaining_objects = 0 then
      update public.jobs
      set state = 'deleted', progress_stage = 'deleted', progress_value = 100,
          lease_owner = null, lease_expires_at = null
      where id = target_job_id and state in ('deleting', 'deletion_attention');
      return 'job_deleted';
    end if;
  end if;

  return case when deletion_succeeded then 'object_deleted' else 'retry' end;
end;
$$;

revoke all on function public.record_job_object_deletion(uuid, boolean, text)
  from public, anon, authenticated;
grant execute on function public.record_job_object_deletion(uuid, boolean, text) to service_role;

create function public.accept_stripe_subscription_event(
  stripe_event_id text,
  stripe_event_type text,
  stripe_event_created_at timestamptz,
  target_workspace_id uuid,
  stripe_customer_id text,
  stripe_subscription_id text,
  normalized_status text,
  internal_plan_key text,
  subscription_currency text,
  period_start timestamptz,
  period_end timestamptz,
  ends_at_period_end boolean
)
returns text
language plpgsql
security invoker
set search_path = ''
as $$
declare
  inserted_event_count integer;
  subscription_event boolean;
  applied_subscription_count integer := 0;
  access_enabled boolean;
begin
  insert into public.webhook_events (
    provider, event_id, event_type, created_at_provider, processing_state
  ) values (
    'stripe', stripe_event_id, stripe_event_type, stripe_event_created_at, 'received'
  ) on conflict (provider, event_id) do nothing;
  get diagnostics inserted_event_count = row_count;

  if inserted_event_count = 0 then
    return 'duplicate';
  end if;

  subscription_event := stripe_event_type in (
    'customer.subscription.created', 'customer.subscription.updated',
    'customer.subscription.deleted', 'invoice.paid', 'invoice.payment_failed'
  );

  if subscription_event then
    insert into public.subscriptions (
      workspace_id, provider_customer_id, provider_subscription_id, status, plan_key,
      currency, current_period_start, current_period_end, cancel_at_period_end,
      provider_updated_at, provider_event_id
    ) values (
      target_workspace_id, stripe_customer_id, stripe_subscription_id, normalized_status,
      internal_plan_key, upper(subscription_currency), period_start, period_end,
      ends_at_period_end, stripe_event_created_at, stripe_event_id
    )
    on conflict (workspace_id) do update set
      provider_customer_id = excluded.provider_customer_id,
      provider_subscription_id = excluded.provider_subscription_id,
      status = excluded.status,
      plan_key = excluded.plan_key,
      currency = excluded.currency,
      current_period_start = excluded.current_period_start,
      current_period_end = excluded.current_period_end,
      cancel_at_period_end = excluded.cancel_at_period_end,
      provider_updated_at = excluded.provider_updated_at,
      provider_event_id = excluded.provider_event_id
    where subscriptions.provider_updated_at is null
      or subscriptions.provider_updated_at < excluded.provider_updated_at
      or (
        subscriptions.provider_updated_at = excluded.provider_updated_at
        and coalesce(subscriptions.provider_event_id, '') < excluded.provider_event_id
      );
    get diagnostics applied_subscription_count = row_count;

    if applied_subscription_count = 1 then
      access_enabled := normalized_status in ('active', 'trialing');
      insert into public.entitlement_snapshots (
        workspace_id, feature_key, enabled, source, effective_from, effective_until, revision
      ) values
        (target_workspace_id, 'desktop.full', access_enabled, 'subscription', now(), period_end, 1),
        (target_workspace_id, 'history.extended', access_enabled, 'subscription', now(), period_end, 1)
      on conflict (workspace_id, feature_key) do update set
        enabled = excluded.enabled,
        source = excluded.source,
        effective_from = excluded.effective_from,
        effective_until = excluded.effective_until,
        revision = entitlement_snapshots.revision + 1;
    end if;
  end if;

  update public.webhook_events
  set
    processing_state = case
      when not subscription_event then 'ignored'
      when applied_subscription_count = 1 then 'processed'
      else 'ignored'
    end,
    processed_at = now()
  where provider = 'stripe' and event_id = stripe_event_id;

  return case
    when not subscription_event then 'ignored'
    when applied_subscription_count = 1 then 'applied'
    else 'stale'
  end;
end;
$$;

revoke all on function public.accept_stripe_subscription_event(
  text, text, timestamptz, uuid, text, text, text, text, text, timestamptz, timestamptz, boolean
) from public, anon, authenticated;
grant execute on function public.accept_stripe_subscription_event(
  text, text, timestamptz, uuid, text, text, text, text, text, timestamptz, timestamptz, boolean
) to service_role;

grant select, insert, update, delete on table public.subscriptions to service_role;
grant select, insert, update, delete on table public.entitlement_snapshots to service_role;
grant select, insert, update, delete on table public.jobs to service_role;
grant select, insert, update, delete on table public.job_objects to service_role;
grant select, insert, update, delete on table public.usage_ledger to service_role;
grant select, insert, update, delete on table public.webhook_events to service_role;
grant select, insert, update, delete on table public.audit_events to service_role;
