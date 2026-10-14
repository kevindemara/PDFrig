begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
insert into auth.users(id, email, email_confirmed_at) values
  ('21111111-1111-4111-8111-111111111111', 'lifecycle-owner@example.invalid', now()),
  ('22222222-2222-4222-8222-222222222222', 'lifecycle-other@example.invalid', now());
create temporary table lifecycle_ids as select id as workspace_id, owner_user_id
from public.workspaces where owner_user_id in (
  '21111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222');
create temporary table lifecycle_cases(state text, eligible boolean, job_id uuid default gen_random_uuid());
insert into lifecycle_cases(state, eligible) values
  ('awaiting_upload', true), ('queued', true), ('completed', true), ('failed', true),
  ('cancelled', true), ('expired', true), ('deletion_attention', true),
  ('processing', false), ('cancelling', false), ('retry_wait', false), ('deleting', false), ('deleted', false);
insert into public.jobs(id, workspace_id, created_by, operation, operation_version, options,
  idempotency_key, state, progress_stage, delete_after, lease_owner, lease_expires_at)
select c.job_id, w.workspace_id, w.owner_user_id, 'demo.integrity', '1.0.0', '{}',
  'lifecycle-request-' || c.state, c.state, c.state, now() + interval '1 hour',
  case when c.state in ('processing','cancelling') then 'synthetic-worker' end,
  case when c.state in ('processing','cancelling') then now() + interval '5 minutes' end
from lifecycle_cases c cross join lifecycle_ids w
where w.owner_user_id = '21111111-1111-4111-8111-111111111111';
insert into public.usage_ledger(workspace_id, feature_key, quantity, unit, period_key, job_id, status, settled_at)
select workspace_id, 'cloud.demo.integrity', 1, 'jobs', to_char(now(), 'YYYY-MM'), id,
  case when state = 'completed' then 'consumed' else 'reserved' end,
  case when state = 'completed' then now() end
from public.jobs where workspace_id in (select workspace_id from lifecycle_ids);
insert into public.job_objects(job_id, workspace_id, role, storage_key, mime_type, delete_after)
select id, workspace_id, 'input', 'synthetic/lifecycle/' || id::text, 'application/pdf', now() + interval '1 hour'
from public.jobs where workspace_id in (select workspace_id from lifecycle_ids);
grant select on lifecycle_ids, lifecycle_cases to service_role, authenticated;

set local role service_role;
select throws_ok(format($sql$ select public.%I(
  (select job_id from lifecycle_cases where state = 'queued'),
  (select workspace_id from lifecycle_ids where owner_user_id = '21111111-1111-4111-8111-111111111111'),
  '22222222-2222-4222-8222-222222222222') $sql$, name),
  '42501', 'WORKSPACE_ACCESS_DENIED', name || ' rejects another actor')
from (values ('request_cloud_job_cancellation'), ('request_cloud_job_deletion')) f(name);
select is(public.request_cloud_job_deletion(
  (select job_id from lifecycle_cases where state = 'queued'),
  (select workspace_id from lifecycle_ids where owner_user_id = '22222222-2222-4222-8222-222222222222'),
  '22222222-2222-4222-8222-222222222222'), false, 'another owner cannot delete a job by pairing it with their workspace');
select is(public.request_cloud_job_cancellation(
  (select job_id from lifecycle_cases where state = 'queued'),
  (select workspace_id from lifecycle_ids where owner_user_id = '22222222-2222-4222-8222-222222222222'),
  '22222222-2222-4222-8222-222222222222'), false, 'another owner cannot cancel a job by pairing it with their workspace');
select is(public.request_cloud_job_deletion(c.job_id,
  (select workspace_id from lifecycle_ids where owner_user_id = '21111111-1111-4111-8111-111111111111'),
  '21111111-1111-4111-8111-111111111111'), c.eligible, c.state || ' respects the deletion state boundary')
from lifecycle_cases c;
select ok((select bool_and(j.state = case when c.eligible then 'deleting' else c.state end)
  from public.jobs j join lifecycle_cases c on c.job_id = j.id), 'only eligible job states change');
