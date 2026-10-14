begin;

create extension if not exists pgtap with schema extensions;

select plan(58);

select ok((select relrowsecurity from pg_class where oid = 'public.subscriptions'::regclass), 'subscriptions has RLS');
select ok((select relrowsecurity from pg_class where oid = 'public.entitlement_snapshots'::regclass), 'entitlements has RLS');
select ok((select relrowsecurity from pg_class where oid = 'public.jobs'::regclass), 'jobs has RLS');
select ok((select relrowsecurity from pg_class where oid = 'public.job_objects'::regclass), 'job objects has RLS');
select ok((select relrowsecurity from pg_class where oid = 'public.usage_ledger'::regclass), 'usage ledger has RLS');
select ok((select relrowsecurity from pg_class where oid = 'public.webhook_events'::regclass), 'webhook events has RLS');
select ok((select relrowsecurity from pg_class where oid = 'public.audit_events'::regclass), 'audit events has RLS');
select ok(
  exists (
    select 1 from pg_indexes
    where schemaname = 'public' and indexname = 'job_objects_one_input_per_job'
  ),
  'a job can have only one input object across idempotent upload authorization replays'
);

select ok(not has_table_privilege('anon', 'public.subscriptions', 'SELECT'), 'anonymous cannot select subscriptions');
select ok(not has_table_privilege('authenticated', 'public.jobs', 'INSERT'), 'clients cannot insert jobs');
select ok(not has_table_privilege('authenticated', 'public.jobs', 'UPDATE'), 'clients cannot mutate job state');
select ok(not has_column_privilege('authenticated', 'public.job_objects', 'storage_key', 'SELECT'), 'storage keys are server-only');
select ok(not has_column_privilege('authenticated', 'public.subscriptions', 'provider_customer_id', 'SELECT'), 'provider customer IDs are server-only');
select ok(
  not has_function_privilege(
    'authenticated',
    'public.create_cloud_job_with_reservation(uuid,uuid,text,text,jsonb,text,text,bigint,text,text,timestamptz)',
    'EXECUTE'
  ),
  'job creation function is trusted-server only'
);

insert into auth.users (id, email, email_confirmed_at)
values
  ('51111111-1111-4111-8111-111111111111', 'cloud-one@example.invalid', now()),
  ('52222222-2222-4222-8222-222222222222', 'cloud-two@example.invalid', now()),
  ('53333333-3333-4333-8333-333333333333', 'cloud-removed@example.invalid', now()),
  ('54444444-4444-4444-8444-444444444444', 'cloud-suspended@example.invalid', now());

select is((select count(*) from public.subscriptions), 4::bigint, 'onboarding creates free subscription mirrors');
select is(
  (select count(*) from public.entitlement_snapshots where feature_key = 'cloud.demo.integrity'),
  4::bigint,
  'onboarding creates bounded demonstration entitlements'
);
select ok(
  (select bool_and(limit_value = 3 and limit_unit = 'jobs') from public.entitlement_snapshots where feature_key = 'cloud.demo.integrity'),
  'free demonstration quota is explicit'
);

create temporary table test_cloud_ids (
  name text primary key,
  id uuid not null
);

insert into test_cloud_ids (name, id)
select 'owner-one-job-one', public.create_cloud_job_with_reservation(
  (select id from public.workspaces where owner_user_id = '51111111-1111-4111-8111-111111111111'),
  '51111111-1111-4111-8111-111111111111',
  'demo.integrity', '1.0.0', '{"verifySha256":true}'::jsonb,
  'owner-one-request-000001', 'cloud.demo.integrity', 1, 'jobs', '2026-08', now() + interval '1 hour'
);

select is(
  public.create_cloud_job_with_reservation(
    (select id from public.workspaces where owner_user_id = '51111111-1111-4111-8111-111111111111'),
    '51111111-1111-4111-8111-111111111111',
    'demo.integrity', '1.0.0', '{"verifySha256":true}'::jsonb,
    'owner-one-request-000001', 'cloud.demo.integrity', 1, 'jobs', '2026-08', now() + interval '1 hour'
  ),
  (select id from test_cloud_ids where name = 'owner-one-job-one'),
  'job creation is idempotent per workspace'
);
select is((select count(*) from public.usage_ledger), 1::bigint, 'idempotent replay does not reserve quota twice');

