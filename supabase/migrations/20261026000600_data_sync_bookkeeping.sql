-- =========================================================================================
-- 20261026000600 — sync bookkeeping, overlap protection, and the grants the sync needs
-- =========================================================================================
--
-- A scheduled job that overlaps itself is how you get duplicated rows and a slow publisher
-- hammered twice. The lease below exists because this runs on serverless: there is no
-- persistent connection to hold a session-scoped advisory lock, so overlap protection has
-- to be a row with an expiry that can be claimed atomically.
--
-- Creates no data rows.

-- =========================================================================================
-- 1. data.sync_runs — one row per attempt, including the failed ones
-- =========================================================================================
--
-- The runner opens a row (status = 'running') and later updates the same row by run_id, so
-- an interrupted run stays visible as 'running' instead of pretending it completed.

create table if not exists data.sync_runs (
  run_id         bigint generated always as identity primary key,
  source_key     text not null,
  started_at     timestamptz not null default now(),
  finished_at    timestamptz,
  status         text not null
    check (status in ('running', 'succeeded', 'partial', 'failed', 'skipped_overlap')),
  rows_written   integer not null default 0 check (rows_written >= 0),
  rows_rejected  integer not null default 0 check (rows_rejected >= 0),
  -- Publisher metadata for the run: the newest observation seen, and where it came from.
  observed_at    timestamptz,
  source_url     text,
  -- Sanitized, bounded reason. Never an upstream body, never a header, never a key.
  error_code     text,
  error_message  text,
  detail         jsonb not null default '{}'::jsonb,
  record_added_at    timestamptz not null default now(),
  record_replaced_at timestamptz not null default now(),
  constraint sync_run_finished_has_time check (
    status = 'running' or finished_at is not null
  ),
  constraint sync_run_detail_is_object check (jsonb_typeof(detail) = 'object')
);

comment on table data.sync_runs is
  'Every sync attempt, successful or not. A failed run is recorded rather than swallowed, because "the WFP file has not updated since July" is only visible if the attempts are kept. Contains no personal data, no credentials and no upstream payloads.';
comment on column data.sync_runs.status is
  'succeeded = every task wrote. partial = some publishers failed and the run recorded which. failed = nothing could be written. skipped_overlap = another worker held the lease, which is the protection working, not a fault.';
comment on column data.sync_runs.error_message is
  'Truncated, sanitized operator-facing reason — the same stable text the source-status view shows. Kept short so an upstream response body or a credential cannot end up persisted in a log table.';
comment on column data.sync_runs.detail is
  'Per-task counts only (rows written/rejected, source id, error code). Anything that could contain a token, a cookie or a customer record belongs in neither this column nor any other.';

create index if not exists sync_runs_source_started_idx
  on data.sync_runs (source_key, started_at desc);
create index if not exists sync_runs_status_idx
  on data.sync_runs (status, started_at desc);

-- =========================================================================================
-- 2. data.sync_leases — the overlap guard
-- =========================================================================================

create table if not exists data.sync_leases (
  source_key   text primary key,
  holder       text not null,
  acquired_at  timestamptz not null default now(),
  expires_at   timestamptz not null,
  claims       integer not null default 0,
  record_added_at    timestamptz not null default now(),
  record_replaced_at timestamptz not null default now(),
  constraint sync_lease_expires_after_acquisition check (expires_at > acquired_at),
  constraint sync_lease_claims_non_negative check (claims >= 0)
);

comment on table data.sync_leases is
  'One row per scheduled source: who is running it and until when. A crashed worker cannot block the pipeline forever, because its lease simply expires.';
comment on column data.sync_leases.holder is
  'Ephemeral per-attempt id (a random hex string made by the caller). Not a secret, not a credential, and useless outside one run.';

-- `create or replace`, so re-applying the pack updates the logic rather than failing on an
-- existing function.
create or replace function data.claim_sync_lease(
  p_source_key text,
  p_holder text,
  p_ttl interval default interval '20 minutes'
)
returns boolean
language plpgsql
as $$
declare
  v_won boolean;
