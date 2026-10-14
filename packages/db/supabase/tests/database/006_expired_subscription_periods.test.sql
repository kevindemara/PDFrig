begin;

create extension if not exists pgtap with schema extensions;
select no_plan();

-- Synthetic accounts only. Transaction-relative times never turn current-period
-- positives into expired negatives when CI runs later. CONV-002/003/004, OCR-001.
insert into auth.users (id, email, email_confirmed_at)
select
  ('81111111-1111-4111-8111-11111111110' || n::text)::uuid,
  'expiry-' || n::text || '@example.invalid',
  now()
from generate_series(1, 9) as n;

create temporary table period_cases (
  case_number integer primary key,
  workspace_id uuid not null,
  owner_id uuid not null,
  status text not null,
  plan_key text not null,
  period_end timestamptz,
  expected_enabled boolean not null,
  cancel_at_period_end boolean not null,
  description text not null
);

insert into period_cases
select c.n, w.id, w.owner_user_id, c.status, c.plan_key, c.period_end,
       c.expected_enabled, c.cancel_at_period_end, c.description
from (values
  (1, 'active', 'pro_monthly', now() - interval '1 day', false, false, 'delayed expired active'),
  (2, 'trialing', 'pro_annual', now() - interval '1 day', false, false, 'delayed expired trial'),
  (3, 'cancelled', 'pro_monthly', now() - interval '1 day', false, false, 'delayed expired cancellation'),
  (4, 'active', 'pro_annual', now(), false, false, 'exact expiry boundary'),
  (5, 'active', 'pro_monthly', now() + interval '30 days', true, true, 'current paid cancellation scheduled'),
  (6, 'past_due', 'pro_annual', now() + interval '30 days', false, false, 'payment problem without grace'),
  (7, 'active', 'pro_monthly', null::timestamptz, true, false, 'existing null-end policy'),
  (8, 'none', 'free', null::timestamptz, false, false, 'free onboarding policy'),
  (9, 'trialing', 'pro_annual', now() + interval '30 days', true, false, 'current valid trial')
) as c(n, status, plan_key, period_end, expected_enabled, cancel_at_period_end, description)
join public.workspaces w
  on w.owner_user_id = ('81111111-1111-4111-8111-11111111110' || c.n::text)::uuid;

grant select on period_cases to service_role, authenticated, anon;

set local role service_role;

select is(
  public.accept_stripe_subscription_event(
    'evt_expiry_' || case_number::text,
    case when status = 'cancelled' then 'customer.subscription.deleted'
         else 'customer.subscription.updated' end,
    now() - interval '2 minutes', workspace_id,
    'cus_expiry_' || case_number::text, 'sub_expiry_' || case_number::text,
    status, plan_key, 'cad', now() - interval '30 days', period_end, cancel_at_period_end
  ),
  'applied', description || ' event commits under service_role'
) from period_cases order by case_number;

select is(
  (select count(*) from public.entitlement_snapshots e
   where e.workspace_id = c.workspace_id and e.source = 'subscription'),
  4::bigint, c.description || ' refreshes all four subscription snapshots'
) from period_cases c order by case_number;

select ok(
  (select bool_and(e.enabled = c.expected_enabled)
   from public.entitlement_snapshots e
   where e.workspace_id = c.workspace_id and e.source = 'subscription'),
  c.description || ' does not grant expired or ineligible access'
) from period_cases c order by case_number;

select ok(
  (select bool_and(e.effective_until is not distinct from c.period_end
                  and e.effective_from = least(now(), c.period_end))
   from public.entitlement_snapshots e
   where e.workspace_id = c.workspace_id and e.source = 'subscription'),
  c.description || ' preserves exact expiry with a valid interval'
) from period_cases c order by case_number;

select ok(
  (select s.status = c.status and s.plan_key = c.plan_key and s.currency = 'CAD'
          and s.cancel_at_period_end = c.cancel_at_period_end
          and s.current_period_end is not distinct from c.period_end
   from public.subscriptions s where s.workspace_id = c.workspace_id),
  c.description || ' retains the authoritative subscription mirror'
) from period_cases c order by case_number;

