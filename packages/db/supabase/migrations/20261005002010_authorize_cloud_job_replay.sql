-- Existing cloud capabilities: authorize before revealing any retry identifier.
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