begin
  -- One statement, so the expiry check and the write are the same transaction: two workers
  -- racing on an expired lease cannot both win. Re-claiming your own live lease is allowed,
  -- which is how a long run extends it without double-counting the claim.
  insert into data.sync_leases as l (source_key, holder, acquired_at, expires_at, claims)
  values (p_source_key, p_holder, now(), now() + p_ttl, 1)
  on conflict (source_key) do update
     set holder = excluded.holder,
         acquired_at = excluded.acquired_at,
         expires_at = excluded.expires_at,
         claims = case when l.holder = excluded.holder then l.claims else l.claims + 1 end
   where l.expires_at < now() or l.holder = excluded.holder
  returning true into v_won;

  return coalesce(v_won, false);
end $$;

comment on function data.claim_sync_lease(text, text, interval) is
  'Atomically take (or extend) the lease for one source. True only when the caller owns it. False means another worker is running: the caller must record skipped_overlap and write nothing.';

create or replace function data.release_sync_lease(p_source_key text, p_holder text)
returns boolean
language plpgsql
as $$
declare
  v_released boolean;
begin
  update data.sync_leases
     set expires_at = now(),
         record_replaced_at = now()
   where source_key = p_source_key and holder = p_holder
  returning true into v_released;

  return coalesce(v_released, false);
end $$;

comment on function data.release_sync_lease(text, text) is
  'Hand the lease back early so the next schedule is not blocked by a run that already finished. Only the holder can release it, so a late-finishing old worker cannot free a lease a newer worker owns.';

-- =========================================================================================
-- 3. data.v_source_freshness — what the status view can honestly claim
-- =========================================================================================
--
-- Read path for "when did this number last arrive from its publisher, and how many rows did
-- it bring?". Derived from run bookkeeping only: a source with no recorded run produces no
-- row, so nothing can report a status it never earned.

create or replace view data.v_source_freshness as
select
  r.source_key,
  r.run_id,
  r.status,
  r.started_at,
  r.finished_at,
  r.rows_written,
  r.rows_rejected,
  r.observed_at,
  r.source_url,
  r.error_code,
  r.error_message,
  coalesce(l.expires_at > now(), false) as lease_held,
  l.expires_at as lease_expires_at,
  now() - r.finished_at as age
from data.sync_runs r
left join data.sync_leases l on l.source_key = r.source_key
where r.run_id = (
  select max(latest.run_id)
  from data.sync_runs latest
  where latest.source_key = r.source_key
);

comment on view data.v_source_freshness is
  'Newest recorded run per source, plus whether its lease is currently held. /api/data/status uses it to show "last successful sync" beside "newest observation". A source with no row here has never synced, and the UI must say exactly that.';

-- =========================================================================================
-- 4. Row-level security
-- =========================================================================================

alter table data.sync_runs   enable row level security;
alter table data.sync_leases enable row level security;
alter table data.sync_runs   force row level security;
alter table data.sync_leases force row level security;

-- A plain view runs as its OWNER, which would turn it into an anonymous read path around
-- the RLS above. The invoker flag (PostgreSQL 15+) plus the revokes below mean only a role
-- that could already read these tables can use the view.
alter view data.v_source_freshness set (security_invoker = true);

revoke all on data.sync_runs         from anon, authenticated;
revoke all on data.sync_leases       from anon, authenticated;
revoke all on data.v_source_freshness from anon, authenticated;

-- The lease functions are callable by the sync's role only. Granting execute to
-- `anon`/`authenticated` would let any visitor take the lease or stall the pipeline.
revoke all on function data.claim_sync_lease(text, text, interval) from public, anon, authenticated;
revoke all on function data.release_sync_lease(text, text)         from public, anon, authenticated;
grant execute on function data.claim_sync_lease(text, text, interval) to service_role;
grant execute on function data.release_sync_lease(text, text)         to service_role;

-- =========================================================================================
-- 5. The grants `service_role` actually needs, which the repository scripts never had
-- =========================================================================================
--
-- `bypassrls` bypasses ROW policies, not TABLE privileges. Without the statements below a
-- correctly written migration still fails, with 42501 on the first insert. `usage` on the
-- schema, `select/insert/update` on the tables, and `usage` on the identity sequences are
-- all required, because the runner writes through PostgREST as `service_role`.
--
-- One grant per line, each with the code that needs it. Nothing here widens access for
-- `anon` or `authenticated`: every statement targets `service_role` only, and section 4 has
-- already revoked these same objects from the two API roles.

-- lib/data/sync.ts opens every table and view in `data` through PostgREST, which first
-- checks USAGE on the schema itself; without it every request in the pack 42501s.
grant usage on schema data to service_role;

