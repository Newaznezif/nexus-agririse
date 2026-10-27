-- =========================================================================================
-- 20261026000400 — dated exchange-rate history and economic indicator series
-- =========================================================================================
--
-- Why a new table for rates: `public.exchange_rates` (created by
-- `harvester/setup_normalization.sql`) is declared `currency_code text primary key`, so it
-- physically cannot hold a series — one row per currency, latest value only, `updated_at`
-- describing the cache rather than the publication. That is fine for the legacy
-- `unified_market_intel` view, which needs one scalar multiplier. It is not fine for a
-- farmer asking "what was the official rate on 12 August?", and it is why this file adds a
-- history table instead of pretending the snapshot is one.
--
-- `public.exchange_rates` is NOT modified and NOT written by the sync: the legacy view's
-- CASE resolves `rate_to_usd` from it by currency code, and writing an NBE "ETB per US$"
-- figure into a `rate_to_usd` column would invert the very conversion the view performs.
-- The snapshot stays owned by the legacy harvester.

-- =========================================================================================
-- 1. data.exchange_rate_observations
-- =========================================================================================
--
-- One row per (source, date, currency). Three publishers, three clearly different kinds of
-- figure, distinguished by `source_id` + `rate_kind` and never blended:
--
--   nbe-indicative-rates        official NBE daily indicative rate, ETB per 1 US$
--                               (a reference rate the central bank publishes per date)
--   worldbank-realtime-prices   World Bank monthly national "Market Average" parallel
--                               rate, ETB per 1 US$ (a survey of the unofficial market)
--   (reserved)                  any further dated rate series the project later earns
--
-- A UI may plot these two lines on the same axis ONLY with two legends and two dates; the
-- `rate_kind` column exists so the pairing is explicit and cannot be collapsed.

create table if not exists data.exchange_rate_observations (
  rate_id        bigint generated always as identity primary key,
  source_id      text not null,
  observed_on    date not null,
  currency_code  text not null,
  currency_name  text,
  quote          text not null default 'ETB per 1 unit',
  -- Exactly one of the three published figures must be present; a row of three nulls is a
  -- failed parse, not a zero rate.
  value          numeric(18, 6) check (value is null or value > 0),
  buying_rate    numeric(18, 6) check (buying_rate is null or buying_rate > 0),
  selling_rate   numeric(18, 6) check (selling_rate is null or selling_rate > 0),
  rate_kind      text not null
    check (rate_kind in ('official-indicative', 'unofficial-market-average', 'other')),
  frequency      text not null
    check (frequency in ('daily', 'weekly', 'monthly', 'quarterly', 'annual', 'irregular')),
  value_kind     data.value_kind not null default 'observed',
  -- provenance
  source_name    text not null,
  source_url     text not null,
  license        text not null,
  method_url     text,
  units          text not null,
  methodology    text not null,
  coverage       text not null,
  quality        data.quality not null default 'high',
  retrieved_at   timestamptz not null default now(),
  record_added_at    timestamptz not null default now(),
  record_replaced_at timestamptz not null default now(),
  constraint exchange_rate_has_a_figure check (
    coalesce(value, buying_rate, selling_rate) is not null
  ),
  -- The publisher's cadence is stored with the row so nothing can present a monthly survey
  -- as a daily price or an annual benchmark as "current".
  constraint exchange_rate_kind_matches_frequency check (
    (rate_kind = 'official-indicative'        and frequency = 'daily')
    or (rate_kind = 'unofficial-market-average' and frequency = 'monthly')
    or (rate_kind = 'other')
  )
);

comment on table data.exchange_rate_observations is
  'Dated exchange-rate history. Official NBE indicative rates and the World Bank monthly unofficial average are stored as separate source rows; a chart that shows both must label both, because they measure different markets.';
comment on column data.exchange_rate_observations.value is
  'The published weighted-average / mid rate for that date, in the units column. Never converted here: a conversion would need a dated rate, which is the thing being stored.';
comment on column data.exchange_rate_observations.frequency is
  'The cadence the PUBLISHER actually uses. This is the column that makes "do not present monthly data as real-time" enforceable in the UI rather than a convention.';
comment on column data.exchange_rate_observations.rate_kind is
  'official-indicative = NBE reference rate. unofficial-market-average = surveyed parallel rate. The two are never averaged, differenced or shown as one series.';

create unique index if not exists exchange_rate_source_date_currency_uid
  on data.exchange_rate_observations (source_id, observed_on, currency_code);

create index if not exists exchange_rate_currency_date_idx
  on data.exchange_rate_observations (currency_code, observed_on desc);

drop trigger if exists exchange_rate_touch on data.exchange_rate_observations;
create trigger exchange_rate_touch
  before update on data.exchange_rate_observations
  for each row execute function data.touch_replaced_at();

-- =========================================================================================
-- 2. data.latest_exchange_rates — a snapshot built from history, not maintained beside it
-- =========================================================================================
--
-- The legacy pattern (write a snapshot row AND a history row, keep them consistent) fails
-- whenever one write succeeds and the other does not. This view derives the snapshot from
-- the history, so it cannot drift.