select is(
  (select processing_state from public.webhook_events
   where provider = 'stripe' and event_id = 'evt_expiry_' || case_number::text),
  'processed', description || ' is durably accepted'
) from period_cases order by case_number;

select ok(
  (select e.limit_value = d.limit_value and e.limit_unit = d.limit_unit
   from public.entitlement_snapshots e
   join public.plan_feature_defaults d on d.plan_key = c.plan_key and d.feature_key = e.feature_key
   where e.workspace_id = c.workspace_id and e.feature_key = 'convert.office.pdf.cloud'),
  c.description || ' keeps the configured Office quota'
) from period_cases c order by case_number;

select ok(
  (select e.limit_value = d.limit_value and e.limit_unit = d.limit_unit
   from public.entitlement_snapshots e
   join public.plan_feature_defaults d on d.plan_key = c.plan_key and d.feature_key = e.feature_key
   where e.workspace_id = c.workspace_id and e.feature_key = 'ocr.searchable.pdf.cloud'),
  c.description || ' keeps the configured OCR quota'
) from period_cases c order by case_number;

select throws_ok(
  format($sql$ select public.create_cloud_job_with_reservation(
    %L::uuid, %L::uuid, 'ocr.searchable.pdf', '0.1.0', '{"languages":["eng"]}'::jsonb,
    %L, 'ocr.searchable.pdf.cloud', 1, 'pages', to_char(now(), 'YYYY-MM'), now() + interval '1 hour'
  ) $sql$, workspace_id, owner_id, 'expiry-ocr-request-' || case_number::text),
  '42501', 'ENTITLEMENT_REQUIRED', description || ' denies a new OCR reservation'
) from period_cases where not expected_enabled order by case_number;

select throws_ok(
  format($sql$ select public.create_cloud_job_with_reservation(
    %L::uuid, %L::uuid, 'convert.office.pdf', '0.1.0', '{}'::jsonb,
    %L, 'convert.office.pdf.cloud', 1, 'jobs', to_char(now(), 'YYYY-MM'), now() + interval '1 hour'
  ) $sql$, workspace_id, owner_id, 'expiry-office-request-' || case_number::text),
  '42501', 'ENTITLEMENT_REQUIRED', description || ' denies a new Office reservation'
) from period_cases where not expected_enabled order by case_number;

select is((select count(*) from public.jobs where workspace_id in (select workspace_id from period_cases)),
          0::bigint, 'denied requests create no jobs');
select is((select count(*) from public.usage_ledger where workspace_id in (select workspace_id from period_cases)),
          0::bigint, 'denied requests reserve no usage');

reset role;
create temporary table saved_expiry_snapshots as
select * from public.entitlement_snapshots
where workspace_id = (select workspace_id from period_cases where case_number = 1);
create temporary table saved_expiry_subscription as
select * from public.subscriptions
where workspace_id = (select workspace_id from period_cases where case_number = 1);
grant select on saved_expiry_snapshots, saved_expiry_subscription to service_role;

set local role service_role;

select is(public.accept_stripe_subscription_event(
  'evt_expiry_1', 'customer.subscription.updated', now(),
  (select workspace_id from period_cases where case_number = 1),
  'cus_expiry_1', 'sub_expiry_1', 'active', 'pro_annual', 'cad',
  now() - interval '1 day', now() + interval '30 days', false
), 'duplicate', 'duplicate event cannot reactivate an expired subscription');

select is(public.accept_stripe_subscription_event(
  'evt_expiry_stale', 'customer.subscription.updated', now() - interval '3 minutes',
  (select workspace_id from period_cases where case_number = 1),
  'cus_expiry_1', 'sub_expiry_1', 'active', 'pro_annual', 'cad',
  now() - interval '1 day', now() + interval '30 days', false
), 'stale', 'older event cannot reactivate an expired subscription');

