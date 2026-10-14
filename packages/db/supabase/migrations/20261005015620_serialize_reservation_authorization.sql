-- CONV-002/003/004, OCR-001: serialize reservation authorization with revocation.
-- No new table privileges, client grants or privilege escalation.
create function public.lock_workspace_membership_mutation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  lock_key bigint;
begin
  if tg_op = 'DELETE' then
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
      'pdfmason.member:' || old.workspace_id::text || ':' || old.user_id::text, 0
    ));
    return old;
  end if;

  -- Identity changes lock both identities in a consistent order.
  for lock_key in
    select distinct key from (values
      (pg_catalog.hashtextextended(
        'pdfmason.member:' || old.workspace_id::text || ':' || old.user_id::text, 0)),
      (pg_catalog.hashtextextended(
        'pdfmason.member:' || new.workspace_id::text || ':' || new.user_id::text, 0))
    ) identities(key) order by key
  loop
    perform pg_catalog.pg_advisory_xact_lock(lock_key);
  end loop;
  return new;
end;
$$;
revoke all on function public.lock_workspace_membership_mutation()
  from public, anon, authenticated, service_role;

create trigger serialize_workspace_membership_mutation
before update of status, role, workspace_id, user_id or delete on public.workspace_members
for each row execute function public.lock_workspace_membership_mutation();

-- Existing cloud capabilities: reject malformed or sensitive requests before persistence.
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
  sensitive_options boolean;
  excessive_options boolean;
begin
  if target_workspace_id is null or actor_user_id is null
    or job_operation is null or job_operation !~ '^[a-z][a-z0-9]*(\.[a-z0-9]+)*$'
    or job_operation_version is null or job_operation_version !~ '^\d+\.\d+\.\d+$'
    or request_idempotency_key is null
    or char_length(request_idempotency_key) not between 16 and 200
    or request_idempotency_key !~ '^[A-Za-z0-9._~-]+$'
    or entitlement_feature_key is null or char_length(entitlement_feature_key) not between 3 and 100
    or entitlement_feature_key !~ '^[a-z][a-z0-9]*(\.[a-z0-9_]+)+$'
    or usage_quantity is null or usage_quantity <= 0
    or usage_unit is null or usage_unit not in ('jobs', 'pages', 'bytes')
    or usage_period_key is null or usage_period_key !~ '^\d{4}-(0[1-9]|1[0-2])$'
    or deletion_deadline is null or not isfinite(deletion_deadline) or deletion_deadline <= now()
    or job_options is null or jsonb_typeof(job_options) <> 'object'
    or pg_column_size(job_options) > 16384
  then
    raise exception using errcode = '22023', message = 'INVALID_JOB_RESERVATION';
  end if;

  -- Traverse objects and arrays; option values never enter logs/errors.
  -- Input bytes are already bounded; cap depth/nodes before persistence.
  with recursive option_tree(value, key, depth) as (
    select job_options, null::text, 0
    union all
    select child.value, child.key, parent.depth + 1
    from option_tree parent
    cross join lateral (
      select entry.value, entry.key from jsonb_each(
        case when jsonb_typeof(parent.value) = 'object' then parent.value else '{}'::jsonb end
      ) entry
      union all
      select entry.value, null::text from jsonb_array_elements(
        case when jsonb_typeof(parent.value) = 'array' then parent.value else '[]'::jsonb end
      ) entry
    ) child
    where parent.depth < 16
  )
  select
    coalesce(bool_or(key ~* '(password|passphrase|secret|token|authorization|cookie|filename|document[_-]?text|pdf[_-]?text|extracted[_-]?text|signature)'), false),
    count(*) > 1024 or coalesce(bool_or(depth = 16 and jsonb_typeof(value) in ('object', 'array')), false)
  into sensitive_options, excessive_options
  from option_tree;

  if excessive_options then
    raise exception using errcode = '22023', message = 'INVALID_JOB_RESERVATION';
  end if;
  if sensitive_options then
    raise exception using errcode = '22023', message = 'SENSITIVE_JOB_OPTION_FORBIDDEN';
  end if;

  -- Authorization reads remain fresh after a lock wait only at READ COMMITTED.
  if pg_catalog.current_setting('transaction_isolation') <> 'read committed' then
    raise exception using errcode = '0A000', message = 'TRANSACTION_ISOLATION_UNSUPPORTED';
  end if;

  -- Existing column-level UPDATE privilege is enough for this row lock.
  -- Hold workspace state stable through reservation/replay and commit.
  perform w.id from public.workspaces w
  where w.id = target_workspace_id
  for share of w;
  if not found then
    raise exception using errcode = '42501', message = 'WORKSPACE_ACCESS_DENIED';
  end if;

  -- Membership mutations take the exclusive counterpart in an invoker trigger.
  perform pg_catalog.pg_advisory_xact_lock_shared(pg_catalog.hashtextextended(
    'pdfmason.member:' || target_workspace_id::text || ':' || actor_user_id::text, 0
  ));

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

  -- Serialize the same workspace/request key before lookup, including different
  -- features. Hash collisions only serialize unrelated requests; they grant nothing.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(target_workspace_id::text || ':' || request_idempotency_key, 0)
  );

  select id into existing_job_id
  from public.jobs
  where workspace_id = target_workspace_id
    and idempotency_key = request_idempotency_key;
  if existing_job_id is not null then
    if not exists (
      select 1 from public.jobs j
      join public.usage_ledger u on u.job_id = j.id and u.workspace_id = j.workspace_id
      where j.id = existing_job_id
        and j.created_by is not distinct from actor_user_id
        and j.operation is not distinct from job_operation
        and j.operation_version is not distinct from job_operation_version
        and j.options is not distinct from job_options
        and u.feature_key is not distinct from entitlement_feature_key
        and u.quantity is not distinct from usage_quantity
        and u.unit is not distinct from usage_unit
        and u.period_key is not distinct from usage_period_key
    ) then
      raise exception using errcode = '22023', message = 'IDEMPOTENCY_CONFLICT';
    end if;
    return existing_job_id;
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


