create table public.operation_cost_metrics (
  job_id uuid primary key references public.jobs (id) on delete cascade,
  operation text not null check (operation ~ '^[a-z][a-z0-9]*(\.[a-z0-9]+)*$'),
  engine_name text not null check (char_length(engine_name) between 1 and 80),
  engine_version text not null check (char_length(engine_version) between 1 and 40),
  cpu_milliseconds bigint not null check (cpu_milliseconds >= 0),
  wall_milliseconds bigint not null check (wall_milliseconds >= 0),
  peak_memory_bytes bigint not null check (peak_memory_bytes > 0),
  input_bytes bigint not null check (input_bytes > 0),
  output_bytes bigint not null check (output_bytes > 0),
  recorded_at timestamptz not null default now()
);

comment on table public.operation_cost_metrics is
  'Content-free worker cost metrics. Never store filenames, document text, passwords, URLs, or provider payloads.';

alter table public.operation_cost_metrics enable row level security;
revoke all on table public.operation_cost_metrics from public, anon, authenticated;
grant select, insert, update, delete on table public.operation_cost_metrics to service_role;

create function public.refresh_office_conversion_entitlement()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  access_enabled boolean;
begin
  access_enabled := new.plan_key in ('pro_monthly', 'pro_annual')
    and new.status in ('active', 'trialing');

  insert into public.entitlement_snapshots (
    workspace_id, feature_key, enabled, limit_value, limit_unit, source,
    effective_from, effective_until, revision
  ) values (
    new.workspace_id, 'convert.office.pdf.cloud', access_enabled, 20, 'jobs',
    'subscription', now(), new.current_period_end, 1
  )
  on conflict (workspace_id, feature_key) do update set
    enabled = excluded.enabled,
    limit_value = excluded.limit_value,
    limit_unit = excluded.limit_unit,
    source = excluded.source,
    effective_from = excluded.effective_from,
    effective_until = excluded.effective_until,
    revision = entitlement_snapshots.revision + 1;

  return new;
end;
$$;

revoke all on function public.refresh_office_conversion_entitlement()
  from public, anon, authenticated;

create trigger subscriptions_refresh_office_conversion_entitlement
  after insert or update of status, plan_key, current_period_end on public.subscriptions
  for each row execute function public.refresh_office_conversion_entitlement();

insert into public.entitlement_snapshots (
  workspace_id, feature_key, enabled, limit_value, limit_unit, source,
  effective_from, effective_until, revision
)
select
  workspace_id,
  'convert.office.pdf.cloud',
  plan_key in ('pro_monthly', 'pro_annual') and status in ('active', 'trialing'),
  20,
  'jobs',
  'subscription',
  now(),
  current_period_end,
  1
from public.subscriptions
on conflict (workspace_id, feature_key) do update set
  enabled = excluded.enabled,
  limit_value = excluded.limit_value,
  limit_unit = excluded.limit_unit,
  source = excluded.source,
  effective_from = excluded.effective_from,
  effective_until = excluded.effective_until,
  revision = entitlement_snapshots.revision + 1;

create or replace function public.create_cloud_job_with_reservation(
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
  effective_limit_unit text;
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

  if usage_quantity <= 0
    or usage_unit not in ('jobs', 'pages', 'bytes')
    or usage_period_key !~ '^\d{4}-\d{2}$'
    or deletion_deadline <= now()
    or jsonb_typeof(job_options) <> 'object'
    or pg_column_size(job_options) > 16384
  then
    raise exception using errcode = '22023', message = 'INVALID_JOB_RESERVATION';
  end if;

  if exists (
    select 1
    from jsonb_object_keys(job_options) as option_name
    where option_name ~* '(password|passphrase|secret|token|authorization|cookie|filename|documenttext|pdftext)'
  ) then
    raise exception using errcode = '22023', message = 'SENSITIVE_JOB_OPTION_FORBIDDEN';
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

  select enabled, limit_value, limit_unit
  into effective_enabled, effective_limit, effective_limit_unit
  from public.entitlement_snapshots
  where workspace_id = target_workspace_id
    and feature_key = entitlement_feature_key
    and effective_from <= now()
    and (effective_until is null or effective_until > now())
  for update;

  if effective_enabled is distinct from true then
    raise exception using errcode = '42501', message = 'ENTITLEMENT_REQUIRED';
  end if;

  if effective_limit is not null and effective_limit_unit is distinct from usage_unit then
    raise exception using errcode = '22023', message = 'USAGE_UNIT_MISMATCH';
  end if;

  select coalesce(sum(quantity), 0)
  into current_usage
  from public.usage_ledger
  where workspace_id = target_workspace_id
    and feature_key = entitlement_feature_key
    and period_key = usage_period_key
    and unit = usage_unit
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

create function public.record_operation_cost_metrics(
  target_job_id uuid,
  metric_operation text,
  metric_engine_name text,
  metric_engine_version text,
  metric_cpu_milliseconds bigint,
  metric_wall_milliseconds bigint,
  metric_peak_memory_bytes bigint,
  metric_input_bytes bigint,
  metric_output_bytes bigint
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.jobs
    where id = target_job_id and operation = metric_operation
  ) then
    raise exception using errcode = '22023', message = 'JOB_OPERATION_MISMATCH';
  end if;

  insert into public.operation_cost_metrics (
    job_id, operation, engine_name, engine_version, cpu_milliseconds,
    wall_milliseconds, peak_memory_bytes, input_bytes, output_bytes
  ) values (
    target_job_id, metric_operation, metric_engine_name, metric_engine_version,
    metric_cpu_milliseconds, metric_wall_milliseconds, metric_peak_memory_bytes,
    metric_input_bytes, metric_output_bytes
  )
  on conflict (job_id) do update set
    operation = excluded.operation,
    engine_name = excluded.engine_name,
    engine_version = excluded.engine_version,
    cpu_milliseconds = excluded.cpu_milliseconds,
    wall_milliseconds = excluded.wall_milliseconds,
    peak_memory_bytes = excluded.peak_memory_bytes,
    input_bytes = excluded.input_bytes,
    output_bytes = excluded.output_bytes,
    recorded_at = now();

  return true;
end;
$$;

revoke all on function public.record_operation_cost_metrics(
  uuid, text, text, text, bigint, bigint, bigint, bigint, bigint
) from public, anon, authenticated;
grant execute on function public.record_operation_cost_metrics(
  uuid, text, text, text, bigint, bigint, bigint, bigint, bigint
) to service_role;