insert into test_cloud_ids (name, id)
values
  ('owner-one-job-two', public.create_cloud_job_with_reservation(
    (select id from public.workspaces where owner_user_id = '51111111-1111-4111-8111-111111111111'),
    '51111111-1111-4111-8111-111111111111', 'demo.integrity', '1.0.0', '{}'::jsonb,
    'owner-one-request-000002', 'cloud.demo.integrity', 1, 'jobs', '2026-08', now() + interval '1 hour'
  )),
  ('owner-one-job-three', public.create_cloud_job_with_reservation(
    (select id from public.workspaces where owner_user_id = '51111111-1111-4111-8111-111111111111'),
    '51111111-1111-4111-8111-111111111111', 'demo.integrity', '1.0.0', '{}'::jsonb,
    'owner-one-request-000003', 'cloud.demo.integrity', 1, 'jobs', '2026-08', now() + interval '1 hour'
  ));

select throws_ok(
  $$ select public.create_cloud_job_with_reservation(
    (select id from public.workspaces where owner_user_id = '51111111-1111-4111-8111-111111111111'),
    '51111111-1111-4111-8111-111111111111', 'demo.integrity', '1.0.0', '{}'::jsonb,
    'owner-one-request-000004', 'cloud.demo.integrity', 1, 'jobs', '2026-08', now() + interval '1 hour'
  ) $$,
  'P0001',
  'QUOTA_EXCEEDED',
  'quota is checked atomically before job creation'
);

select throws_ok(
  $$ select public.create_cloud_job_with_reservation(
    (select id from public.workspaces where owner_user_id = '51111111-1111-4111-8111-111111111111'),
    '52222222-2222-4222-8222-222222222222', 'demo.integrity', '1.0.0', '{}'::jsonb,
    'cross-tenant-request-01', 'cloud.demo.integrity', 1, 'jobs', '2026-08', now() + interval '1 hour'
  ) $$,
  '42501',
  'WORKSPACE_ACCESS_DENIED',
  'trusted job creation still verifies membership'
);

select is(
  (select state from public.jobs where id = (select id from test_cloud_ids where name = 'owner-one-job-one')),
  'awaiting_upload',
  'new jobs wait for verified upload'
);
select ok(
  public.transition_cloud_job(
    (select id from test_cloud_ids where name = 'owner-one-job-one'),
    'awaiting_upload', 'queued', 'queued', 0::smallint, null
  ),
  'trusted state transition queues a verified job'
);
select throws_ok(
  $$ select public.transition_cloud_job(
    (select id from test_cloud_ids where name = 'owner-one-job-one'),
    'queued', 'completed', 'complete', 100::smallint, null
  ) $$,
  '22023',
  'INVALID_JOB_TRANSITION',
  'invalid state transitions fail closed'
);
select is(
  (select count(*) from public.claim_cloud_job('worker-synthetic-01', 60)),
  1::bigint,
  'a worker atomically claims one queued job'
);
select ok(
  public.finish_cloud_job_attempt(
    (select id from test_cloud_ids where name = 'owner-one-job-one'), 'worker-synthetic-01', 1, true
  ) = 'completed',
  'reserved usage can be consumed once'
);
select ok(
  not public.settle_cloud_job_usage(
    (select id from test_cloud_ids where name = 'owner-one-job-one'), true
  ),
  'usage settlement is idempotent'
);

