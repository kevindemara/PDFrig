begin;

create extension if not exists pgtap with schema extensions;

select plan(21);

select ok(
  (select relrowsecurity from pg_class where oid = 'public.profiles'::regclass),
  'profiles has RLS enabled'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.workspaces'::regclass),
  'workspaces has RLS enabled'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.workspace_members'::regclass),
  'workspace_members has RLS enabled'
);

insert into auth.users (id, email)
values
  ('11111111-1111-4111-8111-111111111111', 'owner-one@example.invalid'),
  ('22222222-2222-4222-8222-222222222222', 'owner-two@example.invalid'),
  ('33333333-3333-4333-8333-333333333333', 'removed@example.invalid'),
  ('44444444-4444-4444-8444-444444444444', 'suspended@example.invalid');

select is((select count(*) from public.profiles), 4::bigint, 'onboarding creates one profile per user');
select is((select count(*) from public.workspaces), 4::bigint, 'onboarding creates one workspace per user');
select is(
  (select count(*) from public.workspace_members),
  4::bigint,
  'onboarding creates one owner membership per user'
);

select ok(
  not has_table_privilege('anon', 'public.profiles', 'SELECT'),
  'anonymous cannot select profiles'
);
select ok(
  not has_table_privilege('anon', 'public.workspaces', 'SELECT'),
  'anonymous cannot select workspaces'
);
select ok(
  not has_table_privilege('anon', 'public.workspace_members', 'SELECT'),
  'anonymous cannot select memberships'
);
select ok(
  not has_table_privilege('authenticated', 'public.workspaces', 'UPDATE'),
  'clients cannot update workspace state directly'
);
select ok(
  not has_table_privilege('authenticated', 'public.workspace_members', 'DELETE'),
  'clients cannot delete memberships directly'
);
select ok(
  not has_column_privilege('authenticated', 'public.profiles', 'terms_version', 'UPDATE'),
  'clients cannot directly alter terms evidence'
);

set local role authenticated;
set local "request.jwt.claims" = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';

select results_eq(
  'select user_id from public.profiles order by user_id',
  array['11111111-1111-4111-8111-111111111111'::uuid],
  'an authenticated user sees only their profile'
);
select is((select count(*) from public.workspaces), 1::bigint, 'an owner sees only their active workspace');
select is(
  (select count(*) from public.workspace_members),
  1::bigint,
  'an owner sees only their active membership'
);
select results_eq(
  $$
    update public.profiles
      set display_name = 'not allowed'
      where user_id = '22222222-2222-4222-8222-222222222222'
      returning user_id
  $$,
  array[]::uuid[],
  'a user cannot update another profile'
);
select lives_ok(
  $$ update public.profiles set display_name = 'Synthetic owner' where user_id = auth.uid() $$,
  'a user can update allowlisted fields on their own profile'
);

reset role;
update public.workspace_members
set status = 'removed'
where user_id = '33333333-3333-4333-8333-333333333333';
update public.workspaces
set status = 'suspended'
where owner_user_id = '44444444-4444-4444-8444-444444444444';

set local role authenticated;
set local "request.jwt.claims" = '{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated"}';
select is((select count(*) from public.workspaces), 0::bigint, 'removed members cannot see the workspace');
select is((select count(*) from public.workspace_members), 0::bigint, 'removed memberships are not visible');

set local "request.jwt.claims" = '{"sub":"44444444-4444-4444-8444-444444444444","role":"authenticated"}';
select is((select count(*) from public.workspaces), 0::bigint, 'suspended workspaces are not visible');

reset role;
select is((select count(*) from public.profiles), 4::bigint, 'trusted database operations can see all profiles');

select * from finish();
rollback;
