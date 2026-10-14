-- Existing cloud capabilities: deletion and quota release commit together.
create or replace function public.request_cloud_job_deletion(
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
    where job_id = target_job_id
      and workspace_id = target_workspace_id
      and state <> 'deleted';

    -- No worker can claim a job after its atomic transition to deleting.
    -- Already consumed usage remains consumed; only unfinished reservations release.
    update public.usage_ledger
    set status = 'released', settled_at = now()
    where job_id = target_job_id
      and workspace_id = target_workspace_id
      and status = 'reserved';
  end if;
  return changed_count = 1;
end;
$$;

revoke all on function public.request_cloud_job_deletion(uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.request_cloud_job_deletion(uuid, uuid, uuid) to service_role;
