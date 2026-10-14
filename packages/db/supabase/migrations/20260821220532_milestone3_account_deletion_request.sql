create function public.request_account_deletion(
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
