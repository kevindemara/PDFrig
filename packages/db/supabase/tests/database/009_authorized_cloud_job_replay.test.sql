begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
insert into auth.users(id, email, email_confirmed_at) values
  ('51111111-1111-4111-8111-111111111111', 'replay-owner@example.invalid', now()),
  ('52222222-2222-4222-8222-222222222222', 'replay-other@example.invalid', now());
create temporary table replay_ids as select id as workspace_id from public.workspaces
where owner_user_id = '51111111-1111-4111-8111-111111111111';
grant select on replay_ids to service_role;
set local role service_role;
select public.create_cloud_job_with_reservation(
  (select workspace_id from replay_ids), '51111111-1111-4111-8111-111111111111',
  'demo.integrity', '1.0.0', '{}'::jsonb, 'replay-original-request', 'cloud.demo.integrity',
  1, 'jobs', to_char(now(), 'YYYY-MM'), now() + interval '1 hour');
select is(public.create_cloud_job_with_reservation(
  (select workspace_id from replay_ids), '51111111-1111-4111-8111-111111111111',
  'demo.integrity', '1.0.0', '{}'::jsonb, 'replay-original-request', 'cloud.demo.integrity',
  1, 'jobs', to_char(now(), 'YYYY-MM'), now() + interval '2 hours'),
  (select id from public.jobs where workspace_id = (select workspace_id from replay_ids)),
  'authorized identical replay returns the original identifier');
select throws_ok($sql$ select public.create_cloud_job_with_reservation(
  (select workspace_id from replay_ids), '52222222-2222-4222-8222-222222222222',
  'demo.integrity', '1.0.0', '{}'::jsonb, 'replay-original-request', 'cloud.demo.integrity',
  1, 'jobs', to_char(now(), 'YYYY-MM'), now() + interval '1 hour') $sql$,
  '42501', 'WORKSPACE_ACCESS_DENIED', 'known key does not reveal a job to another actor');
reset role;
update public.workspace_members set status = 'removed'
where workspace_id = (select workspace_id from replay_ids);
set local role service_role;
select throws_ok($sql$ select public.create_cloud_job_with_reservation(
  (select workspace_id from replay_ids), '51111111-1111-4111-8111-111111111111',
  'demo.integrity', '1.0.0', '{}'::jsonb, 'replay-original-request', 'cloud.demo.integrity',
  1, 'jobs', to_char(now(), 'YYYY-MM'), now() + interval '1 hour') $sql$,
  '42501', 'WORKSPACE_ACCESS_DENIED', 'removed member cannot replay a known job');
reset role;
update public.workspace_members set status = 'active'
where workspace_id = (select workspace_id from replay_ids);
create temporary table replay_states(status text);
insert into replay_states values ('suspended'), ('deleting');
grant select on replay_states to service_role;
-- Fixture updates use postgres only; the boundary itself always uses service_role.
update public.workspaces set status = 'suspended' where id = (select workspace_id from replay_ids);
set local role service_role;
select throws_ok($sql$ select public.create_cloud_job_with_reservation(
  (select workspace_id from replay_ids), '51111111-1111-4111-8111-111111111111',
  'demo.integrity', '1.0.0', '{}'::jsonb, 'replay-original-request', 'cloud.demo.integrity',
  1, 'jobs', to_char(now(), 'YYYY-MM'), now() + interval '1 hour') $sql$,
  '42501', 'WORKSPACE_ACCESS_DENIED', 'suspended workspace cannot replay a known job');
update public.workspaces set status = 'deleting' where id = (select workspace_id from replay_ids);
select throws_ok($sql$ select public.create_cloud_job_with_reservation(
  (select workspace_id from replay_ids), '51111111-1111-4111-8111-111111111111',
  'demo.integrity', '1.0.0', '{}'::jsonb, 'replay-original-request', 'cloud.demo.integrity',
  1, 'jobs', to_char(now(), 'YYYY-MM'), now() + interval '1 hour') $sql$,
  '42501', 'WORKSPACE_ACCESS_DENIED', 'deleting workspace cannot replay a known job');
select is((select count(*) from public.jobs where workspace_id = (select workspace_id from replay_ids)),
  1::bigint, 'replays create no extra jobs');
select is((select count(*) from public.usage_ledger where workspace_id = (select workspace_id from replay_ids)),
  1::bigint, 'replays create no extra charges');
select ok((select delete_after = now() + interval '1 hour' from public.jobs
  where workspace_id = (select workspace_id from replay_ids)), 'replay never extends retention');
reset role;
select * from finish();
rollback;
