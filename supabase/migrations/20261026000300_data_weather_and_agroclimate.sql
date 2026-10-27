-- =========================================================================================
-- 20261026000300 — daily climate / agroclimatology per place, and the legacy mirror
-- =========================================================================================
--
-- Two publishers answer for the same town on the same day and they are NOT the same kind
-- of number:
--
--   open-meteo-forecast  model output + station analysis, includes future days
--   nasa-power           satellite/reanalysis-derived agroclimatology, past days only
--
-- They are stored as separate rows keyed by source, so a consumer can always say which
-- publisher produced a figure. `public.environmental_data` (created by
-- `harvester/setup_env.sql`) is then refreshed from ONE designated source per day, so the
-- row a legacy consumer reads has a single, truthful provenance instead of whichever
-- pipeline happened to write last. That designated source is Open-Meteo's past-day analysis;
-- NASA POWER never touches the legacy table. Creates no rows.

-- =========================================================================================
-- 1. data.daily_climate — one row per (source, place, day)
-- =========================================================================================

create table if not exists data.daily_climate (
  climate_id      bigint generated always as identity primary key,
  source_id       text not null,
  location_key    text not null references data.location (location_key),
  climate_date    date not null,
  is_forecast     boolean not null default false,
  -- precipitation and temperature
  precipitation_mm               numeric(7, 2) check (precipitation_mm is null or precipitation_mm >= 0),
  precipitation_probability_pct  numeric(4, 1) check (precipitation_probability_pct is null or (precipitation_probability_pct between 0 and 100)),
  temperature_max_c              numeric(5, 2),
  temperature_min_c              numeric(5, 2),
  temperature_mean_c             numeric(5, 2),
  relative_humidity_pct          numeric(4, 1) check (relative_humidity_pct is null or (relative_humidity_pct between 0 and 100)),
  wind_speed_max_kmh             numeric(6, 2) check (wind_speed_max_kmh is null or wind_speed_max_kmh >= 0),
  wind_speed_ms                  numeric(6, 2) check (wind_speed_ms is null or wind_speed_ms >= 0),
  -- the two figures an Ethiopian farm decision actually turns on
  et0_mm                         numeric(7, 3) check (et0_mm is null or et0_mm >= 0),
  shortwave_radiation_mj_per_m2  numeric(7, 3) check (shortwave_radiation_mj_per_m2 is null or shortwave_radiation_mj_per_m2 >= 0),
  value_kind     data.value_kind not null,
  -- provenance
  source_name    text not null,
  source_url     text not null,
  license        text not null,
  method_url     text,
  units          text not null,
  methodology    text not null,
  coverage       text not null,
  quality        data.quality not null default 'medium',
  observed_at    timestamptz,
  retrieved_at   timestamptz not null default now(),
  record_added_at    timestamptz not null default now(),
  record_replaced_at timestamptz not null default now(),
  -- A row whose every numeric column is null would be stored as "data", so at least one
  -- figure must be present.
  --
  -- `is_forecast` vs the calendar is deliberately NOT a CHECK constraint. A constraint on
  -- `current_date` would be volatile, and worse would start rejecting (and make
  -- un-updatable) perfectly legitimate rows as time passes: a forecast written last week
  -- for a date that has since arrived is still a valid historical record of what was
  -- forecast. The invariant is enforced where it belongs, at write time in the sync, and
  -- asserted in scripts/check-data-routes.mjs.
  constraint daily_climate_has_a_value check (
    coalesce(precipitation_mm, temperature_max_c, temperature_min_c, et0_mm,
             shortwave_radiation_mj_per_m2) is not null
  )
);

comment on table data.daily_climate is
  'Daily weather and agroclimatology per place, one row per publisher per day. Open-Meteo and NASA POWER are kept as separate rows because they disagree by design: one is a model/analysis blend with forecasts, the other is satellite-derived agroclimatology. Averaging them would produce a number no publisher stands behind.';
comment on column data.daily_climate.is_forecast is
  'True when the date is in the future, i.e. every figure in the row is a forecast rather than an observation. Drives the Observed/Forecast badge; a row must never be relabelled by the UI.';
comment on column data.daily_climate.et0_mm is
  'FAO-56 reference evapotranspiration in mm for the day. A reference-crop demand figure, NOT measured crop water use of any specific field.';
comment on column data.daily_climate.shortwave_radiation_mj_per_m2 is
  'All-sky surface shortwave downward radiation (NASA POWER ALLSKY_SFC_SW_DWN), MJ/m2/day. Radiation availability, not a measurement of canopy or soil.';
