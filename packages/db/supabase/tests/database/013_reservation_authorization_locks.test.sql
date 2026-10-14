begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

insert into auth.users(id, email, email_confirmed_at) values
  ('71111111-1111-4111-8111-111111111111', 'lock-owner@example.invalid', now());
create temporary table lock_ids as select id as workspace_id from public.workspaces
where owner_user_id = '71111111-1111-4111-8111-111111111111';
grant select on lock_ids to service_role;

set local role service_role;
select lives_ok($sql$ select public.create_cloud_job_with_reservation(
  (select workspace_id from lock_ids), '71111111-1111-4111-8111-111111111111',
  'demo.integrity', '1.0.0', '{}', 'authorization-lock-request', 'cloud.demo.integrity',
  1, 'jobs', to_char(now(), 'YYYY-MM'), now() + interval '1 hour') $sql$,
  'actual service role can acquire authorization barriers with existing grants');
select ok(exists(select 1 from pg_catalog.pg_locks where pid = pg_backend_pid()
  and relation = 'public.workspaces'::regclass and mode = 'RowShareLock' and granted),
  'reservation holds the workspace locking statement through its transaction');
select ok(exists(select 1 from pg_catalog.pg_locks where pid = pg_backend_pid()
  and locktype = 'advisory' and mode = 'ShareLock' and granted),
  'reservation holds a shared membership mutation barrier');
select ok(not has_column_privilege('service_role', 'public.workspace_members', 'status', 'UPDATE'),
  'locking repair grants no membership writes');
select ok(not has_function_privilege('service_role', 'public.lock_workspace_membership_mutation()', 'EXECUTE'),
  'trusted role does not gain direct trigger function invocation');
reset role;

select ok(exists(select 1 from pg_catalog.pg_trigger
  where tgrelid = 'public.workspace_members'::regclass
    and tgname = 'serialize_workspace_membership_mutation' and not tgisinternal),
  'membership mutations retain the installed barrier');
select ok(not p.prosecdef and p.proconfig @> array['search_path=""']::text[],
  p.proname || ' retains invoker security and an empty search path')
from pg_catalog.pg_proc p where p.oid in (
  'public.create_cloud_job_with_reservation(uuid,uuid,text,text,jsonb,text,text,bigint,text,text,timestamptz)'::regprocedure,
  'public.request_account_deletion(uuid,uuid,text)'::regprocedure,
  'public.lock_workspace_membership_mutation()'::regprocedure);
select ok(not has_function_privilege(role_name, function_name, 'EXECUTE'),
  role_name || ' cannot invoke ' || function_name)
from (values ('anon'), ('authenticated')) r(role_name)
cross join (values
  ('public.create_cloud_job_with_reservation(uuid,uuid,text,text,jsonb,text,text,bigint,text,text,timestamptz)'),
  ('public.request_account_deletion(uuid,uuid,text)'),
  ('public.lock_workspace_membership_mutation()')) f(function_name);
select * from finish();
rollback;
