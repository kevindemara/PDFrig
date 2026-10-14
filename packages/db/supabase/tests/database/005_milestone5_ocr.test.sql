begin;

create extension if not exists pgtap with schema extensions;

select plan(15);

select ok(
  (select relrowsecurity from pg_class where oid = 'public.plan_feature_defaults'::regclass),
  'plan feature defaults has RLS'
);
select ok(
  not has_table_privilege('authenticated', 'public.plan_feature_defaults', 'SELECT'),
  'entitlement catalogue is trusted-server only'
);
select ok(
  not has_function_privilege('authenticated', 'public.refresh_ocr_entitlement()', 'EXECUTE'),
  'OCR entitlement refresh is not client callable'
);

insert into auth.users (id, email, email_confirmed_at)
values ('71111111-1111-4111-8111-111111111111', 'm5-one@example.invalid', now());

select ok(
  not (select enabled from public.entitlement_snapshots
       where workspace_id = (select id from public.workspaces where owner_user_id = '71111111-1111-4111-8111-111111111111')
         and feature_key = 'ocr.searchable.pdf.cloud'),
  'free onboarding disables cloud OCR'
);
select is(
  (select limit_unit from public.entitlement_snapshots
   where workspace_id = (select id from public.workspaces where owner_user_id = '71111111-1111-4111-8111-111111111111')
     and feature_key = 'ocr.searchable.pdf.cloud'),
  'pages',
  'OCR quotas are measured in pages'
);

select is(
  public.accept_stripe_subscription_event(
    'evt_m5_active', 'customer.subscription.updated', '2026-08-24T20:00:00Z',
    (select id from public.workspaces where owner_user_id = '71111111-1111-4111-8111-111111111111'),
    'cus_m5_one', 'sub_m5_one', 'active', 'pro_monthly', 'cad',
    now() - interval '1 day', now() + interval '30 days', false
  ),
  'applied',
  'verified Pro subscription is applied'
);
select ok(
  (select enabled from public.entitlement_snapshots
   where workspace_id = (select id from public.workspaces where owner_user_id = '71111111-1111-4111-8111-111111111111')
     and feature_key = 'ocr.searchable.pdf.cloud'),
  'active Pro enables cloud OCR'
);

create temporary table m5_job (id uuid primary key);
insert into m5_job
select public.create_cloud_job_with_reservation(
  (select id from public.workspaces where owner_user_id = '71111111-1111-4111-8111-111111111111'),
  '71111111-1111-4111-8111-111111111111', 'ocr.searchable.pdf', '0.1.0',
  '{"languages":["eng","fra"]}'::jsonb, 'm5-ocr-request-000001',
  'ocr.searchable.pdf.cloud', 3, 'pages', '2026-08', now() + interval '1 hour'
);

select is((select count(*) from m5_job), 1::bigint, 'entitled OCR job reserves page usage');
select is(
  (select quantity from public.usage_ledger where job_id = (select id from m5_job)),
  3::bigint,
  'OCR reservation records the requested page count'
);
select throws_ok(
  $$ select public.create_cloud_job_with_reservation(
    (select id from public.workspaces where owner_user_id = '71111111-1111-4111-8111-111111111111'),
    '71111111-1111-4111-8111-111111111111', 'ocr.searchable.pdf', '0.1.0',
    '{"pdfText":"forbidden"}'::jsonb, 'm5-ocr-sensitive-0001',
    'ocr.searchable.pdf.cloud', 1, 'pages', '2026-08', now() + interval '1 hour'
  ) $$,
  '22023',
  'SENSITIVE_JOB_OPTION_FORBIDDEN',
  'recognized document text is rejected at the reservation boundary'
);

set local role authenticated;
set local "request.jwt.claims" = '{"sub":"71111111-1111-4111-8111-111111111111","role":"authenticated"}';
select throws_ok(
  'select * from public.plan_feature_defaults',
  '42501', null,
  'workspace owners cannot query operator entitlement defaults'
);
reset role;

select is(
  public.accept_stripe_subscription_event(
    'evt_m5_cancelled', 'customer.subscription.deleted', '2026-08-24T20:01:00Z',
    (select id from public.workspaces where owner_user_id = '71111111-1111-4111-8111-111111111111'),
    'cus_m5_one', 'sub_m5_one', 'cancelled', 'free', 'cad',
    now() - interval '1 day', now() + interval '30 days', false
  ),
  'applied',
  'verified cancellation is applied'
);
select ok(
  not (select enabled from public.entitlement_snapshots
       where workspace_id = (select id from public.workspaces where owner_user_id = '71111111-1111-4111-8111-111111111111')
         and feature_key = 'ocr.searchable.pdf.cloud'),
  'verified cancellation disables cloud OCR'
);
select throws_ok(
  $$ select public.create_cloud_job_with_reservation(
    (select id from public.workspaces where owner_user_id = '71111111-1111-4111-8111-111111111111'),
    '71111111-1111-4111-8111-111111111111', 'ocr.searchable.pdf', '0.1.0',
    '{"languages":["eng"]}'::jsonb, 'm5-ocr-after-cancel-1',
    'ocr.searchable.pdf.cloud', 1, 'pages', '2026-08', now() + interval '1 hour'
  ) $$,
  '42501',
  'ENTITLEMENT_REQUIRED',
  'disabled OCR entitlement blocks server-side job creation'
);
select ok(
  not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'plan_feature_defaults'
      and column_name in ('filename', 'document_text', 'password', 'url')
  ),
  'OCR entitlement schema has no sensitive content columns'
);

select * from finish();
rollback;