create or replace view data.latest_exchange_rates as
select distinct on (o.source_id, o.currency_code)
  o.source_id,
  o.currency_code,
  o.currency_name,
  o.observed_on,
  o.value,
  o.buying_rate,
  o.selling_rate,
  o.rate_kind,
  o.frequency,
  o.units,
  o.value_kind,
  o.source_name,
  o.source_url,
  o.license,
  o.methodology,
  o.coverage,
  o.quality,
  o.retrieved_at
from data.exchange_rate_observations o
order by o.source_id, o.currency_code, o.observed_on desc, o.rate_id desc;

comment on view data.latest_exchange_rates is
  'Newest dated row per source+currency. Derived, so a "current official rate" card is always the same figure the history table holds for that date, with its date attached.';

-- =========================================================================================
-- 3. data.economic_indicator_observations — annual/monthly macro context
-- =========================================================================================
--
-- Inflation, agriculture value added, food CPI: published with a lag of months to years.
-- These are the numbers most often mislabelled as live on agricultural dashboards, so the
-- series stores its frequency, its period, and the publisher's own revision note.

create table if not exists data.economic_indicator_observations (
  indicator_id   bigint generated always as identity primary key,
  source_id      text not null,
  indicator_code text not null,
  indicator_name text not null,
  frequency      text not null
    check (frequency in ('daily', 'weekly', 'monthly', 'quarterly', 'annual')),
  period         text not null,
  value          numeric(20, 6),
  units          text not null,
  value_kind     data.value_kind not null default 'observed',
  -- provenance
  source_name    text not null,
  source_url     text not null,
  license        text not null,
  method_url     text,
  methodology    text not null,
  coverage       text not null,
  quality        data.quality not null default 'medium',
  retrieved_at   timestamptz not null default now(),
  record_added_at    timestamptz not null default now(),
  record_replaced_at timestamptz not null default now(),
  -- '2024' for annual, '2026-08' for monthly: the period is the observation date, so it
  -- must be a real one rather than an empty string standing in for "unknown".
  constraint economic_indicator_period_shape check (
    (frequency = 'annual'  and period ~ '^[0-9]{4}$')
    or (frequency = 'monthly'  and period ~ '^[0-9]{4}-[0-9]{2}$')
    or (frequency in ('weekly', 'quarterly', 'daily'))
  )
);

comment on table data.economic_indicator_observations is
  'World Bank development indicators for Ethiopia (and any other official macro series the project adopts), one row per indicator per period. value_kind is usually ''observed'' for a national statistic and ''estimated'' where the publisher flags it as modeled or staff-estimated.';
comment on column data.economic_indicator_observations.period is
  'The statistical period the figure describes, e.g. 2024 or 2026-08. It is NOT a publication date: an annual figure for 2024 may be published in 2025, and the UI must show the period while labelling the frequency.';
comment on column data.economic_indicator_observations.value is
  'Nullable: a publisher gap is stored as a missing value, never as 0 and never interpolated. Absence must stay visible.';

create unique index if not exists economic_indicator_source_code_period_uid
  on data.economic_indicator_observations (source_id, indicator_code, period);

create index if not exists economic_indicator_code_idx
  on data.economic_indicator_observations (indicator_code, period desc);

drop trigger if exists economic_indicator_touch on data.economic_indicator_observations;
create trigger economic_indicator_touch
  before update on data.economic_indicator_observations
  for each row execute function data.touch_replaced_at();

-- =========================================================================================
-- 4. data.v_indicator_latest — "most recent published value" without pretending currency
-- =========================================================================================

create or replace view data.v_indicator_latest as
select distinct on (i.source_id, i.indicator_code)
  i.source_id,
  i.indicator_code,
  i.indicator_name,
  i.frequency,
  i.period,
  i.value,
  i.units,
  i.value_kind,
  i.source_name,
  i.source_url,
  i.license,
  i.methodology,
  i.coverage,
  i.quality,
  i.retrieved_at
from data.economic_indicator_observations i
order by i.source_id, i.indicator_code, i.period desc, i.indicator_id desc;

comment on view data.v_indicator_latest is
  'Newest published period per indicator, WITH its frequency and period attached, so a card can never render an annual statistic as a live number.';

-- =========================================================================================
-- 5. Security
-- =========================================================================================

alter table data.exchange_rate_observations      enable row level security;
alter table data.economic_indicator_observations enable row level security;
alter table data.exchange_rate_observations      force row level security;
alter table data.economic_indicator_observations force row level security;

revoke all on data.exchange_rate_observations      from anon, authenticated;
revoke all on data.economic_indicator_observations from anon, authenticated;
-- Views are revoked from the API roles AND created with `security_invoker = true` (see
-- file 0003 for the flag applied to every view in this pack). Without that flag a plain
-- view executes as its owner, so `data.latest_exchange_rates` would be an anonymous back
-- door around the table-level RLS below — `revoke` alone is not enough on Supabase, where
-- the API role can still reach objects the owner granted via schema usage defaults.
alter view data.latest_exchange_rates  set (security_invoker = true);
alter view data.v_indicator_latest    set (security_invoker = true);
revoke all on data.latest_exchange_rates from anon, authenticated;
revoke all on data.v_indicator_latest    from anon, authenticated;

comment on table data.exchange_rate_observations is 'RLS enabled and forced with no policies: readable only by the table owner or a bypassrls role. No anon/authenticated access.';
comment on table data.economic_indicator_observations is 'RLS enabled and forced with no policies: readable only by the table owner or a bypassrls role. No anon/authenticated access.';
