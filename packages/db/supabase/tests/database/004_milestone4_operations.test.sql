begin;

create extension if not exists pgtap with schema extensions;

select plan(25);

select ok(
  (select relrowsecurity from pg_class where oid = 'public.operation_cost_metrics'::regclass),
  'operation cost metrics has RLS'
);
select ok(
  not has_table_privilege('authenticated', 'public.operation_cost_metrics', 'SELECT'),
  'authenticated clients cannot read operation cost metrics'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.record_operation_cost_metrics(uuid,text,text,text,bigint,bigint,bigint,bigint,bigint)',
    'EXECUTE'
  ),
  'cost recording is trusted-server only'
);

insert into auth.users (id, email, email_confirmed_at)
values
  ('61111111-1111-4111-8111-111111111111', 'm4-one@example.invalid', now()),
  ('62222222-2222-4222-8222-222222222222', 'm4-two@example.invalid', now());

select is(
  (select count(*) from public.entitlement_snapshots where feature_key = 'convert.office.pdf.cloud'),
  2::bigint,
  'onboarding materializes Office conversion entitlements'
);
select ok(
  (select bool_and(not enabled) from public.entitlement_snapshots where feature_key = 'convert.office.pdf.cloud'),
  'Office conversion defaults disabled for free workspaces'
);
select ok(
  (select bool_and(limit_value = 20 and limit_unit = 'jobs') from public.entitlement_snapshots where feature_key = 'convert.office.pdf.cloud'),
  'Office conversion quota and unit are explicit'
);

select is(
  public.accept_stripe_subscription_event(
    'evt_m4_active', 'customer.subscription.updated', '2026-08-22T01:00:00Z',
    (select id from public.workspaces where owner_user_id = '61111111-1111-4111-8111-111111111111'),
    'cus_m4_one', 'sub_m4_one', 'active', 'pro_monthly', 'cad',
    now() - interval '1 day', now() + interval '30 days', false
  ),
  'applied',
  'verified Pro subscription state is applied'
);
select ok(
  (select enabled from public.entitlement_snapshots
   where workspace_id = (select id from public.workspaces where owner_user_id = '61111111-1111-4111-8111-111111111111')
     and feature_key = 'convert.office.pdf.cloud'),
  'active Pro subscription enables Office conversion'
);

select throws_ok(
  $$ select public.create_cloud_job_with_reservation(
    (select id from public.workspaces where owner_user_id = '61111111-1111-4111-8111-111111111111'),
    '61111111-1111-4111-8111-111111111111', 'convert.office.pdf', '0.1.0', '{}'::jsonb,
    'm4-wrong-unit-request-0001', 'convert.office.pdf.cloud', 1, 'pages', '2026-08', now() + interval '1 hour'
  ) $$,
  '22023',
  'USAGE_UNIT_MISMATCH',
  'reservation unit must match the entitlement unit'
);
select throws_ok(
  $$ select public.create_cloud_job_with_reservation(
    (select id from public.workspaces where owner_user_id = '61111111-1111-4111-8111-111111111111'),
    '61111111-1111-4111-8111-111111111111', 'convert.office.pdf', '0.1.0', '{"ownerPassword":"forbidden"}'::jsonb,
    'm4-secret-option-request-01', 'convert.office.pdf.cloud', 1, 'jobs', '2026-08', now() + interval '1 hour'
  ) $$,
  '22023',
  'SENSITIVE_JOB_OPTION_FORBIDDEN',
  'password-like options are rejected at the database boundary'
);

create temporary table m4_job (id uuid primary key);
insert into m4_job
select public.create_cloud_job_with_reservation(
  (select id from public.workspaces where owner_user_id = '61111111-1111-4111-8111-111111111111'),
  '61111111-1111-4111-8111-111111111111', 'convert.office.pdf', '0.1.0', '{}'::jsonb,
  'm4-office-request-000001', 'convert.office.pdf.cloud', 1, 'jobs', '2026-08', now() + interval '1 hour'
);

