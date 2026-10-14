-- CONV-002/003/004, OCR-001: invoker RPCs need ACLs as well as BYPASSRLS.
-- Only authorization lookup columns; no document/account metadata or writes.
grant select (id, status) on public.workspaces to service_role;
grant select (workspace_id, user_id, status) on public.workspace_members to service_role;
