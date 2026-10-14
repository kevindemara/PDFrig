-- CONV-002 / CONV-003 / CONV-004 / OCR-001: preserve provider expiry when
-- delayed events arrive after a subscription period. See ADR 0048.
-- No applied migration, entitlement constraint, RLS policy, or default quota is changed.

create or replace function public.accept_stripe_subscription_event(
  stripe_event_id text,
  stripe_event_type text,
  stripe_event_created_at timestamptz,
  target_workspace_id uuid,
  stripe_customer_id text,
  stripe_subscription_id text,
  normalized_status text,
  internal_plan_key text,
  subscription_currency text,
  period_start timestamptz,
  period_end timestamptz,
  ends_at_period_end boolean
)
returns text
language plpgsql
security invoker
set search_path = ''
as $$
declare
  inserted_event_count integer;
  subscription_event boolean;
  applied_subscription_count integer := 0;
  access_enabled boolean;
begin
  insert into public.webhook_events (
    provider, event_id, event_type, created_at_provider, processing_state
  ) values (
    'stripe', stripe_event_id, stripe_event_type, stripe_event_created_at, 'received'
  ) on conflict (provider, event_id) do nothing;
  get diagnostics inserted_event_count = row_count;

  if inserted_event_count = 0 then
    return 'duplicate';
  end if;

  subscription_event := stripe_event_type in (
    'customer.subscription.created', 'customer.subscription.updated',
    'customer.subscription.deleted', 'invoice.paid', 'invoice.payment_failed'
  );

  if subscription_event then
    insert into public.subscriptions (
      workspace_id, provider_customer_id, provider_subscription_id, status, plan_key,
      currency, current_period_start, current_period_end, cancel_at_period_end,
      provider_updated_at, provider_event_id
    ) values (
      target_workspace_id, stripe_customer_id, stripe_subscription_id, normalized_status,
      internal_plan_key, upper(subscription_currency), period_start, period_end,
      ends_at_period_end, stripe_event_created_at, stripe_event_id
    )
    on conflict (workspace_id) do update set
      provider_customer_id = excluded.provider_customer_id,
      provider_subscription_id = excluded.provider_subscription_id,
      status = excluded.status,
      plan_key = excluded.plan_key,
      currency = excluded.currency,
      current_period_start = excluded.current_period_start,
      current_period_end = excluded.current_period_end,
      cancel_at_period_end = excluded.cancel_at_period_end,
      provider_updated_at = excluded.provider_updated_at,
      provider_event_id = excluded.provider_event_id
    where subscriptions.provider_updated_at is null
      or subscriptions.provider_updated_at < excluded.provider_updated_at
      or (
        subscriptions.provider_updated_at = excluded.provider_updated_at
        and coalesce(subscriptions.provider_event_id, '') < excluded.provider_event_id
      );
    get diagnostics applied_subscription_count = row_count;

    if applied_subscription_count = 1 then
      access_enabled := normalized_status in ('active', 'trialing')
        and (period_end is null or period_end > now());
      insert into public.entitlement_snapshots (
        workspace_id, feature_key, enabled, source, effective_from, effective_until, revision
      ) values
        (target_workspace_id, 'desktop.full', access_enabled, 'subscription', least(now(), period_end), period_end, 1),
        (target_workspace_id, 'history.extended', access_enabled, 'subscription', least(now(), period_end), period_end, 1)
      on conflict (workspace_id, feature_key) do update set
        enabled = excluded.enabled,
        source = excluded.source,
        effective_from = excluded.effective_from,
        effective_until = excluded.effective_until,
        revision = entitlement_snapshots.revision + 1;
    end if;
  end if;

  update public.webhook_events
  set
    processing_state = case
      when not subscription_event then 'ignored'
      when applied_subscription_count = 1 then 'processed'
      else 'ignored'
    end,
    processed_at = now()
  where provider = 'stripe' and event_id = stripe_event_id;

  return case
    when not subscription_event then 'ignored'
    when applied_subscription_count = 1 then 'applied'
    else 'stale'
  end;
end;
$$;

revoke all on function public.accept_stripe_subscription_event(
  text, text, timestamptz, uuid, text, text, text, text, text, timestamptz, timestamptz, boolean
) from public, anon, authenticated;

grant execute on function public.accept_stripe_subscription_event(
  text, text, timestamptz, uuid, text, text, text, text, text, timestamptz, timestamptz, boolean
) to service_role;

-- Move the existing Office defaults into the trusted operator catalogue, without
-- overwriting any operator-owned rows or adding a new quota policy.
insert into public.plan_feature_defaults (
  plan_key, feature_key, enabled, limit_value, limit_unit
) values
  ('free', 'convert.office.pdf.cloud', false, 20, 'jobs'),
  ('pro_monthly', 'convert.office.pdf.cloud', true, 20, 'jobs'),
  ('pro_annual', 'convert.office.pdf.cloud', true, 20, 'jobs')
on conflict (plan_key, feature_key) do nothing;

create or replace function public.refresh_office_conversion_entitlement()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  configured public.plan_feature_defaults%rowtype;
begin
  select * into strict configured
  from public.plan_feature_defaults
  where plan_key = new.plan_key
    and feature_key = 'convert.office.pdf.cloud';

  insert into public.entitlement_snapshots (
    workspace_id, feature_key, enabled, limit_value, limit_unit, source,
    effective_from, effective_until, revision
  ) values (
    new.workspace_id, configured.feature_key,
    configured.enabled and new.status in ('active', 'trialing')
      and (new.current_period_end is null or new.current_period_end > now()),
    configured.limit_value, configured.limit_unit,
    'subscription', least(now(), new.current_period_end), new.current_period_end, 1
  )
  on conflict (workspace_id, feature_key) do update set
    enabled = excluded.enabled,
    limit_value = excluded.limit_value,
    limit_unit = excluded.limit_unit,
    source = excluded.source,
    effective_from = excluded.effective_from,
    effective_until = excluded.effective_until,
    revision = entitlement_snapshots.revision + 1;

  return new;
end;
$$;

revoke all on function public.refresh_office_conversion_entitlement()
  from public, anon, authenticated;

create or replace function public.refresh_ocr_entitlement()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  configured public.plan_feature_defaults%rowtype;
begin
  select * into strict configured
  from public.plan_feature_defaults
  where plan_key = new.plan_key
    and feature_key = 'ocr.searchable.pdf.cloud';

  insert into public.entitlement_snapshots (
    workspace_id, feature_key, enabled, limit_value, limit_unit, source,
    effective_from, effective_until, revision
  ) values (
    new.workspace_id,
    configured.feature_key,
    configured.enabled and new.status in ('active', 'trialing')
      and (new.current_period_end is null or new.current_period_end > now()),
    configured.limit_value,
    configured.limit_unit,
    'subscription',
    least(now(), new.current_period_end),
    new.current_period_end,
    1
  )
  on conflict (workspace_id, feature_key) do update set
    enabled = excluded.enabled,
    limit_value = excluded.limit_value,
    limit_unit = excluded.limit_unit,
    source = excluded.source,
    effective_from = excluded.effective_from,
    effective_until = excluded.effective_until,
    revision = entitlement_snapshots.revision + 1;

  return new;
end;
$$;

revoke all on function public.refresh_ocr_entitlement() from public, anon, authenticated;