select is((select count(*) from m4_job), 1::bigint, 'an entitled Office job is created');
select is(
  (select status from public.usage_ledger where job_id = (select id from m4_job)),
  'reserved',
  'quota is reserved before processing'
);
select throws_ok(
  $$ select public.create_cloud_job_with_reservation(
    (select id from public.workspaces where owner_user_id = '61111111-1111-4111-8111-111111111111'),
    '61111111-1111-4111-8111-111111111111', 'convert.office.pdf', '0.1.0', '{}'::jsonb,
    'm4-over-quota-request-001', 'convert.office.pdf.cloud', 20, 'jobs', '2026-08', now() + interval '1 hour'
  ) $$,
  'P0001',
  'QUOTA_EXCEEDED',
  'reserved and consumed usage count toward the atomic quota'
);
select ok(public.transition_cloud_job((select id from m4_job), 'awaiting_upload', 'queued', 'queued'), 'verified job queues');
select is((select count(*) from public.claim_cloud_job('worker-office-test', 60)), 1::bigint, 'worker claims Office fixture');
select is(public.finish_cloud_job_attempt((select id from m4_job), 'worker-office-test', 1, true), 'completed', 'successful work consumes reservation');
select ok(not public.settle_cloud_job_usage((select id from m4_job), true), 'usage settlement is idempotent');

select ok(
  public.record_operation_cost_metrics(
    (select id from m4_job), 'convert.office.pdf', 'LibreOffice', '26.2.5.2',
    1200, 1800, 268435456, 4096, 8192
  ),
  'content-free cost metrics are recorded'
);
select is(
  (select engine_name from public.operation_cost_metrics where job_id = (select id from m4_job)),
  'LibreOffice',
  'cost metrics retain only reviewed engine provenance'
);
select throws_ok(
  $$ select public.record_operation_cost_metrics(
    (select id from m4_job), 'different.operation', 'LibreOffice', '26.2.5.2',
    1200, 1800, 268435456, 4096, 8192
  ) $$,
  '22023',
  'JOB_OPERATION_MISMATCH',
  'cost metrics cannot be attached under a different operation'
);

set local role authenticated;
set local "request.jwt.claims" = '{"sub":"61111111-1111-4111-8111-111111111111","role":"authenticated"}';
select throws_ok(
  'select * from public.operation_cost_metrics',
  '42501', null,
  'workspace owners cannot query internal cost metrics'
);
reset role;

select is(
  public.accept_stripe_subscription_event(
    'evt_m4_cancelled', 'customer.subscription.deleted', '2026-08-22T01:01:00Z',
    (select id from public.workspaces where owner_user_id = '61111111-1111-4111-8111-111111111111'),
    'cus_m4_one', 'sub_m4_one', 'cancelled', 'free', 'cad',
    now() - interval '1 day', now() + interval '30 days', false
  ),
  'applied',
  'verified cancellation is applied'
);
select ok(
  not (select enabled from public.entitlement_snapshots
       where workspace_id = (select id from public.workspaces where owner_user_id = '61111111-1111-4111-8111-111111111111')
         and feature_key = 'convert.office.pdf.cloud'),
  'verified cancellation disables Office conversion'
);
select throws_ok(
  $$ select public.create_cloud_job_with_reservation(
    (select id from public.workspaces where owner_user_id = '61111111-1111-4111-8111-111111111111'),
    '61111111-1111-4111-8111-111111111111', 'convert.office.pdf', '0.1.0', '{}'::jsonb,
    'm4-after-cancel-request-1', 'convert.office.pdf.cloud', 1, 'jobs', '2026-08', now() + interval '1 hour'
  ) $$,
  '42501',
  'ENTITLEMENT_REQUIRED',
  'disabled entitlement blocks job creation server-side'
);
select ok(
  not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'operation_cost_metrics'
      and column_name in ('filename', 'document_text', 'password', 'url')
  ),
  'cost metric schema has no sensitive content columns'
);

select * from finish();
rollback;
