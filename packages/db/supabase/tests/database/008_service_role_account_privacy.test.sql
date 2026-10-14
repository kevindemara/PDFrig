begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

insert into auth.users (id, email, email_confirmed_at) values
  ('61111111-1111-4111-8111-111111111111', 'privacy-owner@example.invalid', now()),
  ('62222222-2222-4222-8222-222222222222', 'privacy-other@example.invalid', now());
create temporary table privacy_ids as
select id as workspace_id from public.workspaces
where owner_user_id = '61111111-1111-4111-8111-111111111111';
grant select on privacy_ids to service_role, authenticated, anon;

set local role service_role;
select lives_ok($sql$ update public.profiles set retain_job_history = true
  where user_id = '61111111-1111-4111-8111-111111111111' $sql$,
  'trusted preference setter has only the required update grant');
select ok((select retain_job_history from public.profiles
  where user_id = '61111111-1111-4111-8111-111111111111'),
  'trusted account reader sees the explicit history preference');
select public.create_cloud_job_with_reservation(
  (select workspace_id from privacy_ids), '61111111-1111-4111-8111-111111111111',
  'demo.integrity', '1.0.0', '{}'::jsonb, 'privacy-reservation-0001',
  'cloud.demo.integrity', 1, 'jobs', to_char(now(), 'YYYY-MM'), now() + interval '1 hour');
insert into public.job_objects(job_id, workspace_id, role, storage_key, mime_type, delete_after)
select id, workspace_id, 'input', 'synthetic/opaque/privacy/object-01',
  'application/pdf', now() + interval '1 hour'
from public.jobs where workspace_id = (select workspace_id from privacy_ids);
select throws_ok($sql$ select public.request_account_deletion(
  (select workspace_id from privacy_ids), '62222222-2222-4222-8222-222222222222',
  'privacy-wrong-actor') $sql$, '42501', 'WORKSPACE_ACCESS_DENIED',
  'service RPC cannot delete on behalf of another owner');
select is((select status from public.workspaces where id = (select workspace_id from privacy_ids)),
  'active', 'denied deletion leaves workspace active');
select is((select count(*) from public.audit_events where workspace_id = (select workspace_id from privacy_ids)),
  0::bigint, 'denied deletion creates no audit event');
select ok(public.request_account_deletion((select workspace_id from privacy_ids),
  '61111111-1111-4111-8111-111111111111', 'privacy-owner-delete'),
  'actual service role can request owner deletion');
select is((select status from public.workspaces where id = (select workspace_id from privacy_ids)),
  'deleting', 'workspace immediately stops accepting work');
select ok((select account_deletion_requested_at = now() from public.profiles
  where user_id = '61111111-1111-4111-8111-111111111111'), 'deletion request records UTC transaction time');
select ok((select bool_and(state = 'deleting' and lease_owner is null and lease_expires_at is null)
  from public.jobs where workspace_id = (select workspace_id from privacy_ids)),
  'deletion queues jobs and clears leases');
select ok((select bool_and(delete_after <= now()) from public.job_objects
  where workspace_id = (select workspace_id from privacy_ids)), 'objects become due for deletion');
select ok((select bool_and(status = 'released') from public.usage_ledger
  where workspace_id = (select workspace_id from privacy_ids)), 'reserved usage is released');
select ok(public.request_account_deletion((select workspace_id from privacy_ids),
  '61111111-1111-4111-8111-111111111111', 'privacy-owner-repeat'), 'confirmed deletion retry is idempotent');
select is((select count(*) from public.audit_events where workspace_id = (select workspace_id from privacy_ids)),
  1::bigint, 'retry does not duplicate audit evidence');
select is((select owner_user_id from public.workspaces where status = 'deleting'
  and id = (select workspace_id from privacy_ids)), '61111111-1111-4111-8111-111111111111'::uuid,
  'reconciler can look up the deleting owner without account names');
select ok(not has_column_privilege('service_role', 'public.profiles', 'terms_version', 'UPDATE'),
  'trusted privacy grants cannot rewrite terms evidence');
select ok(not has_column_privilege('service_role', 'public.workspaces', 'owner_user_id', 'UPDATE'),
  'trusted privacy grants cannot transfer ownership');
select ok(not has_table_privilege('service_role', 'public.profiles', 'DELETE'),
  'privacy grants cannot directly delete profiles');

reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"62222222-2222-4222-8222-222222222222","role":"authenticated"}', true);
select is((select count(*) from public.profiles
  where user_id = '61111111-1111-4111-8111-111111111111'), 0::bigint, 'another client sees no target profile');
select throws_ok($sql$ select public.request_account_deletion(
  (select workspace_id from privacy_ids), '61111111-1111-4111-8111-111111111111',
  'privacy-client-forgery') $sql$, '42501', 'permission denied for function request_account_deletion',
  'clients cannot forge trusted deletion requests');
reset role;
select * from finish();
rollback;
