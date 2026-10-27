-- =========================================================================================
-- Close the anonymous read path through public.unified_market_intel  (SECURITY_REVIEW H-6)
-- =========================================================================================
-- What was measured, on 2026-10-27, from outside SQL with the anon/publishable key only:
--
--   GET /rest/v1/unified_market_intel?select=*&limit=1  -> 206, content-range 0-0/122
--   GET /rest/v1/market_intelligence?select=*&limit=1   -> 200, content-range */0
--
-- The view publishes 122 scraped market rows to an unauthenticated caller while the table
-- beneath it publishes none. The reason is that a plain view executes as its OWNER: whoever
-- owns the object, the row policies on market_intelligence / exchange_rates /
-- environmental_data are skipped for anyone reading through the view.
-- harvester/setup_normalization.sql:13 creates it as a plain `create or replace view` and no
-- script in this repository ever grants or revokes anything on it. So the access `anon` holds
-- either came from the project's Supabase default privileges when the view was created, or was
-- granted by hand outside the repository, or is inherited from a PUBLIC entry. Query P8 in the
-- migrations README settles which from `pg_class.relacl`; P7's `information_schema` view cannot
-- answer it, because it hides grants made to PUBLIC. Either way, no reviewed decision in this
-- repository created it.
--
-- This file changes that decision and nothing else.
--
-- Scope, stated exactly:
--   * ONE object: public.unified_market_intel.
--   * Two privilege statements: revoke SELECT from anon and authenticated, and set
--     security_invoker. A third statement writes a `comment` on the view so the next reader sees
--     why, and it is the only cosmetic residue the reversal in section 4 has to clean up.
--   * NO change to service_role privileges. The harvester reads this view with the
--     service-role key (harvester/pre_flight_check.py:12, intelligence_generator.py:18) and
--     must keep working. Nothing here touches that role, the postgres role, or ownership.
--   * NO change to grants, policies or RLS on public.market_intelligence,
--     public.exchange_rates or public.environmental_data. Whether anon should keep SELECT on
--     those three is a separate open question (migrations README section 10, queries P7 and P8)
--     with its own evidence requirement; it is deliberately not bundled in here.
--   * NO change to the project's default privileges, because altering them would silently
--     decide the permissions of every future public.* object. See "How this can be undone".
--   * NO revoke from the PUBLIC pseudo-role, even though that is the one grant this file cannot
--     cancel selectively. If SELECT was granted to PUBLIC, anon inherits it and a revoke aimed at
--     `anon`/`authenticated` fixes nothing; section 1 detects that and aborts so a human decides,
--     rather than silently stripping a privilege every other role also inherits.
--   * A check that the revoke can work at all, independent of which mechanism grants the access:
--     if either target role can effectively SELECT through the view without a direct ACL entry
--     (PUBLIC, or role membership), this file aborts instead of reporting a fix it did not make.
--   * A check that the executing role is allowed to make this change (owner, member of the owner,
--     or superuser) and that the reader being protected — service_role — can actually read the
--     view today. Both are refused up front rather than discovered partway through the apply.
--
-- Before applying: run query P8 in the migrations README section 3 (read-only, catalog and
-- privilege metadata only, and NOT yet executed anywhere) and keep its output. Four of this
-- file's own prerequisites are still unmeasured on production — the server version, `service_role`'s
-- SELECT on the three base tables, `service_role`'s SELECT on the view itself, and whether the
-- role running the apply may alter this view at all — and P8 is how they get measured. The guard
-- re-checks all four at apply time, but the pre-flight also captures the original ACL, without
-- which the reversal in section 4a cannot restore anything exactly.
--
-- `alter view … set (security_invoker)` additionally requires the running role to own the view
-- or be a superuser. P8 reports the owner; guard 3 refuses the apply if the executing role cannot
-- act on it.
--
-- Does the website need this access? No, and this is the grep, not the assumption. Neither
-- unified_market_intel nor market_intelligence appears anywhere in app/, components/, hooks/,
-- services/ or lib/, no client `.from()`/`.table()` call in those directories names either of
-- them or public.exchange_rates, and none of the view's derived columns appears at all
-- (price_usd_per_mt, net_opportunity_value, rate_to_usd, region_market, commodity_name). Two
-- hits for the literal string 'exchange_rates' do exist (lib/data/sources.ts:64,
-- lib/data/types.ts:70): both are a category LABEL in the app's own type union, not a reference
-- to the table. They are named here instead of being quietly dropped from a "zero references"
-- claim. The dashboard's market and exchange boards call /api/data/markets and /api/data/exchange,
-- which read live publishers server-side. The only web-app touchpoint on any of these objects is
-- the service-role upsert into public.environmental_data (lib/data/sync.ts:433,442), which this
-- file does not touch. Expected application breakage from the revoke: none.
--
-- Why BOTH statements, and what each one alone does not do:
--   * revoke  -> closes the hole today. The API refuses the read for anon (403, permission
--     denied, SQLSTATE 42501) before it counts any row.
--   * security_invoker -> makes the hole hard to reopen. With it the view reads the base tables
--     AS the calling role, so an anonymous caller gets whatever the base tables give anon, and
--     the second probe above measured exactly that on market_intelligence: zero rows. Without
--     it, a re-granted view is once again an owner-rights bypass of every policy on the three
--     tables.
--
-- =========================================================================================
-- 1. Guard: refuse to run half-applied, refuse to guess
-- =========================================================================================