-- sync.ts writes with upsert (select + insert + update) on data.location,
-- data.market_price, data.daily_climate, data.exchange_rate, data.satellite_observation and
-- closes the run row in data.sync_runs; it claims and releases the lease in
-- data.sync_leases, and the lease functions themselves run select/insert/update as the
-- invoking role.
--
-- `delete` is included for operator backfill and retention pruning, NOT because the
-- application uses it: no code path in lib/, services/ or scripts/ issues a DELETE against
-- these tables (verified by grep over the repository). It is the one privilege here that
-- least-privilege review may reasonably drop, and dropping it is a separate, deliberate
-- change rather than something to assume away in this pack.
grant select, insert, update, delete on all tables in schema data to service_role;

-- Every table above keys on `bigint generated always as identity`, so an insert takes its
-- next value from the owned sequence. `usage` is what permits `nextval`; `select` lets a
-- diagnostic read `last_value`. Without `usage` the very first insert fails with 42501 on
-- the sequence, not the table.
grant usage, select on all sequences in schema data to service_role;

-- `all tables` does NOT cover views, and the app reads `data.v_source_freshness` through the
-- API role, so a pack that grants only tables leaves that request denied.
grant select on all views in schema data to service_role;

-- And for anything a later file or a future migration adds to this schema.
alter default privileges in schema data grant select, insert, update, delete on tables   to service_role;
alter default privileges in schema data grant usage, select                on sequences  to service_role;
alter default privileges in schema data grant select                       on views      to service_role;
alter default privileges in schema data grant execute                      on functions  to service_role;
--
-- Two facts about `alter default privileges` worth recording, because they surprise people:
-- it applies only to objects created by the role running it later on, and its entries are
-- catalog rows that survive (and strand) if the schema is dropped and recreated. Re-running
-- this file is therefore harmless but not idempotent in the way `if not exists` is: check
-- with `SELECT pg_get_userbyl(defaclrole), defaclobjtype, defaclacl FROM pg_default_acl d
--   JOIN pg_namespace n ON n.oid = d.defaclnamespace WHERE n.nspname = 'data';`.
--
-- NOT granted here, on purpose: `REFERENCES` on data.location and the other FK targets.
--
-- `data.market_price`, `data.daily_climate` and `data.satellite_observation` each carry
-- `location_key text not null references data.location (location_key)`, and a wide reading
-- of SQL says the role doing the inserting must hold REFERENCES on the referenced table.
-- PostgreSQL's own GRANT and CREATE TABLE documentation describes REFERENCES as the
-- privilege needed to *declare* such a constraint, and states no requirement on the role
-- performing the DML — but that is a reading of docs, not a test, and there is no local
-- PostgreSQL here to settle it. Adding a privilege on faith is exactly the assumption this
-- section is supposed to avoid, so it is left out and flagged for verification instead:
--
--   Read-only check on the real project:
--     SELECT has_table_privilege('service_role', 'data.location', 'references');
--   Decisive test, in a THROWAWAY database only (never against production):
--     insert one row into data.location, then insert one row into data.daily_climate
--     referencing it AS the role the sync uses. 42501 on the second statement means the
--     grant is genuinely required and this file must add it; success means the docs are
--     right and the grant would have been unnecessary privilege.
--   Until then the activation sequence in README section 6 treats a 42501 naming
--   `data_location_references` or `data.location` as this known open question, not as a
--   mystery.

-- =========================================================================================
-- 6. NOT done by this file: exposing schema `data` to the REST API
-- =========================================================================================
--
-- PostgREST serves only the schemas named in its `db-schemas` configuration (Supabase
-- exposes this as a project setting; self-hosted PostgREST uses `pgrst.db_schemas`). A
-- table in an unpublished schema returns 404 "Could not find the table" — an honest
-- failure, which is why this pack does not quietly work around it.
--
-- This is deliberately left as a reviewed, visible step rather than an `alter role` buried
-- in a migration, because the correct mechanism differs between hosted Supabase and
-- self-hosted PostgREST and the API must be reloaded afterwards. README section 6 states
-- exactly what to set and how to prove it took effect. If you decide not to publish the
-- schema, nothing in the app breaks: the live routes and dashboard already work without the
-- database, and the sync reports `failed` with the PostgREST message.
