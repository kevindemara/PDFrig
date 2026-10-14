begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
insert into auth.users(id, email, email_confirmed_at) values
  ('41111111-1111-4111-8111-111111111111', 'identity-owner@example.invalid', now());
create temporary table identity_ids as select id as workspace_id from public.workspaces
where owner_user_id = '41111111-1111-4111-8111-111111111111';
grant select on identity_ids to service_role;
create temporary table identity_variants(description text, operation text, version text,
  options jsonb, feature text, quantity bigint, unit text, period text);
insert into identity_variants values
  ('operation', 'different.operation', '1.0.0', '{"flag":true,"count":1}', 'cloud.demo.integrity', 1, 'jobs', to_char(now(), 'YYYY-MM')),
  ('version', 'demo.integrity', '2.0.0', '{"flag":true,"count":1}', 'cloud.demo.integrity', 1, 'jobs', to_char(now(), 'YYYY-MM')),
  ('options', 'demo.integrity', '1.0.0', '{"flag":false,"count":1}', 'cloud.demo.integrity', 1, 'jobs', to_char(now(), 'YYYY-MM')),
  ('feature', 'demo.integrity', '1.0.0', '{"flag":true,"count":1}', 'desktop.full', 1, 'jobs', to_char(now(), 'YYYY-MM')),
  ('quantity', 'demo.integrity', '1.0.0', '{"flag":true,"count":1}', 'cloud.demo.integrity', 2, 'jobs', to_char(now(), 'YYYY-MM')),
  ('unit', 'demo.integrity', '1.0.0', '{"flag":true,"count":1}', 'cloud.demo.integrity', 1, 'pages', to_char(now(), 'YYYY-MM')),
  ('period', 'demo.integrity', '1.0.0', '{"flag":true,"count":1}', 'cloud.demo.integrity', 1, 'jobs', to_char(now() - interval '1 month', 'YYYY-MM'));
grant select on identity_variants to service_role;
set local role service_role;
select public.create_cloud_job_with_reservation(
  (select workspace_id from identity_ids), '41111111-1111-4111-8111-111111111111',
  'demo.integrity', '1.0.0', '{"flag":true,"count":1}', 'identity-original-request',
  'cloud.demo.integrity', 1, 'jobs', to_char(now(), 'YYYY-MM'), now() + interval '1 hour');
select throws_ok(format($sql$ select public.create_cloud_job_with_reservation(
  (select workspace_id from identity_ids), '41111111-1111-4111-8111-111111111111',
  %L, %L, %L::jsonb, 'identity-original-request', %L, %L::bigint, %L, %L,
  now() + interval '1 hour') $sql$, operation, version, options, feature, quantity, unit, period),
  '22023', 'IDEMPOTENCY_CONFLICT', 'changed ' || description || ' cannot reuse an existing request')
from identity_variants;
select is(public.create_cloud_job_with_reservation(
  (select workspace_id from identity_ids), '41111111-1111-4111-8111-111111111111',
  'demo.integrity', '1.0.0', '{"count":1,"flag":true}', 'identity-original-request',
  'cloud.demo.integrity', 1, 'jobs', to_char(now(), 'YYYY-MM'), now() + interval '2 hours'),
  (select id from public.jobs where workspace_id = (select workspace_id from identity_ids)),
  'canonical JSON key order does not create a false conflict');
select is((select count(*) from public.jobs where workspace_id = (select workspace_id from identity_ids)),
  1::bigint, 'conflicts create no new job');
select is((select sum(quantity) from public.usage_ledger where workspace_id = (select workspace_id from identity_ids)),
  1::numeric, 'conflicts reserve no additional quota');
select ok((select delete_after = now() + interval '1 hour' from public.jobs
  where workspace_id = (select workspace_id from identity_ids)), 'retention remains bound to the first request');
reset role;
select * from finish();
rollback;
