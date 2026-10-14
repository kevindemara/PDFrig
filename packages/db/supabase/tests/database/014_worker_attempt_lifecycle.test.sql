-- CONV-002/003/004, OCR-001: real service-role lease/result negatives.
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
insert into auth.users(id, email, email_confirmed_at)
values ('31111111-1111-4111-8111-111111111111', 'worker-lifecycle@example.invalid', now());
create temporary table worker_cases(name text primary key, job_id uuid default gen_random_uuid());
insert into worker_cases(name) values ('success'), ('retry'), ('final'), ('cancel'),
  ('expired'), ('expired-final'), ('queued-cancel'), ('deleted'), ('claim');
insert into public.jobs(id, workspace_id, created_by, operation, operation_version,
  idempotency_key, state, progress_stage, attempt_count, max_attempts,
  lease_owner, lease_expires_at, delete_after)
select c.job_id, w.id, w.owner_user_id, 'demo.integrity', '1.0.0', 'worker-lifecycle-' || c.name,
  case when c.name = 'claim' then 'queued' when c.name = 'deleted' then 'deleting'
       when c.name in ('cancel','queued-cancel') then 'cancelling' else 'processing' end,
  'starting', case when c.name = 'claim' then 0 else 1 end,
  case when c.name in ('final','expired-final') then 1 else 3 end,
  case when c.name not in ('claim','queued-cancel','deleted') then 'worker-original' end,
  case when c.name in ('expired','expired-final') then now() - interval '1 second'
       when c.name not in ('claim','queued-cancel','deleted') then now() + interval '5 minutes' end,
  now() + interval '1 hour'
from worker_cases c cross join public.workspaces w
where w.owner_user_id = '31111111-1111-4111-8111-111111111111';
insert into public.usage_ledger(workspace_id, feature_key, quantity, unit, period_key, job_id, status)
select workspace_id, 'cloud.demo.integrity', 1, 'jobs', to_char(now(), 'YYYY-MM'), id, 'reserved'
from public.jobs where id in (select job_id from worker_cases);
insert into public.job_objects(job_id, workspace_id, role, storage_key, mime_type, delete_after)
select j.id, j.workspace_id, r.role, 'synthetic/worker/' || j.id || '/' || r.role, 'application/pdf', j.delete_after
from public.jobs j cross join (values ('input'), ('temporary'), ('output')) r(role)
where j.id in (select job_id from worker_cases);
grant select on worker_cases to service_role, authenticated;

select ok(not has_function_privilege('anon', 'public.finish_cloud_job_attempt(uuid,text,integer,boolean)', 'execute'), 'anonymous cannot finish');
select ok(not has_function_privilege('authenticated', 'public.finish_cloud_job_attempt(uuid,text,integer,boolean)', 'execute'), 'client cannot finish');
select ok(not has_function_privilege('authenticated', 'public.recover_cloud_job(uuid)', 'execute'), 'client cannot recover');
set local role service_role;
select throws_ok($$select public.claim_cloud_job(null,60)$$, '22023', 'INVALID_LEASE_REQUEST', 'null worker fails');
select throws_ok($$select public.claim_cloud_job('worker-valid',null)$$, '22023', 'INVALID_LEASE_REQUEST', 'null lease fails');
select throws_ok($$select public.finish_cloud_job_attempt((select job_id from worker_cases where name='success'), 'worker-original',1,null)$$,
  '22023', 'INVALID_ATTEMPT_RESULT', 'null result fails');
