begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

-- Synthetic role-level control-plane tests, not a live provider approval.
insert into auth.users (id, email, email_confirmed_at) values
  ('71111111-1111-4111-8111-111111111111', 'lookup-owner@example.invalid', now()),
  ('72222222-2222-4222-8222-222222222222', 'lookup-other@example.invalid', now());
create temporary table lookup_ids as
select id as workspace_id from public.workspaces
where owner_user_id = '71111111-1111-4111-8111-111111111111';
grant select on lookup_ids to service_role, authenticated, anon;

set local role service_role;
select lives_ok($sql$ select public.create_cloud_job_with_reservation(
  (select workspace_id from lookup_ids), '71111111-1111-4111-8111-111111111111',
  'demo.integrity', '1.0.0', '{}'::jsonb, 'lookup-valid-request',
  'cloud.demo.integrity', 1, 'jobs', to_char(now(), 'YYYY-MM'), now() + interval '1 hour'
) $sql$, 'service role can reserve an eligible job through an invoker function');
select is((select count(*) from public.jobs where workspace_id = (select workspace_id from lookup_ids)),
  1::bigint, 'successful reservation creates one job');
select is((select count(*) from public.usage_ledger where workspace_id = (select workspace_id from lookup_ids)),
  1::bigint, 'successful reservation reserves one usage row');
select throws_ok($sql$ select public.create_cloud_job_with_reservation(
  (select workspace_id from lookup_ids), '72222222-2222-4222-8222-222222222222',
  'demo.integrity', '1.0.0', '{}'::jsonb, 'lookup-denied-request',
  'cloud.demo.integrity', 1, 'jobs', to_char(now(), 'YYYY-MM'), now() + interval '1 hour'
) $sql$, '42501', 'WORKSPACE_ACCESS_DENIED', 'another actor cannot reserve in the target workspace');
select ok(not has_column_privilege('service_role', 'public.workspaces', 'name', 'SELECT'),
  'lookup grant does not expose workspace names');
select ok(not has_column_privilege('service_role', 'public.profiles', 'display_name', 'SELECT'),
  'lookup grant does not expose profile names');
select ok(not has_column_privilege('service_role', 'public.workspaces', 'owner_user_id', 'UPDATE'),
  'lookup grant cannot transfer workspace ownership');
select ok(not has_column_privilege('service_role', 'public.workspace_members', 'status', 'UPDATE'),
  'lookup grant cannot activate a removed member');

reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"72222222-2222-4222-8222-222222222222","role":"authenticated"}', true);
select is((select count(*) from public.workspaces where id = (select workspace_id from lookup_ids)),
  0::bigint, 'client RLS still hides another workspace');
select ok(not has_function_privilege('authenticated',
  'public.create_cloud_job_with_reservation(uuid,uuid,text,text,jsonb,text,text,bigint,text,text,timestamptz)', 'EXECUTE'),
  'clients cannot impersonate actors through the trusted RPC');
reset role;
select ok((select bool_and(relrowsecurity) from pg_class
  where oid in ('public.workspaces'::regclass, 'public.workspace_members'::regclass)),
  'both exposed tables retain RLS');
select * from finish();
rollback;