select ok((select bool_and(u.status = case when c.state = 'completed' then 'consumed'
  when c.eligible then 'released' else 'reserved' end)
  from public.usage_ledger u join lifecycle_cases c on c.job_id = u.job_id),
  'deletion releases reserved usage only and preserves consumed usage');
select ok((select bool_and(o.delete_after = case when c.eligible then now() else now() + interval '1 hour' end)
  from public.job_objects o join lifecycle_cases c on c.job_id = o.job_id), 'only eligible objects become due');
select ok((select bool_and(o.state = 'pending') from public.job_objects o
  join lifecycle_cases c on c.job_id = o.job_id), 'request does not falsely claim storage absence');
select ok((select bool_and(j.lease_owner = 'synthetic-worker' and j.lease_expires_at > now())
  from public.jobs j join lifecycle_cases c on c.job_id = j.id where c.state in ('processing','cancelling')),
  'rejected active deletion preserves the worker lease');
select ok(public.request_cloud_job_cancellation((select job_id from lifecycle_cases where state = 'processing'),
  (select workspace_id from lifecycle_ids where owner_user_id = '21111111-1111-4111-8111-111111111111'),
  '21111111-1111-4111-8111-111111111111'), 'active owner can request processing cancellation');
select ok((select state = 'cancelling' and lease_owner = 'synthetic-worker' and lease_expires_at > now()
  from public.jobs where id = (select job_id from lifecycle_cases where state = 'processing')),
  'cancellation waits for the live worker rather than deleting underneath it');
select is((select status from public.usage_ledger where job_id =
  (select job_id from lifecycle_cases where state = 'processing')), 'reserved', 'cancellation settlement waits for acknowledgement');
select is(public.request_cloud_job_deletion((select job_id from lifecycle_cases where state = 'queued'),
  (select workspace_id from lifecycle_ids where owner_user_id = '21111111-1111-4111-8111-111111111111'),
  '21111111-1111-4111-8111-111111111111'), false, 'repeat deletion does not repeat a transition');

reset role;
update public.workspace_members set status = 'removed' where user_id = '21111111-1111-4111-8111-111111111111';
set local role service_role;
select throws_ok(format($sql$ select public.%I(
  (select job_id from lifecycle_cases where state = 'retry_wait'),
  (select workspace_id from lifecycle_ids where owner_user_id = '21111111-1111-4111-8111-111111111111'),
  '21111111-1111-4111-8111-111111111111') $sql$, name),
  '42501', 'WORKSPACE_ACCESS_DENIED', name || ' rejects removed membership')
from (values ('request_cloud_job_cancellation'), ('request_cloud_job_deletion')) f(name);
reset role;
update public.workspace_members set status = 'active' where user_id = '21111111-1111-4111-8111-111111111111';
update public.workspaces set status = 'suspended' where owner_user_id = '21111111-1111-4111-8111-111111111111';
set local role service_role;
select throws_ok(format($sql$ select public.%I(
  (select job_id from lifecycle_cases where state = 'retry_wait'),
  (select workspace_id from lifecycle_ids where owner_user_id = '21111111-1111-4111-8111-111111111111'),
  '21111111-1111-4111-8111-111111111111') $sql$, name),
  '42501', 'WORKSPACE_ACCESS_DENIED', name || ' rejects suspended workspace')
from (values ('request_cloud_job_cancellation'), ('request_cloud_job_deletion')) f(name);
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}', true);
select is((select count(*) from public.jobs where id in (select job_id from lifecycle_cases)),
  0::bigint, 'client cannot infer another tenant lifecycle');
select ok(not has_function_privilege('authenticated', 'public.request_cloud_job_deletion(uuid,uuid,uuid)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.request_cloud_job_cancellation(uuid,uuid,uuid)', 'EXECUTE'),
  'clients cannot invoke actor-taking lifecycle RPCs');
reset role;
select * from finish();
rollback;
