# Data sync: how the scheduled pipeline is turned on

The dashboard works without any of this. Every card on `/dashboard/climate`, `/forecasts`,
`/map`, `/markets` and `/finance` calls the publisher in the request itself, through a typed
connector, and prints the publisher's own observation date. The sync described here adds two
things the live path cannot: **history** (price series, climate seasons, exchange-rate time
series) and **survival of a publisher outage**. It is not a fallback that quietly replaces a
live figure — the connector layer has no mock path, so a source that is down is shown as down.

Nothing in this document has been executed. The migration pack in `supabase/migrations/` is
awaiting review and the operator pre-flight queries, and no run has ever written to a database
from this machine (Supabase is not configured here, and `*.supabase.co` does not resolve — see
`docs/PRODUCTION_READINESS_AUDIT.md`). Treat everything below as instructions, not as a record.

## 1. What runs

`lib/data/sync.ts` → `POST /api/data/sync`. Five tasks, in dependency order:

| Task | Publishers | Writes | Roughly |
| --- | --- | --- | --- |
| `locations` | our own catalogue (geoBoundaries-verified names) | `data.location` | 12 rows |
| `market-prices` | HDX / WFP Ethiopian Food Prices Survey | `data.market_price_observations` | 24 months of national survey rows |
| `climate` | Open-Meteo, NASA POWER | `data.daily_climate`, plus the owned columns of `public.environmental_data` | 12 places × (45 days history + 7 days forecast) × 2 publishers |
| `exchange` | NBE, World Bank (unofficial ETB + annual indicators) | `data.exchange_rate_observations`, `data.economic_indicator_observations` | daily official + monthly unofficial + annual benchmarks, kept separate |
| `satellite` | NASA GIBS | `data.satellite_layers`, `data.satellite_observations` | 8 sampled points per layer, latest composite |

The knobs that bound upstream load are constants at the top of `lib/data/sync.ts`
(`PRICE_HISTORY_MONTHS`, `CLIMATE_DAYS_PER_RUN`, `CLIMATE_FORECAST_DAYS`, `CLIMATE_PLACES`,
`SATELLITE_POINTS`, `BATCH_SIZE = 400`, `LEASE_TTL_MINUTES = 20`). They are constants on
purpose: a run that quietly widened its own scope is how a free service gets rate-limited.

`data.market_monthly_summary` is defined by the pack but has **no writer yet**: the
month-on-month figures the markets board shows are computed per request in
`lib/data/wfpMarketPrices.ts` from the live WFP rows, so nothing currently populates that
table and its row count is always 0. The table exists so the derived figures have a
provenance-correct home (`value_kind = 'estimated'`, both observation dates stored) when a
task is written for it.

Each attempt writes a `data.sync_runs` row first and closes it `succeeded` / `partial` /
`failed`, with a sanitized reason (200 chars, no URL query). Before contacting anyone it claims
`data.sync_leases` for `nexus-data-sync`; a second concurrent worker records `skipped_overlap`
and writes nothing. That lease table exists because serverless workers have no session in which
to hold an advisory lock.

## 2. Credentials it needs

All four are server-side. None of them is a third-party API key — every publisher wired here
(Open-Meteo, NASA POWER, HDX, NBE, World Bank, GIBS, geoBoundaries) is keyless, which is why
`NEXT_PUBLIC_*` variables carry no secret and the browser holds none.

| Variable | Where | Needed for |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | server + client | client reads (anon) and the admin client's base URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | client | RLS-scoped reads from the browser |
| `SUPABASE_SERVICE_ROLE_KEY` | **server only** | `lib/supabaseAdmin.ts`, and therefore the sync. Never in client code, logs, or responses. |
| `SYNC_SECRET` | server + scheduler | bearer token that authorizes `POST /api/data/sync`. Minimum 16 characters. |

`lib/supabaseAdmin.ts` fails closed: browser-side it refuses outright, and server-side it names
the missing variable (never its value). `POST /api/data/sync` refuses when `SYNC_SECRET` is
absent or short, so an unconfigured deployment is a closed endpoint rather than an open one.

Also required, and the step most easily missed: the `data` schema must be **exposed to
PostgREST** (the runner calls `client.schema('data')`). Options A/B/C and their costs are in
`supabase/migrations/README.md` §6. Until then the sync reports `blocked` and the dashboard
keeps serving live publisher data.

