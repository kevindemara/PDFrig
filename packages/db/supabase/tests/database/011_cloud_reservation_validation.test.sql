begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
insert into auth.users(id, email, email_confirmed_at) values
  ('31111111-1111-4111-8111-111111111111', 'validation-owner@example.invalid', now());
create temporary table boundary_request as select jsonb_build_object(
  'workspace', id, 'actor', owner_user_id, 'operation', 'demo.integrity', 'version', '1.0.0',
  'options', '{}'::jsonb, 'key', 'validation-original-request', 'feature', 'cloud.demo.integrity',
  'quantity', 1, 'unit', 'jobs', 'period', to_char(now(), 'YYYY-MM'),
  'deadline', now() + interval '1 hour') as request
from public.workspaces where owner_user_id = '31111111-1111-4111-8111-111111111111';
create temporary table boundary_cases(description text, request jsonb, error text);
insert into boundary_cases select 'null ' || k,
  jsonb_set(request, array[k], 'null'::jsonb), 'INVALID_JOB_RESERVATION'
from boundary_request cross join unnest(array['workspace','actor','operation','version','options',
  'key','feature','quantity','unit','period','deadline']) k;
insert into boundary_cases select c.description, jsonb_set(r.request, array[c.key], c.value), c.error
from boundary_request r cross join (values
  ('short key', 'key', '"short"'::jsonb, 'INVALID_JOB_RESERVATION'),
  ('invalid key characters', 'key', '"invalid key request"', 'INVALID_JOB_RESERVATION'),
  ('invalid operation', 'operation', '"demo/unsafe"', 'INVALID_JOB_RESERVATION'),
  ('invalid version', 'version', '"latest"', 'INVALID_JOB_RESERVATION'),
  ('invalid feature', 'feature', '"not-a-feature"', 'INVALID_JOB_RESERVATION'),
  ('zero quantity', 'quantity', '0', 'INVALID_JOB_RESERVATION'),
  ('negative quantity', 'quantity', '-1', 'INVALID_JOB_RESERVATION'),
  ('invalid unit', 'unit', '"unbounded"', 'INVALID_JOB_RESERVATION'),
  ('invalid month', 'period', '"2026-13"', 'INVALID_JOB_RESERVATION'),
  ('array root', 'options', '[]', 'INVALID_JOB_RESERVATION'),
  ('top-level password', 'options', '{"password":"synthetic-canary"}', 'SENSITIVE_JOB_OPTION_FORBIDDEN'),
  ('nested filename', 'options', '{"nested":{"filename":"synthetic-canary"}}', 'SENSITIVE_JOB_OPTION_FORBIDDEN'),
  ('array nested token', 'options', '{"items":[{"nested":{"token":"synthetic-canary"}}]}', 'SENSITIVE_JOB_OPTION_FORBIDDEN'),
  ('nested extracted text', 'options', '{"nested":{"extracted_text":"synthetic-canary"}}', 'SENSITIVE_JOB_OPTION_FORBIDDEN')
) c(description, key, value, error);
insert into boundary_cases select 'expired deadline', jsonb_set(request, '{deadline}', to_jsonb(now())),
  'INVALID_JOB_RESERVATION' from boundary_request;
insert into boundary_cases select 'infinite deadline', jsonb_set(request, '{deadline}', '"infinity"'),
  'INVALID_JOB_RESERVATION' from boundary_request;
insert into boundary_cases select 'oversized options', jsonb_set(request, '{options}',
  jsonb_build_object('bounded', repeat('x', 17000))), 'INVALID_JOB_RESERVATION' from boundary_request;
insert into boundary_cases select 'excessive nodes', jsonb_set(request, '{options}',
  jsonb_build_object('items', (select jsonb_agg(0) from generate_series(1, 1024)))),
  'INVALID_JOB_RESERVATION' from boundary_request;
with recursive deep_options(value, depth) as (
  select '{}'::jsonb, 0 union all
  select jsonb_build_object('nested', value), depth + 1 from deep_options where depth < 17
)
insert into boundary_cases select 'excessive depth', jsonb_set(request, '{options}', value),
  'INVALID_JOB_RESERVATION' from boundary_request cross join deep_options where depth = 17;
grant select on boundary_request, boundary_cases to service_role;

set local role service_role;
select public.create_cloud_job_with_reservation(
  (request->>'workspace')::uuid, (request->>'actor')::uuid, request->>'operation', request->>'version',
  request->'options', request->>'key', request->>'feature', (request->>'quantity')::bigint,
  request->>'unit', request->>'period', (request->>'deadline')::timestamptz) from boundary_request;
select throws_ok(format($sql$ select public.create_cloud_job_with_reservation(
  %L::uuid, %L::uuid, %L, %L, %L::jsonb, %L, %L, %L::bigint, %L, %L, %L::timestamptz) $sql$,
  request->>'workspace', request->>'actor', request->>'operation', request->>'version',
  case when request->'options' = 'null'::jsonb then null else (request->'options')::text end,
  request->>'key', request->>'feature', request->>'quantity', request->>'unit', request->>'period', request->>'deadline'),
  '22023', error, description || ' stops before retry lookup or persistence') from boundary_cases;
select is((select count(*) from public.jobs where workspace_id =
  (select (request->>'workspace')::uuid from boundary_request)), 1::bigint, 'invalid requests add no jobs');
select is((select count(*) from public.usage_ledger where workspace_id =
  (select (request->>'workspace')::uuid from boundary_request)), 1::bigint, 'invalid requests add no usage');
select lives_ok($sql$ select public.create_cloud_job_with_reservation(
  (select (request->>'workspace')::uuid from boundary_request), '31111111-1111-4111-8111-111111111111',
  'demo.integrity', '1.0.0', '{"nested":{"items":[true,1,null,{"flag":false}]}}',
  'validation-nested-safe', 'cloud.demo.integrity', 1, 'jobs', to_char(now(), 'YYYY-MM'),
  now() + interval '1 hour') $sql$, 'bounded non-sensitive nested options remain supported');
reset role;
select * from finish();
rollback;