select ok(
  not exists (
    (select * from saved_expiry_snapshots except select * from public.entitlement_snapshots)
    union all
    (select * from public.entitlement_snapshots
     where workspace_id = (select workspace_id from period_cases where case_number = 1)
     except select * from saved_expiry_snapshots)
  ), 'duplicate and stale delivery preserve every snapshot field and revision'
);
select ok(
  not exists (
    (select * from saved_expiry_subscription except select * from public.subscriptions)
    union all
    (select * from public.subscriptions
     where workspace_id = (select workspace_id from period_cases where case_number = 1)
     except select * from saved_expiry_subscription)
  ), 'duplicate and stale delivery preserve every subscription field'
);
select is((select processing_state from public.webhook_events where provider = 'stripe' and event_id = 'evt_expiry_stale'),
          'ignored', 'stale event is durably ignored');

select is(public.accept_stripe_subscription_event(
  'evt_expiry_0_tie', 'customer.subscription.updated', now() - interval '2 minutes',
  (select workspace_id from period_cases where case_number = 1),
  'cus_expiry_1', 'sub_expiry_1', 'active', 'pro_monthly', 'cad',
  now() - interval '1 day', now() + interval '30 days', false
), 'stale', 'equal-time lower event ID remains stale');

select is(public.accept_stripe_subscription_event(
  'evt_expiry_z_tie', 'customer.subscription.deleted', now() - interval '2 minutes',
  (select workspace_id from period_cases where case_number = 1),
  'cus_expiry_1', 'sub_expiry_1', 'cancelled', 'pro_monthly', 'cad',
  now() - interval '30 days', now() - interval '1 day', false
), 'applied', 'equal-time higher event ID applies expired revocation');

select ok(
  (select bool_and(e.revision = old.revision + 1 and not e.enabled)
   from public.entitlement_snapshots e join saved_expiry_snapshots old
     on old.workspace_id = e.workspace_id and old.feature_key = e.feature_key
   where e.source = 'subscription'),
  'one applied revocation increments each subscription revision exactly once'
);

-- A later authoritative renewal can restore access; failure is not sticky.
select is(public.accept_stripe_subscription_event(
  'evt_expiry_renewal', 'invoice.paid', now() - interval '1 minute',
  (select workspace_id from period_cases where case_number = 1),
  'cus_expiry_1', 'sub_expiry_1', 'active', 'pro_monthly', 'cad',
  now() - interval '1 day', now() + interval '30 days', false
), 'applied', 'a later current-period renewal applies');
select ok(
  (select bool_and(enabled and effective_from = now() and effective_until = now() + interval '30 days')
   from public.entitlement_snapshots where source = 'subscription'
     and workspace_id = (select workspace_id from period_cases where case_number = 1)),
  'renewal restores bounded access without extending the provider expiry'
);

-- The unchanged period-order constraint must still reject malformed intervals.
select throws_ok(
  $$ update public.entitlement_snapshots set effective_from = now() + interval '31 days'
     where workspace_id = (select workspace_id from period_cases where case_number = 1)
       and feature_key = 'desktop.full' $$,
  '23514', null, 'invalid entitlement intervals remain rejected'
);
select throws_ok(
  $$ select public.accept_stripe_subscription_event(
    'evt_expiry_invalid', 'customer.subscription.updated', now(),
    (select workspace_id from period_cases where case_number = 1),
    'cus_expiry_1', 'sub_expiry_1', 'active', 'pro_monthly', 'cad',
    now() + interval '2 days', now() + interval '1 day', false
  ) $$,
  '23514', null, 'invalid provider period order remains rejected'
);
select is((select count(*) from public.webhook_events where provider = 'stripe' and event_id = 'evt_expiry_invalid'),
          0::bigint, 'invalid event rolls back durable acceptance for safe retry');

-- Office defaults now follow the existing operator-only configuration boundary.
update public.plan_feature_defaults set enabled = false, limit_value = 17
where plan_key = 'pro_monthly' and feature_key = 'convert.office.pdf.cloud';
update public.subscriptions set status = status
where workspace_id = (select workspace_id from period_cases where case_number = 1);
select ok(
  (select not enabled and limit_value = 17 and limit_unit = 'jobs'
   from public.entitlement_snapshots where feature_key = 'convert.office.pdf.cloud'
     and workspace_id = (select workspace_id from period_cases where case_number = 1)),
  'Office refresh respects operator disable and quota configuration'
);

