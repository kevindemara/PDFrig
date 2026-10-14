create table public.plan_feature_defaults (
  plan_key text not null check (plan_key in ('free', 'pro_monthly', 'pro_annual')),
  feature_key text not null check (feature_key ~ '^[a-z][a-z0-9]*(\.[a-z0-9]+)*$'),
  enabled boolean not null,
  limit_value bigint check (limit_value is null or limit_value >= 0),
  limit_unit text check (limit_unit is null or limit_unit in ('jobs', 'pages', 'bytes')),
  updated_at timestamptz not null default now(),
  primary key (plan_key, feature_key),
  check ((limit_value is null) = (limit_unit is null))
);

comment on table public.plan_feature_defaults is
  'Operator-managed entitlement catalogue. Product limits are data, never browser or worker constants.';

alter table public.plan_feature_defaults enable row level security;
revoke all on table public.plan_feature_defaults from public, anon, authenticated;
grant select, insert, update, delete on table public.plan_feature_defaults to service_role;

insert into public.plan_feature_defaults (
  plan_key, feature_key, enabled, limit_value, limit_unit
) values
  ('free', 'ocr.searchable.pdf.cloud', false, 0, 'pages'),
  ('pro_monthly', 'ocr.searchable.pdf.cloud', true, 200, 'pages'),
  ('pro_annual', 'ocr.searchable.pdf.cloud', true, 200, 'pages');

create function public.refresh_ocr_entitlement()
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
    configured.enabled and new.status in ('active', 'trialing'),
    configured.limit_value,
    configured.limit_unit,
    'subscription',
    now(),
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

create trigger subscriptions_refresh_ocr_entitlement
  after insert or update of status, plan_key, current_period_end on public.subscriptions
  for each row execute function public.refresh_ocr_entitlement();

insert into public.entitlement_snapshots (
  workspace_id, feature_key, enabled, limit_value, limit_unit, source,
  effective_from, effective_until, revision
)
select
  subscriptions.workspace_id,
  defaults.feature_key,
  defaults.enabled and subscriptions.status in ('active', 'trialing'),
  defaults.limit_value,
  defaults.limit_unit,
  'subscription',
  now(),
  subscriptions.current_period_end,
  1
from public.subscriptions subscriptions
join public.plan_feature_defaults defaults
  on defaults.plan_key = subscriptions.plan_key
 and defaults.feature_key = 'ocr.searchable.pdf.cloud'
on conflict (workspace_id, feature_key) do update set
  enabled = excluded.enabled,
  limit_value = excluded.limit_value,
  limit_unit = excluded.limit_unit,
  source = excluded.source,
  effective_from = excluded.effective_from,
  effective_until = excluded.effective_until,
  revision = entitlement_snapshots.revision + 1;
