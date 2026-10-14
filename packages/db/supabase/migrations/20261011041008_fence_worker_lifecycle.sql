-- CONV-002/003/004, OCR-001: metadata control plane, not provider rollout.
-- Serialize on the job before objects/usage, matching account deletion's order.
create function public.finish_cloud_job_attempt(
  target_job_id uuid, worker_id text, expected_attempt integer, succeeded boolean
)
returns text
language plpgsql security invoker set search_path = ''
as $$
declare
  job public.jobs%rowtype;
  resolved_state text;
  resolved_at timestamptz;
begin
  if worker_id is null or char_length(worker_id) not between 8 and 120
     or expected_attempt is null or expected_attempt not between 1 and 10
     or succeeded is null then
    raise exception using errcode = '22023', message = 'INVALID_ATTEMPT_RESULT';
  end if;
  select * into job from public.jobs where id = target_job_id for update;
  resolved_at := clock_timestamp();
  if not found or job.state not in ('processing', 'cancelling')
     or job.lease_owner is distinct from worker_id
     or job.attempt_count <> expected_attempt
     or job.lease_expires_at is null or job.lease_expires_at <= resolved_at then
    return null;
  end if;
  resolved_state := case
    when job.state = 'cancelling' then 'cancelled'
    when succeeded then 'completed'
    when job.attempt_count >= job.max_attempts then 'failed'
    else 'retry_wait' end;
  update public.jobs set state = resolved_state,
    progress_stage = case when resolved_state = 'completed' then 'complete' else resolved_state end,
    progress_value = case when resolved_state = 'completed' then 100 else null end,
    error_code = case when resolved_state = 'failed' then 'OPERATION_FAILED' else null end,
    completed_at = case when resolved_state in ('completed', 'failed') then resolved_at else completed_at end,
    cancelled_at = case when resolved_state = 'cancelled' then resolved_at else cancelled_at end,
    lease_owner = null, lease_expires_at = null
  where id = job.id;
  if resolved_state <> 'retry_wait' then
    update public.job_objects set delete_after = least(delete_after, resolved_at)
    where job_id = job.id and workspace_id = job.workspace_id and state <> 'deleted'
      and (resolved_state <> 'completed' or role in ('input', 'temporary'));
    update public.usage_ledger
    set status = case when resolved_state = 'completed' then 'consumed' else 'released' end,
        settled_at = resolved_at
    where job_id = job.id and workspace_id = job.workspace_id and status = 'reserved';
  end if;
  return resolved_state;
end;
$$;
revoke all on function public.finish_cloud_job_attempt(uuid, text, integer, boolean)
  from public, anon, authenticated;
grant execute on function public.finish_cloud_job_attempt(uuid, text, integer, boolean) to service_role;

-- Recovery is rechecked under the lock; an earlier expiry query is not authority.
create function public.recover_cloud_job(target_job_id uuid)
returns text
language plpgsql security invoker set search_path = ''
as $$
declare
  job public.jobs%rowtype;
  resolved_state text;
  resolved_at timestamptz;
begin
  select * into job from public.jobs where id = target_job_id for update;
  resolved_at := clock_timestamp();
  if not found or job.state not in ('processing', 'cancelling')
     or job.lease_expires_at > resolved_at
     or (job.state = 'processing' and job.lease_expires_at is null) then
    return null;
  end if;
  resolved_state := case when job.state = 'cancelling' then 'cancelled'
    when job.attempt_count >= job.max_attempts then 'failed' else 'retry_wait' end;
  update public.jobs set state = resolved_state, progress_stage = resolved_state,
    progress_value = null, lease_owner = null, lease_expires_at = null,
    error_code = case when resolved_state = 'failed' then 'OPERATION_FAILED' else null end,
    completed_at = case when resolved_state = 'failed' then resolved_at else completed_at end,
    cancelled_at = case when resolved_state = 'cancelled' then resolved_at else cancelled_at end
  where id = job.id;
  if resolved_state <> 'retry_wait' then
    update public.job_objects set delete_after = least(delete_after, resolved_at)
    where job_id = job.id and workspace_id = job.workspace_id and state <> 'deleted';
    update public.usage_ledger set status = 'released', settled_at = resolved_at
    where job_id = job.id and workspace_id = job.workspace_id and status = 'reserved';
  end if;
  return resolved_state;
end;
$$;
revoke all on function public.recover_cloud_job(uuid) from public, anon, authenticated;
grant execute on function public.recover_cloud_job(uuid) to service_role;

create or replace function public.claim_cloud_job(worker_id text, lease_seconds integer)
returns setof public.jobs
language plpgsql security invoker set search_path = ''
as $$
declare
  claimed_job_id uuid;
begin
  if lease_seconds is null or lease_seconds not between 15 and 900
     or worker_id is null or char_length(worker_id) not between 8 and 120 then
    raise exception using errcode = '22023', message = 'INVALID_LEASE_REQUEST';
  end if;
  select j.id into claimed_job_id from public.jobs j
  join public.workspaces w on w.id = j.workspace_id and w.status = 'active'
  where j.state in ('queued', 'retry_wait') and j.attempt_count < j.max_attempts
    and (j.lease_expires_at is null or j.lease_expires_at <= clock_timestamp())
  order by j.created_at, j.id for update of j skip locked limit 1;
  if claimed_job_id is null then return; end if;
  return query update public.jobs set state = 'processing', progress_stage = 'starting',
    progress_value = null, error_code = null, attempt_count = attempt_count + 1,
    lease_owner = worker_id, lease_expires_at = clock_timestamp() + make_interval(secs => lease_seconds),
    started_at = coalesce(started_at, clock_timestamp())
  where id = claimed_job_id returning *;
end;
$$;

-- Legacy control-plane transitions cannot acknowledge an unfenced attempt.
create or replace function public.transition_cloud_job(
  target_job_id uuid, expected_state text, next_state text, next_stage text,
  next_progress smallint default null, safe_error_code text default null
)
returns boolean
language plpgsql security invoker set search_path = ''
as $$
declare changed_count integer;
begin
  if not public.is_allowed_job_transition(expected_state, next_state) then
    raise exception using errcode = '22023', message = 'INVALID_JOB_TRANSITION';
  end if;
  if expected_state in ('processing', 'cancelling') or next_state = 'processing' then return false; end if;
  update public.jobs set state = next_state, progress_stage = next_stage,
    progress_value = next_progress, error_code = safe_error_code,
    completed_at = case when next_state in ('completed', 'failed') then clock_timestamp() else completed_at end,
    cancelled_at = case when next_state = 'cancelled' then clock_timestamp() else cancelled_at end,
    lease_owner = null, lease_expires_at = null
  where id = target_job_id and state = expected_state;
  get diagnostics changed_count = row_count;
  return changed_count = 1;
end;
$$;

create or replace function public.settle_cloud_job_usage(target_job_id uuid, consume_usage boolean)
returns boolean
language plpgsql security invoker set search_path = ''
as $$
declare
  job public.jobs%rowtype;
  changed_count integer;
begin
  select * into job from public.jobs where id = target_job_id for update;
  if not found or consume_usage is null
    or (consume_usage and job.state <> 'completed')
    or (not consume_usage and job.state not in ('failed', 'cancelled', 'expired', 'deleting', 'deleted')) then
    return false;
  end if;
  update public.usage_ledger
  set status = case when consume_usage then 'consumed' else 'released' end, settled_at = clock_timestamp()
  where job_id = job.id and workspace_id = job.workspace_id and status = 'reserved';
  get diagnostics changed_count = row_count;
  return changed_count > 0;
end;
$$;