select is(
  public.accept_stripe_subscription_event(
    'evt_checkout_only', 'checkout.session.completed', '2026-08-21T12:00:00Z',
    (select id from public.workspaces where owner_user_id = '51111111-1111-4111-8111-111111111111'),
    'cus_synthetic_one', 'sub_synthetic_one', 'active', 'pro_monthly', 'cad',
    now() - interval '1 day', now() + interval '30 days', false
  ),
  'ignored',
  'checkout completion alone is not authoritative access state'
);
select is(
  (select count(*) from public.entitlement_snapshots where feature_key = 'desktop.full' and enabled),
  0::bigint,
  'checkout redirect cannot grant entitlement'
);
select is(
  public.accept_stripe_subscription_event(
    'evt_subscription_active', 'customer.subscription.updated', '2026-08-21T12:01:00Z',
    (select id from public.workspaces where owner_user_id = '51111111-1111-4111-8111-111111111111'),
    'cus_synthetic_one', 'sub_synthetic_one', 'active', 'pro_monthly', 'cad',
    now() - interval '1 day', now() + interval '30 days', false
  ),
  'applied',
  'verified subscription state is applied'
);
select ok(
  (select enabled from public.entitlement_snapshots where feature_key = 'desktop.full'),
  'active verified subscription enables entitlement'
);
select is(
  public.accept_stripe_subscription_event(
    'evt_subscription_active', 'customer.subscription.updated', '2026-08-21T12:01:00Z',
    (select id from public.workspaces where owner_user_id = '51111111-1111-4111-8111-111111111111'),
    'cus_synthetic_one', 'sub_synthetic_one', 'active', 'pro_monthly', 'cad',
    now() - interval '1 day', now() + interval '30 days', false
  ),
  'duplicate',
  'duplicate webhook delivery is idempotent'
);
select is(
  public.accept_stripe_subscription_event(
    'evt_subscription_old', 'customer.subscription.deleted', '2026-08-21T11:59:00Z',
    (select id from public.workspaces where owner_user_id = '51111111-1111-4111-8111-111111111111'),
    'cus_synthetic_one', 'sub_synthetic_one', 'cancelled', 'free', 'cad',
    now() - interval '1 day', now() + interval '30 days', false
  ),
  'stale',
  'out-of-order stale webhook is recorded without overwriting state'
);
select ok(
  (select enabled from public.entitlement_snapshots where feature_key = 'desktop.full'),
  'stale webhook cannot revoke newer entitlement state'
);
select is(
  public.accept_stripe_subscription_event(
    'evt_subscription_cancelled', 'customer.subscription.deleted', '2026-08-21T12:02:00Z',
    (select id from public.workspaces where owner_user_id = '51111111-1111-4111-8111-111111111111'),
    'cus_synthetic_one', 'sub_synthetic_one', 'cancelled', 'free', 'cad',
    now() - interval '1 day', now() + interval '30 days', false
  ),
  'applied',
  'newer cancellation is applied'
);
select ok(
  not (select enabled from public.entitlement_snapshots where feature_key = 'desktop.full'),
  'verified cancellation disables entitlement'
);

create temporary table owner_two_job (id uuid primary key);
with inserted_job as (
  insert into public.jobs (
    workspace_id, created_by, operation, operation_version, state, idempotency_key, progress_stage, delete_after
  )
  select id, owner_user_id, 'demo.integrity', '1.0.0', 'queued', 'owner-two-request-000001', 'queued', now() + interval '1 hour'
  from public.workspaces where owner_user_id = '52222222-2222-4222-8222-222222222222'
  returning id
)
insert into owner_two_job select id from inserted_job;
grant select on owner_two_job to authenticated;

insert into public.jobs (
  workspace_id, created_by, operation, operation_version, state, idempotency_key, progress_stage, delete_after
)
select id, owner_user_id, 'demo.integrity', '1.0.0', 'queued', 'removed-request-0000001', 'queued', now() + interval '1 hour'
from public.workspaces where owner_user_id = '53333333-3333-4333-8333-333333333333';

insert into public.jobs (
  workspace_id, created_by, operation, operation_version, state, idempotency_key, progress_stage, delete_after
)
select id, owner_user_id, 'demo.integrity', '1.0.0', 'queued', 'suspended-request-001', 'queued', now() + interval '1 hour'
from public.workspaces where owner_user_id = '54444444-4444-4444-8444-444444444444';

insert into public.job_objects (
  job_id, workspace_id, role, storage_key, mime_type, byte_size, sha256, state, delete_after
)
select j.id, j.workspace_id, 'input',
  'development/' || replace(j.workspace_id::text, '-', '') || '/' || replace(j.id::text, '-', '') || '/input',
  'application/pdf', 128, repeat('a', 64), 'verified', now() + interval '1 hour'
from public.jobs j
where j.id = (select id from test_cloud_ids where name = 'owner-one-job-three');

set local role authenticated;
set local "request.jwt.claims" = '{"sub":"51111111-1111-4111-8111-111111111111","role":"authenticated"}';

select is((select count(*) from public.jobs), 3::bigint, 'owner sees only jobs in their active workspace');
select is(
  (select count(*) from public.jobs where id = (select id from owner_two_job)),
  0::bigint,
  'owner cannot infer another workspace job by ID'
);
select is((select count(*) from public.safe_job_object_statuses), 1::bigint, 'owner sees safe object deletion metadata');

set local "request.jwt.claims" = '{"sub":"52222222-2222-4222-8222-222222222222","role":"authenticated"}';
select is((select count(*) from public.jobs), 1::bigint, 'second owner sees only their own job');

set local role anon;
select throws_ok('select id from public.jobs', '42501', null, 'anonymous job access is denied');

