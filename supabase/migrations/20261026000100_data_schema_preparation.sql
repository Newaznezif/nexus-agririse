-- =========================================================================================
-- 20261026000100 — schema, shared vocabulary, idempotent alignment of legacy tables
-- =========================================================================================
--
-- READ `supabase/migrations/README.md` BEFORE RUNNING THIS PACK.
--
-- Objects every later file in the pack depends on, plus two idempotent repairs to the
-- tables that the repository's own `harvester/setup*.sql` scripts create.
--
-- This file changes no rows. No DROP, no DELETE, no UPDATE, no TRUNCATE.
--
-- PRODUCTION SCHEMA IS UNVERIFIED: this pack was written against the repository's SQL
-- scripts, not against the live project's `information_schema`. Run the pre-flight
-- queries in the README first. Every statement that could collide with an existing object
-- is guarded.

-- =========================================================================================
-- 1. A dedicated schema for publisher-faithful, provenance-complete rows
-- =========================================================================================
--
-- Why not reuse `public.market_intelligence` for market prices? That table records no
-- unit, no currency and no observation date, and the `unified_market_intel` view derives
-- `price_usd_per_mt` from hard-coded assumptions (source ECX => price is per quintal,
-- source NAEB => per kilogram, anything else => already USD). Pushing WFP rows (ETB per
-- 100 KG) through that CASE would publish an Ethiopian retail price as a US dollar price —
-- the exact confusion this project must never make. The legacy tables are therefore left
-- exactly as they are, and the new pipeline gets a self-describing home. Reconnecting the
-- legacy view is a separate, deliberate decision (see README section 8).

create schema if not exists data;

comment on schema data is
  'Publisher-faithful copies of open data (WFP rEMS, Open-Meteo, NASA POWER, NBE, World Bank, NASA GIBS). Every row carries its own units, observation date and provenance. Contains no user data.';

-- =========================================================================================
-- 2. Shared domains
-- =========================================================================================
--
-- A domain cannot be created conditionally: PostgreSQL has no `CREATE DOMAIN IF NOT EXISTS`
-- (confirmed against the current `CREATE DOMAIN` syntax synopsis), so a bare `create domain`
-- makes a rerun of this file abort with `type "value_kind" already exists`. That matters
-- because a pack that failed halfway must be finishable by re-running the file (README
-- section 2), not by hand-editing the statements that already succeeded.
--
-- Reusing an existing domain is only safe when it IS the domain this pack assumes, so the
-- guard VERIFIES rather than merely detects. A silent skip would let production columns be
-- checked against someone else's vocabulary — a `value_kind` that also accepted 'live' would
-- defeat the entire purpose of the column, and every later file would build on it. Each
-- existing domain is therefore tested three ways: that it is a domain at all, that its base
-- type is `text`, and that it behaves like the declaration below — accepting every declared
-- value and rejecting an undeclared one. Any mismatch raises `INCOMPATIBLE` and stops the
-- file rather than continuing on assumptions.
--
-- One loop declares both domains, so the vocabulary used to CREATE is the same vocabulary
-- used to PROBE; they cannot drift apart. The probe is the literal cast a reviewer can run by
-- hand (`select 'observed'::data.value_kind;`), not an indirect check.

do $$
declare
  r       record;
  v_oid   oid;
  v_kind  text;
  v_base  text;
  v_sink  text;
  v_val   text;
