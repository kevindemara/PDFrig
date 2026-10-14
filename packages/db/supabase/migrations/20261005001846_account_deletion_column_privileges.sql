-- Existing Milestone 3 account/privacy service and deletion reconciler only.
-- No identity-table access, profile names, owner changes or membership writes.
grant select (owner_user_id) on public.workspaces to service_role;
grant select (role) on public.workspace_members to service_role;
grant update (status, updated_at) on public.workspaces to service_role;
grant select (user_id, retain_job_history, account_deletion_requested_at)
  on public.profiles to service_role;
grant update (retain_job_history, account_deletion_requested_at)
  on public.profiles to service_role;