comment on column data.daily_climate.precipitation_probability_pct is
  'The publisher''s own maximum probability across the day. Present only for forecast rows; a null means the publisher does not publish it, not 0%.';
comment on column data.daily_climate.units is
  'A single string naming the unit of every numeric column in the row (mm, degC, %, km/h, MJ/m2). Kept on the row because the publisher''s units are the only ones ever stored here.';
comment on column data.daily_climate.observed_at is
  'UNUSED by the current sync, and deliberately left null: the observation time of a daily row IS climate_date, and a connector''s provenance carries only the newest date of the whole fetch. Staleness for this table must be judged from climate_date plus the source''s cadence, never from this column.';

create unique index if not exists daily_climate_source_place_date_uid
  on data.daily_climate (source_id, location_key, climate_date);

create index if not exists daily_climate_place_date_idx
  on data.daily_climate (location_key, climate_date desc);
create index if not exists daily_climate_date_idx
  on data.daily_climate (climate_date desc);

drop trigger if exists daily_climate_touch on data.daily_climate;
create trigger daily_climate_touch
  before update on data.daily_climate
  for each row execute function data.touch_replaced_at();

-- =========================================================================================
-- 2. Additive provenance and agrometeorology columns on public.environmental_data
-- =========================================================================================
--
-- All nullable, all `add column if not exists`: the legacy harvester keeps inserting its
-- own rows without them and nothing that reads the table today changes behaviour. This is
-- what lets the existing (unverified) consumers tell an observation from a model instead
-- of guessing from a column name.
--
-- This table was NOT created by this repository, and the script that claims to create it
-- (`harvester/setup_env.sql`) declares `id bigserial primary key`. The production table
-- inspected by the read-only pre-flight (README section 2) is:
--
--   id uuid not null default gen_random_uuid()   -- not bigint
--   location_name text not null, date date not null
--   rainfall_mm / soil_moisture_pct / temp_max / ndvi_index numeric
--   climate_risk_score integer
--   created_at timestamptz default CURRENT_TIMESTAMP
--   a unique constraint on (location_name, date) already present
--
-- `uuid` is a finding about one project, not a type to bake into application logic or into
-- the next migration. The mirror payload contains no `id`, which is safe for either shape
-- so long as `id` carries a default, so the guard below asserts exactly that and nothing
-- about which type it is. If the real table differs in a way that would make the mirror
-- fail, the guard says so before any column here is added.

do $$
declare
  v_rel      oid;
  v_col      text;
  v_required text[] := array['location_name', 'date', 'rainfall_mm', 'soil_moisture_pct',
                             'temp_max', 'ndvi_index', 'climate_risk_score', 'created_at'];
  v_missing  text[] := array[]::text[];
  v_unique   boolean := false;
  v_id_type  text;
  v_id_null  boolean;
  v_id_def   text;
begin
  select c.oid into v_rel
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relname = 'environmental_data' and c.relkind = 'r';

  if v_rel is null then
    raise exception
      'INCOMPATIBLE: public.environmental_data does not exist in this project, so there is no legacy table to mirror onto. Nothing further in this file has been applied. Create/verify the legacy table first (harvester/setup_env.sql, README section 2).';
  end if;

  foreach v_col in array v_required loop
    if not exists (select 1 from pg_attribute a
                    where a.attrelid = v_rel and a.attname = v_col
                      and a.attnum > 0 and not a.attisdropped) then
      v_missing := array_append(v_missing, v_col);
    end if;
  end loop;

  if array_length(v_missing, 1) is not null then
    raise exception
      'INCOMPATIBLE: public.environmental_data is missing legacy column(s): %. The mirror view and every reader of those columns would fail mid-apply, so this file stops here rather than half-mutating the table.',
      array_to_string(v_missing, ', ');
  end if;

  -- The mirror's ON CONFLICT target. File 0001 guarantees it; re-checking costs one catalog
  -- read and turns a `42P10` at the first live sync into a named problem at apply time.
  -- Same alphabetical-aggregation form file 0001 uses, so the two cannot disagree.
  select true into v_unique
    from pg_index x
   where x.indrelid = v_rel and x.indisunique
     and (select string_agg(a.attname, ',' order by a.attname)
            from unnest(x.indkey) as k(attnum)
            join pg_attribute a on a.attrelid = x.indrelid and a.attnum = k.attnum) = 'date,location_name';

  -- `is distinct from true`, not `not v_unique`: SELECT INTO with no rows leaves the target
  -- NULL, and `not NULL` is NULL, which would silently skip this branch.
  if v_unique is distinct from true then
    raise exception
      'INCOMPATIBLE: public.environmental_data has no unique index on (location_name, date). File 0001 adds one; its absence means 0001 was never applied here or stopped partway. Upserting against a non-unique pair would create duplicate rows per place per day.';
  end if;

  select format_type(a.atttypid, a.atttypmod), a.attnotnull,
         coalesce(pg_get_expr(d.adbin, d.adrelid),
                  case when a.attgenerated <> '' then 'identity' end, '')
    into v_id_type, v_id_null, v_id_def
    from pg_attribute a
    left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
   where a.attrelid = v_rel and a.attname = 'id' and a.attnum > 0 and not a.attisdropped;

  if v_id_type is null then
    raise exception
      'INCOMPATIBLE: public.environmental_data has no "id" column, so the primary key the legacy harvester and the mirror rely on is not the expected one. Refusing to guess at an alternative.';
  end if;

  if v_id_null and v_id_def = '' then
    raise exception
      'INCOMPATIBLE: public.environmental_data.id is declared "not null" with no default (type %). The mirror sends no id value, so every batch would be rejected by the database. Give id a default (or an identity), or the sync must supply it.',
      v_id_type;
  end if;

  raise notice
    'OK: public.environmental_data verified - id % (default: %), unique (location_name, date) present. The uuid shape is reported, never assumed.',
    v_id_type, coalesce(nullif(v_id_def, ''), 'none but column is nullable');
