# Nexus AgriRise — Security & Privacy Review

**Prepared:** 2026-10-26
**Scope:** entire repository at `C:\Users\lenovo\NexusAgririse` (git HEAD of `main`), plus live behaviour observed on `https://nexus-agririse.vercel.app/`.
**Method:** static source review of every tracked file, dependency audit, CI/workflow review, and live black-box probes of the deployed application from both `curl` and a real browser.
**Companion document:** `docs/PRODUCTION_READINESS_AUDIT.md` (feature/data/architecture findings). IDs in this document (`C-*`, `H-*`, `M-*`, `L-*`) are the same IDs referenced in §7 of that audit.

> This review is **read-only**. No source file, database object, storage bucket, or deployment setting was modified. Every remediation below is expressed as a *proposed* change; items that touch production data or live policy are given as SQL/commands **for you to run**, and I stop before executing them.
> Per your rule 6, this document lists environment variable **names** only. No value of any key, token, or password appears anywhere in it.
> A successful build is not evidence of security, and no claim in this document rests on one.

---

## 1. Executive summary

The application's security posture is dominated by one structural fact: **there is no server-side trust boundary.** Authentication exists in the browser (Supabase client, anonymous key) but nothing on the server ever consults it. The single API route takes the caller's identity from the request body, the data plane is reached directly from client code with the anonymous key, and no migration in version control defines the row-level-security state of the tables that hold customer business data.

The consequence is that the product's central promise — *"Row-level data isolation"* (stated to users at `app/signup/page.tsx:124`) — is **not verifiable from the repository, and is contradicted by the only migration that is in version control** (`harvester/setup_insights.sql`). The marketing claim is therefore both a security finding and a disclosure finding.

| Severity | Count | IDs |
|---|---|---|
| **Critical** | 4 | C-1, C-2, C-3, C-4 |
| **High** | 5 | H-1, H-2, H-3, H-4, H-6 (H-5, M-6 and M-7 are numbered in `docs/PHASE_2_REMEDIATION_PLAN.md`, not here) |
| **Medium** | 5 | M-1, M-2, M-3, M-4, M-5 |
| **Low** | 1 | L-1 |

**If you do nothing else before an incubation demo, fix C-1, C-2 and H-6.** C-1 is a live, unauthenticated endpoint that spends your paid quota; C-2 lets any caller write into any user's records; H-6 is an anonymous read path that is already publishing 122 scraped market rows, measured in production (§10 of `supabase/migrations/README.md`, and §9a below). C-3's intent is wrong but its bucket does not exist, so it is latent rather than live — see §9a.

---

## 2 Threat model (what we are actually protecting)

**Assets, in order of value:**
1. Farmers'/buyers' uploaded datasets (commercial yields, pricing, counterparty names) — in Supabase Storage bucket `datasets` and table `datasets`.
2. Generated insights per customer — table `insights`.
3. Provider credentials — `GEMINI_API_KEY` (web app), `GOOGLE_API_KEY` (harvester), `CURRENCY_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY` / `SERVICE_ROLE`, `MONITORING_WEBHOOK_URL`.
4. Supabase project itself (the service-role key is a full-bypass credential).
5. User account integrity (email/password auth, session tokens).
6. The platform's credibility with the EAI Incubation Center — damaged at least as much by H-1 as by a classic exploit.

**Adversaries assumed:** anonymous internet user (highest volume, lowest skill), authenticated user of another tenant (the IDOR case), a malicious or compromised contributor/CI dependency, and a network observer.

**Out of scope / not claimed:** this is not a penetration test, not a dynamic security scan, and not a penetration-test replacement. I did not attempt exploitation against production beyond read-only requests to endpoints the app itself calls.

---

## 3 Critical findings

### C-1 — `POST /api/analyze` is unauthenticated, unthrottled, and burns a paid AI quota

**Evidence**
- `app/api/analyze/route.ts:5` — `export async function POST(req: Request)`. No session check, no API key check, no origin check, no rate limit, no `export const dynamic`/`maxDuration` guard.
- `app/api/analyze/route.ts:7-15` — the only validation is `!dataset || !Array.isArray(dataset) || dataset.length === 0`.
- `services/ai.ts:12-28` — the handler then performs a live Gemini call. `services/ai.ts:22` trims to 50 rows **after** the whole payload has already been parsed and held in memory (`route.ts:7`), so the row cap is not a request-size cap.
- Live confirmation: `curl -X POST https://nexus-agririse.vercel.app/api/analyze -H 'content-type: application/json' -d '{"dataset":[1]}'` returns a `500` from the AI layer, proving the request reaches the provider path with no authentication. Reproduced a second time from inside a browser on the deployed origin.

**Impact**
Any script on the internet can drive your Gemini bill indefinitely (the endpoint is on a public hostname and is discoverable from `components/UploadCard.tsx:117` in the shipped client bundle). This is simultaneous **financial DoS**, **quota exhaustion**, and — because the endpoint echoes AI output back to the caller — a free general-purpose AI proxy for whoever finds it. A single attacker with a bash loop is enough to zero out your monthly credit before a real customer's upload succeeds, which turns an availability problem into a reputational one at exactly the wrong moment.

**Remediation (proposed, ordered)**
1. **Authenticate server-side.** The route must derive identity from the Supabase JWT, never from the body (this is also C-2's fix):
   ```ts
   // app/api/analyze/route.ts — proposed shape
   import { createClient } from '@supabase/supabase-js';

   const server = createClient(
     process.env.NEXT_PUBLIC_SUPABASE_URL!,
     process.env.SUPABASE_TOKEN_FORWARDER_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
   );

   export async function POST(req: Request) {
     const auth = req.headers.get('authorization');
     if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
     const { data, error } = await server.auth.getUser(auth.replace(/^Bearer\s+/i, ''));
     if (error || !data.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
     const userId = data.user.id;            // trusted; ignore any userId in the body
     ...
   ```
   `components/UploadCard.tsx:117-125` then sends the caller's real access token:
   ```ts
   const { data: { session } } = await supabase.auth.getSession();
   headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}` }
   ```
2. **Bound the request.** Reject payloads over a stated ceiling before parsing (e.g. read `Content-Length`, and cap the buffered body at ~1 MB), and cap `dataset.length` as well as rows-sent-to-the-model.
3. **Rate limit.** On Vercel without an edge store, the practical minimum is per-user limiting keyed on `userId` in an in-flight map plus a `429` with `Retry-After`; the correct answer for production is Upstash Ratelimit or Vercel's WAF rules (`@upstash/ratelimit` + `@upstash/redis`). Document which you choose so the reviewer sees intent.
4. **Give the provider call a timeout and a circuit breaker.** `services/ai.ts:28` awaits `generateContent` with no deadline; add `generationConfig` plus `AbortSignal.timeout(...)`, and fail fast (503, no Gemini call) when the last N requests failed so an outage cannot be amplified.
5. **Add `robots`/WAF-level obscurity is *not* a control** — do not rely on the route being unlinked.

**Verification**
- `curl -s -o /dev/null -w '%{http_code}\n' -X POST https://…/api/analyze -H 'content-type: application/json' -d '{"dataset":[1]}'` must return **`401`** (it currently returns `500`).
- Same request **with** a valid token must return `200`; with a token for a *different* user and a foreign `datasetId`, the insert must be rejected by RLS (see C-4) and must **not** appear in the victim's `insights` rows: `select count(*) from insights where dataset_id='<victim-dataset>';` before and after must be identical.
- 30 rapid authenticated requests → at least one `429`, and `GEMINI_API_KEY` usage in the provider console must not grow 1:1 with request count.
- Unauthenticated scrape check: confirm the route no longer appears in a way that invites abuse — grep the client bundle for `api/analyze` and confirm the accompanying code path requires a session.

---

### C-2 — Broken access control: the server writes to any user's records using a client-supplied identity

**Evidence**
- `app/api/analyze/route.ts:8` — `const { dataset, userId, datasetId } = body;` — the *attacker* supplies both identifiers.
- `app/api/analyze/route.ts:21-28` — `if (userId && datasetId) { await saveInsight({ userId, datasetId, … }) }`.
- `services/database.ts:67-80` — `saveInsight` inserts `user_id`/`dataset_id` straight through, using **`lib/supabaseClient.ts`'s anonymous-key client** (`lib/supabaseClient.ts:2-6`). There is no server-side key in the web app and no check that the caller owns either identifier.
- Read side, same pattern: `services/database.ts:89-101` — `getDatasetInsights(datasetId)` filters by dataset id only, no ownership predicate.
- Delete side: `services/database.ts:121-132` — `deleteDataset(datasetId)` issues `.delete().eq("id", datasetId)` with **no `user_id` filter**. (Currently unused by any component — I grepped every call site — but it is a loaded gun: it becomes live the moment a "Delete" button is wired.)
- `hooks/useAuth.tsx:54` — `const activeUser = isDemoMode ? mockUser : user;` with `mockUser.id = 'demo-user-id'` (`:49`). In demo mode a browser session *is* a fixed synthetic identity, so any ownership test that trusts the client is trivially forged.

