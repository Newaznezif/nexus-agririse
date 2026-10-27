-- =========================================================================================
-- 20261026000200 — place registry and Ethiopian market price observations (WFP rEMS)
-- =========================================================================================
--
-- Applies cleanly to a project that has never had this pack, and again to one that has.
-- Creates no rows. Every write in the sync targets the natural keys defined here.

-- =========================================================================================
-- 1. data.location — the places the platform can talk about
-- =========================================================================================
--
-- Market centres, their region/zone labels and their coordinates come from WFP's Ethiopia
-- market reference table; `source_*` therefore describe where the COORDINATES came from,
-- not where a price came from. A location is separate from an observation because the same
-- town is priced by WFP, modelled by Open-Meteo, observed by NASA POWER and sampled from a
-- GIBS tile — four provenances that must never be merged into one "source" column.

create table if not exists data.location (
  location_key      text primary key,
  name              text not null check (btrim(name) <> ''),
  admin1            text,
  admin2            text,
  country           text not null default 'ET',
  latitude          double precision not null check (latitude  between -90  and 90),
  longitude         double precision not null check (longitude between -180 and 180),
  coordinate_source text not null
    check (coordinate_source in ('source-catalogue', 'user', 'default')),
  elevation_m       numeric(6, 2),
  timezone          text,
  source_id         text not null,
  source_name       text not null,
  source_url        text not null,
  license           text not null,
  methodology       text not null,
  retrieved_at      timestamptz not null default now(),
  record_added_at    timestamptz not null default now(),
  record_replaced_at timestamptz not null default now()
);

comment on table data.location is
  'Selectable places, with the coordinates'' own provenance. Populated from WFP''s published market reference table; a farmer-typed point is stored only after it is validated and is labelled coordinate_source = ''user''.';
comment on column data.location.location_key is
  'Stable id used by every observation table. Format: ''wfp-market:<marketId>'' for publisher catalogue points, ''user:<lat>,<lon>'' for a point someone typed.';
comment on column data.location.coordinate_source is
  'source-catalogue = the publisher states these coordinates. user = a person typed them, so the accuracy of the pin is theirs, not ours. default = our fallback (Addis Ababa).';

create index if not exists location_admin1_idx on data.location (admin1);

drop trigger if exists location_touch on data.location;
create trigger location_touch
  before update on data.location
  for each row execute function data.touch_replaced_at();

-- =========================================================================================
-- 2. data.market_price_observations — the survey rows, as published
-- =========================================================================================
--
-- Source: WFP Ethiopia Food Prices (rEMS), via HDX, CC BY-IGO. One row is one price for
-- one commodity in one market for one survey month, in the publisher's own unit and
-- currency. Nothing here is converted, deflated, annualised or blended: `price` is the
-- figure the publisher printed and `unit` says what it is per.

create table if not exists data.market_price_observations (
  observation_id  bigint generated always as identity primary key,
  -- identity (a price is only unique within a source, market, commodity, unit, channel and month)
  source_id       text not null,
  market          text not null,
  market_id       text,
  -- Some WFP rows carry no market id. `coalesce(market_id, market)` is the identity, and it
  -- is materialised as a stored generated column because PostgREST's `upsert?on_conflict=`
  -- can only name plain columns, not an index expression. One column, one truth: the sync
  -- cannot disagree with the index about what makes a price row the same price.
  market_key      text generated always as (coalesce(market_id, market)) stored,
  admin1          text,
  admin2          text,
  commodity       text not null,
  commodity_category text,
  unit            text not null,
  currency        text not null,
  retail          text not null
    check (retail in ('Retail', 'Wholesale', 'aggregate', 'unknown')),
  observed_on     date not null,
  -- the figure itself
  price           numeric(15, 4) check (price is null or price >= 0),
  -- Kept separate from `price`: the publisher's own USD conversion, never ours. A null
  -- means the publisher published none, and the UI must then show ETB only.
  usd_price       numeric(15, 4) check (usd_price is null or usd_price >= 0),
  price_flag      text not null default 'actual'
    check (price_flag in ('actual', 'aggregate', 'replaced', 'unknown')),
  value_kind      data.value_kind not null default 'observed',
  -- provenance
  source_name     text not null,
  source_url      text not null,
  license         text not null,
  method_url      text,
  units           text not null,
  methodology     text not null,
  coverage        text not null,
  quality         data.quality not null default 'high',
  retrieved_at    timestamptz not null default now(),
  record_added_at    timestamptz not null default now(),
  record_replaced_at timestamptz not null default now()
);

comment on table data.market_price_observations is
  'Ethiopian market prices exactly as WFP''s rEMS survey published them: ETB (or the stated currency) per the stated unit, per market, per survey month. This is the only place in the database where an Ethiopian market price lives; international reference prices are kept in separate, differently-labelled tables and must never be written here.';
comment on column data.market_price_observations.unit is
  'The publisher''s own unit string, e.g. ''100 KG'' or ''KG''. Never normalised into another column: a "price" without its unit cannot be compared across markets.';
comment on column data.market_price_observations.retail is
  'Survey channel as published. Retail and wholesale prices of the same commodity in the same market are different facts and are kept as different rows.';
comment on column data.market_price_observations.usd_price is
  'Only a conversion the PUBLISHER printed. It is never computed here, because a conversion needs a dated rate and a unit decision that this table does not own.';
comment on column data.market_price_observations.price_flag is
  'The publisher''s own quality marker: actual = surveyed; aggregate = rolled up from other markets; replaced = substituted for a missing survey. A ''replaced'' figure must not be shown as a measurement.';