end $$;

alter table public.environmental_data add column if not exists location_key text;
alter table public.environmental_data add column if not exists source_id text;
alter table public.environmental_data add column if not exists source_name text;
alter table public.environmental_data add column if not exists source_url text;
alter table public.environmental_data add column if not exists license text;
alter table public.environmental_data add column if not exists units text;
alter table public.environmental_data add column if not exists methodology text;
alter table public.environmental_data add column if not exists coverage text;
alter table public.environmental_data add column if not exists quality data.quality;
alter table public.environmental_data add column if not exists value_kind data.value_kind;
alter table public.environmental_data add column if not exists is_forecast boolean not null default false;
alter table public.environmental_data add column if not exists temperature_min_c numeric(5, 2);
alter table public.environmental_data add column if not exists relative_humidity_pct numeric(4, 1);
alter table public.environmental_data add column if not exists et0_mm numeric(7, 3);
alter table public.environmental_data add column if not exists retrieved_at timestamptz;

-- `record_replaced_at` is the only addition here that is NOT free. A NOT NULL column with a
-- volatile default (`now()`) cannot be a catalog-only change: PostgreSQL rewrites the whole
-- table to stamp every existing row, and holds the rewrite under AccessExclusiveLock, which
-- blocks the legacy harvester and every reader until it finishes. The pre-flight measured
-- this table at 0 rows, so the rewrite is instant on this project today. On a populated
-- copy, drop `not null default now()` for the add, backfill in batches, then `set not null`
-- with `not valid` + `validate constraint`-style care — do not run this line as written.
-- The trigger-free `record_replaced_at` is written explicitly by the sync payload, so the
-- default only matters for rows other writers insert.
alter table public.environmental_data add column if not exists record_replaced_at timestamptz not null default now();

comment on column public.environmental_data.rainfall_mm is
  'Daily precipitation in mm. The sync writes here only from the designated mirror source (Open-Meteo, the past-day analysis of its forecast endpoint) and labels it in value_kind; NASA POWER rows stay in data.daily_climate.';
comment on column public.environmental_data.temp_max is
  'Daily maximum temperature in degrees C, same source as rainfall_mm.';
comment on column public.environmental_data.soil_moisture_pct is
  'MODELLED root-zone moisture from a numerical model (Open-Meteo soil_moisture_0_to_10cm, m3/m3 scaled by 100 by the legacy enricher). Not a field measurement and not written by the current sync.';
comment on column public.environmental_data.ndvi_index is
  'LEGACY COLUMN, NOT A SATELLITE OBSERVATION. The old enricher computed it as 0.4 + soil_moisture*0.5 + rain/50 clamped to 0.1-0.9. The sync never writes it. Real, tile-derived NDVI lives in data.satellite_observations with its scene date and colour-map band. Any UI reading this column must label it modelled, or read the new table instead.';
comment on column public.environmental_data.climate_risk_score is
  'Legacy 1-10 score derived from a hard-coded 100 mm monthly rainfall placeholder. Not written by the current sync; it is not a defensible risk figure and must not be presented as one.';
comment on column public.environmental_data.value_kind is
  'observed | modeled | forecast | estimated | imputed for the sync-written columns of this row. Null means the row predates this pack, so its kind is unknown and the UI must say so.';