**Impact**
This is textbook **OWASP A01 Broken Access Control / IDOR**, on the write path. If RLS on `insights`/`datasets` is permissive or absent (see C-4), an attacker can (a) poison another customer's dashboard with fabricated insights, (b) with `deleteDataset`, destroy another customer's records, and (c) enumerate identifiers to map who is on the platform. Conversely, if RLS is strict-but-correct, the insert *silently fails* and — `route.ts:30-33` — the failure is only `console.error`-ed and the response still returns `200`. That second branch is its own defect: a persistence failure the UI cannot see. So the identity design is wrong under either RLS state; there is no configuration in which trusting the body is acceptable.

**Remediation (proposed)**
1. Derive `userId` from the verified JWT (C-1 step 1) and **delete `userId` from the request contract** — keep it out of the type, out of `UploadCard.tsx:122`, and out of the docs, so no future caller can pass it.
2. Authorize `datasetId` server-side before inserting an insight: `select id from datasets where id = $1 and user_id = $2` (best via a Postgres function or a scoped select with the user's own token, so RLS enforces it).
3. Add ownership predicates to every data function: `getUserDatasets` already filters (`database.ts:53`) but `getDatasetInsights` (`:92`) and `deleteDataset` (`:125`) must gain `.eq('user_id', userId)`.
4. **Do not swallow DB failures.** If the insight cannot be persisted, return `500` (or `201`-vs-`200` deliberately) so the UI can tell the user the record was not saved; keep a `saved: false` flag at minimum.
5. Enforce it a second time in the database (C-4). Application checks are a convenience; RLS is the boundary.
6. Make `deleteDataset` refuse to run without an authenticated user id — make the parameter required rather than optional, so forgetting it is a compile error.

**Verification**
- Two test accounts A and B. With A's token, attempt `POST /api/analyze` naming B's `datasetId`: expect `403`/`404`, and B's row count unchanged.
- As B, `select * from insights where dataset_id in (select id from datasets where user_id='<A>')` → must return **0 rows**.
- Unit test that `deleteDataset` cannot be invoked without a user id (type-level test or runtime assertion).

---

### C-3 — Customer files are written with `getPublicUrl`, implying a publicly readable storage bucket

**Evidence**
- `services/storage.ts:11-16` — upload to bucket `datasets` using the client's anonymous key.
- `services/storage.ts:22-24` — the app immediately calls `.getPublicUrl(fileName)` and returns `publicUrlData.publicUrl`, which it persists as `datasets.file_url` (`UploadCard.tsx` → `services/database.ts:37`). `getPublicUrl` only produces a *usable* link if the bucket is public; the code's correctness therefore **depends on the bucket being public**.
- Object key is `${userId}/${Date.now()}_${7-char-random}.${ext}` (`storage.ts:9`) — the user id is the first path segment, so one leak (a shared PDF, a browser history entry, a Referer header) discloses the tenant and hands the attacker the shape of the namespace to brute-force.
- No download path uses `createSignedUrls`; no bucket policy exists in version control to confirm or deny the setting.

**Impact**
If the bucket is public — which the code requires — then every uploaded CSV is retrievable by anyone who obtains or guesses one URL, with **no authentication at all**. That is A01 broken access control *plus* A02 data exposure on the most sensitive asset in the product (farmers' commercial data), and it directly falsifies `app/page.tsx:93` ("100% Data Privacy Guaranteed") and `app/signup/page.tsx:124` ("Row-level data isolation"). It is also near-irreversible: public objects get crawled and cached, and a "we deleted them" answer afterwards does not un-publish them.

**Remediation (proposed)**
1. **Confirm the current state first** (read-only, see Verification), because the fix and the disclosure obligation depend on it.
2. Flip `datasets` to **private** and replace `getPublicUrl` with a short-lived signed URL:
   ```ts
   // services/storage.ts — proposed
   const { data, error } = await supabase.storage
     .from('datasets')
     .createSignedUrl(fileName, 60 * 10); // 10 minutes
   if (error) return { url: null, error };
   return { url: data.signedUrl, error: null };
   ```
   Store only the object **path** in `datasets.file_url`, not the signed URL — a signed URL in a database column is a credential with an expiry that will be re-shared forever.
3. Add storage RLS policies so a user can only touch their own prefix. Draft for **you** to run in the Supabase SQL editor (I will not execute DDL/DML against your project — rule 10):
   ```sql
   -- DRAFT ONLY — review, then you run it. Assumes bucket `datasets` is private.
   create policy "owners read own objects"
     on storage.objects for select
     to authenticated
     using (bucket_id = 'datasets' and (storage.foldername(name))[1] = auth.uid()::text);

   create policy "owners upload own objects"
     on storage.objects for insert
     to authenticated
     with check (bucket_id = 'datasets' and (storage.foldername(name))[1] = auth.uid()::text);

   create policy "owners delete own objects"
     on storage.objects for delete
     to authenticated
     using (bucket_id = 'datasets' and (storage.foldername(name))[1] = auth.uid()::text);
   ```
4. Consider a per-upload random **prefix** (uuid) in addition to the user folder so path enumeration is not even theoretically bounded by user ids.
5. If any object has already been public, treat those URLs as disclosed: rotate filenames for new uploads and decide (with your users) whether old records need re-consent. That is a disclosure decision for you, not for me to make silently.

**Verification**
- Read-only check of the live setting (run this yourself — `*.supabase.co` does not resolve from this machine, see §7):
  `curl -s -o /dev/null -w '%{http_code}\n' "https://<project-ref>.supabase.co/storage/v1/object/public/datasets/<known-path>"`
  `200` ⇒ bucket is public (**finding confirmed**); `400/404` with a message mentioning public access disabled ⇒ already private.
- **Measured later on 2026-10-27, after the DNS block lifted: neither.** That request returns
  `400 {"error":"Bucket not found","code":"NoSuchBucket"}` — there is no `datasets` bucket in this
  project, public or private. So C-3 is **latent, not live**: nothing is being published today, and
  the upload feature is broken outright (`services/storage.ts:12,23` target that bucket). See §9a.
  Do not "fix" the upload by creating a public bucket — that is precisely how this finding becomes
  real; create it private and switch the code to signed URLs first.
- After the fix: the same public-route request must **not** return the file, and `select signedUrl` path must work in-app for the owner and fail for a second test account.
- New uploads must persist a path (no `https://…/object/public/…`) in `datasets.file_url`; verify with `select file_url from datasets order by created_at desc limit 5;`.

---

### C-4 — No version-controlled migrations and no discoverable RLS for the tables that hold customer data; the only committed migration contradicts the product claim

**Evidence**
- `git ls-files` shows **no `supabase/migrations/` directory** and no tracked `.sql` under a migrations path. Schema and policy state live only in the Supabase dashboard — unauditable, unreproducible, and impossible for a reviewer (or an incubator judge) to verify.
- The one tracked migration actively argues the opposite of a safe design. `harvester/setup_insights.sql:4-19` creates:
  ```sql
  CREATE TABLE IF NOT EXISTS insights (
      id BIGSERIAL PRIMARY KEY, summary TEXT NOT NULL,
      risk_level TEXT, trend TEXT,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
  );
  ALTER TABLE insights ENABLE ROW LEVEL SECURITY;
  CREATE POLICY "Service role can manage insights" ON insights
      FOR ALL USING (auth.role() = 'service_role')
      WITH CHECK (auth.role() = 'service_role');
  ```
  — **no `user_id`, no `dataset_id`, and no `on delete cascade` FK** — with a single `FOR ALL` policy restricted to `service_role`. The application code (`services/database.ts:71-77`) inserts `user_id` and `dataset_id` into `insights`. So either (a) production has drifted from this file, in which case the file is misleading documentation of a security control, or (b) this *is* production, in which case **authenticated users can read and write zero insights** (every policy requires `service_role`, and the web app only ever holds the anon key — `lib/supabaseClient.ts:3`) and every app insert is rejected. The live symptom — `app/dashboard/page.tsx:98,161` showing real (non-demo) users a permanent `—` for their insight count — is consistent with (b). Note also the file's own header comment (`:1`) says "create the ai_insights table" while `:4` creates `insights`, a naming drift that suggests the file was not the last word on production schema.
- `harvester/recreate_view.sql:4` — `DROP VIEW IF EXISTS unified_market_intel;` shipped as the manual repair step for a broken view, with no `CREATE OR REPLACE` alternative and no transaction wrapper.

**Impact**
The security guarantee the product sells cannot be evidenced at all — which for an incubation review is close to the worst outcome, since the reviewer's question ("show me the policy") has no answer. Beyond that: no migration history means no rollback, no environment parity, and schema changes performed by hand against production data; a `service_role`-only policy means either total invisibility of user data or a hidden `service_role` path in the app; and a `DROP VIEW` as a runbook step is an availability risk on a read path the harvester also writes.

**Remediation (proposed)**
1. **Export ground truth from production, read-only**, and commit it as the baseline migration. In Supabase Studio → SQL, or via `supabase db dump --data-only false`:
   ```sql
   -- DRAFT — read-only introspection, safe to run, produces the audit artefact.
   -- Which policies exist, and what they actually permit:
   select tablename, policyname, cmd, permissive, roles::text, qual, with_check
     from pg_policies
    where schemaname = 'public'
    order by tablename, policyname;

   -- Which tables have RLS enabled / forced at all:
   select c.relname,
          c.relrowsecurity  as rls_enabled,
          c.relforcerowsecurity as rls_forced
     from pg_class c
     join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r'
    order by c.relname;

   -- Column list, nullability, defaults, and storage of the two customer tables:
   select table_name, column_name, data_type, is_nullable, column_default
     from information_schema.columns
    where table_schema = 'public' and table_name in ('datasets','insights')
    order by table_name, ordinal_position;

   -- Constraints and indexes (RLS correctness is not enough without these):
   select conrelid::regclass as table_name, conname, contype, pg_get_constraintdef(oid)
     from pg_constraint
    where connamespace = 'public'::regnamespace
    order by 1, 2;
   ```
   Run in Supabase Studio → SQL Editor (read-only, no mutation), and paste the results into `docs/` so the true schema becomes an auditable artefact.
2. **Adopt ordered, incremental migrations** in `supabase/migrations/` (`0001_baseline.sql`, `0002_insights_ownership.sql`, …) and never edit a committed migration. Install the Supabase CLI and manage them through it so `db push`/`db pull` is reproducible.
3. **Draft the target policy set** (least privilege, owner-only) — for **your** review and execution, not mine:
   ```sql
   -- DRAFT ONLY — you run this after confirming the real column names.
   alter table public.datasets enable row level security;
   alter table public.insights enable row level security;

   create policy "datasets: owner selects" on public.datasets
     for select to authenticated using (auth.uid() = user_id);
   create policy "datasets: owner inserts" on public.datasets
     for insert to authenticated with check (auth.uid() = user_id);
   create policy "datasets: owner deletes" on public.datasets
     for delete to authenticated using (auth.uid() = user_id);

   create policy "insights: owner selects" on public.insights
     for select to authenticated using (auth.uid() = user_id);
   create policy "insights: owner inserts" on public.insights
     for insert to authenticated with check (auth.uid() = user_id);

   -- Harvester keeps service_role only; the web app must never need it.
   create policy "insights: harvester writes" on public.insights
     for insert to service_role with check (true);
   ```
   Add `not null` on `user_id`, `on delete cascade` on the `insights.dataset_id → datasets.id` FK, and indexes on `datasets.user_id, datasets.created_at` and `insights.dataset_id, insights.user_id` — the app currently filters on exactly these columns with no index in version control.
4. Replace `DROP VIEW` with `CREATE OR REPLACE VIEW`, and commit the view as a migration.
5. **Reconcile the two `insights` schemas** (audit §5, D-2) as one migration, and make `setup_insights.sql` match reality or delete it — a wrong committed schema file is worse than none.

**Verification**
- `select count(*) from pg_policies where schemaname='public' and tablename in ('datasets','insights');` > 0 and the returned `qual` text contains `auth.uid()`.
- Tenant test: account A `select count(*) from datasets` must equal A's own rows only; A attempting `update datasets set name='x' where id=<B's id>` must affect 0 rows.
- CI check: `supabase db reset` against the migration folder succeeds from a clean checkout (proves the migrations are the whole truth).
- The application's own header count changes from `—` to a number for a real account — the first user-visible proof that C-4 was the cause.

---

## 4 High findings

### H-1 — Fabricated analytics, cryptographic-looking signatures, and hardcoded "AI recommendations" are presented to users as verified intelligence

**Evidence (all in the shipped product surface)**
- `components/CountrySection.tsx:28-60` — `getTrendData()` / `getRiskData()` synthesize chart series by keyword-matching the AI summary text, rendered under the label **"REAL-TIME TREND DISTRIBUTION"**.
- `services/pdfExport.ts:48-110` — the same fabricated histogram and pie chart exported to PDF under **"Trend Progression (Real-Time)"**.
- `components/CountrySection.tsx:62` — `Buffer.from(insight.id).toString('base64')` printed as a report ID ("Authorized System Code", `:210-214`), next to `:76` **"SECURE CRYPTOGRAPHIC REPORTING SYSTEM"**. Base64 is encoding, not cryptography. I verified that nothing in the codebase signs, encrypts, or hashes anything: `grep -in "createHmac|crypto\.|encrypt|jwt\.sign|signed"` across all `.ts/.tsx/.py` returns **only UI copy** — no cryptographic call site exists anywhere.
- `app/page.tsx:443` — public marketing states "we use **strong cloud encryption** to keep your insights completely safe"; `components/ComingSoonModule.tsx:39` renders a status chip reading `Security: Encrypted`. Neither is backed by any implementation, and C-3 is the direct counter-evidence (a public object URL is the opposite of access-controlled storage). Transport encryption (TLS) is not what those sentences claim.
- `components/CountrySection.tsx:165-198` and `services/pdfExport.ts:238-242` — "Strategic Recommendations" and "Step-by-Step Resolution Guidelines" are **static literals** (including "SnNPR zones" terminology), identical for every customer, presented as personalized advice.
- `components/ExportButton.tsx:13-17` — `AUTHORIZED_PROFILES` is three hardcoded real-looking names and roles that **any visitor can select** to stamp a downloaded report; `:133` shows an "Encrypting…" progress label for a step that performs no encryption.
- `components/CountrySection.tsx:218-226` — "**Digitally Signed By**" over a hardcoded person's name (`Augustin Nkundimana`, `:219`, titled `Lead Manager / Nexus Agririse`, `:220`), with `:226` labelling it an "**Official Signature (Digital Proxy)**". No signing operation exists.
- `components/ChatAssistant.tsx:1-126` — a `toLowerCase().includes(...)` keyword responder, with `:165` labelling itself **"Online | AI Powered"** and `:101-107` reciting specific market figures that exist nowhere in the database.
- `data/demoInsights.ts` — figures of high specificity (180,000 MT; USD 920/MT; USD 4.2M; 40–65% premiums; 38% income retention) rendered inside app chrome, not in an obviously-demo container.
- `harvester/environment_enricher.py:72-75` — soil/vegetation intelligence is explicitly invented in the source: *"NDVI Index (Mocked/Estimated)… We simulate an index based on soil moisture"* → `ndvi = 0.4 + (moist*0.5) + (rain/50.0)`; and `:58` `MONTHLY_AVG_RAINFALL = 100.0 # mm` is a placeholder constant, not a measurement. That value is written to the production table the harvester owns.
- `harvester/recreate_view.sql:12-14` — stale hardcoded FX fallbacks (ETB `0.018`, RWF `0.00078`) and an inconsistent third (`COALESCE(er.rate_to_usd, 0.001)` vs `1.0`), then `:33` `(ms.price_usd_per_mt - 150) AS net_opportunity_value` — a magic constant presented as a computed business metric.
- `app/dashboard/analytics/page.tsx:114,125,136` — `14.2K`, `12,400`, `89%` are literals.

**Impact**
Your own mission brief states this plainly: *"Do not invent live weather, market prices, soil measurements, or AI-generated results and present them as verified facts."* The app does exactly that, at scale, on the screens a judge will look at. Beyond the credibility risk — and the risk of a real buyer acting on an invented NDVI or an invented price — this is a **security finding**, not merely a honesty finding, in two concrete ways. First, simulated soil and vegetation values are persisted into the same tables as harvested real data with **no provenance column**, so nothing downstream can tell them apart; `ndvi` will be treated as an observation by any future model or recommendation. Second, a fake "cryptographic" signature plus selectable fake authorisation profiles is the standard shape of a **fraud/impersonation** vector: a report that appears attested by a named expert, generated by anyone, is a document with evidentiary weight that the system did not earn. If such a PDF is forwarded to a bank or cooperative, the harm is real and traceable to your platform.

**Remediation (proposed)**
1. **Provenance first.** Add a source marker to every intelligence column (`environment_enricher.py`) — `source text not null check (source in ('observed','modelled','placeholder'))` plus `observed_at timestamptz` and `as_of_note text`. Never write a placeholder into a column that renders as an observation.
2. **Relabel honestly, in place.** "REAL-TIME TREND DISTRIBUTION" → "Illustrative distribution (derived from the summary text)"; "Trend Progression (Real-Time)" → same. Keep the visual design untouched (your rule 1) — the fix is copy, not layout.
3. **Remove or rename the crypto claims.** Drop "SECURE CRYPTOGRAPHIC REPORTING SYSTEM"; show the plain insight id, or genuinely sign reports with an HMAC using a server-side secret and label it "Integrity check". Correct `app/page.tsx:443` and the `Security: Encrypted` chip in `components/ComingSoonModule.tsx:39` to describe what is actually true (TLS in transit; provider-side storage controls) — or state encryption-at-rest as a roadmap item, not a present feature. `Buffer` reliance in the browser is also an M-3/bundler fragility risk.
4. **Delete `AUTHORIZED_PROFILES`** (`ExportButton.tsx:13-17`) and the "Encrypting…" label (`:133`). If a signed-off report is a real requirement, the signer must be the authenticated owner's own name from their profile, and the signature must be produced server-side.
5. **Make static recommendations visibly static, or generate them.** Either move the "SnNPR zones" guidance to a labelled "General guidance" section, or feed it through the AI with the abstain/cite rules (M-1) so it is actually derived from the dataset.
6. **Correct the chat assistant's self-description** — it is not AI-powered. Either wire it to the provider (reusing the fixed `/api/analyze` pattern, with the same auth + timeout + rate limit) or label it "Rule-based FAQ assistant" and remove the invented figures from `:101-107`.
7. **Scope demo data explicitly.** Everything from `data/demoInsights.ts` renders behind a persistent, unavoidable "DEMO DATA" banner tied to `DemoModeContext`, and the banner is included in PDFs. `hooks/useAuth.tsx:48-54`'s `mockUser` must never be usable as a write identity (C-2).
8. Replace FX fallbacks with either a fresh value plus `rate_as_of` displayed to users, or no value at all — never a hardcoded number with no timestamp.

**Verification**
- `grep -rin "REAL-TIME\|CRYPTOGRAPHIC\|Encrypting\|AUTHORIZED_PROFILES\|Encrypted\|encryption\|Digitally Signed" components services app data harvester` → zero matches, **unless** each remaining match is paired with an explicit "illustrative"/"in transit only"/"none" qualifier and a call site that performs the operation.
- `select source, count(*) from <env table> group by 1;` → no `placeholder` rows feeding a UI column labelled as observed.
- Product walk: every number on every dashboard has either a fetch path to a table or a visible "sample data" marker. I will do this as a scripted checklist, not an assertion.

---

### H-2 — CI leaks secrets into shell commands and URL query strings, with a hardcoded third-party fallback endpoint

**Evidence**
- `.github/workflows/harvester.yml:70-72`:
  ```
  curl -X POST -H "Content-Type: application/json" -d '{"text": "…"}' \
    ${{ secrets.MONITORING_WEBHOOK_URL || 'https://httpbin.org/post' }}
  ```
  The secret is **interpolated into the command line** before the shell runs it — it appears in the job's expanded script and in process listings, rather than being passed as an environment variable. Worse, the `||` fallback points at `httpbin.org`: if the secret is unset, the workflow posts your run metadata — repository name and a clickable URL to your Actions logs, which contain further context — to an unrelated public third party that logs request bodies.
- `harvester/pre_flight_check.py:56` — `url = f"...?key={google_api_key}"`. The API key travels in the **query string**, and `:65` prints the caught `httpx` exception. httpx exception text includes the request URL, so on any network failure the key is echoed into the Actions log. Same class of leak at `:63` (`res.text` printed) if the provider ever echoes the request.
- `harvester/main.py:73` — the harvester's CSV/HTML parsing writes straight into production tables using the `service_role` key.
- The web app and the harvester use **two different variable names for one provider**: `GEMINI_API_KEY` (`services/ai.ts:6`) vs `GOOGLE_API_KEY` (`harvester.yml:38,64`). A correctly-set one and a missing other produces a silent partial outage (see M-4).

**Impact**
GitHub Actions logs are readable by anyone with repo access (including former collaborators and, in a public repo, anyone), and the service-role key and provider keys are also present in the same job env for several steps (`harvester.yml:37,44,50,56,63`). A single accidental secret echo converts into a **full-project compromise**: `SERVICE_ROLE` bypasses RLS entirely, so its leak means every user's datasets and insights, and via the storage API potentially every uploaded file. This is the most likely path to a real incident in this codebase, precisely because it needs no exploit — only a mis-set secret or a transient network error.

**Remediation (proposed)**
1. Move the webhook URL out of the command line into `env:`, and **fail loudly instead of falling back to a third party**:
   ```yaml
   - name: Dispatch Workflow Failure Alert
     if: failure() && env.MONITORING_WEBHOOK_URL != ''
     env:
       MONITORING_WEBHOOK_URL: ${{ secrets.MONITORING_WEBHOOK_URL }}
     run: |
       curl -sf -X POST -H "Content-Type: application/json" \
         --data-binary @- "$MONITORING_WEBHOOK_URL" <<'JSON'
       {"text":"Nexus AgriRise harvester run failed: https://github.com/…/actions/runs/${{ github.run_id }}"}
       JSON
   ```
   Add a preceding step that errors if the secret is empty, so "monitoring is off" is a visible failure, never a silent POST to `httpbin.org`.
2. Send the Gemini key in the **`x-goog-api-key` header**, never the query string, and never print an exception object as-is: `print(f"Gemini check failed: {type(e).__name__}")`. Same for `res.text` — log status codes, not bodies.
3. **Standardize on one name** (`GEMINI_API_KEY`) across web app, harvester, and CI; update `services/ai.ts:6`, `pre_flight_check.py`, `intelligence_generator.py`, `harvester.yml`, and `README.md` in one pass. Add a startup assertion so a missing key is a loud deployment failure (see M-4).
4. **Rotate everything now, on general principle**, since the workflow has been running on this pattern daily (`cron: "0 0 * * *"`, `harvester.yml:7`): `SERVICE_ROLE`/`SUPABASE_SERVICE_ROLE_KEY`, `GOOGLE_API_KEY`, `CURRENCY_API_KEY`, `MONITORING_WEBHOOK_URL`. Rotation is an action **you** take in the provider dashboards — I will not modify secrets or environment settings (rule 10). I can list which rotations are required and in what order to avoid breaking the daily run.
5. Reduce blast radius: give the harvester a **scoped DB role** (insert/select on its own tables) instead of `service_role`, and have `pre_flight_check.py` use a read-only credential.
6. Add a secret scanner as a CI step (`gitleaks`/`trufflehog`) and a pre-commit hook, so the class of bug is prevented rather than fixed once.

**Verification**
- After the workflow edit: trigger `workflow_dispatch`, open the job's raw log, and search the log for the first 8 characters of each secret value (you do this check, since only you can see values). Expected: **zero occurrences**.
- `grep -n "key=" harvester/*.py` → no API key in any URL.
- `grep -rn "httpbin.org" .github` → zero.
- `gitleaks detect --source . --redact` in CI exits 0.
- Deliberate failure test: set the webhook secret empty and confirm the job fails with a clear message instead of POSTing anywhere.

---

### H-3 — 27 npm vulnerabilities (2 critical, 19 high), with build tooling installed as runtime dependencies

**Evidence**
- `npm audit` on a clean install of the committed lockfile: **27 advisories — 2 critical, 19 high, 5 moderate, 1 low** (recorded verbatim in audit §1).
- `package.json` `dependencies` includes `shadcn ^4.7.0` and `@base-ui/react ^1.4.1` — a CLI scaffolding tool and a component primitive set that belong in `devDependencies` (if at all) — alongside unused runtime packages `openai`, `axios`, `sonner`, `@lottiefiles/dotlottie-react`, `@shadcn/ui`.
- Unused-but-installed code expands the vulnerable surface without adding function: `services/api.ts` (pure mock, imported by nothing) and `components/ui/button.tsx` (imports `@base-ui/react/button`, imported by nothing) were confirmed by grep.
- `npm install` emitted **3 high-severity vulns at `postinstall` time**, i.e. advisories reachable through install hooks.
- No lockfile-based provenance pinning beyond the default, and no `audit-ci`/Dependabot configuration in the repo.

**Impact**
Transitive critical/high advisories in a Next.js/React app routinely include SSRF, DoS, and prototype-pollution classes in the request/parse path, and this app's request path is the one that is already unauthenticated (C-1). Shipping CLI tooling in `dependencies` also means the production server bundle contains packages with their own dependency trees and their own write-executable postinstall scripts, in an app that additionally runs arbitrary Python scrapers in CI. It is a materially larger supply-chain surface than the product needs, and the "unused" packages are exactly the ones nobody notices when they go bad.

**Remediation (proposed)**
1. `npm audit --json` triage, then `npm audit fix` (non-breaking) followed by explicit, reviewed `npm update` for the rest — one commit per batch so a regression is attributable.
2. Move `shadcn` to `devDependencies`; verify whether `@base-ui/react` is genuinely needed given `components/ui/button.tsx` has no importers — if unused, remove both it and the dead file.
3. Delete the unused runtime deps listed above (each removal is one small, reviewable change; your rule 11). Confirm no importer before each removal, and keep the design system intact.
4. Add `npm audit --audit-level=high` (or `audit-ci`) as a CI gate on PRs, and enable Dependabot security updates so this cannot silently re-accumulate.
5. Re-run the full gate set after each batch: `npm ci && npx tsc --noEmit && npx eslint . && npm run build`.
6. Pin the Python side too: `harvester/requirements.txt` currently floats, and `playwright` + `playwright-stealth` executing scraped HTML daily is a higher-risk combination than the JS stack. Add `pip-audit` to CI.

**Verification**
- `npm audit --audit-level=high` exits 0 (documented exceptions listed with justification, not silent).
- `npm ls shadcn` shows it under devDependencies; `npx next build` still succeeds and `dist`/`.next` server bundle size drops measurably (record before/after `du -sh .next`).
- `node -e "require('openai')"` no longer resolvable from the app tree (proof the dead dependency is gone).

---

### H-4 — No security headers and no response hardening; wildcard CORS observed on live responses

**Evidence**
- `next.config.ts` is the **empty create-next-app stub** (lines 1-8, `/* config options here */`). Therefore: no `Content-Security-Policy`, no `X-Content-Type-Options`, no `Referrer-Policy`, no `X-Frame-Options`/`frame-ancestors`, no `Permissions-Policy`, no `Strict-Transport-Security`.
- Live probe of the deployed site returned `Access-Control-Allow-Origin: *` on responses.
- The app is 100% `"use client"` (every page under `app/` carries the directive) and injects AI-derived text into React (`CountrySection.tsx`) and into a generated PDF (`pdfExport.ts`) — see M-1.
- There is **no `middleware.ts`** anywhere in the repo (verified by `git ls-files`), so no server-side route protection, no header injection point, and no redirect allow-list (relevant because `app/signup/page.tsx:60-67` does a blind `router.push('/dashboard')` on a `setTimeout`, not a validated redirect).

**Impact**
No CSP means any XSS that does land (via the AI-output/DOM path in M-1) has no mitigation and can exfiltrate to any origin; missing `X-Content-Type-Options: nosniff` leaves uploaded CSV/HTML served with sniffing enabled; no `frame-ancestors` allows clickjacking of a logged-in dashboard, and specifically of the upload flow; no `Referrer-Policy` can leak the signed/public object paths from C-3 into third-party analytics via referrer; and wildcard CORS combined with C-1/C-2 means any website a user visits can drive cross-origin requests to your expensive, identity-trusting endpoint. Missing HSTS leaves the first request downgradeable. This is a "trivially cheap, visibly checked by every reviewer" gap — incubation judges routinely open DevTools → Network → Response Headers.

**Remediation (proposed)**
1. Populate `next.config.ts` with a headers block (design-preserving, zero UI impact):
   ```ts
   const CSP = [
     "default-src 'self'",
     "script-src 'self' 'unsafe-inline'",   // required by Next hydration; tighten with a nonce later
     "style-src 'self' 'unsafe-inline'",
     "img-src 'self' data: blob: https:",
     "font-src 'self' data:",
     "connect-src 'self' https://<project-ref>.supabase.co https://generativelanguage.googleapis.com",
     "frame-ancestors 'none'",
     "base-uri 'self'",
     "form-action 'self'",
     "object-src 'none'",
   ].join('; ');

   const nextConfig: NextConfig = {
     async headers() {
       return [{
         source: '/:path*',
         headers: [
           { key: 'Content-Security-Policy', value: CSP },
           { key: 'X-Content-Type-Options', value: 'nosniff' },
           { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
           { key: 'X-Frame-Options', value: 'DENY' },
           { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
           { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
         ],
       }];
     },
   };
   ```
   Note `connect-src` must name your Supabase host — put the **URL** there (it is not a secret) or use an env placeholder that Vercel substitutes at build time; do not hardcode a project ref into a committed file if you prefer, but a URL is not a credential.
2. **Remove the wildcard CORS.** Do not set `Access-Control-Allow-Origin: *` for `/api/*`; if a header is being added by an external config (Vercel project settings or a Supabase dashboard setting), locate it and scope it to `https://nexus-agririse.vercel.app`. If it turns out to be Supabase's own REST/Storage CORS default, document that, since it also means your anon-key REST endpoint is browser-reachable from any origin — which is exactly why C-4's RLS must be the enforcement point rather than app code.
3. Add a `middleware.ts` that (a) checks the session cookie for `/dashboard/*` and (b) is the place where any future redirect target is validated against an allow-list — this closes the "no server-side route protection" gap noted in audit §6 and removes reliance on client-side guards.
4. Add a headers/observability regression check to CI (a script that asserts each header is present).

**Verification**
- `curl -sI https://nexus-agririse.vercel.app/ | grep -iE 'content-security|x-content-type|referrer|x-frame|permissions-policy|strict-transport'` → all six present.
- `curl -sI -H 'Origin: https://evil.example' https://…/api/analyze` → response must **not** carry `Access-Control-Allow-Origin: *`.
- Browser console on the live site shows **no CSP violation** errors after the change (this is the step people skip — `script-src 'unsafe-inline'` vs a real nonce is a trade-off to state explicitly).
- Unauthenticated `GET /dashboard` from `curl` must be redirected to sign-in once `middleware.ts` lands; today it returns the page shell (client-side guard only).
- Manual check that no visual regression occurred: the header changes touch no CSS, so `prefers-reduced-motion`, animations and layout are unaffected — verified by loading the existing pages.

---

### H-6 — An anonymous caller can read the entire scraped market dataset through a view that bypasses RLS (measured, 2026-10-27)

`supabase/migrations/README.md` section 10 flagged this as unresolved and explicitly *unverified*.
It is now verified, from outside SQL, with read-only requests.

**Evidence.** Using only the anon key that the production browser bundle already ships (the
project host and a 208-character anon JWT appear in `/_next/static/chunks/*.js`; values were
never printed, stored, or committed), a `select`-only GET returns:

```
GET /rest/v1/unified_market_intel?select=*&limit=1   → 206, content-range 0-0/122
GET /rest/v1/market_intelligence?select=*&limit=1    → 200, content-range */0
```

The view returns **122 rows to an unauthenticated-by-session caller**; the table beneath it
returns **0**. 122 is exactly the `market_intelligence` row count measured from inside SQL during
the pre-flight, so the view publishes that whole table. `environmental_data`, `exchange_rates`,
`datasets` and `insights` all correctly return 0 rows to the same key, which is what makes this
one comparable result a real difference rather than a blanket open door.

**Why it happens.** `harvester/setup_normalization.sql:13` creates the view with a plain
`CREATE OR REPLACE VIEW`. A plain view executes as its owner, so row-level security on the base
table is not consulted for readers of the view. The Phase 1 audit already documents that the
numbers themselves are unsafe — `price_usd_per_mt` is derived from hard-coded `rate_to_usd`
constants with a literal `$150/MT` subtracted — so what is publicly enumerable is not merely
unhelpful, it is third-party-scraped figures with fabricated unit conversions attached and no
licence or attribution context in the payload.

**Impact.** Anyone on the internet can dump the harvest, including rows scraped from ECX and NAEB
pages whose terms of use were never reviewed here. For an incubator submission that is both a
data-licensing exposure and a competitive leak, and it is live today, independent of the six
unapplied migrations.

**What is still not established.** The view's owner, `relkind` and `reloptions` — i.e. whether
the fix is `alter view … set (security_invoker = true)` (which would then require base-table
grants and policies to be reviewed, and could break the harvester's own readers) or a revocation
of `select … to anon, authenticated`. Choosing between them needs the P7 output, not this probe.

**I changed nothing.** No grant, policy, or view definition was altered; this finding is the
measurement only. Remediation should be its own approved change with a read-only before/after
check, because the same view is what the dashboard's price panels would read if it were ever
wired up.

**Verification**
- Re-run the two `curl` commands above with `$ANON` in a shell variable (never in a file): the
  gap between `0-0/122` and `*/0` is the finding.
- `select relname, relkind, pg_get_userbyl(relowner), reloptions from pg_class where relname='unified_market_intel';`
  and `select pg_get_viewdef('public.unified_market_intel'::regclass, true);` — paste both before
  touching permissions.
- After any fix, both `curl` commands must return `*/0` or `401`, and the harvester's own reads
  must be re-checked from the service-role side.

## 5 Medium findings



### M-1 — Unvalidated AI output reaches the DOM and generated documents

**Evidence:** `services/ai.ts:38` uses a greedy regex `content.match(/\{[\s\S]*\}/)` — on a reply containing prose plus multiple JSON blocks this captures from the **first** `{` to the **last** `}`, producing invalid or partially-attacker-controlled text; `:41` `JSON.parse` then casts it to `AIInsightResponse` with **no runtime validation**; `:44` checks only 3 fields (`marketSummary`, `riskLevel`, `priceTrend`) and never validates `recommendedAction`/the fourth field; `riskLevel` is typed `"Low"|"Medium"|"High"` (`services/database.ts:19`) but **never checked**, and `components/RiskBadge.tsx` styles on exact string equality while `app/dashboard/analytics/page.tsx:87` calls `i.risk_level.toLowerCase()` — a null/long value from the model crashes the analytics page (audit §5 D-5). The result is then rendered (`CountrySection.tsx`) and written into a PDF (`pdfExport.ts`) and, with no CSP (H-4), an injection landing in `summary` text has no second line of defence. `services/prompts.ts` contains **no** instruction to cite sources, no "if data is insufficient say so", and no output-schema constraint.

**Impact:** model-output-controlled content displayed as authoritative advice, plus availability (page crash) and a plausible XSS sink. Also the main route to fabricated agricultural claims, since nothing bounds the model's statement set.

**Remediation:** (1) ask Gemini for JSON only (`responseMimeType: "application/json"`) and add a `responseSchema`, which removes the regex entirely; (2) validate with a real runtime checker (`zod`, already idiomatic in this ecosystem) and **reject any `riskLevel` outside the enum** rather than coercing; (3) require `minLength`/`maxLength` per field so a runaway reply cannot be dumped into a PDF; (4) add abstain-and-cite instructions to `services/prompts.ts` — the model must return "insufficient data" instead of inventing figures (this is the direct implementation of your brief §4B); (5) keep React's default escaping and never introduce `dangerouslySetInnerHTML`; (6) make `analytics/page.tsx:87` null-safe.

**Verification:** unit tests with adversarial fixtures — prose-wrapped JSON, two JSON blocks, `riskLevel: "Extreme"`, missing field, 500 KB summary — each must produce a clean validation error, never a render. Manual: an insight with an unexpected `risk_level` renders a neutral badge, not a crash.

### M-2 — `service_role` credential used by an unbounded scraper in a shared CI runner

**Evidence:** `harvester.yml:44,50,56,63` grants `SUPABASE_SERVICE_ROLE_KEY` to four Python steps; `harvester/main.py` uses `playwright` + `playwright-stealth` (bot-detection evasion) to render third-party HTML and `:73` parses by **column position** (`safe_float(cells[4])`), with `:30` `upsert(data_list)` and **no conflict target**, writing into production tables. No schema validation on scraped rows, no size limits, no allow-list of source domains in version control.

**Impact:** a remote page's markup, through a positional parser, becomes a production row with RLS bypassed. A layout change on the source site silently mis-columns data (wrong country's price for the right crop); a hostile or compromised upstream page controls what lands in your tables; and `upsert` without a conflict target either errors or duplicates. Bot-evasion scraping also carries a legal/ToS exposure that an incubation reviewer may ask about directly.

**Remediation:** dedicated DB role for the harvester with insert/select only on its own tables (never `service_role`); validate every scraped row against an explicit schema before write; declare an `on_conflict` target and a unique index; allow-list source hosts and log the source URL + fetch timestamp per row for provenance (ties into H-1 step 1); prefer a licensed/agreed data feed over HTML scraping and document the arrangement. Add row-count anomaly guards so a bad harvest fails loudly instead of overwriting good data.

**Verification:** `select count(*) from <market table> where harvested_at > now() - interval '1 day';` — alert on >2× or <0.5× the trailing 30-day mean; deliberately feed a malformed HTML fixture in a unit test and assert **zero** rows written; confirm with `select rolname, rolsuper, rolbypassrls from pg_roles where rolname like 'harvester%';` that the new role has `rolbypassrls = false`.

### M-3 — Resource-exhaustion and DOM-churn patterns on hot paths

**Evidence:** unbounded `select("*")` at `services/database.ts:52, 92, 106` (no `limit`, no pagination, no column projection); the whole CSV is parsed once for the DB insert and again for the AI payload (`UploadCard.tsx:115` re-reads `parseCSV(file)` after already doing so earlier in the same handler); `components/LanguageSwitcher.tsx:66-72` installs `setInterval(forceBodyTop, 100)` that is **never cleared**, running forever and rewriting scroll position; `:79-80` writes `document.cookie` (also an eslint `immutability` error); `harvester/` ships `ETB_RATES_CACHE.json` with a documented ~130-day staleness window. A 100 ms interval touching layout is a battery/thermal and accessibility problem (it fights the user's own scroll), and a 130-day FX cache feeds H-1's stale-currency numbers.

**Impact:** unbounded reads scale badly with the first real customer; the interval is a permanent jank/leak on every page; a 130-day FX cache quietly makes derived USD figures wrong.

**Remediation:** paginate (`.range(0, 99)`) and project only needed columns; pass the already-parsed rows to `/api/analyze` instead of re-parsing; replace the interval with a one-shot effect (or CSS) and clear it on unmount; cache FX with a TTL and surface `rate_as_of` in the UI (also fixes H-1 step 8).

**Verification:** `performance.measure`/DevTools flame chart shows no recurring 100 ms task after the language-switcher change; `select` queries in the app carry `limit` — enforced by a `grep -n "select(\"\\*\")" services/database.ts` CI assertion; `ETB_RATES_CACHE.json` older than the TTL triggers a refetch (unit test on a fake clock).

### M-4 — Information leakage through errors and logs, and two names for one provider key

**Evidence:** `route.ts:40` `console.error('POST /api/analyze error:', error.message)` and `services/ai.ts:50,61` log provider messages, which for Google include request/quota detail; `route.ts:43` branches on `error.message === 'OPENAI_API_KEY is missing'` — a string that can never occur, because the app uses Gemini (`services/ai.ts:6` reads `GEMINI_API_KEY`) and `ai.ts:8` throws a *different* message (`'GEMINI_API_KEY is missing. Please add it to .env.local'`). `ai.ts:65` collapses every distinct failure (auth, quota, timeout, malformed reply, model-not-found) into one `'AI analysis failed'`. Because the CI uses `GOOGLE_API_KEY` and the app uses `GEMINI_API_KEY`, a correct-but-mismatched configuration produces a **silent** production outage — which is precisely the live 500 observed in C-1, and is why this is not academic. `README.md:7,10,19,36` documents Next 14+ and `OPENAI_API_KEY`/GPT-4o-mini, contradicting the code, so a maintainer following the README will set the wrong variable.

**Impact:** internal detail in logs (which in Vercel are retained and exportable), an unusable error taxonomy for operators, and a configuration footgun that is the leading root-cause candidate for the broken core feature.

**Remediation:** (1) unify on `GEMINI_API_KEY`, set it in Vercel (project **and** production environment) — variable **name** only here, values stay with you; (2) add a startup/deploy assertion that fails loudly if it is absent, rather than 500-ing per request; (3) delete the dead `OPENAI_API_KEY` branch at `route.ts:43`; (4) classify errors — introduce distinct codes (`missing_config`, `provider_auth`, `quota`, `timeout`, `bad_output`) with a stable public message and a correlatable internal log line; (5) never log a provider response body verbatim; (6) fix the README to describe the stack actually used (Next 16, Gemini) — a security-adjacent fix, since wrong docs cause wrong configuration; (7) confirm `GEMINI_API_KEY` is **not** `NEXT_PUBLIC_`-prefixed anywhere (`grep -rn "NEXT_PUBLIC_GEMINI" .` must be empty) — a `NEXT_PUBLIC_` name would embed the secret into the client bundle.

**Verification:** after configuration, an authenticated request returns `200` and a real insight row appears in `insights`; a deliberately-wrong key returns a labelled `provider_auth` error without the key text in any log line; `grep -rn "NEXT_PUBLIC_.*KEY" app services lib components` is empty; the Vercel build log shows the assertion step passing.

### M-5 — No privacy, terms, or data-processing surface for an app that stores third-party business data

**Evidence:** `app/` contains no `/privacy`, `/terms`, or data-processing route (`git ls-files` verified), while `app/page.tsx:93` asserts "100% Data Privacy Guaranteed" and `:441` makes team privacy claims; `app/contact/page.tsx:9-13` is `preventDefault()` + `alert("Message sent!…")`, so **every enquiry is silently discarded** (a trust failure as much as a functional one, audit §4); user uploads and generated insights are persisted with no recorded purpose, retention period, or deletion path — and the one deletion function that exists (`deleteDataset`) is unscoped and unwired (C-2).

**Impact:** the privacy statements are unsupported by any document or mechanism, and there is no way for a user to obtain or remove their data. For a platform handling farm-level commercial data — and for an incubator that may later connect real partners — this is a compliance exposure, and it is also the kind of claim a technical reviewer checks in thirty seconds by opening the footer.

**Remediation:** publish `/privacy` and `/terms` (purpose, categories, retention, subprocessors: Supabase, Google Gemini, Vercel, Open-Meteo, freecurrencyapi); add a real contact path (Supabase table + insert, or an approved transactional email) with validation and a genuine success state; implement account/data export and deletion (a `delete_account` flow that cascades datasets/insights and removes storage objects) behind the same auth as C-2; make each claim in `app/page.tsx:93,:441` correspond to something the app does, and soften what it does not.

**Verification:** `/privacy` and `/terms` resolve with content and are linked from the footer on every page; submitting the contact form creates a queryable row (`select * from contact_requests order by created_at desc limit 5;`); requesting deletion leaves `select count(*) from datasets where user_id='<uid>'` at 0 **and** removes the corresponding storage objects (check with the Storage API list, not just the DB row).

---

## 6 Low findings

### L-1 — Repository hygiene issues that raise the probability of the findings above

**Evidence and why it matters:**
- **5 committed `harvester/__pycache__/*.pyc`** (cpython-3.13). Build artifacts in version control invite "it committed before, it can commit now" — including a `.env` that slips past an imperfect ignore rule.
- **`.gitignore:35` uses `.env*`**, which also blocks `.env.example` — so there is **no committed, canonical list of required variable names**. That single omission is why M-4's two-names-for-one-key confusion is possible and why a new contributor (or a judge) cannot tell what the app needs.
- `AGENTS.md`, `CLAUDE.md`, `.vscode/` are committed. Not harmful, but they are tooling noise in a repo that will be reviewed, and `AGENTS.md` content may describe intentions that no longer match code.
- `README.md` contradicts the implementation (Next 14+, `OPENAI_API_KEY`, GPT-4o-mini) — see M-4.
- No tests of any kind: `package.json` has `dev/build/start/lint` and **no `test` script**, and no test framework is installed. Every statement in this review about behaviour was verified by reading code and probing the deployed site, because there is no automated way to re-verify it — which is itself the security finding: **regressions in access control will not be caught.**
- No `middleware.ts`, so protected routes are guarded only in client JavaScript (see H-4 step 3).

**Remediation:** `git rm -r --cached harvester/__pycache__` + add `__pycache__/`; change `.gitignore` to keep `.env*` ignored but `!.env.example` committed, and populate `.env.example` with **names and a comment per name** (never values); refresh `README.md`; add `docs/` to the ignore-exempt list so the audit artefacts are versioned; introduce a test harness (Vitest for units, Playwright for the journeys in §7 below) and wire both into CI.

**Verification:** `git ls-files | grep -E "__pycache__|\.pyc$"` is empty; `git ls-files .env.example` returns it and `grep -c "^[A-Z_]*=" .env.example` matches the documented variable count in audit §9; `npm test` exists and runs in CI.

---

## 7 OWASP coverage checklist (brief §6, item by item)

| Brief §6 item | Status | Finding / rationale |
|---|---|---|
| Broken access control / IDOR | **Confirmed** | C-2 (body-supplied identity, unscoped read/delete), C-3 (public objects), C-4 (policies unverifiable), H-4 (no server-side route protection) |
| Auth & session weaknesses | **Confirmed** | `hooks/useAuth.tsx:54` client-substitutable `mockUser`; `app/signup/page.tsx:60-67` ignores returned `session` and blind-navigates after 2 s, so signup "success" is unverified; no server session verification anywhere (no middleware, `route.ts:5`); password recovery — no reset flow present in `app/`; no session-length/refresh handling. Also C-2 fix is the auth fix. |
| Exposed secrets / unsafe env usage | **Confirmed** | H-2 (secret into CI command line, key in query string, exception printing), M-4 (two names for one key, `NEXT_PUBLIC_` risk to verify), C-3/C-4 (service-role dependency). No hardcoded secret **value** was found in any tracked file — the exposure vectors are configuration and logs, which is a genuinely good sign and worth stating. |
| Injection (SQL/OS/command) | **Not applicable as classic SQLi; one command-injection-adjacent risk** | All DB access goes through PostgREST via Supabase clients with no SQL string concatenation (`grep` found no `.rpc()` string building, no raw SQL in the web app). The `run: |` step at `harvester.yml:69-72` interpolates a secret into a shell command (H-2) — that is the injection-shaped issue present. Python f-string SQL: none found. |
| XSS / unsafe rendering | **Latent, unmitigated** | React escaping is intact and I found no `dangerouslySetInnerHTML`; however unvalidated model text reaches the DOM/PDF (M-1) with **no CSP** (H-4), so the sink is safe today only by default. Treated as M-1 + H-4, not as a confirmed XSS. |
| CSRF | **Low risk, not zero** | No cookie-based auth in the app (Supabase bearer tokens in JS-accessible storage), and `/api/analyze` accepts `application/json` cross-origin — but the wildcard CORS (H-4) plus a same-site endpoint that performs paid work (C-1) is the relevant exposure. Adding `connect-src` (H-4) and requiring `Authorization` (C-1) closes it. No state-changing GET endpoints found. |
| Insecure file upload / storage access | **Confirmed** | C-3. Additionally `services/storage.ts` has **no** MIME/extension/size allow-list (it derives the extension from `file.name` at `:8` with no validation), `datasets` bucket publicity unverified, no `upsert:false`-based overwrite protection beyond `:15`, and no virus scanning or row-count ceiling on parsed CSVs. A `.html.svg`.double-extension upload to a public bucket is a stored-content risk. |
| Missing rate limits on sensitive/expensive endpoints | **Confirmed** | C-1. No limiter anywhere in the repo (no `@upstash`, no Vercel WAF config, no in-memory counter). Signup/login are also unlimited — Supabase project-level throttling may apply but is not configured in version control and must be checked in the dashboard (audit §11). |
| Excessive data exposure in responses/logs | **Confirmed** | `select("*")` with no projection (M-3); `route.ts:40` and `ai.ts:50,61` log provider internals (M-4); `harvester/pre_flight_check.py:63` prints response bodies (H-2). Live API responses are currently generic 500s, so the exposure is via logs and over-fetching rather than verbose errors. |
| Vulnerable / outdated dependencies | **Confirmed** | H-3 (27 advisories, 2 critical / 19 high; CLI tooling in `dependencies`; 3 high at `postinstall`). |
| Missing security headers / unsafe redirects | **Confirmed** | H-4 (`next.config.ts` empty stub). Unsafe-redirect evidence: no allow-list exists; the client-side blind `router.push('/dashboard')` (`signup/page.tsx:66`) means nothing validates a post-auth target, so the moment a `?next=` parameter is introduced it will be open — flagging now rather than as a future bug. |
| Insecure error messages / info leakage | **Confirmed** | M-4 (single opaque `'AI analysis failed'` for all causes, and a dead error branch that shows the mapping was never validated). No stack traces were observed in live responses; the leakage direction is *into logs*, and the operational risk is *silent* failure. |

---

## 8 Remediation order, with what I need from you

I have made **no** changes. Proposed sequence, each step small and independently verifiable (your rule 11):

| # | Action | Files touched | Needs your approval / action |
|---|---|---|---|
| 1 | Authenticate `/api/analyze`, derive `userId` from the JWT, drop it from the contract, stop swallowing DB errors | `app/api/analyze/route.ts`, `services/database.ts`, `components/UploadCard.tsx` | No production data touched. Design-preserving. |
| 2 | Request size cap + per-user rate limit + provider timeout/circuit breaker | same + `package.json` (limiter dep) | Choice of limiter backend (Upstash vs Vercel WAF) is yours — it adds a third-party dependency. |
| 3 | Security headers in `next.config.ts` + `middleware.ts` route protection | `next.config.ts`, new `middleware.ts` | Verify no CSP violation on the live UI afterwards; no visual change. |
| 4 | Unify provider key name to `GEMINI_API_KEY`, delete dead error branch, add deploy assertion, fix README | `services/ai.ts`, `route.ts`, `README.md` | **You** set/rotate the variable in Vercel. I will not modify environment settings (rule 10). |
| 5 | CI secret handling + remove `httpbin.org` fallback + header-based Gemini auth | `.github/workflows/harvester.yml`, `harvester/pre_flight_check.py` | **You** rotate `SERVICE_ROLE`, `GOOGLE_API_KEY`, `CURRENCY_API_KEY`, `MONITORING_WEBHOOK_URL` in GitHub/provider dashboards afterwards, since they have been exposed to the log-leak pattern daily. |
| 6 | Confirm the `datasets` bucket's public/private setting (read-only curl) | none | Your run — `*.supabase.co` does not resolve from this machine (§9). |
| 7 | Switch to signed URLs; store object paths not URLs; add upload validation | `services/storage.ts`, `components/UploadCard.tsx` | If the bucket is confirmed public, the disclosure decision (re-issue names? notify users?) is **yours** — I will lay out options and impact, not act. |
| 8 | Export production schema + `pg_policies` read-only, commit as baseline migration, then draft ownership RLS | new `supabase/migrations/*`, `harvester/setup_insights.sql`, `harvester/recreate_view.sql` | **You execute the SQL/migrations.** I provide the drafts and the before/after verification queries and stop there (rule 10; standing preference on record). `recreate_view.sql`'s `DROP VIEW` (`:4`) must be replaced with `CREATE OR REPLACE` before it is run at all. |
| 9 | Honest labelling: charts, "cryptographic" signature, authorized-profile stamp, chat-bot self-description, provenance column for modelled values | `components/CountrySection.tsx`, `services/pdfExport.ts`, `components/ExportButton.tsx`, `components/ChatAssistant.tsx`, `harvester/environment_enricher.py`, `data/demoInsights.ts` | Copy/label changes only — branding, layout and animations preserved (rule 1). Removing fake numbers without a real feed means showing "no data yet", which changes what a demo looks like: flagging that trade-off for you explicitly. |
| 10 | `npm audit` remediation batches, move CLI tooling to dev, delete unused deps, add audit gate + Dependabot + `pip-audit` | `package.json`, `package-lock.json`, CI | Each removal verified by grep-for-importers first; build re-run after every batch. |
| 11 | `.env.example` with names, un-ignore it, drop committed `.pyc`, refresh docs | `.gitignore`, `.env.example`, `harvester/__pycache__` | `git rm --cached` only — no file deletion from disk beyond artifacts. |
| 12 | Test harness + the five security-critical regression tests (C-1 401, C-2 cross-tenant, C-3 signed-URL-only, C-4 RLS, H-4 headers) | new `tests/`, `package.json` | None. |

**Do not start #8 before #6/#7** — you need the true schema and bucket state before writing policy, and a policy draft written against guessed columns is worse than none.

---

## 9 What could not be verified from this environment (honest limits)

| Item | Why | Exact commands for you to run |
|---|---|---|
| Whether the `datasets` bucket is public (C-3) | `*.supabase.co` does not resolve from this machine; control probe: `api.supabase.co` also failed, and a `curl` to Supabase hosts exits 6 (could not resolve host). This is a **local network restriction, not a production finding.** | `curl -sSI "https://<project-ref>.supabase.co/storage/v1/object/public/datasets/<path-from-datasets.file-url>"` — `200` = public = C-3 confirmed live. |
| Real `datasets`/`insights` columns and every active RLS policy (C-4) | No schema/policy is in version control; the only committed migration contradicts the code. | The read-only `pg_policies` / `pg_class` introspection in C-4 step 1, run in SQL Editor. Also `select * from pg_policies where schemaname='public';` |
| Root cause of the live `500` on `/api/analyze` (C-1/M-4) | Cause is not returned in the response; it is in Vercel function logs I cannot access. Leading candidate is the `GEMINI_API_KEY` vs `GOOGLE_API_KEY` mismatch (M-4); second is a RLS-rejected insert. | Vercel → Project → Logs, filter `/api/analyze`; look for `Gemini analysis failed:` and the message after it. A `401/403` from Google ⇒ key/quota; `relation "insights" does not exist` or `new row violates row-level security policy` ⇒ C-4. |
| Whether Supabase's own dashboard has API protection / auth rate limits enabled | Dashboard setting, not repo state. | Supabase → Authentication → (Rate limits / CAPTCHA) and API → settings; record what is on. |
| Whether the harvester's last successful run actually wrote rows | The web app never reads the harvester's tables (`unified_market_intel` is not referenced by any `.from(` in `app/`, `components/`, `services/`) and this machine cannot reach the DB. | `select max(created_at), count(*) from <each harvester table>;` and `select * from unified_market_intel limit 5;` |

None of the findings above depend on these unknowns for their *existence* — C-1, C-2, H-2, H-3,
H-4 and L-1 are proven from source and live probes. C-3 and C-4 depend on them for their **final
severity classification**, and I have marked that rather than assuming the worst or the best.

### 9a. Amendment, later on 2026-10-27 — the network restriction lifted, so three rows above got answered

The `*.supabase.co` DNS block recorded in the first row above **no longer holds on this machine**:
the same hosts now resolve and answer (`curl` to `/rest/v1/` returns `401` without a key instead of
exiting 6). Read-only requests were then made using only the anon key that the production browser
bundle already ships. No write was attempted, no service-role key was used, and no secret value was
printed, stored or committed. Three items in the table above change state:

| Row above | Now measured | Consequence |
|---|---|---|
| "Whether the `datasets` bucket is public (C-3)" | `GET /storage/v1/object/public/datasets/__probe_nonexistent__.csv` → `400` with `{"error":"Bucket not found","code":"NoSuchBucket"}` | **Neither.** There is no `datasets` bucket in this project at all, so C-3 is not live today. `services/storage.ts:12` and `:23` would fail on upload regardless of any policy, which is a functional finding as well as a security one. The `getPublicUrl` intent remains wrong and must not be made to work by creating a public bucket — that is how C-3 becomes real. |
| "Real `datasets`/`insights` columns and every active RLS policy (C-4)" | `GET /rest/v1/datasets?select=*&limit=1` and `/rest/v1/insights…` → `200` with `content-range: */0` | Both objects **exist** and are in the exposed schema, and RLS returns nothing to an anonymous caller. Still no column list and no policy text from here — that needs the SQL Editor — but "unverifiable" is now "exists, empty to anon". |
| "Whether the harvester's last run actually wrote rows" | `GET /rest/v1/unified_market_intel?select=*&limit=1` → `206`, `content-range: 0-0/122` | The harvester **did** write rows — 122 of them — and they are readable anonymously. See H-6. `market_intelligence` itself returns `*/0` to the same key, so the view is the path. |

Two items stay unverified, correctly: the live `/api/analyze` failure cause (Vercel function logs,
which I cannot read) and Supabase dashboard-level rate limits/CAPTCHA. And the bucket probe is one
request against one name — confirm in Storage → Policies before relying on it, because a project
whose upload path is broken may simply have had the bucket deleted.

**Nothing in this amendment changed a permission, a policy, a bucket setting or a row of data.** It
is measurement, and it moves H-6 to the front of the remediation order because it is the only item
in this review that is both live in production and fixable with one reviewed statement.

---

## 10 Standing caveat

A build passing, `tsc --noEmit` returning 0, and pages rendering are **not** evidence that this application is secure, and nothing in this review says it is. Findings C-1 through C-4 are structural: no amount of successful compilation changes them. Conversely, after remediation, each item is only closed when the **verification step listed against it** has been executed and observed — most of those need a second test account, provider-console quota readings, and a live request to your Supabase host, which only your environment can provide. Treat §8 as a checklist to sign off one line at a time, and treat "verified" as meaning *a command ran and I saw its output*, never *the code looks right now*.