### The current state, stated plainly

As of the `fix/supabase-migration-safety` branch: **the `data` schema is not exposed to the
REST API, and the six migrations have not been applied anywhere.** Both are deliberate.
Publishing a schema and applying DDL are configuration/production changes, and this branch
only prepares files for review.

The consequence has to be said out loud rather than inferred from a green build:

- Database persistence is **not operational** on any environment, including a Vercel Preview.
  A Preview deployment proves the app compiles and the live routes answer; it proves nothing
  about `data.*`.
- `GET /api/data/status?persisted=1` will report no stored runs (`data.sync` empty, or the
  request fails on the missing schema), and `SourceStatusPanel` will say so. That is the
  correct output for this state, not a bug to fix by faking a row.
- `POST /api/data/sync` on a Preview either refuses (no `SYNC_SECRET`/service-role key set) or
  runs and records `blocked`/`failed`. Do not schedule it against a Preview.
- A build passing, a Preview existing, and the migration files being committed are three
  different things from the six migrations being applied. None of them authorizes the next
  step; README §3's pre-flight and your review do.

## 3. Turning it on

1. Review and apply `supabase/migrations/20261026000100…000600` in order, one file per
   transaction, after running the P1–P7 pre-flight queries in the README. Apply them through
   the Supabase SQL editor or `supabase db push` — your call, executed by you.
2. Set the four variables above in the deployment's secret store (never in a committed file).
3. Expose the `data` schema to PostgREST per README §6, then verify with README §7 (V1–V9).
   README §2a explains why one-file-at-a-time matters for a failed apply, and §8 is the
   rollback — read §8b before dropping anything, since the two domains back columns on
   `public.environmental_data`.
4. Add a scheduler. It needs only the URL and `SYNC_SECRET`; it never needs the service-role
   key, which is why the trigger is an HTTP call and not a local script with database access.

**crontab / systemd** — `SYNC_URL` and `SYNC_SECRET` come from the environment;
`scripts/run-sync.mjs` prints neither:

```
SYNC_URL=https://your-app.example.com SYNC_SECRET='…' npm run sync:data
# one publisher group only:
SYNC_URL=https://your-app.example.com SYNC_SECRET='…' node scripts/run-sync.mjs --tasks market-prices
```

Exit codes: `0` wrote something, `1` the run was blocked or a task failed, `2` transport error
or missing `SYNC_SECRET` — so a cron line that mails failures on non-zero is enough.

**GitHub Actions** — a scheduled workflow that calls the same script, with both values as
secrets:

```yaml
on:
  schedule:
    - cron: '20 3 * * *'   # 06:20 EAT, after the NBE daily rate is published
jobs:
  sync:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '22' }
      - run: node scripts/run-sync.mjs
        env:
          SYNC_URL: ${{ vars.SYNC_URL }}
          SYNC_SECRET: ${{ secrets.SYNC_SECRET }}
```

**Vercel Cron** — `vercel.json` with a POST is the shortest version, but it sends no bearer
token, so it only works behind a platform-level secret header. Not configured in this repo: the
deployment target is yours to choose, and a stray `vercel.json` would be a presumption. If
Vercel is the platform, prefer a Cron Job hitting an endpoint that reads
`process.env.CRON_SECRET` and forwards it, or run the schedule from GitHub Actions as above.

### Cadence, chosen per publisher rather than one global interval

- `market-prices`: the WFP survey is released monthly. A daily run re-fetches the newest month
  and changes nothing else; the run is idempotent because the conflict target is the full
  natural key (`source_id, market_key, commodity, unit, currency, retail, observed_on`).
- `climate`: daily. History is 45 rolling days, so a missed week repairs itself on the next run.
- `exchange`: daily after the NBE publication, plus the World Bank series, which moves monthly
  or annually and is stored with its own `frequency` — the schema CHECK ties
  `official-indicative` to daily and `unofficial-market-average` to monthly, so a monthly
  figure cannot be written as if it were today's rate.
- `satellite`: daily at most; a composite appears every 8–16 days regardless, and
  `data.satellite_layers.latest_available_date` records what is actually there.
- A safe single schedule is one run per day. There is no benefit to hourly, and the publishers
  would notice.

## 4. Reading the result