select is(public.finish_cloud_job_attempt((select job_id from worker_cases where name='success'), 'worker-wrong',1,true), null::text, 'wrong lease owner rejected');
select is(public.finish_cloud_job_attempt((select job_id from worker_cases where name='success'), 'worker-original',2,true), null::text, 'wrong attempt rejected');
select is(public.finish_cloud_job_attempt((select job_id from worker_cases where name='deleted'), 'worker-original',1,true), null::text, 'deleting job cannot resurrect');
select is(public.finish_cloud_job_attempt((select job_id from worker_cases where name='expired'), 'worker-original',1,true), null::text, 'expired worker cannot finish');
select is(public.transition_cloud_job((select job_id from worker_cases where name='success'), 'processing','completed','complete'), false, 'legacy completion cannot bypass fence');
select is(public.settle_cloud_job_usage((select job_id from worker_cases where name='success'), true), false, 'processing cannot consume');
select is(public.settle_cloud_job_usage((select job_id from worker_cases where name='success'), false), false, 'processing cannot release');
select is(public.recover_cloud_job((select job_id from worker_cases where name='success')), null::text, 'live lease cannot be recovered');
select is((select status from public.usage_ledger where job_id=(select job_id from worker_cases where name='success')), 'reserved', 'rejected results preserve quota');
select is(public.finish_cloud_job_attempt((select job_id from worker_cases where name='success'), 'worker-original',1,true), 'completed', 'owner finishes');
select is((select status from public.usage_ledger where job_id=(select job_id from worker_cases where name='success')), 'consumed', 'finish atomically consumes');
select is((select count(*) from public.job_objects where job_id=(select job_id from worker_cases where name='success') and delete_after <= clock_timestamp()), 2::bigint, 'success only expires input and temporary');
select is(public.finish_cloud_job_attempt((select job_id from worker_cases where name='success'), 'worker-original',1,true), null::text, 'duplicate finish rejected');
select is(public.settle_cloud_job_usage((select job_id from worker_cases where name='success'), false), false, 'successful work cannot be refunded by legacy release');
select is(public.finish_cloud_job_attempt((select job_id from worker_cases where name='retry'), 'worker-original',1,false), 'retry_wait', 'failure retries');
select is((select status from public.usage_ledger where job_id=(select job_id from worker_cases where name='retry')), 'reserved', 'retry keeps reservation');
select is((select count(*) from public.job_objects where job_id=(select job_id from worker_cases where name='retry') and delete_after > clock_timestamp()), 3::bigint, 'retry keeps inputs');
select is(public.finish_cloud_job_attempt((select job_id from worker_cases where name='final'), 'worker-original',1,false), 'failed', 'final failure stops');
select is((select status from public.usage_ledger where job_id=(select job_id from worker_cases where name='final')), 'released', 'final failure releases');
select is(public.finish_cloud_job_attempt((select job_id from worker_cases where name='cancel'), 'worker-original',1,true), 'cancelled', 'cancellation wins over success');
select is((select status from public.usage_ledger where job_id=(select job_id from worker_cases where name='cancel')), 'released', 'cancel releases');
select is(public.recover_cloud_job((select job_id from worker_cases where name='queued-cancel')), 'cancelled', 'unleased cancellation recovers');
select is(public.recover_cloud_job((select job_id from worker_cases where name='expired')), 'retry_wait', 'expired lease recovers for retry');
select is(public.recover_cloud_job((select job_id from worker_cases where name='expired-final')), 'failed', 'exhausted lease cannot retry');
select is((select status from public.usage_ledger where job_id=(select job_id from worker_cases where name='expired-final')), 'released', 'exhaustion releases');
select ok((select bool_and(lease_owner is null and lease_expires_at is null) from public.jobs where id in (select job_id from worker_cases where name <> 'claim')), 'resolved leases cleared');
reset role;
-- Isolate claim eligibility from the deliberately recovered retry fixtures.
update public.jobs set state='failed' where id in (select job_id from worker_cases where name in ('retry','expired'));
set local role service_role;
select is((select count(*) from public.claim_cloud_job('worker-new-owner',60)), 1::bigint, 'claim grants one lease');
select is((select attempt_count::integer from public.jobs where id=(select job_id from worker_cases where name='claim')), 1, 'claim increments attempt');
select is((select count(*) from public.claim_cloud_job('worker-competitor',60)), 0::bigint, 'live attempt is not claimable');
reset role;
update public.jobs set state='queued', lease_owner=null, lease_expires_at=null, attempt_count=max_attempts
where id=(select job_id from worker_cases where name='claim');
set local role service_role;
select is((select count(*) from public.claim_cloud_job('worker-competitor',60)), 0::bigint, 'exhausted queued job cannot exceed attempt cap');
reset role;
update public.jobs set attempt_count=0 where id=(select job_id from worker_cases where name='claim');
update public.workspaces set status='suspended' where owner_user_id='31111111-1111-4111-8111-111111111111';
set local role service_role;
select is((select count(*) from public.claim_cloud_job('worker-competitor',60)), 0::bigint, 'suspended workspace is not claimable');
select * from finish();
rollback;
