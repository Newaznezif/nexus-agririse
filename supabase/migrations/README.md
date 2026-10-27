# Reviewed data migrations — `supabase/migrations/`

**These files have not been executed. Nothing in this directory has touched any database.**

They are the reviewed draft for persisting the open-data integrations that now run live in
`/api/data/*`. Apply them only after you have read this file, run the pre-flight queries in
section 3, and are happy with the diff. Nothing in the pack drops a table, deletes a row,
updates a row, or modifies any value in an existing table. Three statements are not purely
additive, and each is named so nobody has to audit for them: file 0001 relaxes
`climate_risk_score`'s NOT NULL (no stored value changes; an existing insert still succeeds),
and files 0002–0005 each run `drop trigger if exists` immediately before recreating **their
own** trigger on **their own** new table. Section 8 is the only place that destroys data, and
it is a manual step you choose to run.

---

## 1. Why new tables at all

The repository's own scripts (`harvester/setup*.sql`) create four tables and one view. They
cannot hold what this project now has:

| Existing object | What it can store | What is missing |
| --- |---| --- |
| `public.market_intelligence` | commodity, price, volume, grade, region, scrape timestamp, source | **no unit, no currency, no observation date.** Its `price` is meaningless without them, and the `unified_market_intel` view derives `price_usd_per_mt` from hard-coded assumptions (ECX ⇒ per quintal, NAEB ⇒ per kilogram, anything else ⇒ already USD). Feeding WFP rows (ETB per 100 KG) through that `CASE` would publish an Ethiopian retail price as a US dollar price. |
| `public.environmental_data` | location, date, rainfall, modelled soil moisture, max temp, `ndvi_index`, risk score | no provenance, no `et0_mm`, no radiation, no forecast flag. `ndvi_index` is **computed from soil moisture** (`0.4 + moisture*0.5 + rain/50`, clamped) by `harvester/environment_enricher.py` — it is not a satellite observation. `climate_risk_score` uses a hard-coded 100 mm monthly placeholder. |
| `public.exchange_rates` | one row per currency code | `currency_code` **is the primary key**, so it physically cannot hold a dated series. `updated_at` describes the cache, not the publication. |
| `public.harvester_status` | one JSONB value per key | fine as-is; not touched. The production pre-flight did not see this table at all (section 3a), and the dashboard's client-side read of it is wrapped in try/catch (`app/dashboard/page.tsx`), so the freshness chip degrades silently rather than erroring. It is not a dependency of this pack. |
| `public.insights` | summary, risk level, trend | not touched by this pack (stage-1/P0-3 work). |

So: `market_intelligence` and `exchange_rates` keep their current owners and current
meanings, and the new pipeline writes to `data.*`, where every row carries its own units,
observation date and provenance. `public.environmental_data` **is** reused — it already
means "one row per place per day" — via additive columns plus a single designated writer
(section 5).

## 2. Apply order

```
20261026000100_data_schema_preparation.sql      schema, domains, trigger fn, legacy guards
20261026000200_data_market_observations.sql     data.location, market prices, monthly summary
20261026000300_data_weather_and_agroclimate.sql data.daily_climate + environmental_data mirror
20261026000400_data_exchange_and_indicators.sql dated rate history, macro indicators
20261026000500_data_satellite_observations.sql  layer registry, tile point readings
20261026000600_data_sync_bookkeeping.sql        sync_runs, leases, grants
```

One file per transaction. In the Supabase SQL Editor, paste one file, run it, then the next.
Each file is safe to re-run: `create table if not exists`, `create index if not exists`,
`add column if not exists`, `create or replace view/function`, and `do $$` guards that only
act when something is genuinely missing.

A seventh file sits in this directory but is **not part of this pack**:

```
20261027000100_market_intel_view_lockdown.sql   revoke anon/authenticated SELECT on the
                                                legacy unified_market_intel view (H-6)
```

It has its own review and its own apply decision, and it has no dependency on the pack at all —
the object it touches is the legacy harvester view, which none of the six files creates, drops or
alters. It also sorts last, so `supabase db push` cannot apply it before the pack. Conversely,
and this matters while the pack is still unapplied: `db push` applies *every* pending file, so it
cannot be used to land only the lockdown. Paste that file's sections 1-3 into the SQL Editor for
that. See section 10.

Before that file is applied, **P8 below is the pre-flight**: it is read-only, it captures the
view's original ACL (which the lockdown's rollback section 4a cannot do without), and it answers
the questions the lockdown's guard refuses to guess — whether `PUBLIC` holds SELECT, whether
`service_role` can read the view and all three joined base tables, whether the executing role is
allowed to alter the view at all, and what the server version is. If `public_has_select` comes back
true, the lockdown is the wrong patch for this project and needs a reviewed decision about `PUBLIC`
first. When it is applied, apply it inside an explicit `begin;` / `commit;` — the dashboard editor's
atomicity for a pasted multi-statement script has **not** been verified on this project, and there
is no local PostgreSQL here to check it against (see section 2 of that file, note 5e).

Two of those guards are worth naming, because "rerunnable" hides a real decision in them:

- **Domains.** `CREATE DOMAIN` has no `IF NOT EXISTS` in PostgreSQL, so file 0001 creates
  `data.value_kind` and `data.quality` inside a `do $$` block that looks each one up in
  `pg_type` first. If the domain is absent it is created. If it already exists, the block
  *verifies* it rather than trusting the name: it must be type kind `d`, it must be over
  `text`, every declared vocabulary value must cast into it, and a probe value outside the
  vocabulary must be rejected. Any of those failing raises
  `INCOMPATIBLE: …` and aborts the file. An existing domain that is looser than the pack
  needs would silently let an undeclared `value_kind` be stored, which is the exact failure
  this data model exists to prevent, so the guard reports instead of skipping.
- **The legacy mirror.** File 0003 checks `public.environmental_data` before it adds a single
  column: the table must exist, carry the eight legacy columns, have a unique index on
  `(location_name, date)`, and have an `id` that is either nullable or defaulted. A failure
  names the missing piece and aborts. That check `raise`s rather than skipping because the
  alternative is a `42P10` from `ON CONFLICT` at the first live sync, several weeks later,
  with no record of why.

### 2a. Partial failure: what "re-runnable" does not cover

The guards make a *second* run safe. They do not make a *first* run atomic in every client:

- `supabase db push` and the CLI wrap each migration file in a transaction, so a failure
  half-way through a file leaves that file entirely unapplied.