reset role;
update public.workspace_members set status = 'removed'
where user_id = '53333333-3333-4333-8333-333333333333';
update public.workspaces set status = 'suspended'
where owner_user_id = '54444444-4444-4444-8444-444444444444';

set local role authenticated;
set local "request.jwt.claims" = '{"sub":"53333333-3333-4333-8333-333333333333","role":"authenticated"}';
select is((select count(*) from public.jobs), 0::bigint, 'removed member cannot read former jobs');
set local "request.jwt.claims" = '{"sub":"54444444-4444-4444-8444-444444444444","role":"authenticated"}';
select is((select count(*) from public.jobs), 0::bigint, 'suspended workspace cannot expose jobs');
select throws_ok(
  'update public.jobs set state = ''completed''',
  '42501', null,
  'authenticated clients cannot directly mutate job state'
);

reset role;
select throws_ok(
  $$ select public.request_cloud_job_cancellation(
    (select id from owner_two_job),
    (select id from public.workspaces where owner_user_id = '52222222-2222-4222-8222-222222222222'),
    '51111111-1111-4111-8111-111111111111'
  ) $$,
  '42501', 'WORKSPACE_ACCESS_DENIED',
  'cancellation verifies workspace membership'
);
select ok(
  public.request_cloud_job_cancellation(
    (select id from owner_two_job),
    (select id from public.workspaces where owner_user_id = '52222222-2222-4222-8222-222222222222'),
    '52222222-2222-4222-8222-222222222222'
  ),
  'owner can request cancellation through trusted transition'
);

update public.jobs set state = 'completed', progress_stage = 'complete', progress_value = 100
where id = (select id from test_cloud_ids where name = 'owner-one-job-three');
select ok(
  public.request_cloud_job_deletion(
    (select id from test_cloud_ids where name = 'owner-one-job-three'),
    (select id from public.workspaces where owner_user_id = '51111111-1111-4111-8111-111111111111'),
    '51111111-1111-4111-8111-111111111111'
  ),
  'owner can request immediate object deletion'
);
select ok(
  (select delete_after <= now() from public.job_objects where job_id = (select id from test_cloud_ids where name = 'owner-one-job-three')),
  'delete request makes every object immediately eligible'
);
select is(
  public.record_job_object_deletion(
    (select id from public.job_objects where job_id = (select id from test_cloud_ids where name = 'owner-one-job-three')),
    false, 'STORAGE_UNAVAILABLE'
  ),
  'retry',
  'first delete failure remains retryable'
);
select is(
  public.record_job_object_deletion(
    (select id from public.job_objects where job_id = (select id from test_cloud_ids where name = 'owner-one-job-three')),
    false, 'STORAGE_UNAVAILABLE'
  ),
  'retry',
  'second delete failure remains retryable'
);
select is(
  public.record_job_object_deletion(
    (select id from public.job_objects where job_id = (select id from test_cloud_ids where name = 'owner-one-job-three')),
    false, 'STORAGE_UNAVAILABLE'
  ),
  'attention',
  'third delete failure raises operational attention'
);
select is(
  (select state from public.jobs where id = (select id from test_cloud_ids where name = 'owner-one-job-three')),
  'deletion_attention',
  'deletion failure is visible in job state'
);
select ok(
  public.request_cloud_job_deletion(
    (select id from test_cloud_ids where name = 'owner-one-job-three'),
    (select id from public.workspaces where owner_user_id = '51111111-1111-4111-8111-111111111111'),
    '51111111-1111-4111-8111-111111111111'
  ),
  'deletion attention can be retried'
);
select is(
  public.record_job_object_deletion(
    (select id from public.job_objects where job_id = (select id from test_cloud_ids where name = 'owner-one-job-three')),
    true, null
  ),
  'job_deleted',
  'successful reconciliation marks the job deleted'
);
select is(
  (select state from public.jobs where id = (select id from test_cloud_ids where name = 'owner-one-job-three')),
  'deleted',
  'job deletion completes only after object absence is confirmed'
);
select ok(
  not has_table_privilege('authenticated', 'public.operational_job_summary', 'SELECT'),
  'content-free operational view is service-only'
);
select ok(
  not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'webhook_events' and column_name = 'payload'
  ),
  'webhook table does not retain raw provider bodies'
);
select ok(
  (select 'security_invoker=true' = any(coalesce(reloptions, '{}')) from pg_class where oid = 'public.safe_job_object_statuses'::regclass),
  'safe object status view invokes underlying RLS'
);

select * from finish();
rollback;