begin
  for r in
    select * from (values
      ('value_kind', array['observed', 'modeled', 'forecast', 'estimated', 'imputed']),
      ('quality',    array['high', 'medium', 'low'])
    ) as declared (name text, allowed text[])
  loop
    select t.oid, t.typtype::text, format_type(t.typbasetype, t.typtypmod)
      into v_oid, v_kind, v_base
    from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'data' and t.typname = r.name;

    if v_oid is null then
      execute format(
        'create domain data.%I as text check (value in (%s))',
        r.name,
        (select string_agg(quote_literal(v), ', ') from unnest(r.allowed) as v)
      );
      raise notice 'ADDED: domain data.%', r.name;
      continue;
    end if;

    if v_kind <> 'd' then
      raise exception
        'INCOMPATIBLE: data.% exists but is PostgreSQL type kind "%", not a domain. This pack cannot share that name. Drop or rename the existing type first, then re-run file 0001.',
        r.name, v_kind;
    end if;

    if v_base <> 'text' then
      raise exception
        'INCOMPATIBLE: domain data.% is a domain over %, not over text. The sync writes bare labels into columns typed by it, so the constraint actually enforced would not be the one this pack documents.',
        r.name, v_base;
    end if;

    -- Every value this pack will store must pass the existing domain.
    for v_val in select unnest(r.allowed) as v loop
      begin
        execute format('select %L::data.%I', v_val, r.name) into v_sink;
      exception when check_violation then
        raise exception
          'INCOMPATIBLE: the existing domain data.% rejects ''%''. It is not the vocabulary this pack was written against; reconcile it before applying.',
          r.name, v_val;
      end;
    end loop;

    -- And a value OUTSIDE the vocabulary must fail, or the domain is too permissive to be
    -- the guard this pack claims to be.
    begin
      execute format('select %L::data.%I', '__undeclared_probe_value__', r.name) into v_sink;
      raise exception
        'INCOMPATIBLE: the existing domain data.% accepted a value outside its declared vocabulary (%). An undeclared kind could be stored, which is the failure this column exists to prevent. Reconcile it before applying.',
        r.name, array_to_string(r.allowed, ', ');
    exception
      when check_violation then
        null;  -- the expected outcome: the domain rejected the probe
    end;

    raise notice 'OK: domain data.% already exists over text with the expected vocabulary', r.name;
  end loop;
end $$;

comment on domain data.value_kind is
  'observed = a measurement or a publisher''s own survey figure. modeled = output of a numerical model or retrieval. forecast = a future period. estimated = derived here from published inputs. imputed = a publisher fill or placeholder. A number whose kind is undeclared must not be rendered.';

comment on domain data.quality is
  'How much weight the figure can bear: high = direct publication by the source of record, medium = survey or model with known caveats, low = thin coverage, interpolated, or a publisher fill.';

-- =========================================================================================
-- 3. Provenance bundle (the contract, stated once)
-- =========================================================================================
--
-- Postgres has no column sets, so each table repeats these columns verbatim.
--
--   source_id             stable key equal to `lib/data/sources.ts` -> SOURCES[*].id
--   source_name           publisher exactly as it must appear in the UI
--   source_url            landing page a user can click to verify the figure
--   license               redistribution terms, stored with the row they govern
--   method_url            endpoint that actually produced the row
--   units                 the publisher's own unit string, never silently translated
--   value_kind            see domain above
--   quality               see domain above
--   methodology           one sentence a non-specialist can read
--   coverage              geographic scope of the row
--   observed_at / *_on    when the underlying fact was true (per table)
--   retrieved_at          when our server pulled it
--   record_added_at / record_replaced_at   audit of our own writes

-- =========================================================================================
-- 4. Trigger function used by every table in this pack
-- =========================================================================================
--
-- `create or replace` so re-running the pack cannot fail on an existing function; the body
-- is versioned here, so replacement is idempotent rather than surprising.

create or replace function data.touch_replaced_at()
returns trigger
language plpgsql
as $$
begin
  new.record_replaced_at := now();
  return new;
end $$;

comment on function data.touch_replaced_at() is
  'Sets record_replaced_at on every UPDATE so a row always shows when we last changed it, separately from when the publisher observed the fact.';