`GET /api/data/status?sources=all&persisted=1` returns the live probes **and** `data.sync`, the
latest run per source from `data.v_source_freshness`. `components/data/SourceStatusPanel.tsx`
renders it under "Stored pipeline"; when the list is empty it says so plainly, because an empty
sync list is a real state, not an error. `GET /api/data/sync` lists the task names and whether
the endpoint is configured, and never reveals the secret.

That freshness view is the only SQL the application reads. The sync is, as of this writing, a
**history writer with no reader**: the dashboard keeps calling publishers directly, so a
successful run cannot change what a farmer sees until a route is pointed at `data.*`. Say
"history is being accumulated", not "the dashboard now uses the database".

### Proving a write actually landed

`rows_written` is the runner's own claim, so check it against the tables. Run this in the SQL
editor after the first sync — it reads nothing but counts and the newest stored observation per
source, and it is the one query that distinguishes "the endpoint returned 200" from "rows are
in the database":

```sql
-- What the last run claimed vs what is stored.
select source_key, status, rows_written, rows_rejected, observed_at, error_code, finished_at
  from data.v_source_freshness
 order by started_at desc;

-- Row counts per table, with the newest publisher date each one holds.
select 'location'                    as table_name, count(*) as rows, max(retrieved_at)::date as newest_write, null::date as newest_observation from data.location
union all select 'market_price_observations',    count(*), max(retrieved_at)::date, max(observed_on) from data.market_price_observations
union all select 'daily_climate',                count(*), max(retrieved_at)::date, max(climate_date) from data.daily_climate
union all select 'exchange_rate_observations',   count(*), max(retrieved_at)::date, max(observed_on) from data.exchange_rate_observations
union all select 'economic_indicator_observations', count(*), max(retrieved_at)::date, null::date from data.economic_indicator_observations  -- newest period is text ('2024', '2026-08'), not a date: select max(period) separately
union all select 'satellite_layers',             count(*), null, max(latest_available_date) from data.satellite_layers
union all select 'satellite_observations',       count(*), max(retrieved_at)::date, max(scene_date) from data.satellite_observations
union all select 'market_monthly_summary',       count(*), null, null from data.market_monthly_summary;  -- 0 by design: no writer yet

-- The mirror wrote its columns and left the legacy ones alone.
select location_name, date, source_id, value_kind, rainfall_mm, temp_max, et0_mm,
       soil_moisture_pct, ndvi_index, climate_risk_score
  from data.v_environmental_mirror
 order by record_replaced_at desc limit 10;
```

Three checks that mean more than a row count:
`rows_written` ≈ the table's count for a first run; `max(observed_on)` / `max(climate_date)` is
the publisher's own newest date rather than today's date (a stored "observation" dated today
when the survey is monthly is a lie somewhere upstream); and `select count(*) from
data.sync_runs where status = 'failed'` grows only when a publisher or the REST configuration
is genuinely broken.

### Turning it back off

Disabling the schedule stops all writes; nothing else needs to change. The lease expires on its
own (20 minutes) if a worker dies mid-run, so recovery is "wait, then run again" — the upserts
are idempotent on the natural key, which is what makes a rerun safe rather than duplicating.
To stop writes without touching the scheduler, remove `SUPABASE_SERVICE_ROLE_KEY` from the
deployment: `lib/supabaseAdmin.ts` then fails closed and `/api/data/sync` reports the missing
variable by name, never by value.


## 5. What this pipeline will not do

- Write `public.market_intelligence` or `public.exchange_rates`, or the
  `unified_market_intel` view. The legacy view divides by 10 or multiplies by 1000 depending on
  a `source` string and then labels the result USD; an Ethiopian ETB retail price pushed through
  it becomes a wrong dollar figure with our name on it. New rows go to `data.*` tables that
  store currency, unit, and observation date as columns instead of as arithmetic.
- Touch `soil_moisture_pct`, `ndvi_index` or `climate_risk_score` on `public.environmental_data`.
  Those legacy columns are model output and a placeholder-derived score (`harvester/environment_enricher.py`
  computes them from a hard-coded 100 mm monthly rainfall), and are commented as such in the
  migration. The mirror writes only the columns the new pipeline genuinely sources.
- Blend publishers. NASA POWER and Open-Meteo rows for the same place and day are stored
  separately with their own `source_id`; nothing is averaged into a single "temperature".
- Present a forecast, model output, or benchmark as an Ethiopian observation. `value_kind` is a
  constrained column, every payload carries it, and the contract checker asserts it.