-- The mirror upserts against (location_name, date). Production already had that uniqueness
-- and file 0001 guarantees it wherever the table was created without it; the guard above
-- refuses to continue if neither is true, because `ON CONFLICT` against a non-unique pair
-- fails with 42P10 on the first batch of the first live sync.
create index if not exists environmental_data_source_date_idx
  on public.environmental_data (source_id, date desc);

-- =========================================================================================
-- 3. data.v_environmental_mirror — what the mirror owns, and only that
-- =========================================================================================
--
-- A view rather than a habit: it lists exactly the columns the sync is allowed to write,
-- so "we did not overwrite the legacy harvester's soil moisture" is checkable with one
-- query instead of a code review.
--
-- Cross-check this against `upsertLegacyMirror` in `lib/data/sync.ts` before applying: the
-- payload sends location_name, date, location_key, source_id, source_name, source_url,
-- units, methodology, coverage, quality, value_kind, is_forecast, rainfall_mm, temp_max,
-- temperature_min_c, relative_humidity_pct, et0_mm, retrieved_at, record_replaced_at — i.e.
-- every column this view names as sync-owned, and nothing it does not. It sends no `id` and
-- no `created_at`, which is only safe because of the verified defaults (see the guard).
-- `license` is deliberately absent from the legacy row: it lives on data.daily_climate and
-- on sync_runs, and the legacy column would sit unused.
--
-- A rejected mirror is not a silent one: `upsertLegacyMirror` records
-- `legacy_mirror_rejected` with the database message, `syncClimate` folds that into the
-- task report as `partial`/`failed` with the error attached, and the run row is closed with
-- that status. What the report does NOT count is mirror rows in `rowsWritten` (that number
-- is the data.daily_climate total only), so `written=0` does not mean the legacy table was
-- untouched. `docs/DATA_SYNC.md` section 4 shows the query that confirms a mirror landed.

-- Wind and shortwave radiation are deliberately absent: `public.environmental_data` has no
-- such columns and this pack does not add them, because the mirror writes neither figure
-- (see `upsertLegacyMirror` in `lib/data/sync.ts`). They live in `data.daily_climate`, where
-- their units are stated on the row. Naming a column that does not exist here would abort
-- this whole file with "column e.wind_speed_ms does not exist".

create or replace view data.v_environmental_mirror as
select
  e.location_name,
  e.date,
  e.location_key,
  e.source_id,
  e.source_name,
  e.source_url,
  e.units,
  e.value_kind,
  e.quality,
  e.rainfall_mm,
  e.temp_max,
  e.temperature_min_c,
  e.relative_humidity_pct,
  e.et0_mm,
  e.is_forecast,
  e.retrieved_at,
  e.record_replaced_at,
  -- Read-only here so nobody mistakes them for sync output: these belong to the legacy
  -- enricher and this pack never writes them.
  e.soil_moisture_pct,
  e.ndvi_index,
  e.climate_risk_score
from public.environmental_data e;

comment on view data.v_environmental_mirror is
  'The columns the climate sync owns on public.environmental_data, plus the legacy columns it must never write. Use it to confirm a refresh did not destroy harvester output.';

-- A plain view executes as its owner, which would make this an anonymous read path around
-- the RLS on the underlying tables. Set the invoker flag (PostgreSQL 15+) and revoke access
-- from the API roles: only a role that could already read environmental_data can use it.
alter view data.v_environmental_mirror set (security_invoker = true);
revoke all on data.v_environmental_mirror from anon, authenticated;

-- =========================================================================================
-- 4. Security
-- =========================================================================================

alter table data.daily_climate enable row level security;
alter table data.daily_climate force row level security;
revoke all on data.daily_climate from anon, authenticated;

comment on table data.daily_climate is 'RLS enabled and forced with no policies: readable only by the table owner or a bypassrls role. No anon/authenticated access.';

-- `public.environmental_data` keeps whatever policies it already had (the repository script
-- created a service-role-only policy). This pack neither adds a policy that widens access
-- nor removes one, and the view above stays revoked from the API roles.
--
-- The mirror does need TABLE PRIVILEGES, which RLS policies do not provide. `service_role`
-- has `bypassrls`, and `bypassrls` only skips row policies — without `insert`/`update` the
-- mirror's first batch fails with 42501. Supabase's project default privileges usually
-- already grant this, but that is a project setting, not something this pack may assume
-- (README section 3, query P5b, shows the check). The grant is the minimum the mirror performs: no
-- `delete`, no `truncate`, nothing to `anon` or `authenticated`.
grant usage on schema public to service_role;
grant select, insert, update on public.environmental_data to service_role;