create or replace function public.request_account_deletion(
  target_workspace_id uuid,
  actor_user_id uuid,
  request_id text
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  changed_count integer;
begin
  if request_id is null or char_length(request_id) not between 8 and 200 then
    raise exception using errcode = '22023', message = 'INVALID_REQUEST_ID';
  end if;

  -- Authorization reads remain fresh after a lock wait only at READ COMMITTED.
  if pg_catalog.current_setting('transaction_isolation') <> 'read committed' then
    raise exception using errcode = '0A000', message = 'TRANSACTION_ISOLATION_UNSUPPORTED';
  end if;

  -- Existing column-level UPDATE privilege is enough for this row lock.
  -- Hold workspace state stable through account deletion and commit.
  perform w.id from public.workspaces w
  where w.id = target_workspace_id
  for update of w;
  if not found then
    raise exception using errcode = '42501', message = 'WORKSPACE_ACCESS_DENIED';
  end if;

  -- Membership mutations take the exclusive counterpart in an invoker trigger.
  perform pg_catalog.pg_advisory_xact_lock_shared(pg_catalog.hashtextextended(
    'pdfmason.member:' || target_workspace_id::text || ':' || actor_user_id::text, 0
  ));

  if not exists (
    select 1
    from public.workspaces w
    join public.workspace_members m on m.workspace_id = w.id
    where w.id = target_workspace_id
      and w.owner_user_id = actor_user_id
      and w.status in ('active', 'deleting')
      and m.user_id = actor_user_id
      and m.role = 'owner'
      and m.status = 'active'
  ) then
    raise exception using errcode = '42501', message = 'WORKSPACE_ACCESS_DENIED';
  end if;

  update public.profiles
  set account_deletion_requested_at = coalesce(account_deletion_requested_at, now())
  where user_id = actor_user_id;

  update public.workspaces
  set status = 'deleting', updated_at = now()
  where id = target_workspace_id and status = 'active';
  get diagnostics changed_count = row_count;

  update public.jobs
  set
    state = case when state = 'deleted' then state else 'deleting' end,
    progress_stage = case when state = 'deleted' then progress_stage else 'deleting' end,
    progress_value = case when state = 'deleted' then progress_value else null end,
    lease_owner = null,
    lease_expires_at = null,
    delete_after = case when state = 'deleted' then delete_after else now() end,
    updated_at = now()
  where workspace_id = target_workspace_id;

  update public.job_objects
  set delete_after = now(), updated_at = now()
  where workspace_id = target_workspace_id and state <> 'deleted';

  update public.usage_ledger
  set status = 'released', settled_at = now()
  where workspace_id = target_workspace_id and status = 'reserved';

  if changed_count = 1 then
    insert into public.audit_events (
      workspace_id, actor_user_id, event_type, request_id, safe_context
    ) values (
      target_workspace_id, actor_user_id, 'account.deletion_requested', request_id,
      jsonb_build_object('processing_state', 'queued')
    );
  end if;

  return true;
end;
$$;

revoke all on function public.request_account_deletion(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.request_account_deletion(uuid, uuid, text)
  to service_role;