delete from public.plan_feature_defaults
where plan_key = 'pro_monthly' and feature_key = 'convert.office.pdf.cloud';
select throws_ok(
  $$ select public.accept_stripe_subscription_event(
    'evt_expiry_missing_config', 'invoice.paid', now(),
    (select workspace_id from period_cases where case_number = 1),
    'cus_expiry_1', 'sub_expiry_1', 'active', 'pro_monthly', 'cad',
    now() - interval '1 day', now() + interval '30 days', false
  ) $$,
  'P0002', null, 'missing operator defaults fail closed instead of inventing access'
);
select is((select count(*) from public.webhook_events where provider = 'stripe' and event_id = 'evt_expiry_missing_config'),
          0::bigint, 'missing defaults roll back event acceptance for safe retry');
select is((select provider_event_id from public.subscriptions
           where workspace_id = (select workspace_id from period_cases where case_number = 1)),
          'evt_expiry_renewal', 'failed refresh leaves the prior subscription mirror intact');

reset role;
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"81111111-1111-4111-8111-111111111105","role":"authenticated"}';

select is((select count(*) from public.entitlement_snapshots
           where workspace_id = (select workspace_id from period_cases where case_number = 1)),
          0::bigint, 'another workspace cannot read renewed entitlements');
select is((select count(*) from public.subscriptions
           where workspace_id = (select workspace_id from period_cases where case_number = 1)),
          0::bigint, 'another workspace cannot read renewed subscription state');
select throws_ok(
  $$ select public.accept_stripe_subscription_event(
    'evt_expiry_forged', 'customer.subscription.updated', now(),
    (select workspace_id from period_cases where case_number = 1),
    'cus_expiry_1', 'sub_expiry_1', 'active', 'pro_monthly', 'cad',
    now() - interval '1 day', now() + interval '30 days', false
  ) $$,
  '42501', null, 'authenticated caller cannot forge another workspace billing event'
);
select throws_ok(
  $$ update public.entitlement_snapshots set enabled = true
     where workspace_id = (select workspace_id from period_cases where case_number = 2) $$,
  '42501', null, 'client cannot enable another workspace expired entitlement'
);
select throws_ok('select * from public.plan_feature_defaults', '42501', null,
                'client cannot inspect or modify operator quota defaults');

reset role;
set local role anon;
select throws_ok(
  $$ select public.accept_stripe_subscription_event(
    'evt_expiry_anon', 'customer.subscription.updated', now(),
    (select workspace_id from period_cases where case_number = 1),
    'cus_expiry_1', 'sub_expiry_1', 'active', 'pro_monthly', 'cad',
    now() - interval '1 day', now() + interval '30 days', false
  ) $$,
  '42501', null, 'anonymous caller cannot forge a billing event'
);
reset role;

select ok(
  (select bool_and(not prosecdef and proconfig @> array['search_path=""'])
   from pg_proc where oid in (
     'public.accept_stripe_subscription_event(text,text,timestamptz,uuid,text,text,text,text,text,timestamptz,timestamptz,boolean)'::regprocedure,
     'public.refresh_office_conversion_entitlement()'::regprocedure,
     'public.refresh_ocr_entitlement()'::regprocedure
   )), 'all replacement functions retain invoker security and an empty search path'
);
select ok(
  not has_function_privilege('authenticated', 'public.refresh_office_conversion_entitlement()', 'EXECUTE')
  and not has_function_privilege('anon', 'public.refresh_office_conversion_entitlement()', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.refresh_ocr_entitlement()', 'EXECUTE')
  and not has_function_privilege('anon', 'public.refresh_ocr_entitlement()', 'EXECUTE'),
  'neither entitlement trigger becomes client callable'
);

select * from finish();
rollback;