-- The index names `market_key`, not `coalesce(market_id, market)`, even though the two are
-- the same expression. `ON CONFLICT (source_id, market_key, …)` only matches an index over
-- that COLUMN; an expression index is a different index for conflict-target purposes, so
-- naming the expression here would make the sync's very first upsert fail with
-- "no unique or exclusion constraint matching the ON CONFLICT specification".
create unique index if not exists market_price_observations_key_uid
  on data.market_price_observations (
    source_id,
    market_key,
    commodity,
    unit,
    currency,
    retail,
    observed_on
  );

create index if not exists market_price_observed_on_idx
  on data.market_price_observations (observed_on desc);
create index if not exists market_price_commodity_month_idx
  on data.market_price_observations (commodity, observed_on desc);
create index if not exists market_price_region_month_idx
  on data.market_price_observations (admin1, observed_on desc);

drop trigger if exists market_price_touch on data.market_price_observations;
create trigger market_price_touch
  before update on data.market_price_observations
  for each row execute function data.touch_replaced_at();

-- =========================================================================================
-- 3. data.market_monthly_summary — month-on-month movement, stored as derived
-- =========================================================================================
--
-- Cross-market change is the number farmers actually ask for, and it is the easiest one to
-- fabricate. Storing it with its own `value_kind = ''estimated''` and the two observation
-- dates it used means it can never be mistaken for a published figure, and a consumer does
-- not have to re-derive it (and get a different answer) to show it.
--
-- STATUS: this table has no writer yet. `lib/data/sync.ts` populates
-- `data.market_price_observations` only; the month-on-month figures the dashboard renders
-- are derived per request in `lib/data/wfpMarketPrices.ts` from those observation rows, with
-- the same rule this table encodes (no earlier observation ⇒ no percentage, never 0). The
-- table is created here so the derived figures have a provenance-correct home once a task
-- writes them; until then it stays empty, and nothing may report a row count for it.

create table if not exists data.market_monthly_summary (
  summary_id         bigint generated always as identity primary key,
  source_id          text not null,
  commodity          text not null,
  market             text not null,
  unit               text not null,
  currency           text not null,
  retail             text not null,
  observed_on        date not null,
  price              numeric(15, 4) check (price is null or price >= 0),
  previous_observed_on date,
  previous_price     numeric(15, 4) check (previous_price is null or previous_price >= 0),
  change_pct         numeric(9, 3),
  observations       integer not null default 0 check (observations >= 0),
  value_kind         data.value_kind not null default 'estimated',
  source_name        text not null,
  source_url         text not null,
  methodology        text not null,
  retrieved_at       timestamptz not null default now(),
  record_added_at    timestamptz not null default now(),
  record_replaced_at timestamptz not null default now(),
  -- A percentage is meaningless without a second observation to compare with.
  check (change_pct is null or (previous_observed_on is not null and previous_price is not null))
);

comment on table data.market_monthly_summary is
  'Derived movement per commodity/market/unit/month. value_kind is ''estimated'' because no publisher publishes it: it comes from two rows of data.market_price_observations. See this section''s header — no sync task writes this table yet, so it is empty until a writer is added.';
comment on column data.market_monthly_summary.change_pct is
  'Null unless the same market+commodity+unit has an earlier published observation. Never filled with 0: "no comparable previous month" and "no change" are different statements.';

create unique index if not exists market_monthly_summary_key_uid
  on data.market_monthly_summary (source_id, commodity, market, unit, currency, retail, observed_on);

drop trigger if exists market_summary_touch on data.market_monthly_summary;
create trigger market_summary_touch
  before update on data.market_monthly_summary
  for each row execute function data.touch_replaced_at();

-- =========================================================================================
-- 4. Row-level security: deny everything, then grant nothing to anon/authenticated
-- =========================================================================================
--
-- `security_invoker = false` does NOT mean readable. With RLS enabled and no policy, every
-- role that is not the owner and does not hold `bypassrls` reads zero rows. Supabase's
-- `service_role` has `bypassrls`, so the sync (which authenticates with the service key,
-- server-side only) can write; `anon` and `authenticated` cannot read or write any row of
-- this table. The pre-flight query in the README confirms `bypassrls` on the live project
-- before this pack is applied — if the role lacks it, the sync's writes fail loudly rather
-- than silently storing nothing.

alter table data.location                 enable row level security;
alter table data.market_price_observations enable row level security;
alter table data.market_monthly_summary    enable row level security;

alter table data.location                 force row level security;
alter table data.market_price_observations force row level security;
alter table data.market_monthly_summary    force row level security;

comment on table data.location is 'RLS enabled and forced with no policies: readable only by the table owner or a bypassrls role. No anon/authenticated access.';
comment on table data.market_price_observations is 'RLS enabled and forced with no policies: readable only by the table owner or a bypassrls role. No anon/authenticated access.';
comment on table data.market_monthly_summary is 'RLS enabled and forced with no policies: readable only by the table owner or a bypassrls role. No anon/authenticated access.';

-- Belt and braces: revoke DDL-shaped privileges from the anonymous API roles outright, in
-- case a project has a permissive default-grant template. `usage` on the schema is
-- deliberately NOT granted to anon: no API role should be able to name these tables.
revoke all on data.location                    from anon, authenticated;
revoke all on data.market_price_observations   from anon, authenticated;
revoke all on data.market_monthly_summary      from anon, authenticated;