do $$
declare
  v_rel        oid;
  v_kind       "char";
  v_owner      text;
  v_owneroid   oid;
  v_opts       text;
  v_acl        aclitem[];
  v_acltext    text;
  v_targets    text[] := array['anon','authenticated'];
  v_target     text;
  v_inherit    text[] := array[]::text[];
  v_roles      text[] := array['public.market_intelligence','public.exchange_rates',
                               'public.environmental_data'];
  v_role       text;
  v_missing    text[] := array[]::text[];
begin
  select c.oid, c.relkind, pg_get_userbyl(c.relowner), c.relowner,
         coalesce(array_to_string(c.reloptions, ','), '(none: a plain view runs as its owner)'),
         c.relacl
    into v_rel, v_kind, v_owner, v_owneroid, v_opts, v_acl
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relname = 'unified_market_intel';

  -- Absent is not a pass. The whole point of this file is to remove access to this object;
  -- succeeding quietly on a project that does not have it would leave the reviewer believing
  -- the hole was closed here when it was never open, or is under another name.
  if v_rel is null then
    raise exception
      'INCOMPATIBLE: public.unified_market_intel does not exist in this project. This migration is about that one object, so it stops instead of reporting a fix it did not make. If the view was renamed or lives in another schema, say so and a corrected file will be prepared. To confirm from the catalog: select to_regclass(''public.unified_market_intel'');';
  end if;

  if v_kind <> 'v' then
    raise exception
      'INCOMPATIBLE: public.unified_market_intel exists but is relkind %, expected a plain view (''v''). `alter view ... set (security_invoker)` on a materialized view or foreign table is a different change with different consequences; this file refuses to apply it blind.',
      v_kind;
  end if;

  -- Can the role running this script actually do it? Both mutations need the view's owner, a
  -- member of that owner, or a superuser: `revoke` requires grant-option or ownership, and
  -- `alter view ... set (...)` requires ownership. This is checked as a precondition rather than
  -- left to fail mid-script, because a paste that commits statement-by-statement would otherwise
  -- land part of this file and refuse the rest (see the atomicity note in section 5e).
  -- `pg_has_role(owner_oid, 'usage')` reports the CURRENT user's membership of that role, and a
  -- role is always a member of itself, so it also covers "the running role IS the owner". The
  -- superuser test uses `coalesce(..., false)` so an absent `pg_roles` row for current_user is
  -- treated as not-superuser rather than silently passing the guard with NULL.
  if not (pg_has_role(v_owneroid, 'usage')
          or coalesce((select rolsuper from pg_roles where rolname = current_user::text), false)) then
    raise exception
      'INCOMPATIBLE: the executing role % is not the owner of public.unified_market_intel (owner: %), is not a member of that owner, and is not a superuser, so it cannot revoke on this view or set security_invoker on it. Re-run as the owner — in Supabase the SQL Editor connects as postgres, which normally owns objects created there and in migrations. Nothing has been applied.',
      current_user, v_owner;
  end if;

  -- Render the ACL once, here, so every message and the final notice carry the same text.
  -- Two NULLs mean different things and must not be conflated:
  --   * relacl IS NULL            -> default privileges. For a *view* the default entry is
  --                                  owner-only (tables and views get nothing for PUBLIC in the
  --                                  default ACL, unlike functions, types and sequences), so
  --                                  there is no PUBLIC grant to worry about.
  --   * grantee with no pg_roles row and oid 0 -> that IS PUBLIC. `rolname` is NULL for it, and
  --                                  reading a NULL grantee name as "nobody" is the mistake this
  --                                  block exists to prevent. It is labelled explicitly.
  -- aclexplode over a NULL array yields zero rows, so the aggregate returns NULL and the
  -- coalesce produces the "default privileges" text rather than an empty string.
  select coalesce(string_agg(
           case when a.grantee = 0 then 'PUBLIC'
                else coalesce(r.rolname, 'role-oid-' || a.grantee::text) end
           || ' ' || a.privtype::text || case when a.is_grantable then ' (grant option)' else '' end
           || ' by ' || coalesce(g.rolname, 'role-oid-' || a.grantor::text), ', '),
         '(relacl NULL: default privileges in effect; for a view that is OWNER ONLY, no PUBLIC entry)')
    into v_acltext
    from aclexplode(v_acl) a
    left join pg_roles r on r.oid = a.grantee
    left join pg_roles g on g.oid = a.grantor;

  -- The blind spot this file used to have. `revoke ... from anon, authenticated` only removes
  -- entries held *directly* by those two roles. If SELECT was granted to the PUBLIC pseudo-role,
  -- anon inherits it regardless, the revoke finds nothing to take away (PostgreSQL reports that
  -- as a warning, not an error, so the apply still "succeeds"), and the anonymous read path is
  -- still open afterwards. Revoking from PUBLIC would also strip the privilege from every other
  -- role that inherits it — which roles those are on this project is exactly what P8 reports, and
  -- it would include service_role if it reads the view through PUBLIC, as the harvester must.
  -- So this file refuses to do it unasked: it stops, reports the exact ACL, and leaves the
  -- decision to review.
  -- `v_acl is not null and` first so a NULL relacl is evaluated as "no PUBLIC entry" instead of
  -- depending on how aclexplode handles NULL input.
  if v_acl is not null
     and exists (select 1 from aclexplode(v_acl) a where a.grantee = 0 and a.privtype = 'r') then
    raise exception
      'INCOMPATIBLE: SELECT on public.unified_market_intel is granted to the PUBLIC pseudo-role, so revoking it from anon and authenticated would change nothing for an anonymous caller — the privilege is inherited, not held directly. This file stops without applying anything, and it will not revoke from PUBLIC automatically, because that also removes the privilege from every role that inherits it, service_role included if it reads this view through PUBLIC as the harvester needs. Current ACL, for review: %. Decide the PUBLIC entry explicitly, then re-run. Nothing has been applied.',
      v_acltext;
  end if;

  -- The general form of the same trap, for either named role. `revoke ... from anon,
  -- authenticated` removes only what those roles hold DIRECTLY on this object. If an effective
  -- SELECT reaches them by inheritance — through PUBLIC, or through a role they belong to — the
  -- revoke finds nothing to take away, PostgreSQL reports that as a warning rather than an error,
  -- the apply "succeeds", and the anonymous read path is still open afterwards. Being told that
  -- here costs nothing; discovering it from a post-apply probe wastes an approval cycle.
  -- `aclexplode` over a NULL array yields zero rows, so a NULL relacl simply contributes no
  -- direct entries; has_table_privilege is what reports the effective truth.
  foreach v_target in array v_targets loop
    if has_table_privilege(v_target, v_rel::regclass, 'select')
       and not exists (select 1 from aclexplode(v_acl) a
                         join pg_roles r on r.oid = a.grantee
                        where r.rolname = v_target and a.privtype = 'r') then
      v_inherit := array_append(v_inherit, v_target);
    end if;
  end loop;

  if array_length(v_inherit, 1) is not null then
    raise exception
      'INCOMPATIBLE: % can read public.unified_market_intel without holding SELECT directly on it, so the privilege is inherited (through PUBLIC or through role membership) and `revoke select ... from anon, authenticated` would remove nothing while still reporting success. Current ACL, for review: %. This file stops; resolving the inheritance is a reviewed permission decision, not a migration step. Nothing has been applied.',
      array_to_string(v_inherit, ' and '), v_acltext;
  end if;

  -- security_invoker is PostgreSQL 15+. On an older server the statement below is a syntax
  -- error mid-apply, so the version is checked where the message can explain it. The revoke
  -- alone would still close the hole on any version; if this project really is pre-15, apply
  -- only statement 2 by hand and skip statement 3 rather than letting a failed apply roll the
  -- revoke back.
  if current_setting('server_version_num')::int < 150000 then
    raise exception
      'INCOMPATIBLE: this server is PostgreSQL %, and security_invoker requires 15+. Stopping so the lockdown is not half-applied. The one statement that closes the anonymous path safely on this version is: revoke select on public.unified_market_intel from anon, authenticated;',
      current_setting('server_version');
  end if;

  -- The reader this file must preserve is the harvester, and it reads THE VIEW, not only the
  -- tables behind it. Statement 2 names only anon and authenticated, so service_role's own path
  -- to the view is not touched here; but if that path existed only through the PUBLIC entry,
  -- the PUBLIC guard above would already have refused the apply. A false answer at this line
  -- therefore means something more basic is wrong with the premise of this file — the dependency
  -- recorded at harvester/pre_flight_check.py:12 and intelligence_generator.py:18 does not hold on
  -- this project — and that must be established before anything is applied, not discovered
  -- afterwards.
  -- `to_regrole` first so a project without that role yields this message instead of a raw
  -- `role "service_role" does not exist` abort.
  if to_regrole('service_role') is null then
    raise exception
      'INCOMPATIBLE: this project has no service_role, so the harvester read path this file is written to preserve cannot be verified. Establish which role actually reads public.unified_market_intel before applying anything. Nothing has been applied.';
  end if;

  if has_table_privilege('service_role', v_rel, 'select') is not true then
    raise exception
      'INCOMPATIBLE: service_role cannot SELECT from public.unified_market_intel even before this change. Either the harvester uses a different role than the repository records, or its access arrives by a mechanism this file has already refused to touch. The premise of the lockdown needs re-checking; nothing has been applied.';
  end if;

  -- The second half of the fix is only safe if the harvester's own role can still read the
  -- tables the view joins. Once the view runs as its invoker, service_role needs SELECT on
  -- each base table directly; without it, the view that pre_flight_check.py and
  -- intelligence_generator.py depend on starts failing 42501 and the revoke would have traded
  -- an anonymous leak for a broken pipeline. Checked here, not discovered on the first cron
  -- run. The ownership requirement for `alter view ... set` is a separate guard, further up,
  -- and the owner is reported in the notice
  -- below either way.
  foreach v_role in array v_roles loop
    -- to_regclass rather than the bare name: a missing base table must produce this file's own
    -- message, not a raw `relation does not exist` abort, and `is not true` means a NULL result
    -- counts as missing rather than silently passing the check.
    if to_regclass(v_role) is null then
      v_missing := array_append(v_missing, v_role || ' (does not exist in this project)');
    elsif has_table_privilege('service_role', to_regclass(v_role), 'select') is not true then
      v_missing := array_append(v_missing, v_role);
    end if;
  end loop;

  if array_length(v_missing, 1) is not null then
    raise exception
      'INCOMPATIBLE: service_role lacks SELECT on %. Setting security_invoker on the view would make the view read those tables as the calling role and break the harvester. Grant service_role what it needs first (that is a separate, approved permission decision), or apply only the revoke. Nothing in this file has been applied.',
      array_to_string(v_missing, ', ');
  end if;

  -- Everything this file is about, in one place, for the review record — including the ORIGINAL
  -- ACL, which is the only thing that makes the reversal in section 4 an exact restoration
  -- instead of a guess. Catalog metadata only: no row values, no keys, no secrets.
  raise notice
    'OK: public.unified_market_intel present (relkind v, owner %, options: %, security_invoker already set: %). server % (%). executed as %, which may alter this view. service_role reads the view and holds SELECT on all three joined tables. ORIGINAL ACL before this change (record it: it is what section 4 restores): %',
    v_owner, v_opts, (v_opts like '%security_invoker=true%'),
    current_setting('server_version'), current_setting('server_version_num'),
    current_user, v_acltext;
