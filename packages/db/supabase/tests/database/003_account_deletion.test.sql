begin;

create extension if not exists pgtap with schema extensions;

select plan(9);

select ok(
  not has_function_privilege(
    'authenticated',
    'public.request_account_deletion(uuid,uuid,text)',
    'EXECUTE'
  ),
  'account deletion is a trusted-server operation'
);

insert into auth.users (id, email, email_confirmed_at)
values ('91111111-1111-4111-8111-111111111111', 'delete-owner@example.invalid', now());

create temporary table deletion_test_ids as
select
  (select id from public.workspaces where owner_user_id = '91111111-1111-4111-8111-111111111111') as workspace_id,
  public.create_cloud_job_with_reservation(
    (select id from public.workspaces where owner_user_id = '91111111-1111-4111-8111-111111111111'),
    '91111111-1111-4111-8111-111111111111',
    'demo.integrity', '1.0.0', '{}'::jsonb, 'account-delete-job-0001',
    'cloud.demo.integrity', 1, 'jobs', '2026-08', now() + interval '1 hour'
  ) as job_id;

insert into public.job_objects (
  job_id, workspace_id, role, storage_key, mime_type, byte_size, sha256, delete_after
)
select
  job_id, workspace_id, 'input',
  'production/opaque/delete/account/object-01',
  'application/pdf', 100, repeat('a', 64), now() + interval '1 hour'
from deletion_test_ids;

select ok(
  public.request_account_deletion(
    (select workspace_id from deletion_test_ids),
    '91111111-1111-4111-8111-111111111111',
    'account-delete-request-0001'
  ),
  'owner can request deletion through trusted server function'
);
select is(
  (select status from public.workspaces where id = (select workspace_id from deletion_test_ids)),
  'deleting',
  'workspace stops accepting normal authenticated work'
);
select ok(
  (select account_deletion_requested_at is not null from public.profiles where user_id = '91111111-1111-4111-8111-111111111111'),
  'profile records deletion request time'
);
select is(
  (select state from public.jobs where id = (select job_id from deletion_test_ids)),
  'deleting',
  'account deletion queues every job for deletion'
);
select ok(
  (select delete_after <= now() from public.job_objects where job_id = (select job_id from deletion_test_ids)),
  'account deletion makes every object immediately eligible for reconciliation'
);
select is(
  (select status from public.usage_ledger where job_id = (select job_id from deletion_test_ids)),
  'released',
  'reserved usage is released'
);
select is(
  (select count(*) from public.audit_events where event_type = 'account.deletion_requested'),
  1::bigint,
  'content-free deletion audit event is recorded once'
);
select throws_ok(
  $$ select public.request_account_deletion(
    (select workspace_id from deletion_test_ids),
    '92222222-2222-4222-8222-222222222222',
    'cross-tenant-delete-request'
  ) $$,
  '42501',
  'WORKSPACE_ACCESS_DENIED',
  'another user cannot request workspace deletion'
);

select * from finish();
rollback;