- Pasting into the Supabase SQL Editor is not guaranteed to be one transaction for the whole
  script. A statement that fails after earlier statements committed leaves the schema in a
  mixed state (for example file 0003's columns present but its view absent).
- Therefore: run **one file at a time**, and after any error re-run that file from the top
  before moving on. The guards and the `if not exists` forms are what make that safe.
- To see where a mixed state actually is, use section 7's V1–V4 verbatim; they are written to
  be run at any point, not only after a clean apply.

### 2b. How much of this pack PostgreSQL's own parser has actually checked

An earlier revision of this file said the pack was "static reviewed". That was not enough, and
it was wrong in a way that mattered: reviewed by eye, file 0006 looked fine until its two view
grants were run through a real grammar. So the pack was then parsed with **libpg_query**
(PostgreSQL's own parser, the same one `psql` and every client uses), compiled to WebAssembly
as `pg-query-emscripten`. It reported grammar version **160001**, i.e. the PostgreSQL 16.1
grammar.

How, so the result can be reproduced or doubted:

- The package was installed into a scratch directory **outside** this repository. `package.json`
  and `package-lock.json` are untouched, no dependency was added, and **nothing connected to any
  database** — a parser is not a server, and nothing here was executed.
- Each file was split at top-level semicolons by a tokenizer that honours `--` comments,
  `/* */` blocks, `''` escapes and `$tag$ … $tag$` dollar quoting, so a `do $$ … $$;` body stays
  one statement. Then every statement was parsed on its own, in a **fresh parser instance per
  file**: the asm.js runtime degrades after roughly ninety calls in a single instance and starts
  reporting internal errors for statements that are perfectly valid. Any harness that reuses one
  instance across this whole pack will produce false failures — that was observed, not assumed.
- Two negative controls confirmed the harness is actually parsing: `selct from where` and
  `create table t (id int;` both come back with real `syntax error at or near …` messages.
  Those two hold. An earlier revision of this section credited the run with a third,
  `alter table data.location alter column id set default (14)`, believing the parenthesised
  form to be a syntax error — probed directly, the grammar **accepts** it, so it was never a
  check, and the typo it was said to catch (`set default now()` on a `bigint`) was found by
  hand. Likewise "`ON ALL VIEWS`" is rejected but `alter default privileges for role x grant
  execute on routines to y` parses cleanly, so only the `ON VIEWS` class mis-spelling is a
  real control. Re-run them yourself before repeating any of this.
- Positive controls, same grammar, because the accepted object classes are what the file 0006
  comment now relies on: `on all tables`, `on all sequences`, `on all functions`, `on all
  procedures` and `on all routines` parse, while `on all views` and `on all materialized views`
  do not; in `alter default privileges`, `on tables`, `on sequences`, `on functions`,
  `on routines`, `on types` and `on schemas` parse, while `on views`, `on procedures` and
  `on materialized views` do not. Consequence worth knowing before adding anything: a
  materialized view in `data` would be reachable by **no** mass-privilege form, so it has to be
  granted by name and verified with V4.

| File | Statements | Grammar failures |
| --- | --- | --- |
| `…0001_data_schema_preparation` | 9 | 0 |
| `…0002_data_market_observations` | 37 | 0 |
| `…0003_data_weather_and_agroclimate` | 47 | 0 |
| `…0004_data_exchange_and_indicators` | 33 | 0 |
| `…0005_data_satellite_observations` | 26 | 0 |
| `…0006_data_sync_bookkeeping` | 36 → 34 | 2 found, both removed |
| `20261027000100_market_intel_view_lockdown` | 4 | 0 |

The last row was parsed on 2026-10-27, again after the revision described in section 10, with the
same harness in a fresh instance per file, alongside the two `harvester/` scripts the lockdown
mirrors (`recreate_view.sql`: 4 statements; `setup_normalization.sql`: 6; 0 failures each) and
file 0003 as a regression control (47 statements, unchanged). Also parsed the same day, 0 failures:
the P8 pre-flight below (1 `SelectStmt`), the migration's three de-commented verification queries
(3 `SelectStmt`), all 9 `sql` blocks of this README (43 statements) and of
`docs/SECURITY_REVIEW.md` (20 statements). The harness was checked against itself with deliberately
broken input (`select 1 from aclexplode(x) a wher 1=1;` → reported the expected syntax error), so
its PASS results are not vacuous.

The two failures were `grant select on all views in schema data to service_role;` and
`alter default privileges in schema data grant select on views to service_role;`, each
`syntax error at or near "views"`. PostgreSQL has no `ON ALL VIEWS` mass-privilege form and no
`VIEWS` class in `ALTER DEFAULT PRIVILEGES`; `ON TABLES` is the class that covers views, which
the GRANT documentation states outright. Those two statements would have aborted file 0006 at
apply time, after its tables, sequences, view and RLS statements had already taken effect — a
partial apply of exactly the kind section 2a describes. They are gone, and the file now says
why they were never needed.

What a grammar check does **not** buy you, and where the risk therefore still sits:

- **PL/pgSQL bodies are not validated.** `DoStmt` and `CreateFunctionStmt` parse as containers;
  PostgreSQL only checks the body text when the language handler runs, i.e. at apply time. The
  three `do $$` guards in 0001, the one in 0003, the two lease functions in 0006 and the guard in
  `20261027000100` were read by hand instead — which did find two real defects (an undeclared
  loop variable, and a `int2vector::int2[]` cast that is not in the grammar), but hand-reading is
  not a parse and should not be reported as one. This is not laziness: the WASM build ships
  `parsePlpgsql`/`raw_parse_plpgsql`, and probing it with deliberately broken bodies (`selct 1`,
  an unbalanced `end if`) returned `plpgsql_funcs: []` and an **empty error** every time, for
  `do` blocks and for `create function` wrappers alike. It reports nothing about the body, so it
  cannot be cited as a check. The only real test for a body is an apply against a throwaway
  database, which is what section 9 says is still outstanding.

  The 20261027000100 guard earned that hand-reading its keep: the first draft had two `RAISE`
  format defects this tooling cannot see and a live apply would have hit immediately — `%%` where a
  `%` placeholder was meant, which leaves an argument unconsumed and aborts with
  `too many parameters specified for RAISE`. Both were fixed, and the revised guard is now audited
  with a quote-aware local checker rather than by eye alone. Re-run after the second review round
  added three more aborts: 10 `RAISE` statements found (9 `EXCEPTION`, 1 `NOTICE`), 0 literal
  `%%`, placeholder count equal to top-level argument count on every one of them (0, 1, 2, 1, 2, 1,
  0, 0, 1 against 0, 1, 2, 1, 2, 1, 0, 0, 1, and 7 against 7 in the notice). That checker was
  itself tested by injecting both defects into a copy, which it reported correctly
  (`placeholders=7 args=8 <<< MISMATCH`, `mismatches=1`, `literal %% in guard: 1`). It is a text
  audit, not a PostgreSQL validation: it cannot see a wrong variable name, a bad expression, or an
  unbalanced `end if`.
- **No semantic analysis.** Object existence, `has_*_privilege()` argument shapes, whether
  `security_invoker` is accepted on your server version, FK targets, and every privilege name
  are outside what a raw parser can see.
- **Nothing has been executed.** The remaining decisive step is unchanged: apply the pack to a
  **throwaway** Supabase project (or a local PostgreSQL 15+) with the same major version as
  production, run section 7, and only then treat these files as applyable to the real project.
  That is the environment in which the `REFERENCES` question in file 0006 also gets answered.

One operational cost to know before running file 0003 on a populated database: it adds
`record_replaced_at timestamptz not null default now()` to `public.environmental_data`. A
volatile default cannot use the fast `ADD COLUMN` path, so Postgres rewrites the table and
holds an exclusive lock for the duration. No value is changed and no row is lost, but on a
large table that is a write-blocking step — run it when the legacy harvester is idle, and use
P3's count to judge the size first. Every other column this pack adds is nullable or has a
constant default, which does not rewrite.

## 3. Pre-flight — run these FIRST and paste the results back

This pack was written from the repository's SQL scripts, not from `information_schema`, and
the first pass assumed the legacy shape. The queries below have since been run read-only
against the production project and the answers are recorded in section 3a. Run them again
after any change to the project, and treat nothing here as verified that this file does not
state as verified.

```sql
-- P0 PostgreSQL version. The pack needs 15+ for `alter view … set (security_invoker = true)`,
--    which four views rely on to avoid becoming owner-rights read paths. On 14 or older those
--    four statements fail and the views stay security-definer by default — a real exposure, not
--    a cosmetic one. Supabase projects are 15+; confirm rather than assume.
select current_setting('server_version_num')::int as version_num,
       version()                                   as build;

-- P1 Which of the legacy objects actually exist, and with which columns?
select table_name, column_name, data_type, is_nullable
  from information_schema.columns
 where table_schema = 'public'
   and table_name in ('market_intelligence','environmental_data','exchange_rates','harvester_status','insights')
 order by table_name, ordinal_position;

-- P2 Does (location_name, date) already have a uniqueness target? If not, the climate
--    mirror in file 0003 has nothing to upsert against.
select conname, pg_get_constraintdef(oid)
  from pg_constraint
 where conrelid = 'public.environmental_data'::regclass and contype in ('u','p');
select indexname, indexdef
  from pg_indexes
 where tablename = 'environmental_data' and schemaname = 'public';

-- P3 Row counts, so you know the size of what already exists (this pack never reads or
--    rewrites these rows, but you should know before saying "apply").
select 'environmental_data', count(*) from public.environmental_data
union all select 'market_intelligence', count(*) from public.market_intelligence
union all select 'exchange_rates', count(*) from public.exchange_rates;

-- P4 RLS posture of the legacy tables, and whether the API roles can already see them.
select c.relname, c.reloptions,
       (select coalesce(string_agg(p.policyname, ', '), 'NO POLICIES')
          from pg_policies p where p.tablename = c.relname and p.schemaname = 'public') as policies
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public'
   and c.relname in ('market_intelligence','environmental_data','exchange_rates','harvester_status');
select relname, relrowsecurity, relforcerowsecurity
  from pg_class where relnamespace = 'public'::regnamespace
   and relname in ('market_intelligence','environmental_data','exchange_rates','harvester_status');

-- P5 Does the role the sync will use really bypass RLS, and does it hold privileges?
--    If `rolbypassrls` is false, writes to `data.*` still work (grants are explicit in
--    file 0006) but so does any other role you granted — read the result carefully.
select r.rolname, r.rolsuper, r.rolbypassrls, r.rolcanlogin
  from pg_roles r where r.rolname in ('service_role','anon','authenticated','postgres','authenticator');

-- P5b Can the sync's role already write the one legacy table it mirrors into? `bypassrls`
--     skips ROW policies only; without table privileges the mirror fails with 42501 no matter
--     what P5 says. Supabase's project default privileges usually cover this, and file 0003
--     grants it explicitly so the pack does not depend on that assumption.
select has_schema_privilege('service_role','public','usage')                          as public_usage,
       has_table_privilege('service_role','public.environmental_data','insert')       as can_insert,
       has_table_privilege('service_role','public.environmental_data','update')       as can_update;

-- P6 Which schemas does the REST API serve? If `data` is not in there, section 6 applies.
select setdatabase, setrole, config
  from pg_db_role_setting s
  left join pg_roles r on r.oid = s.setrole
 where config::text ilike '%db_schemas%' or config::text ilike '%search_path%';

-- P7 The two existing objects this pack does NOT touch, whose permissions are an open
--    security question rather than a migration step (see section 10). Read-only.
select table_name, privilege_type, grantee
  from information_schema.role_table_grants
 where table_schema = 'public'
   and grantee in ('anon','authenticated','public')
 order by table_name, grantee, privilege_type;

select c.relname, c.relkind, c.relowner::regrole,
       coalesce(array_to_string(c.reloptions, ','), '(no options — a plain view runs as its OWNER)') as options,
       (select count(*) from pg_policies p where p.schemaname = 'public' and p.tablename = c.relname) as policies
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relname in ('unified_market_intel','market_intelligence','environmental_data','exchange_rates','harvester_status');

select pg_get_viewdef('public.unified_market_intel'::regclass, true) as view_definition;
```

#### P8 — the before-state for the H-6 lockdown (read-only, not yet executed)

`20261027000100_market_intel_view_lockdown.sql` revokes SELECT on
`public.unified_market_intel` from `anon` and `authenticated` and sets
`security_invoker`. **STRICTLY READ-ONLY**: catalog and privilege metadata only — no grant, no
revoke, no comment, no alter, no insert/update/delete, nothing that writes. It has **NOT been
executed anywhere**, because nothing in this pack can be executed from this machine; it is
prepared for a human to run in the Supabase SQL Editor.

Run it BEFORE applying the lockdown and keep the output. It is the record of the original ACL
that section 4a of that file needs in order to restore anything exactly — after the revoke has
run, the before-state is unrecoverable from the database.

One row. Every object reference goes through `to_regclass()`, every role reference through
`to_regrole()`, and the view itself arrives by a `LEFT JOIN`, so a missing object or a missing
role yields NULL instead of aborting the query — for a pre-flight that must report rather than
fail, that distinction is the whole design. Read NULL as **"not measured on this project"**, never
as "denied": `false` is only ever returned where the question was actually answerable (a table that
exists, a role that exists, an ACL that exists). `relacl IS NULL` is likewise reported as the
default-privileges state rather than as "no grant exists". `aclexplode()` renders the ACL with
grantee OID `0` labelled **`PUBLIC`** — the pseudo-role an ordinary
`information_schema.role_table_grants` query (P7 above) hides, and the one case the lockdown
refuses to guess about. A grantee whose OID has no `pg_roles` row renders as `role-oid-N` rather
than as a blank name, so an orphaned or unusual grantee cannot be mistaken for "nobody".
`relacl_readable` is the labelled rendering to review; `relacl_raw` (the same `aclitem[]` cast to
text, because that is what most clients can print) is the byte-level record to keep.
`svc_is_superuser` and `svc_bypassrls` are reported side by side because they are not
interchangeable: superuser answers the grant question for you, BYPASSRLS does not grant table
SELECT at all.

```sql
-- P8 before-state for 20261027000100_market_intel_view_lockdown.sql. READ-ONLY: metadata only,
--    no grant/revoke/comment/alter/DML. Run BEFORE applying the lockdown and keep the output.
select
  current_setting('server_version')                       as server_version,
  current_setting('server_version_num')::int              as server_version_num,
  current_user                                            as executed_as,
  (c.oid is not null)                                     as view_exists,
  n.nspname                                               as view_schema,
  c.relname                                               as view_name,
  c.relkind::text                                         as relkind,
  pg_get_userbyl(c.relowner)                              as view_owner,
  coalesce(array_to_string(c.reloptions, ','),
           '(NULL: a plain view, runs as its OWNER)')     as reloptions,
  coalesce((select string_agg(
              case when a.grantee = 0 then 'PUBLIC'
                   else coalesce(r.rolname, 'role-oid-' || a.grantee::text) end
              || '=' || a.privtype::text
              || case when a.is_grantable then '*' else '' end
              || '/' || coalesce(g.rolname, 'role-oid-' || a.grantor::text), ', ')
            from aclexplode(c.relacl) a
            left join pg_roles r on r.oid = a.grantee
            left join pg_roles g on g.oid = a.grantor),
           '(NULL relacl: default privileges; for a view that is OWNER ONLY, no PUBLIC entry)')
                                                          as relacl_readable,
  c.relacl::text                                          as relacl_raw,
  -- The grant the lockdown cannot cancel selectively. If this is true, `revoke ... from anon,
  -- authenticated` fixes nothing, the lockdown's guard aborts on purpose, and the decision about
  -- PUBLIC has to be made by a reviewer instead of by a migration.
  case when c.relacl is null then false
       else exists (select 1 from aclexplode(c.relacl) a
                     where a.grantee = 0 and a.privtype = 'r') end          as public_has_select,
  case when c.relacl is null then false
       else exists (select 1 from aclexplode(c.relacl) a
                     join pg_roles r on r.oid = a.grantee
                    where r.rolname = 'anon' and a.privtype = 'r') end      as anon_direct_select,
  case when c.relacl is null then false
       else exists (select 1 from aclexplode(c.relacl) a
                     join pg_roles r on r.oid = a.grantee
                    where r.rolname = 'authenticated' and a.privtype = 'r') end as auth_direct_select,
  case when c.relacl is null then false
       else exists (select 1 from aclexplode(c.relacl) a
                     join pg_roles r on r.oid = a.grantee
                    where r.rolname = 'service_role' and a.privtype = 'r') end  as svc_direct_select,
  -- What each role can actually do, inheritance included. `anon_direct_select` false with
  -- `anon_effective_select` true can only mean the privilege arrives through PUBLIC or a granted
  -- role — the case the lockdown refuses to guess about. The `case` wrappers exist so a missing
  -- view yields NULL ("not measured") instead of handing has_table_privilege() an empty OID, whose
  -- behaviour differs across versions, and so a missing ROLE yields NULL too — has_table_privilege
  -- raises `role does not exist` and would abort the whole pre-flight, which must report instead of
  -- failing. NULL therefore always means "not measured here", never "denied".
  case when c.oid is null or to_regrole('anon') is null then null
       else has_table_privilege('anon',          c.oid, 'select') end as anon_effective_select,
  case when c.oid is null or to_regrole('authenticated') is null then null
       else has_table_privilege('authenticated', c.oid, 'select') end as auth_effective_select,
  case when c.oid is null or to_regrole('service_role') is null then null
       else has_table_privilege('service_role',  c.oid, 'select') end as svc_effective_select,
  -- The lockdown's own prerequisites. security_invoker makes the view read the base tables as the
  -- CALLING role, so service_role needs these directly; bypassrls does not supply them. A missing
  -- base table reports false — the honest answer, since the harvester cannot read what does not
  -- exist, and the migration's guard refuses that case too. A missing service_role reports NULL:
  -- the role's existence is a separate question from the table's, and conflating them would hide
  -- the reason nothing could be read.
  to_regrole('service_role') is not null                            as service_role_exists,
  case when to_regrole('service_role') is null then null
       when to_regclass('public.market_intelligence') is null then false
       else has_table_privilege('service_role', to_regclass('public.market_intelligence'), 'select') end as svc_select_market_intelligence,
  case when to_regrole('service_role') is null then null
       when to_regclass('public.exchange_rates') is null then false
       else has_table_privilege('service_role', to_regclass('public.exchange_rates'), 'select') end as svc_select_exchange_rates,
  case when to_regrole('service_role') is null then null
       when to_regclass('public.environmental_data') is null then false
       else has_table_privilege('service_role', to_regclass('public.environmental_data'), 'select') end as svc_select_environmental_data,
  -- Role attributes, reported rather than assumed: a superuser bypasses the grant question
  -- entirely, and BYPASSRLS does NOT grant table SELECT, so the two must not be read as one.
  (select rolsuper     from pg_roles where rolname = 'service_role') as svc_is_superuser,
  (select rolbypassrls from pg_roles where rolname = 'service_role') as svc_bypassrls
 from (values (1)) as driver(rownum)
 left join pg_class c     on c.oid = to_regclass('public.unified_market_intel')
 left join pg_namespace n on n.oid = c.relnamespace;
```

`server_version_num` below 150000 means the lockdown cannot set `security_invoker` here at all.
Three `true`s in the `svc_select_*` columns mean it can be set safely; a `false` is not an error
to work around, it is a separate permission decision. Those two prerequisite groups had **no
production measurement** when `20261027000100_market_intel_view_lockdown.sql` was drafted — the
migration guards them instead of assuming them, and P8 is how a reviewer checks them.

`public_has_select = true` is the result that stops the lockdown rather than fixing it. If SELECT
was granted to the `PUBLIC` pseudo-role, `revoke … from anon, authenticated` changes nothing at
all (those roles keep inheriting the privilege), and the only honest response is to report it for
a reviewed decision about `PUBLIC` — which is why the migration raises rather than reaching for
`revoke … from public`, an operation that would strip privileges every other role inherits,
`service_role` included. Cross-check the two readings: `anon_direct_select = false` together with
`anon_effective_select = true` means the privilege arrives through `PUBLIC` or through role
membership, not through a named grant.

### 3a. What the production pre-flight established (and what it did not)

Run read-only against the production project on 2026-10-27. Nothing in this pack has been
applied, so every statement below describes the schema **before** these migrations:

- `public.environmental_data` exists as `id uuid not null default gen_random_uuid()`,
  `location_name text not null`, `date date not null`, `rainfall_mm`, `soil_moisture_pct`,
  `temp_max`, `ndvi_index` numeric, `climate_risk_score integer`, `created_at timestamptz
  default CURRENT_TIMESTAMP`, with a unique constraint on `(location_name, date)` already
  present. It is **not** the `id bigserial` shape `harvester/setup_env.sql` declares — the
  repository script and production have diverged. File 0003 records this and asserts only
  what the mirror depends on (`id` has a default; the pair is unique), never the `uuid` type.
- Row counts at the time of the check: `environmental_data` 0, `market_intelligence` 122,
  `exchange_rates` 4. So file 0003's table rewrite (section 2) was trivial on this project
  at that moment; it is not trivial on a populated copy, and counts change.
- `public.harvester_status` did **not** appear in P1's output. Either it does not exist or
  the role running the query cannot see its columns. Section 1 overstates it as a live
  dependency: the dashboard's client-side read (`app/dashboard/page.tsx`) is wrapped in
  try/catch, so the freshness chip degrades silently instead of erroring. No migration
  depends on that table.
- The anon read path through `public.unified_market_intel` was measured on 2026-10-27, after
  this list was written: **122 rows visible to an anonymous caller**, while
  `market_intelligence` itself returns 0 to the same key. See section 10a; it is the one
  production finding in this file that came from outside SQL.
- RLS is `enabled` but **not `forced`** on the legacy public tables; a service-role-only
  policy exists on `environmental_data`; `service_role` has `bypassrls` plus
  `usage`/`INSERT`/`UPDATE` as expected (P5, P5b).
- **P6 came back inconclusive.** Hosted Supabase keeps the exposed-schema list in its own
  API configuration, not in `pg_db_role_setting`, so an empty result does not mean `data`
  is unpublished. Confirm in the dashboard (API settings → exposed schemas) before choosing
  option A in section 6. Section 10a adds the same conclusion from outside: a `PGRST205` on
  `data.location` cannot distinguish "unpublished" from "never created", because the pack has
  not been applied.
- **P0 was not captured by that run** (it was added afterwards), so the project's
  `server_version_num` is unverified here. The pack needs PostgreSQL 15+ for the four
  `security_invoker` view settings; on an older server those statements fail and the views
  remain owner-rights read paths. Hosted Supabase projects are 15+, but that is platform
  knowledge, not a measurement — run P0 and paste the number.
- Still unverified, and not made less unverified by this pack: what `anon`/`authenticated`
  may read through `public.*` (P7), the ACL of `public.unified_market_intel` including whether
  `PUBLIC` holds SELECT, that view's owner and `reloptions`, the server version, and whether
  `service_role` holds SELECT on the three joined base tables (all of it: P8).

If **P1** shows `public.environmental_data` with extra `not null` columns beyond
`location_name` and `date`, stop: the climate mirror would fail on insert, and file 0001
only relaxes `climate_risk_score`. Tell me which columns are `not null` and I will adjust
the pack rather than have you loosen a constraint you did not choose to loosen.

## 4. What the pack asserts about honesty, in the database itself

These are not comments; they are constraints that will reject a write.

- `data.value_kind` / `data.quality` domains: a number whose kind is undeclared cannot be
  stored, so it cannot reach a chart. `observed`, `modeled`, `forecast`, `estimated`,
  `imputed` — nothing else.
- `daily_climate_has_a_value`: a row with every numeric column null is rejected. An empty
  row is not "data".
- `exchange_rate_has_a_figure`, same reason.
- `exchange_rate_kind_matches_frequency`: an `official-indicative` row must be labelled
  `daily`, an `unofficial-market-average` row must be labelled `monthly`. This is what makes
  "do not present monthly data as real-time" enforceable at the door rather than by a UI
  convention someone will forget.
- `economic_indicator_period_shape`: an annual figure's period is `2024`, not `2024-08-01`
  and not blank.
- `market_monthly_summary.change_pct` may be null only when there is no comparable previous
  observation — the `check` forbids a percentage without both dates. **A missing comparison
  is never written as 0 %**, which would read as "no change".
- `satellite_layers_states_limits`: a layer cannot exist without a caveat of at least 20
  characters. A layer whose limits are unstated is the layer that gets over-read.
- `satellite_layers_no_credentials_in_url`: the tile template is rejected if it contains
  `api_key`, `token` or `secret`. These tiles are public, and this column is copied into a
  `<img src>` in a browser, so a key must never be able to arrive here.
- `sync_run_finished_has_time` and `sync_run_detail_is_object`: bookkeeping cannot lie about
  having finished, and cannot store an arbitrary blob.

`is_forecast` vs the calendar is deliberately **not** a `check` constraint. A constraint on
`current_date` would be volatile, and would start rejecting legitimate rows as time passes:
a forecast written last week for a date that has now arrived is still a valid record of what
was forecast. That invariant is enforced at write time in `lib/data/sync.ts` and asserted by
`scripts/check-data-routes.mjs`.

## 5. `public.environmental_data` — the one reused table, and its single writer

Two publishers describe the same town on the same day (Open-Meteo model+analysis with
forecasts; NASA POWER satellite-derived agroclimatology, past days only). They disagree by
design, and averaging them produces a figure no publisher stands behind. So:

- `data.daily_climate` keeps **one row per (source, place, day)** — both publishers, never
  merged, each with its own provenance.
- `public.environmental_data` is refreshed from **one designated source only**: Open-Meteo for
  past days (`source_id = 'open-meteo-forecast'`; the mirror is written from that publisher's
  analysed history, see `upsertLegacyMirror` in `lib/data/sync.ts`). One writer, so the row's
  provenance can be true. The value is written into the columns that table already has
  (`rainfall_mm`, `temp_max`) plus the new ones file 0003 adds and the mirror genuinely
  supplies (`location_key`, `source_id`, `source_name`, `source_url`, `units`, `methodology`,
  `coverage`, `quality`, `value_kind`, `is_forecast`, `temperature_min_c`,
  `relative_humidity_pct`, `et0_mm`, `retrieved_at`, `record_replaced_at`).
- Wind and shortwave radiation are **not** mirrored: `public.environmental_data` has no such
  columns and this pack adds none, because a km/h figure in a column whose `units` string says
  m/s would misdescribe itself. Both live in `data.daily_climate`, where their units are stated
  on the row.
- `soil_moisture_pct`, `ndvi_index` and `climate_risk_score` are **never written** by the
  sync: not on insert, and not on update. `data.v_environmental_mirror` lists the owned
  columns next to the forbidden ones so this is checkable with one query rather than by
  trusting a code review. If the legacy harvester wrote those values, they survive a refresh
  untouched; if it did not, they stay null and the UI must say "not measured" rather than
  draw a line.
- Uniqueness on `(location_name, date)` is created by file 0001 only if nothing already
  enforces it. **If duplicates already exist, that statement fails and the transaction
  rolls back** — which is the intended outcome: you decide how to reconcile them, I do not
  delete rows on your behalf. The duplicate query is:

  ```sql
  select location_name, date, count(*) as rows
    from public.environmental_data
   group by location_name, date having count(*) > 1
   order by rows desc limit 40;
  ```

## 6. One reviewed configuration step, not a migration

PostgREST only serves the schemas in its `db-schemas` configuration. A table in an
unpublished schema returns `404 Could not find the table` — an honest failure, which is why
this pack does not bury an `alter role` to work around it.

Decide, then act:

- **Option A — publish `data`.** Add it to the project's exposed schema list (Supabase
  dashboard: API settings; self-hosted: `pgrst.db_schemas = 'public, data'`), then reload
  the API config. Prove it with the REST request in section 7.
- **Option B — keep `data` private.** Do nothing. The sync cannot write through PostgREST
  and will report `failed` with that message; every live route and dashboard card keeps
  working, because none of them depend on the database.
- **Option C — no scheduled sync at all.** Do not apply file 0006. The observation tables
  still work for anything you query directly, and nothing is scheduled.

If you choose A, note what it costs: the schema's object names become enumerable through the
public API endpoint. The tables remain unreadable (`RLS` enabled **and** `force`d, zero
policies, `revoke ... from anon, authenticated`), so the exposure is names, not rows. That
trade is yours to accept or refuse, which is why it is written down instead of silently done.

Once A is in place, `docs/DATA_SYNC.md` covers the credentials, the per-publisher cadence, and
the scheduler entries (crontab, GitHub Actions, Vercel) that actually run `POST /api/data/sync`.

## 7. Post-apply verification

```sql
-- V1 Everything in the pack exists and nothing in `public` lost a column.
select table_name from information_schema.tables
 where table_schema = 'data' order by table_name;
-- expected: daily_climate, location, market_monthly_summary, market_price_observations,
--           sync_leases, sync_runs, satellite_layers, satellite_observations,
--           economic_indicator_observations, exchange_rate_observations

-- V2 RLS is on and forced everywhere, and no policy slipped in.
select c.relname, c.relrowsecurity, c.relforcerowsecurity,
       (select count(*) from pg_policies p
         where p.schemaname = 'data' and p.tablename = c.relname) as policies
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'data' and c.relkind = 'r' order by c.relname;
-- expected: relrowsecurity = t, relforcerowsecurity = t, policies = 0 for every row.

-- V3 The API roles have nothing on anything in `data`.
select privilege_type, grantee
  from information_schema.role_table_grants
 where table_schema = 'data' and grantee in ('anon','authenticated') order by grantee;
-- expected: zero rows.

-- V4 service_role can reach the objects (this is what 42501 would have told you).
select has_schema_privilege('service_role','data','usage')                        as schema_usage,
       has_table_privilege('service_role','data.market_price_observations','insert') as can_insert,
       has_table_privilege('service_role','data.v_source_freshness','select')      as can_read_view,
       has_sequence_privilege('service_role','data.sync_runs_run_id_seq','usage')   as seq_usage,
       has_function_privilege('service_role','data.claim_sync_lease(text,text,interval)','execute') as can_claim;
-- expected: t, t, t, t, t
--
-- `can_read_view` still earns its place in this list, but not for the reason an earlier draft
-- of this file gave: PostgreSQL has no `ON ALL VIEWS` grant form at all, and the documentation
-- states that `"ALL TABLES" also affects views and foreign tables`. So the mass grant in file
-- 0006 covers the view — and if it ever stops covering it (a view created after a partial
-- apply, say), this check is what notices. Re-run the mass grant rather than inventing a
-- `ON ALL VIEWS` statement, which will not parse.

-- V5 The mirror really does leave the legacy columns alone.
select * from data.v_environmental_mirror limit 5;

-- V6 From outside SQL, as the anonymous API role — this must be empty, not an error and
--    not rows. Use your project URL and the ANON key only (never the service key here).
--   curl "https://<project>.supabase.co/rest/v1/data.market_price_observations?select=*"
-- expected: {"error":"...permission denied..."} or `[]`, and never a row.

-- V7 Nothing was scheduled yet, and no rows were written by applying DDL.
select count(*) from data.sync_runs;   -- expected 0 until the first sync attempt

-- V8 The domains are the declared ones, not a same-named lookalike. File 0001's guard prints
--    this at apply time; re-running it after a rollback-and-reapply is cheap insurance.
select t.typname, format_type(t.typbasetype, t.typtypmod) as base,
       (select coalesce(string_agg(c.conname, ','), 'NO CHECK — looser than this pack')
          from pg_constraint c where c.contypid = t.oid) as checks
  from pg_type t join pg_namespace n on n.oid = t.typnamespace
 where n.nspname = 'data' and t.typname in ('value_kind','quality') order by 1;

-- V9 The open privilege question from file 0006 section 5. This answers "does the role hold
--    REFERENCES", not "does inserting across an FK require it" — only a real insert does that.
--    Both rows below are the complete FK target list of the pack (file 0006 §5); anything
--    outside them has no foreign key and needs nothing.
select 'data.location' as target,
       has_table_privilege('service_role','data.location','references') as can_reference
union all
select 'data.satellite_layers',
       has_table_privilege('service_role','data.satellite_layers','references');
-- If `f`: nothing is wrong yet. Watch the first live sync for 42501 naming one of these two.
-- Only that error, in an isolated database, settles whether the grant is genuinely required.
```

## 8. Rollback

Rollback is not one script, because the pack contains two very different kinds of change and
only one of them is reversible by dropping things:

- **Structure that holds nothing until you use it.** Schemas, domains, functions, grants, the
  nullable columns on `public.environmental_data`. Removing these loses no value that existed
  before the pack, and (for the legacy columns) no value the pack invented either.
- **Rows collected after the pack was applied.** Every `data.*` table, and the mirror columns
  on `public.environmental_data`. `drop table data.daily_climate cascade` destroys months of
  weather history in one statement. There is no undo, and no `if not exists` that brings it
  back.

**Never run `DROP DOMAIN … CASCADE` here.** `data.value_kind` and `data.quality` are the
column types of `public.environmental_data.value_kind` and `.quality` as well as of the
`data.*` tables. `cascade` would therefore drop those *columns on the legacy table*, taking
their stored values with them, and would do it silently as a side effect of a type removal.
That is how a "cleanup" script deletes production data nobody meant to delete.

### 8a. Reversible part — the safe default

Use this when the pack must come off. It removes only objects in `data`, and it does not touch
`public` at all:

```sql
-- Order matters: views and functions first, then tables, then the domains, then the schema.
-- `drop schema` requires an empty schema, so the two domains would have to go BEFORE it —
-- but see 8b: they cannot be dropped without first dropping the columns that use them.
drop view  if exists data.v_source_freshness;
drop view  if exists data.latest_exchange_rates;
drop view  if exists data.v_indicator_latest;
drop view  if exists data.v_environmental_mirror;
drop function if exists data.claim_sync_lease(text, text, interval);
drop function if exists data.release_sync_lease(text, text);
drop function if exists data.touch_replaced_at();
drop table if exists data.sync_leases, data.sync_runs,
                     data.satellite_observations, data.satellite_layers,
                     data.economic_indicator_observations, data.exchange_rate_observations,
                     data.daily_climate, data.market_monthly_summary,
                     data.market_price_observations, data.location cascade;
```

`drop table … cascade` is scoped to the `data` objects in the list: it removes the FKs
between them (`daily_climate.location_key → location.location_key`, and the same on the other
observation tables) and any view defined over them. It reaches nothing in `public`. **This
statement destroys every observation the sync has written.** Count it first:

```sql
select 'daily_climate', count(*) from data.daily_climate
union all select 'market_price_observations', count(*) from data.market_price_observations
union all select 'exchange_rate_observations', count(*) from data.exchange_rate_observations
union all select 'satellite_observations', count(*) from data.satellite_observations
union all select 'economic_indicator_observations', count(*) from data.economic_indicator_observations
union all select 'location', count(*) from data.location;
```

If every count is 0, this rollback is genuinely free. If they are not, snapshot or export
before running it — dropping a table that holds collected data is a data-destruction event,
not a schema change.

`drop schema data` also strands the three `alter default privileges in schema data grant …`
statements from file 0006 (they were scoped to that schema). If you want them gone explicitly,
reverse them **before** dropping the schema:

```sql
alter default privileges in schema data revoke all on tables    from service_role;
alter default privileges in schema data revoke all on sequences from service_role;
alter default privileges in schema data revoke all on functions from service_role;
```

There is deliberately no `on views` line: `ALTER DEFAULT PRIVILEGES … ON VIEWS` is not
PostgreSQL syntax (the grammar rejects it at the word `views`), and the TABLES entry above is
what reverses the grant that covered the views.

### 8b. Irreversible part — removing the domains and the schema

Only needed if you want `data` gone entirely. Do it explicitly, in this order, and stop at any
step whose check does not look like what you expected:

```sql
-- Step 1. Name every column typed by the two domains, in both schemas. Expected result:
--         data.daily_climate / market_price_observations / … AND public.environmental_data's
--         value_kind + quality. Write the list down; these are the things at risk.
select n.nspname, c.relname, a.attname
  from pg_attribute a
  join pg_class c on c.oid = a.attrelid
  join pg_namespace n on n.oid = c.relnamespace
 where a.atttypid in ('data.value_kind'::regtype, 'data.quality'::regtype)
   and a.attnum > 0 and not a.attisdropped
 order by 1, 2, 3;

-- Step 2. 8a must already be done, so the only remaining users are the two legacy columns.
--         Do they hold anything? If this returns rows, dropping the columns destroys synced
--         history and you must decide that consciously, not as a cascade side effect.
select count(*) filter (where value_kind is not null) as rows_with_kind,
       count(*) filter (where quality   is not null) as rows_with_quality,
       count(*) as total
  from public.environmental_data;

-- Step 3. Destroying the columns to free the domains. IRREVERSIBLE for any non-null value.
--         Skip this whole block if Step 2 returned rows and you have not exported them.
alter table public.environmental_data drop column if exists value_kind;
alter table public.environmental_data drop column if exists quality;

-- Step 4. Now these drops succeed WITHOUT cascade — which is the point. If PostgreSQL still
--         refuses, something depends on the domain that this file does not know about; read
--         the error instead of adding `cascade` to make it quiet.
drop domain if exists data.value_kind;
drop domain if exists data.quality;

-- Step 5. The schema is empty now and can go.
drop schema if exists data;
```

Step 4 failing is information, not an obstacle. Reaching for `cascade` there is precisely how
`public.environmental_data` loses columns nobody intended to lose.

### 8c. What rollback does not undo, by design

- the unique index on `public.environmental_data (location_name, date)` (file 0001 added it
  only because nothing enforced it; removing it would put the table back into the state where
  a sync duplicates rows — drop it yourself only if you have a reason);
- the added nullable columns on `public.environmental_data`. They hold nothing until a sync
  writes them, and `drop column` would destroy whatever a later run stored. The legacy
  harvester ignores unknown columns, so leaving them is the safe state. Only section 8b
  drops them, and only after you have counted what is in them.
- the `grant select, insert, update on public.environmental_data to service_role` from file
  0003 and the `climate_risk_score` NOT NULL relaxation from file 0001. Both widen what an
  existing role may do; neither destroys a stored value, and revoking or re-adding a NOT NULL
  on a live table is your decision, not a rollback side effect. To reverse them explicitly,
  once you have confirmed nothing else needs them:

  ```sql
  revoke select, insert, update on public.environmental_data from service_role;
  ```

  Note that `harvester/setup_env.sql` also created a service-role-only RLS policy on that
  table; revoking the privilege does not remove the policy, and the two are separate decisions.

## 9. Explicitly not in this pack

- **No execution.** These files have not been run against any database, local or production. The
  drafted lockdown (`20261027000100`, section 2) has not been run either, and nothing in it has
  been applied to the live project.
- **No changes to `datasets`, `insights`, storage buckets, or any authentication policy.**
  The stage-1 ownership work and its open questions (`insights.user_id`, `datasets.user_id`)
  are untouched; the V-1 verification results are still outstanding.
- **No writes to `public.market_intelligence`, `public.exchange_rates`, or the
  `unified_market_intel` view.** Repointing the view at the new tables needs a real unit
  policy (quintal vs 100 KG vs kg, and an ETB→USD decision with a dated rate) — that is a
  decision for you, not a migration I should slip in.
- **No writer for `data.market_monthly_summary`.** The table is defined with the right shape
  (`value_kind = 'estimated'`, both observation dates, a check that forbids a percentage
  without a comparable previous month) and stays empty until a sync task fills it. The markets
  board derives the same figure per request from live WFP rows, so nothing reads the empty
  table and nothing should report its row count.
- **No read path from `data.*` into the dashboard.** Today the only SQL the app runs is
  `data.v_source_freshness` on `/api/data/status?persisted=1`, which reports sync bookkeeping.
  Every card still calls its publisher. Applying this pack creates history; it does not
  switch any screen to reading from Postgres, and no claim to the contrary should be made
  until a route is pointed at the tables.
- **No full raster storage.** GIBS tiles are rendered by the browser from the publisher and
  sampled server-side into point readings; storing rasters row-by-row in Postgres would be
  the wrong tool.
- No `drop trigger`, `alter owner`, or tablespace/storage parameter anywhere.

## 10. Existing permissions this pack leaves alone (unresolved security review)

**This is a pre-existing condition, not something these migrations introduced, and this task
deliberately changes nothing about it.** The read-only review of the production project
reported broad privileges for `anon` and `authenticated` on several `public.*` tables and on
`public.unified_market_intel`. Revoking or re-policing that is a separate, approved change with
its own review; it must not ride along inside a data-migration PR, and it must not be done by
guessing which readers depend on it — the live dashboard can break on a revoke the way it can
break on a bad migration.

**Status of that separate change, 2026-10-27 (revised after review):** drafted, unapplied, and
deliberately still unapplied — see `20261027000100_market_intel_view_lockdown.sql` (section 2)
and the P8 pre-flight above. It is exactly the scoped version of this question: one object,
`revoke select` from `anon`/`authenticated` plus `security_invoker = true`, nothing about
`service_role`, nothing about the three base tables, nothing about `PUBLIC`, nothing about
ownership or default privileges. The "which readers depend on it" guessing was replaced by a grep
of the whole app: no file in `app/`, `components/`, `hooks/`, `services/` or `lib/` references
that view (the only near-hits anywhere in those directories are two uses of the literal string
`'exchange_rates'` as a *category label*, `lib/data/sources.ts:64` and `lib/data/types.ts:70`, and
the service-role upsert into `environmental_data`), so the expected breakage is zero. Three things
the drafts got wrong or left unasked, all now guarded rather than assumed:

- **`PUBLIC`, and inheritance in general.** If SELECT on the view was granted to the `PUBLIC`
  pseudo-role, revoking it from `anon` and `authenticated` changes nothing — those roles keep
  inheriting it through membership — while `revoke … from public` would strip privileges from every
  other role that inherits them, including `service_role`, the one reader that must survive.
  Neither is a decision a migration should make blind. The guard now reads `pg_class.relacl`
  through `aclexplode()`, labels grantee OID `0` as `PUBLIC` instead of dropping it, treats a NULL
  `relacl` as the default-privileges state (for a view: owner only, no `PUBLIC` entry) rather than
  as "no grant", raises when `PUBLIC` holds SELECT, and raises on the general form of the same
  trap: either target role able to `select` effectively according to `has_table_privilege()` while
  holding no direct ACL entry. In both cases it applies nothing and reports the exact ACL for
  review. P8 answers that question from the catalog; the answer decides whether this patch is the
  right patch at all.
- **The two prerequisites `security_invoker` depends on.** PostgreSQL 15+ and
  `service_role` SELECT on all three joined tables. Neither had ever been measured on production
  when the first draft was written — P5b measured `usage`/`insert`/`update` on
  `environmental_data` only, and P0's server version was never captured. They are now checked
  inside the migration before any statement mutates anything, and P8 is the read-only way to
  check them from the outside first. That check is not cosmetic: `security_invoker` converts the
  view's owner-rights shortcut into a direct privilege requirement, so setting it without those
  grants would trade an anonymous leak for a broken harvester.
- **Two preconditions the second review round found unchecked** (2026-10-27, after the first
  revision). The draft *reported* the view's owner but never asked whether the role running the
  script may alter it — `revoke` and `alter view … set` both require the owner, a member of the
  owner, or a superuser, so that is now a guard (`pg_has_role(relowner, 'usage')` plus a
  `rolsuper` fallback), not a comment. And it checked `service_role`'s SELECT on the three joined
  tables without checking that `service_role` can read **the view itself**, which is the actual
  harvester dependency; that is now a guard too, with `to_regrole()` so a project lacking the role
  gets this file's message instead of a raw catalog abort. The same round recorded that
  **apply-time atomicity is unverified**: the dashboard editor's handling of a pasted
  multi-statement script was never tested here and there is no local PostgreSQL to test it on, so
  the apply must be wrapped in `begin;` / `commit;` and the two partial-failure orderings are
  analysed in that file's note 5e rather than assumed away.

Rollback is documented in two distinct forms, because they are not the same act: **4a** restores
the captured original ACL exactly (only possible if the pre-change `relacl` was recorded — P8
before applying, or the guard's own `RAISE NOTICE`, which prints it), and **4b** re-grants the
*assumed* state, which is what you are left with if the before-state was never captured.
Everything below still stands as the record of what was unknown when this section was first
written.

What is established, from the queries in section 3:

- RLS on the legacy tables is `enabled` but **not `forced`**.
- `service_role` holds `bypassrls` and the expected schema/table privileges.
- The privilege rows for `anon`/`authenticated` on `public.*` exist. How reachable they are
  through the API depends on the exposed-schema list (section 6), which P6 did **not** settle.

What is explicitly **not** established, and is the reason no claim like "RLS protects every
access path" should be made about this project yet:

- `public.unified_market_intel` — its definition, its owner, and whether it carries
  `security_invoker`. `harvester/setup_normalization.sql:13` creates it as a plain
  `CREATE OR REPLACE VIEW`, i.e. with **owner rights**, and a plain view executes as its owner
  on the tables beneath it. If that owner is `postgres` or the table owner, an `anon` request
  through the view sees rows that the same role could never select directly, and no amount of
  row policy on `market_intelligence` changes that. Until `relkind`, `relowner`, `reloptions`,
  `relacl` and `pg_get_viewdef` are all pasted back — P8 for the first four, P7 for the
  definition — the view's security mode is **unresolved**, and the lockdown stays unapplied.
- Whether `harvester/setup_normalization.sql` ever ran to completion on production. The script
  defines a policy named `Service role can manage exchange rates` on `exchange_rates`
  (`:46-48`); the pre-flight output showed none, which means the script is at least partially
  unapplied here. That is a general warning about this repository: **its `harvester/*.sql`
  files are not evidence of the production schema**, in either direction.
- The numbers that view publishes even if it turns out to be correctly restricted:
  `setup_normalization.sql` derives `price_usd_per_mt` from hard-coded unit assumptions
  (ECX ⇒ quintal, NAEB ⇒ kilogram, anything else ⇒ already USD) and subtracts a literal
  `$150/MT` "Logistics & Tariff" estimate (`:40-41`). Presenting that as a market price would
  be a data-honesty problem independently of the permissions question.

To close this section, run P7 after a change to the project's API settings and paste all four
results. The decisive probe is from outside SQL, with the **anon** key only (never the service
key):

```
curl "https://<project>.supabase.co/rest/v1/unified_market_intel?select=*&limit=3" \
  -H "apikey: <ANON key>"
```

`200` with rows means an anonymous read path exists through that object and the question is no
longer theoretical; `401`/`404`/permission-denied is the expected answer. Record which you got,
then decide the fix as its own change: `alter view … set (security_invoker = true)` plus an
explicit grant review, or a policy rewrite. **Not in this pack.**

### 10a. That probe was run on 2026-10-27, and the answer is the bad one

The network block noted in `docs/PRODUCTION_READINESS_AUDIT.md` lifted, so the read-only probe
above could be made directly. It was made with **only** the key that is already shipped inside
the production browser bundle (`/_next/static/chunks/*.js` contains the project host and a
208-character anon JWT; the values were never printed, copied, or logged here), and with
`select`-only GETs at `limit=1`. No write, no service-role key, no SQL executed.

| Object, requested as `anon` | HTTP | rows visible to anon |
| --- | --- | --- |
| `public.unified_market_intel` | 206 | **122** (`content-range: 0-0/122`) |
| `public.market_intelligence` | 200 | 0 |
| `public.environmental_data` | 200 | 0 |
| `public.exchange_rates` | 200 | 0 |
| `public.datasets` | 200 | 0 |
| `public.insights` | 200 | 0 |
| `public.harvester_status` | 404 | `PGRST205` — not in the API at all |

Read that table as one comparison, because it is the whole finding: the view returns **122 rows**
while the table underneath it returns **0** to the same role. RLS on `market_intelligence` is
doing its job against anonymous callers, and `unified_market_intel` steps around it — which is
the behaviour `harvester/setup_normalization.sql:13` produces, a plain `CREATE OR REPLACE VIEW`
running with its owner's rights. 122 is also exactly the `market_intelligence` row count P3
measured from inside SQL, so the view is publishing that entire table, not a subset. The open
question in the bullet above is therefore no longer theoretical: **an anonymous read path
exists**, and it serves numbers this repository already documents as unsafe (hard-coded
`rate_to_usd`, a literal `$150/MT` subtraction).

What the probe still does not establish, and what only the SQL side can:

- The view's `relkind`, owner and `reloptions`. Behaviour proves the bypass, not the
  mechanism; `security_invoker` could be set and the access could instead come from broad
  `grant select … to anon` on the base tables. Run P7 and paste it before choosing between
  `alter view … set (security_invoker = true)` and a grant revocation — they are different
  fixes with different blast radii.
- Whether `data` is published to PostgREST. `data.location` returns `PGRST205` here, but the
  pack has never been applied, so "not published" and "does not exist" are indistinguishable
  from outside. P6 stays inconclusive for the reason section 3a gives.
- Whether `harvester_status` is absent or merely unexposed. A 404 on a `public` object that
  other `public` objects share is weak evidence of absence, but combined with P1 not listing
  it, section 1's premise that the freshness chip reads a live table should be treated as
  **unconfirmed** until P7 says otherwise.

Reproduce it without handling any secret:

```bash
# $ANON is the publishable key already in the browser bundle; paste it into the shell
# variable, never into a file or a commit.
curl -s "https://<project>.supabase.co/rest/v1/unified_market_intel?select=*&limit=1" \
  -H "apikey: $ANON" -H "Authorization: Bearer $ANON" -D - -o /dev/null | grep -i content-range
curl -s "https://<project>.supabase.co/rest/v1/market_intelligence?select=*&limit=1" \
  -H "apikey: $ANON" -H "Authorization: Bearer $ANON" -D - -o /dev/null | grep -i content-range
```

This changes no permission and no policy; it records the measurement. Fixing it is a separate,
approved change, and it is now the most urgent item in this file — ahead of applying the pack.