end
$$;

-- =========================================================================================
-- 2. Revoke the anonymous and signed-in read path
-- =========================================================================================
-- `select` only, not `all`: this is a view, it is not writable, and naming the exact
-- privilege keeps the reversal in section 4 a one-line mirror of this line.
--
-- From `anon` and `authenticated` specifically, never `from public`. Revoking from the
-- `public` pseudo-role would strip a privilege every role inherits through it, including
-- service_role, which is the one reader that must survive this change.

revoke select on public.unified_market_intel from anon, authenticated;

-- =========================================================================================
-- 3. Make the view run as its caller, not as its owner
-- =========================================================================================
-- Idempotent, and required for the fix to survive the next view recreation.

alter view public.unified_market_intel set (security_invoker = true);

comment on view public.unified_market_intel is
  'Legacy harvester view. Not readable by anon or authenticated: access was revoked on 2026-10-27 (SECURITY_REVIEW H-6) and the view runs as its invoker. Read it with the service role, or through a server-side route that decides what may be published. Its derived figures are still unsafe to present as Ethiopian market prices: price_usd_per_mt hard-codes unit and FX assumptions (ECX divided by 10, NAEB multiplied by 1000) and net_opportunity_value subtracts a literal 150 USD per MT logistics estimate.';

-- =========================================================================================
-- 4. Reversal — two different things people mean by "roll it back"
-- =========================================================================================
-- Both forms below must be run as the role that owns the view (or a superuser); that is the
-- same ownership requirement section 1 reports in its notice. Neither form touches the base
-- tables. Reverting re-opens the anonymous read path described in SECURITY_REVIEW H-6, so it
-- should only follow a reviewed decision to publish this view.
--
-- (4a) RESTORE THE ORIGINAL PRIVILEGES, exactly. This is what you want if the object's ACL
--      mattered in its original state — because the original ACL may have had entries this file
--      never mentions (other grantees, `WITH GRANT OPTION`, a `references` privilege, or a
--      PUBLIC entry, which section 1 refuses to touch). It is only possible if the original ACL
--      was CAPTURED BEFORE APPLYING: it is printed by the guard's notice in this very
--      transaction, and the pre-apply capture is query P8 in the migrations README section 3.
--      Without that record there is nothing to restore to, and 4b is the only option available.
--
--      Reconstruct one GRANT per captured entry, keeping the privilege letters and the grant
--      option, for example (illustrative, using the values you captured):
--
--        grant select on public.unified_market_intel to anon with grant option;
--        grant select on public.unified_market_intel to authenticated;
--        grant select, references on public.unified_market_intel to some_other_role;
--
--      Then prove the restore is byte-exact by comparing the rendered ACL against the captured
--      string (section 6's query, same rendering). Do not "restore" by writing to pg_class.
--      If the captured ACL was NULL (default privileges), the exact restoration is:
--
--        revoke select on public.unified_market_intel from anon, authenticated;  -- again
--
--      because nothing to re-grant existed. Yes, that means the reversal is a no-op — that is
--      what the original state was.
--
-- (4b) SIMPLY GIVE THE ACCESS BACK, which is not the same thing as 4a. Two statements undo what
--      this file did, whatever the original ACL happened to be:
--
--        grant select on public.unified_market_intel to anon, authenticated;
--        alter view public.unified_market_intel reset (security_invoker);
--
--      `reset` returns the view to owner-rights execution, its state before this file;
--      `set (security_invoker = false)` is equivalent. What 4b does NOT do is restore grants
--      this file never made, so a reviewer comparing the before and after ACL must expect extra
--      or missing entries unless the original ACL was captured.
--
-- (4c) The `comment` set in section 3 is the only cosmetic residue. Clear it with:
--
--        comment on view public.unified_market_intel is null;
--
-- =========================================================================================
-- 5. How this fix can be silently undone, and what to do about each
-- =========================================================================================
-- Read this before scheduling anything that touches the view.
--
-- (a) `harvester/recreate_view.sql:4` begins with `DROP VIEW IF EXISTS unified_market_intel`
--     and then creates it again. A dropped view is a NEW object with a fresh ACL and fresh
--     reloptions, so neither half of this file survives that script by itself — and if the
--     project's default privileges are what granted anon on the first creation, they will
--     grant it again on the new one. That script now carries these same two statements at its
--     end, so a rerun cannot reopen the hole whichever mechanism created the grant — with the
--     limit stated in that file's own comment: those two statements are a plain REVOKE with no
--     guard, so on a project where the access is inherited from PUBLIC they would still leave the
--     path open. P8 answers that question before anyone relies on them.
-- (b) `create or replace view` (setup_normalization.sql:13) does NOT drop the object, so it
--     keeps the row in pg_class with its ACL and reloptions: a replace alone preserves both
--     halves of this fix.
-- (c) `supabase db push` applies pending files in filename order. This filename sorts after
--     20261026000600, and none of those six files creates, drops or alters this view (they
--     mention it only in comments), so no migration in the current pack undoes it. Any future
--     migration that recreates the view must end with these same two statements.
--     WARNING about db push specifically: it applies EVERY pending file, so on this project it
--     would also apply the six unapplied data migrations. To apply only this lockdown, paste
--     sections 1-3 into the Supabase SQL Editor instead, wrapped in an explicit `begin;` /
--     `commit;` — see (e) for why the wrapper is required rather than assumed.
-- (d) A change to Supabase default privileges (API settings, or a support ticket) can re-grant
--     access to objects already created. Re-run the verification queries below after any such
--     change. This file does not attempt to change default privileges, because doing so
--     decides the permissions of every future public.* object at once.
-- (e) ATOMICITY OF THE APPLY IS NOT VERIFIED, and this file is written for three statements that
--     must be applied together. `supabase db migration`/`db push` wraps each migration file in a
--     transaction; whether the dashboard SQL Editor commits a pasted multi-statement script as one
--     transaction or statement-by-statement has NOT been checked on this project, and no local
--     PostgreSQL exists here to check it against. So run the paste inside an explicit transaction
--     and end it deliberately:
--
--         begin;
--           <sections 1-3 of this file>
--         commit;
--
--     If it were committed statement-by-statement the two partial outcomes differ, and neither is
--     catastrophic, which is worth stating instead of pretending the risk is absent:
--       * guard passes, `revoke` lands, `alter view` fails -> the anonymous path is CLOSED (that
--         is the security goal) but the durable half is missing, so a later DROP+recreate can
--         reopen it. Fix by applying statement 3 alone, as the owner, or by reverting and re-running
--         the whole script inside one transaction.
--       * guard passes, `revoke` fails, `alter view` lands -> not reachable from a clean apply: the
--         guard has already refused the one condition in which a revoke removes nothing (an
--         inherited grant), and with security_invoker an anonymous caller is limited by the base
--         tables, which the probe measured at zero rows. This ordering still does not publish rows,
--         but it must be confirmed with query 6c rather than assumed.
--     Either way section 6 is what proves the final state; the notice printed by the guard is what
--     proves the before-state.

-- =========================================================================================
-- 6. Verification, from the database (read-only)
-- =========================================================================================
-- Run the P8 pre-flight in the migrations README (section 3) BEFORE applying — it captures the
-- ACL that section 4a needs to restore anything exactly. Then run these after. Paste the
-- results into the review. Nothing here prints a key or a row value, and none of it writes.
--
-- (6a) The object and its options, plus the ACL in the same rendering the guard's notice used,
--      so before and after can be compared literally:
--
--   select c.relname, c.relkind, pg_get_userbyl(c.relowner) as owner,
--          coalesce(array_to_string(c.reloptions, ','), '(none)') as options,
--          coalesce((select string_agg(
--                      case when a.grantee = 0 then 'PUBLIC'
--                           else coalesce(r.rolname, 'role-oid-' || a.grantee::text) end
--                      || ' ' || a.privtype::text
--                      || case when a.is_grantable then ' (grant option)' else '' end
--                      || ' by ' || coalesce(g.rolname, 'role-oid-' || a.grantor::text), ', ')
--                    from aclexplode(c.relacl) a
--                    left join pg_roles r on r.oid = a.grantee
--                    left join pg_roles g on g.oid = a.grantor),
--                   '(relacl NULL: default privileges; for a view that is OWNER ONLY)') as acl
--     from pg_class c join pg_namespace n on n.oid = c.relnamespace
--    where n.nspname = 'public' and c.relname = 'unified_market_intel';
--
-- (6b) Per-grantee rows, with PUBLIC named as PUBLIC. This is the query a reviewer reads, so it
--      must not be able to mistake the pseudo-role for an absent grantee:
--
--   select case when a.grantee = 0 then 'PUBLIC (inherited by every role)'
--                else coalesce(r.rolname, 'role-oid-' || a.grantee::text) end as grantee,
--          a.privtype::text as privilege, a.is_grantable
--     from pg_class c
--     join pg_namespace n on n.oid = c.relnamespace
--     cross join lateral aclexplode(c.relacl) a
--     left join pg_roles r on r.oid = a.grantee
--    where n.nspname = 'public' and c.relname = 'unified_market_intel'
--    order by 1, 2;
--
--      privtype 'r' is SELECT. Expected after applying: no 'r' row for anon or authenticated,
--      and no 'r' row for PUBLIC. A row for service_role is correct and must stay. A row whose
--      grantee renders as PUBLIC means the revoke in section 2 could not have worked, the guard
--      should have refused the apply, and the finding must be reported rather than revoked
--      around. If relacl is NULL there are no explicit entries at all and only the owner can
--      read the object, which is also a pass.
--
-- (6c) The decisive privilege question, answered for the roles that matter rather than by
--      reading entries. `has_table_privilege` accounts for role membership and for PUBLIC, so it
--      reports what a caller can actually do, not what a named row says:
--
--   select has_table_privilege('anon',          to_regclass('public.unified_market_intel'), 'select') as anon_can_read,
--          has_table_privilege('authenticated', to_regclass('public.unified_market_intel'), 'select') as signed_in_can_read,
--          has_table_privilege('service_role',  to_regclass('public.unified_market_intel'), 'select') as harvester_can_read,
--          has_schema_privilege('anon', 'public', 'usage')                                           as anon_schema_usage;
--
--      Expected after applying: `f`, `f`, `t`. `anon_schema_usage` is true and irrelevant on its
--      own — schema usage without table select cannot read the view. Using to_regclass() rather
--      than the literal name means an absent object yields NULL instead of aborting the whole
--      query; this form assumes the view exists, which after an apply it does. Run the P8 version
--      (README, section 3) instead if you are checking a project where it might not — P8 wraps the
--      same calls in `case … is null then null` so a pre-flight reports "not measured" rather than
--      depending on how a privilege function handles an empty OID.
--
-- (6d) information_schema.role_table_grants is NOT a sufficient check here: it omits privileges
--      granted to PUBLIC unless the current user is a member, so it can under-report exactly the
--      entry this file is about. Read relacl (6a/6b) or ask has_table_privilege (6c).
--
-- (6e) The decisive check is from outside SQL, with the anon/publishable key only (never the
--      service key), and is listed in docs/SECURITY_REVIEW.md under "H-6 remediation patch":
--
--   GET https://<project>.supabase.co/rest/v1/unified_market_intel?select=*&limit=1
--
--      Expected after applying: the read is refused (HTTP 403, permission denied / SQLSTATE
--      42501). If it still answers 200 or 206 with rows, the fix has not landed — check 6c before
--      anything else, because a PUBLIC entry produces precisely that outcome with a clean apply.
--      Before applying, the same request returned 206 with content-range 0-0/122.