-- =========================================================================================
-- 5. Idempotent uniqueness on `public.environmental_data (location_name, date)`
-- =========================================================================================
--
-- `harvester/setup_env.sql` declares `UNIQUE(location_name, date)`, but a project created
-- from an earlier revision may not have it. Without a uniqueness target the climate sync
-- cannot upsert, and would insert a fresh duplicate row per location per run. The index is
-- created only when nothing already enforces that tuple — a redundant second unique index
-- would be write amplification on a table the AI step reads daily.

do $$
declare
  v_enforcer text;
begin
  if to_regclass('public.environmental_data') is null then
    raise notice 'SKIP: public.environmental_data does not exist here. Create it (harvester/setup_env.sql) or apply file 0003, then re-run this pack.';
    return;
  end if;

  -- A unique constraint, or a unique/primary index, over exactly (location_name, date).
  -- Column names are aggregated alphabetically so index order cannot matter.
  select coalesce(string_agg(e.name, ', ' order by e.name), '')
    into v_enforcer
  from (
    select c.conname as name
    from pg_constraint c
    where c.conrelid = 'public.environmental_data'::regclass
      and c.contype in ('u', 'p')
      and (
        select string_agg(a.attname, ',' order by a.attname)
        from unnest(c.conkey) as k(attnum)
        join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum
      ) = 'date,location_name'

    union all

    select i.relname
    from pg_index x
    join pg_class i on i.oid = x.indexrelid
    where x.indrelid = 'public.environmental_data'::regclass
      and x.indisunique
      and (
        select string_agg(a.attname, ',' order by a.attname)
        from unnest(x.indkey) as k(attnum)
        join pg_attribute a on a.attrelid = x.indrelid and a.attnum = k.attnum
      ) = 'date,location_name'
  ) e;

  if v_enforcer <> '' then
    raise notice 'OK: uniqueness on (location_name, date) already enforced by %', v_enforcer;
    return;
  end if;

  create unique index environmental_data_location_name_date_key
    on public.environmental_data (location_name, date);
  raise notice 'ADDED: unique index environmental_data_location_name_date_key';
end $$;

-- =========================================================================================
-- 6. Idempotent relaxation of legacy NOT NULLs the open data cannot satisfy
-- =========================================================================================
--
-- `climate_risk_score`: the legacy enricher derives it from a hard-coded placeholder
-- (`MONTHLY_AVG_RAINFALL = 100.0` mm in `harvester/environment_enricher.py`). We will not
-- write a risk score we cannot justify, so the column must accept null. Dropping a NOT NULL
-- is non-destructive: no stored value changes, and every existing insert that supplies a
-- score still succeeds.

do $$
begin
  if exists (
    select 1 from pg_attribute
     where attrelid = 'public.environmental_data'::regclass
       and attname = 'climate_risk_score'
       and attnotnull
  ) then
    alter table public.environmental_data alter column climate_risk_score drop not null;
    raise notice 'CHANGED: environmental_data.climate_risk_score is now nullable (no unjustified score is written)';
  else
    raise notice 'OK: environmental_data.climate_risk_score is already nullable or absent';
  end if;
end $$;

-- Two legacy columns are deliberately NOT written by this pack's sync, and are documented
-- here so a reviewer knows why:
--
--   soil_moisture_pct  modelled output (Open-Meteo `soil_moisture_0_to_10cm`), not a field
--                      measurement.
--   ndvi_index         computed by the legacy enricher as `0.4 + soil_moisture*0.5 +
--                      rain/50`, clamped to 0.1-0.9. It is NOT a satellite observation.
--                      Any UI that labels this column "NDVI from satellite" over-claims.
--                      File 0003 states that in the column comment and adds `value_kind`
--                      for the columns the sync writes, but no per-column kind exists for
--                      this legacy figure — because the sync never writes it, a flag on the
--                      row could not describe it anyway. Real, tile-derived NDVI is stored
--                      per scene date in `data.satellite_observations` (file 0005).
--
-- Existing values in those columns are left untouched by every upsert in this pack.
