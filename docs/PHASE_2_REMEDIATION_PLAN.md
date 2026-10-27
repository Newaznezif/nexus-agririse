# Nexus AgriRise — Phase 2: Safe Remediation Plan

**Prepared:** 2026-10-26
**Status:** PLAN ONLY. No application source file, migration, production setting, or deployment was modified. Nothing was pushed. Nothing was deployed.
**Inputs:** `docs/PRODUCTION_READINESS_AUDIT.md`, `docs/SECURITY_REVIEW.md`, and fresh local reproduction of the build/lint/API failures (commands and outputs in §3).
**Rules honoured:** no external agri-data API integration (§A below is scheduled as P4 and explicitly not started), no production Supabase/RLS/storage/env changes, no deploy/push to `main`, no data reset, no UI redesign, no invented facts, no secret values anywhere in this document.

---

## 1. Executive summary

Phase 2 re-verified every blocking finding in the local environment rather than trusting the written audit. All of them reproduce, and two new findings surfaced that Phase 1 did not contain.

**What was reproduced (all commands re-run today):**

| Check | Result | Evidence |
|---|---|---|
| `npm run build` (no env vars) | **FAIL, exit 1** | `Error: supabaseUrl is required.` thrown at `Collecting page data using 7 workers`, after `✓ Compiled successfully in 12.6s` and after `Finished TypeScript in 4.6s` |
| `npm run build` (with placeholder env) | **PASS, exit 0** | `✓ Generating static pages (23/23)` |
| `npx eslint .` | **FAIL, exit 1** | `✖ 78 problems (16 errors, 62 warnings)` across 10 files (mapped in §3.2) |
| `npx tsc --noEmit` | **PASS** | TypeScript completed inside the build with no diagnostics |
| `npm audit` | **FAIL** | 27 advisories (2 critical, 19 high, 5 moderate, 1 low) |
| `POST /api/analyze` **locally**, key unset | **500** | body `{"error":"Invalid request payload or internal error"}`; server log `GEMINI_API_KEY is missing. Please add it to .env.local` |
| `POST /api/analyze` **locally**, invalid ASCII key | **500** | body `{"error":"AI analysis failed"}`; log carries Google's full `API_KEY_INVALID` 400 payload |
| `POST /api/analyze` **live** | **500** | `HTTP 500`, reproduced again today |
| Live security headers | **5 of 6 absent** | CSP, `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy` = 0 occurrences; HSTS present (added by the hosting layer, not by this repo) |
| Test harness | **absent** | `package.json` scripts = `dev,build,start,lint`; `has test script: false` |

**The single most important new fact:** the failure is now *root-caused by experiment*, not inferred. Locally, with the provider key **unset**, the endpoint returns a *different* string than with the key **set but invalid** — which empirically proves the dead error branch at `app/api/analyze/route.ts:43` and the error-collapse at `services/ai.ts:65`. It also proves this machine **can** reach `generativelanguage.googleapis.com` (HTTP 404 on the bare host, real 400 payload from the model endpoint) while it **cannot** resolve `api.supabase.co` or the project host. That asymmetry is the basis of §5: everything about the AI path was tested here; nothing about the Supabase path could be, and no claim in this plan says otherwise.

**Working tree:** clean except `?? docs/` (the two audit artefacts, preserved) and one incidental `package-lock.json` diff that §2 proves is metadata-only.

**Recommendation:** approve **P0-1 → P0-4 + P1-1** as the first batch. All five are code-only, fully reversible, touch no production data, and together they convert an unauthenticated money-burning endpoint into an authenticated, bounded, correctly-labelled one — and make the production build succeed without env vars present.

---

## 2. A. Working-tree verification

```
$ git status --porcelain
 M package-lock.json
?? docs/
```

No tracked source file is modified. `docs/` is untracked and contains the two Phase-1 deliverables — both are preserved and neither is referenced-by-deletion anywhere.

### The lockfile diff is metadata-only (verified, not assumed)

```
$ git diff --unified=0 package-lock.json | grep '^+' | grep -v '^+++'
+      "license": "MIT"          (x3)

$ removals, grouped
     18 -      "peer": true,
      3 -      "peer": true
      3 -      "license": "MIT",

$ git diff package-lock.json | grep -iE '^[-+].*"(resolved|integrity|version)"'
NONE
```

**Interpretation.** `npm install` on this Windows/npm version dropped the `"peer": true` marker from 21 lockfile entries; for 3 of those the removed line was the *last* key in the object, so the trailing comma on the preceding `"license": "MIT",` also disappeared and reappeared as `"license": "MIT"`. That accounts for all 24 deletions and 3 additions exactly. **No `resolved`, no `integrity`, no `version` and no package entry changed** — verified by the third command returning `NONE`. Therefore no dependency was added, removed, upgraded, or re-pointed, and the diff carries no supply-chain meaning either way.

**Proposal (your decision, not mine to execute):** restore it with `git checkout -- package-lock.json`. Reasons: (a) Phase 2 must start from HEAD so every later diff is attributable to an intentional change; (b) the same normalization will reappear on the first intentional `npm install` during P3-1 dependency work, where it belongs. Restoring discards *my* incidental change, not yours — there were no pre-existing local lockfile edits (the file was clean when the tree was cloned). **I have not run it and will not run it without your go-ahead**, because it is a `git checkout` against a tracked file.

---

## 3. E. Re-verification of the Phase 1 findings

### 3.1 The actual build failure, explained from the error output

Sequence reported by `npm run build`:

1. `✓ Compiled successfully in 12.6s` — bundling is not the problem.
2. `Running TypeScript ... Finished TypeScript in 4.6s` — type checking is not the problem.
3. `Collecting page data using 7 workers` → **`Error: supabaseUrl is required.`**
   Stack frames end at `.next/server/app/api/analyze/route.js:6:3` inside `instantiateModule`.
4. `Failed to collect page data for /api/analyze`.

**Cause, stated without assumption.** The error comes from module *instantiation*, not from request handling: the stack is `instantiateModule` ← `instantiateRuntimeModule` ← `route.js:6:3`, i.e. it fires while the route module's top-level side effects run. Next collects page data for every route, including API routes, at build time; `app/api/analyze/route.ts:1-3` imports `@/services/ai` and `@/services/database`, `services/database.ts:1` imports `@/lib/supabaseClient`, and `lib/supabaseClient.ts:6` calls `createClient(...)` at **module scope** with `process.env.NEXT_PUBLIC_SUPABASE_URL!` (`:2`). With that variable unset the non-null assertion yields `undefined` at runtime and the Supabase SDK throws `supabaseUrl is required`. The build therefore cannot complete on a machine that has no environment configured — which is what a clean clone, a new contributor, or a CI runner without secrets is.

**Fix direction chosen for this plan (see P1-1):** make the client lazily initialised (`getSupabase()` on first use) so importing the module no longer constructs a client, and add a build-time guard that reports the missing variable *by name*. This is the minimal change that keeps the runtime behaviour identical; it does **not** add a new backend and does not change any component.

**Confirmed by experiment:** supplying placeholder values for the two `NEXT_PUBLIC_` variables makes the build pass with 23 routes — which proves the failure is the env-at-import invariant, not a code error elsewhere.

### 3.2 Lint errors mapped to owners

16 errors, 62 warnings (`exit 1`). Grouped by rule family, with the file each error belongs to:

| Rule family | Errors | Files |
|---|---|---|
| `react-hooks` — setState called synchronously inside an effect | 7 | `app/dashboard/comparison/page.tsx:79`, `app/dashboard/insights/page.tsx:59`, `app/dashboard/page.tsx:71,77`, `components/Navbar.tsx:20,27`, `components/Sidebar.tsx:54` |
| `react/no-unescaped-entities` | 5 | `app/about/page.tsx:28`, `app/services/page.tsx:255`, `app/testimonial/page.tsx:61,69(x2)` |
| purity — impure function during render | 1 | `components/ChatAssistant.tsx:52` (`new Date()` in a `useState` initializer) |
| `document.cookie` immutability | 2 | `components/LanguageSwitcher.tsx:79,80` |
| effect setState (LanguageSwitcher) | 1 | `components/LanguageSwitcher.tsx:59` |

Two are **correctness** bugs with user-visible consequences, not style: `ChatAssistant.tsx:52` makes rendering impure (server/client mismatch), and `LanguageSwitcher.tsx:59,79-80` writes cookies from a render-triggered effect with an interval that never clears (also M-3). The 62 warnings are dominated by `<img>`-instead-of-`<Image>` — I am **not** proposing a bulk image refactor, since changing `img` to `next/image` alters layout and is precisely the "unnecessary redesign" rule 5 forbids.

### 3.3 Environment variable names (names only — no values, ever)

| Name | Where read | Layer | Note |
|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | `lib/supabaseClient.ts:2` | browser + build | publishable by design |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `lib/supabaseClient.ts:3` | browser + build | publishable by design; RLS is the control (P0-4/D-series) |
| `GEMINI_API_KEY` | `services/ai.ts:6` | server only | **not** read at build time — proven: the build passed with it empty |
| `GOOGLE_API_KEY` | `harvester/pre_flight_check.py`, `intelligence_generator.py` | CI | **second name for the same provider** → P0-3 |
| `SUPABASE_URL` | `harvester/*.py` | CI | |
| `SUPABASE_SERVICE_ROLE_KEY` | `harvester/main.py`, `environment_enricher.py`, `normalization_engine.py`, `intelligence_generator.py` | CI | full RLS bypass |
| `SERVICE_ROLE` | `.github/workflows/harvester.yml:37,44` | CI secret | mapped *into* `SUPABASE_SERVICE_ROLE_KEY` / bound as `SERVICE_ROLE` for the pre-flight step — two spellings for one secret |
| `CURRENCY_API_KEY` | `harvester/normalization_engine.py` | CI | |
| `MONITORING_WEBHOOK_URL` | `harvester.yml:72` | CI secret | interpolated into a shell command line (H-2) |

Safety check run today: `grep -rnE 'NEXT_PUBLIC_[A-Z0-9_]*(KEY|TOKEN|SECRET|PASSWORD)'` returns only the Supabase **anon** key, which is intentionally public. **No service-role key or provider key carries a `NEXT_PUBLIC_` prefix**, so no secret is embedded into the client bundle. There are **no `.env` files in this working tree** at all (`ls -1a | grep '^\.env'` → none), which is why the build fails as described, and is also why nothing has been leaked from here.

### 3.4 Phase 1 errata (corrections to the written documents)

Phase 2 verification contradicted or extended three Phase 1 statements. Recording them here rather than silently editing the signed-off audit:

| Phase 1 said | Verified fact | Effect on the plan |
|---|---|---|
| H-4 listed **`Strict-Transport-Security` as missing** | It **is** present live: `max-age=63072000; includeSubDomains; preload`. The other five are genuinely absent (0 occurrences each). | P0-5 scope reduced to the five missing headers; HSTS is already correct and must be preserved, not re-added. |
| H-4 / C-1 mentioned `Access-Control-Allow-Origin: *` as if it exposed the API | The wildcard appears on **document, asset and 404** responses. `/api/analyze` responses carry **no** CORS headers (POST with `Origin: https://evil.example` → `500`, no `access-control-*`; OPTIONS → `204 No Content`, none). | Reframes, not weakens, C-1: **CORS is not access control.** An unauthenticated JSON-less/simple POST or script reaches the endpoint regardless. And because `next.config.ts` is empty and no `vercel.json` is tracked, the wildcard originates from **hosting config outside version control** → new production-verification item V-5. |
| PII and testimonial claims were not enumerated | New findings — below. | Added as H-5, M-6, M-7; scheduled in P2. |

**New finding H-5 — personal contact data is rendered into prerendered, publicly served HTML.** `app/about/page.tsx:93` renders a team member's personal Gmail address and `:102` renders a personal mobile number in E.164 form, in clear text, on a public page, and the strings are baked into the prerendered output (`grep -rEo '\+2[0-9]{9,}' .next/server/app/about.html` → 1 match; `[a-z]+@gmail` → 2 matches). I am deliberately not reproducing the values here. These are also committed to a public repository, so they are permanent history regardless of what the site later displays. Impact: scraping-driven contact harvesting against named founders, and it directly undercuts the privacy assurance at `app/page.tsx:443`. Remediation P2-5: move to a "Contact" action that uses the (currently fake) contact path or a `mailto:` generated on click, and delete the literal strings from JSX — with the caveat that removal from the page does not remove them from git history, and that rotating/retiring an address is the owner's decision.

**New finding M-6 — stock-photo fallbacks attributed to named real people.** Four `<img onError>` handlers swap a missing local portrait for an Unsplash photo while keeping the named person's `alt` text and caption: `app/about/page.tsx:78-81,122-125,183-186` and `app/testimonial/page.tsx:32-34`. Verified today: `public/jumanne.jpeg`, `Augestin.jpeg`, `Newaz.png`, `Adonis.jpeg` all exist, so **the fallback is not currently firing** — I checked rather than assumed. The risk is latent: any one asset failing to deploy renders an unrelated stock portrait under a real person's name and title. Remediation P2-6: replace the fallback with a neutral initial monogram, which preserves card geometry and animation.

**New finding M-7 — the `/testimonial` page is a linked, live, single-source endorsement.** It is reachable from the primary navigation (`components/Navbar.tsx:43`, label "Testimonial") and consists of one named individual (`app/testimonial/page.tsx:38`), styled as a "Featured Spotlight" (`:9`) with an explicit location chip ("Mwanza, Tanzania", `:52`), attributed claims that the platform's *predictive insights* "optimize agribusiness" (`:64`) — a capability the audit shows is not implemented for real users — and a pull-quote (`:69`). Nothing in the repository evidences that this person supplied or approved that wording. Rule 6 forbids inventing testimonials, so I am **not** proposing to write, edit, or add any. What I propose (P2-7) is a decision for you: keep it only if you can supply the named person's actual consent and a factual basis for the claim, and label the page accordingly; otherwise drop the link from the nav and let the route go. Which one you choose is a fact about your relationships, not something I can verify.

---

## 4. B + C. Prioritised remediation plan

Legend — **Type**: `code` (safe to do locally, no production contact) / `db` (needs owner approval + verified backup) / `config` (hosting or CI settings, owner-executed) / `verify` (read-only probe, must be run by you). **Risk**: what breaks if I get it wrong.

### P0 — Stop unauthorised access, data exposure, and uncontrolled paid API use

| # | Finding | Files | Proposed change (code-only) | Risk | Depends on | Tests | Rollback | Acceptance |
|---|---|---|---|---|---|---|---|---|
| **P0-1** | C-1 | `app/api/analyze/route.ts` | Verify the Supabase JWT server-side (`authorization` header → `auth.getUser`); `401` when absent/invalid. Identity comes from the token only. | Low-mid: breaks the flow if the client stops sending a token — fixed jointly in P0-1c. | — | a) unit: no header → 401, forged header → 401; b) local `curl` (proven today to return 500 pre-fix); c) authenticated round-trip | `git revert` of one commit; no data or schema touched | Unauthenticated `POST /api/analyze` → **401** (local and live); authenticated → 200 |
| **P0-2** | C-2 | `app/api/analyze/route.ts:8,21-28`, `services/database.ts:89-101,121-132`, `components/UploadCard.tsx:120-124` | Remove `userId` from the request contract entirely; authorise `datasetId` ownership before insert; add `.eq('user_id', userId)` to `getDatasetInsights` and `deleteDataset`; make `deleteDataset` require a user id; **stop swallowing** the DB error (`route.ts:30-33`). | Mid: an RLS-rejected insert that today returns 200 will now surface as an error — that is the intended behaviour, and it may make D-2/C-4 visible for the first time. | P0-1 | cross-tenant integration test (A referencing B's dataset → rejected, B unchanged); type test that `deleteDataset` cannot compile without a user id | `git revert` | No request path can name another user's id; every read/write function carries an ownership predicate |
| **P0-3** | M-4 | `services/ai.ts:6`, `harvester/*.py`, `.github/workflows/harvester.yml:38,64`, `README.md:7,10,19,36` | One provider variable name (`GEMINI_API_KEY`); **add** `services/env.ts` asserting required names are non-empty at server start and at CI pre-flight; delete the dead branch `route.ts:43`; replace the single `'AI analysis failed'` (`ai.ts:65`) with classified codes (`missing_config`, `provider_auth`, `quota`, `timeout`, `bad_output`). | Low: if the name is wrong the guard fails loudly at deploy rather than per-request. | — | unit: each cause → its own code; local reproduction of both today's 500 variants must now produce `missing_config` and `provider_auth` distinctly | `git revert` | Two different failures return two different codes; README matches the code; no secret value logged (grep assertion in CI) |
| **P0-4** | C-3 | `services/storage.ts:8-9,22-26`, `components/UploadCard.tsx` | `getPublicUrl` → `createSignedUrl(path, 600)`; persist the **object path**, never a URL; validate extension/MIME/size and reject multi-extension names before upload; keep the `${userId}/` prefix and add a random sub-prefix. | Mid: any existing UI that displays `file_url` directly will need to request a signed URL; historical rows keep their old public URLs until you decide (V-2). | P0-1 | unit: a stored value never matches `/object/public/`; integration: a second account cannot resolve another's path | `git revert` | Application never emits or stores a public object URL; a non-owner request for an object fails |
| **P0-5** | H-4 | `next.config.ts` (empty stub, lines 1-8) | Add the five absent headers (CSP, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, frame-ancestors/`X-Frame-Options: DENY`, `Permissions-Policy`), scoped `connect-src` (same-origin + Supabase REST/Storage host + `generativelanguage.googleapis.com` — *the Google host is verified reachable and is a public endpoint name, not a secret*). Do **not** re-add HSTS (already correct). Headers only; no CSS, no layout, no component change. | Low but visual-sensitive: an over-tight `script-src`/`style-src` breaks animations and fonts on first load. Mitigated by keeping `'unsafe-inline'` for scripts and testing all pages before calling it done. | — | header assertion script in CI; **manual** load of every route checking the browser console for zero CSP violations | `git revert` of `next.config.ts` | 6 expected headers present live; zero console CSP violations on all 23 routes; screenshots confirm no visual change |

**P0 explicitly excludes:** the RLS/permission-model SQL (P0-4's storage policies and D-1…D-4) — those are `db`-type and live in §5.

### P1 — Restore the production build and core application functionality

| # | Finding | Files | Proposed change | Risk | Depends on | Tests | Rollback | Acceptance |
|---|---|---|---|---|---|---|---|---|
| **P1-1** | Build blocker (§3.1) | `lib/supabaseClient.ts:1-6`, importers | Lazy `getSupabase()` with memoised construction + a named-variable error instead of the SDK's; keeps module import side-effect-free. | Low-mid: ~10 importers must switch from `import { supabase }` to `getSupabase()`; mechanical, type-checked. | — | `npm run build` **with no env present** must reach page-data collection without throwing; placeholder build still passes | `git revert` (one file + call sites) | Clean-clone `npm run build` exits 0 without env; error text names the variable |
| **P1-2** | D-2 / C-4 conflict | (draft only) `supabase/migrations/*` | Reconcile the two `insights` schemas; **then** the app can read real rows. Code side: make `app/dashboard/page.tsx:98,161` read the actual count instead of hardcoding `—` for non-demo users. | High if attempted before V-1: writing an ON CONFLICT clause for an unconfirmed constraint fails. | **V-1, V-2** | after approval: dashboard count test with seeded rows | code half reverts freely; db half needs a downward migration (D-6) | Owner approves after seeing the real policy dump |
| **P1-3** | Audit §4 gaps | `app/dashboard/settings/page.tsx:21-46`, `app/contact/page.tsx:9-13` | Implement the four settings controls against the real `user_metadata`/profile, or mark them "Not yet available" — no dead toggles. Replace the `preventDefault()`+`alert()` contact stub with a real submit path (table insert behind auth, or a validated `mailto`). | Low: each is one page; design preserved. | P0-1/P0-2 for auth | e2e: settings persist across reload; contact submit creates a queryable row | `git revert` | Every control either does something or says it does not |
| **P1-4** | Signup trust | `app/signup/page.tsx:60-67` | Use the returned `data.user`/`data.session` before navigating instead of a blind `setTimeout(…, 2000)`; surface Supabase's real error. | Low. | — | e2e: success requires a session; failure shows the message | `git revert` | No navigation unless a session exists; `:124`'s isolation claim is gated on D-1 |
| **P1-5** | Analytics crash | `app/dashboard/analytics/page.tsx:87`, `RiskBadge.tsx` | Null-safe `risk_level` (today `i.risk_level.toLowerCase()` throws on the nullable column) and neutral badge for unknown values; the `14.2K / 12,400 / 89%` literals at `:114,125,136` are handled under P2-2. | Low. | — | unit with a null-risk row; e2e with an empty dataset | `git revert` | No page crash on any nullable column |

### P2 — Remove unsupported/fabricated claims, improve data integrity

| # | Finding | Files | Proposed change | Risk | Tests | Rollback | Acceptance |
|---|---|---|---|---|---|---|---|
| **P2-1** | H-1 (charts) | `components/CountrySection.tsx:28-60,76`, `services/pdfExport.ts:48-110` | Relabel derived/keyword-matched series truthfully ("derived from the summary text — illustrative"), remove "SECURE CRYPTOGRAPHIC REPORTING SYSTEM"; keep every chart, colour, and layout exactly as built. | Low. Copy only. | grep + visual diff of one rendered card | `git revert` | No label asserts real-time or cryptographic properties; visuals unchanged |
| **P2-2** | H-1 (numbers) | `CountrySection.tsx:165-198`, `pdfExport.ts:238-242`, `analytics/page.tsx:114-136`, `services/comparison.ts:105-125` | Static "Strategic Recommendations" either move under a visible "General guidance" heading or are generated from data; the dashboard literals become computed values or "no data yet". | Mid: the demo looks emptier. That is the honest state; flagged for you deliberately. | checklist per number → source | `git revert` | Every displayed figure has a data path or an explicit "unavailable" marker |
| **P2-3** | H-1 (stamp) | `components/ExportButton.tsx:13-17,133`, `CountrySection.tsx:62,210-214,218-226` | Delete `AUTHORIZED_PROFILES` (three real names selectable by any visitor) and the "Encrypting…" label; the report ID prints plainly. If attestation is a real requirement, it becomes a server-side HMAC later — never a client-side stamp. | Low; removes a fraud-shaped vector. | grep for the three names; PDF export still succeeds | `git revert` | No export can be stamped with a person the caller is not; no encryption claim without an encryption call site |
| **P2-4** | H-1 (chat) | `components/ChatAssistant.tsx:52,101-107,165` | Retitle "Online \| AI Powered" honestly (it is a keyword responder); drop the invented market figures; fix the impure `new Date()`. Wiring it to a model is P4-adjacent and needs P0-1/P0-3 first. | Low. | unit: fixture with no match → the reply does not contain a number | `git revert` | Chatbot claims nothing it cannot do |
| **P2-5** | **H-5** | `app/about/page.tsx:93,102` | Remove personal email/mobile literals from JSX; replace with a contact action. Owner decides whether the address itself is retired. | Low. | grep of build output | `git revert` | `.next/server/app/about.html` has no contact literal; page still reads well |
| **P2-6** | **M-6** | `app/about/page.tsx:78-81,122-125,183-186`, `testimonial/page.tsx:32-34` | Replace the Unsplash `onError` swap with a neutral monogram placeholder of identical dimensions. | Low; no visual change while assets exist. | unit: assert the handler never assigns `images.unsplash.com` | `git revert` | A missing photo can never render as a named real person |
| **P2-7** | **M-7** | `app/testimonial/page.tsx:38,52,64,69`, `Navbar.tsx:43` | **Your decision.** Keep only with documented consent + factual basis and accurate wording; otherwise remove the nav link. I will not author or alter testimonial content. | Low. | — | `git revert` | An endorsement on the site is one a person agreed to |
| **P2-8** | M-1 | `services/ai.ts:38-46`, `services/prompts.ts`, `types/ai.ts` | Ask for JSON only (`responseMimeType` + schema), retire the greedy `/\{[\s\S]*\}/`; validate with `zod` including the **4th** field and the `riskLevel` enum (today only 3 fields are checked at `:44`); length bounds before render/PDF. | Low-mid. | adversarial fixtures (prose-wrapped JSON, two blocks, `"Extreme"`, missing field, oversized) each → clean validation error | `git revert` | No model output reaches DOM or PDF unvalidated |
| **P2-9** | H-1 (env) | `harvester/environment_enricher.py:58,72-75`, `recreate_view.sql:12-14,33` | Add a provenance marker (`observed`/`modelled`/`placeholder`) + `as_of` to modelled values; the simulated NDVI (`0.4 + moist*0.5 + rain/50`) and the 100.0 mm placeholder must be labelled as modelled wherever rendered; replace silent FX fallbacks with a timestamped rate. `DROP VIEW` (`recreate_view.sql:4`) → `CREATE OR REPLACE`. | The provenance **column** is `db`; the labelling is `code`. | read-only: `select source, count(*) … group by 1` | code reverts; column needs downward migration | Nothing simulated presents as an observation |
| **P2-10** | M-5 | new `app/privacy/page.tsx`, `app/terms/page.tsx` | Publish purpose, categories, retention, and named subprocessors (Supabase, Google Gemini, Vercel, Open-Meteo, currency API); footer links on every page; align `app/page.tsx:93,443` with what is true **after** P0-4/P2-3/P2-5. | Low. | e2e: routes resolve, footer links present | `git revert` | Every privacy claim has a document behind it |
| **P2-11** | L-1 | `harvester/__pycache__` (5 `.pyc`), `.gitignore:35`, new `.env.example`, `README.md` | Untrack `__pycache__` (repo only — files stay on disk); `.env*` + `!.env.example`; add `.env.example` with **names and one comment per name, never a value**; correct the README's Next 14 / OpenAI description. | Low. | `git ls-files` assertions | `git revert` | Repo contains no build artefacts; variable list is discoverable and correct |

### P3 — Accessibility, performance, documentation, deployment readiness

| # | Finding | Files | Proposed change | Risk | Tests | Rollback | Acceptance |
|---|---|---|---|---|---|---|---|
| **P3-1** | H-3 | `package.json`, `package-lock.json`, CI | `npm audit fix`, then reviewed updates; move `shadcn` → `devDependencies`; delete unused `openai`/`axios`/`sonner`/`@lottiefiles/dotlottie-react`/`@shadcn/ui` (each removal pre-verified by importer grep); gate on `npm audit --audit-level=high`; add Dependabot + `pip-audit`; `git rm --cached` for `.pyc`. | Mid: version bumps can break Turbopack; batch small, build after each. | full gate set per batch | revert one batch | audit high/level clean or exceptions documented |
| **P3-2** | Audit §8 a11y | `RiskBadge.tsx`, `Sidebar.tsx:20-41,77`, `ChatAssistant.tsx:165`, `LanguageSwitcher.tsx:66-72`, `app/globals.css` | Non-colour redundancy in the risk badge; keyboard-operable sidebar resize with persisted width; resolve the floating hamburger (`bottom-6 right-6`) vs chat launcher (`bottom-8 right-8`) collision; `aria-label`/`role` on icon-only buttons; `lang` reflects the switcher; `prefers-reduced-motion` guard on framer-motion. | Low, but this is the *design-preserving* constraint: add an icon and a word, do not recolour. | axe-core sweep + keyboard walkthrough | `git revert` | a11y automated checks pass; no visual regression screenshot diff |
| **P3-3** | M-3 | `services/database.ts:52,92,106`, `UploadCard.tsx:115`, `LanguageSwitcher.tsx:66-72` | Paginate + project columns instead of `select("*")`; parse the CSV once; clear the 100 ms interval (it currently never clears); cache FX with a TTL and show `as_of`. | Low-mid: pagination changes list semantics — pair with P3-6. | perf trace: no recurring 100 ms task | `git revert` | No unbounded client query; no runaway timer |
| **P3-4** | H-2 | `.github/workflows/harvester.yml:69-72`, `harvester/pre_flight_check.py:56,63,65` | Secret via `env:` not the command line; **remove the `httpbin.org` fallback** and fail loudly if monitoring is unconfigured; Gemini key in the `x-goog-api-key` header; log exception *types*, never URLs or bodies; add `gitleaks`. | Low for code; **rotation is yours** (§6). | log-inspection by owner | `git revert` | Owner confirms zero secret occurrences in a fresh Actions log |
| **P3-5** | §9 | docs, runbook | Record the deploy sequence, env names, harvester schedule, and the header assertions. | Low. | — | `git revert` | A reviewer can reproduce the deploy from docs |
| **P3-6** | L-1 | `package.json`, new `tests/`, CI | Vitest + Playwright; **five security regressions first** (C-1 401, C-2 cross-tenant, C-3 no public URL, C-4 RLS, H-4 headers), then journeys. | Low. | meta: the suite runs | `git revert` | CI fails if an access-control regression reappears |

### P4 — Verified Ethiopian agricultural data (explicitly NOT started)

Per rule 1, this is a plan for a later phase, not work in this one.

| # | Item | Detail | Gate |
|---|---|---|---|
| **P4-1** | Document feeds, do not connect | For each candidate (EIAR, CSA, EMVCA/ECX, IGAD/FEWS NET, FAO, Open-Meteo, Copernicus Sentinel-2): endpoint, licence/ToS, update cadence, attribution requirement, rate terms, and **who is allowed to use it**. | Owner sign-off on the list **and** on the licensing posture — including a decision on the harvester's bot-detection evasion (`playwright-stealth`) as a sourcing method. |
| **P4-2** | Replace placeholders with cited observations | Kill the hardcoded `MONTHLY_AVG_RAINFALL = 100.0` (`environment_enricher.py:58`) and the formula-derived NDVI (`:72-75`). | Provenance column live (P2-9, D-4) |
| **P4-3** | Real weather/soil/irrigation per location | Server-side fetch, stored with `as_of`; UI shows source, refresh time, assumptions, limitations. | D-1/D-2 auth model live |
| **P4-4** | Market prices | Authoritative feed replacing positional HTML scraping (`main.py:73`) and the `price_usd_per_mt - 150` magic constant (`recreate_view.sql:33`). | P4-1 licensing |
| **P4-5** | Geospatial layers | Admin boundaries/plot locations with attribution; map asset today is a static Wikimedia blank map (`components/AfricaMap.tsx:51`). | — |
| **P4-6** | Personalised recommendations from real signals | Only once P4-2…P4-5 supply inputs. Chatbot may be wired to the provider here. | P0-1, P0-3, P2-8 |

**Hard rule for P4:** if a feed is unavailable, the product shows "unavailable", never a modelled placeholder. No live weather, market price, soil measurement, or AI claim is presented as verified fact without a stored source and `as_of`.

---

## 5. D. Database and security-policy changes — drafted, **not executed**

Everything in this section is a `db`-type change. **None of it runs without your approval and a verified backup** (§6). Rule 2 and rule 10 apply literally, and my standing arrangement with you is that database writes are executed by you.

### D-1 — Introspect first (read-only; safe to run today)

```sql
-- 1. What policies actually exist, and what do they permit?
select tablename, policyname, cmd, permissive, roles::text, qual, with_check
  from pg_policies where schemaname = 'public'
 order by tablename, policyname;

-- 2. Which tables have RLS enabled / forced?
select c.relname, c.relrowsecurity as rls_enabled, c.relforcerowsecurity as rls_forced
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relkind = 'r' order by 1;

-- 3. True column shape of the two customer tables
select table_name, column_name, data_type, is_nullable, column_default
  from information_schema.columns
 where table_schema = 'public' and table_name in ('datasets','insights')
 order by table_name, ordinal_position;

-- 4. Constraints, FKs, unique targets (ON CONFLICT correctness)
select conrelid::regclass as tbl, conname, contype, pg_get_constraintdef(oid)
  from pg_constraint where connamespace = 'public'::regnamespace order by 1,2;

-- 5. Indexes (RLS is not enough for performance)
select tablename, indexname, indexdef from pg_indexes where schemaname = 'public' order by 1;
```

**Why this comes first:** writing `ON CONFLICT` or owner policies against guessed columns is worse than not writing them, and a wrong committed migration is the exact situation Phase 1 found `harvester/setup_insights.sql` in (its header comment says `ai_insights` while `:4` creates `insights`).

### D-2 — Ownership policies for `datasets` / `insights` (draft)

```sql
-- DRAFT ONLY — column names must be confirmed by D-1 step 3 before this is run.
alter table public.datasets  enable row level security;
alter table public.insights  enable row level security;

create policy "datasets_owner_select" on public.datasets
  for select to authenticated using (auth.uid() = user_id);
create policy "datasets_owner_insert" on public.datasets
  for insert to authenticated with check (auth.uid() = user_id);
create policy "datasets_owner_delete" on public.datasets
  for delete to authenticated using (auth.uid() = user_id);

create policy "insights_owner_select" on public.insights
  for select to authenticated using (auth.uid() = user_id);
create policy "insights_owner_insert" on public.insights
  for insert to authenticated with check (auth.uid() = user_id);

-- Harvester path kept separate; the web app must never need service_role.
create policy "insights_service_write" on public.insights
  for insert to service_role with check (true);
```

### D-3 — Integrity hardening (draft, after D-2)

```sql
alter table public.insights
  add column user_id uuid references public.datasets(user_id) on delete cascade,
  add column dataset_id uuid references public.datasets(id) on delete cascade;
alter table public.datasets  alter column user_id set not null;
create index if not exists datasets_user_created_idx  on public.datasets (user_id, created_at desc);
create index if not exists insights_dataset_user_idx  on public.insights (dataset_id, user_id);
```
These statements assume the two `insights` schemas are reconciled. They will **fail or duplicate columns** if D-1 shows they already exist — hence "verify, then run", never "run and see".

### D-4 — Provenance columns for harvester output (draft)

```sql
alter table <env_table> add column source text not null default 'modelled'
  check (source in ('observed','modelled','placeholder'));
alter table <env_table> add column as_of timestamptz;
alter table <env_table> add column as_of_note text;
```

### D-5 — Storage bucket policy (draft; **only** once the bucket is confirmed private, see V-2)

```sql
create policy "datasets_owner_read" on storage.objects
  for select to authenticated
  using (bucket_id = 'datasets' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "datasets_owner_upload" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'datasets' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "datasets_owner_remove" on storage.objects
  for delete to authenticated
  using (bucket_id = 'datasets' and (storage.foldername(name))[1] = auth.uid()::text);
```

### D-6 — Migration discipline

Move the above into `supabase/migrations/0001_baseline.sql`, `0002_insights_ownership.sql`, … committed **before** `db push`, never edited afterwards, each paired with a downward migration. Replace the manual `DROP VIEW IF EXISTS` (`harvester/recreate_view.sql:4`) with `CREATE OR REPLACE VIEW` so a repair step cannot take the read path down.

### D-7 — Operations requiring owner approval and a verified backup

| Operation | Approval | Backup prerequisite |
|---|---|---|
| Enabling RLS on `datasets`/`insights` | **yes** | full dump + restore test. RLS on + a missing policy makes tables read empty — the dashboard could go from "wrong numbers" to "no data". |
| `add column user_id/dataset_id` + FK + `set not null` | **yes** | full dump. `set not null` fails on existing NULL rows, so backfill is part of the plan, not an afterthought. |
| Bucket public → private, storage policies | **yes** | object inventory exported first; existing `file_url` rows still hold public URLs. |
| Any `DROP`/`TRUNCATE`/recreate | **yes, and I will argue against it** | none of these are in this plan; `recreate_view.sql` is the only one and it is being replaced, not run. |
| Service-role + provider key rotation | **yes (you execute in provider dashboards)** | not a data change, but it breaks the daily cron until updated |
| Vercel env var names/values | **yes (you execute)** | record which environment each name is set in |

---

## 6. Production verification requirements (must be run by you)

This machine resolves `generativelanguage.googleapis.com` and `nexus-agririse.vercel.app` but **cannot resolve `api.supabase.co` or `qaidhpvxdmrsjvdcavns.supabase.co`** (`curl` exit 6 for both). **That is a local DNS/network restriction, and I am explicitly not claiming the production Supabase database is down.** Nothing in §4/§5 depends on that unknown; three items do depend on the answers:

| ID | Probe | Determines |
|---|---|---|
| **V-1** | D-1 queries in Supabase Studio → SQL Editor | True schema, constraints, indexes, every live policy. Gates P1-2 and all of D-2/D-3. |
| **V-2** | `curl -sSI "https://<project-ref>.supabase.co/storage/v1/object/public/datasets/<path taken from datasets.file_url>"` | Whether C-3 is a latent misconfiguration or an **active public exposure** requiring disclosure handling. Gates D-5. |
| **V-3** | Vercel → Project → Logs, filter `/api/analyze` | Whether the live 500 is provider config (leading candidate: `GEMINI_API_KEY` vs `GOOGLE_API_KEY`, since this repo has no `.env` file at all) or an RLS-rejected insert. |
| **V-4** | Supabase → Authentication → Providers / rate limits; Storage → buckets | Password-recovery config, signup throttling/CAPTCHA, actual bucket privacy toggles. |
| **V-5** | Vercel → Project → Settings → Headers | Where `Access-Control-Allow-Origin: *` on document/asset responses is injected — no tracked `vercel.json`, and `next.config.ts` is empty. New in Phase 2. |

---

## 7. Rollback and backup plan

**Code:** one commit per numbered item; no commit mixes a code change with a schema change. `git revert <sha>` is the entire rollback for every `code` item — no data migration sits underneath it. `git switch -c remediation/phase-2` **before P0-1**, no branch pushed (rule 3), `main` untouched; each item stays separately revertable rather than one large revert. Before each commit: `npx tsc --noEmit && npx eslint .`; after anything in `package.json` or `next.config.ts`: full `npm run build`.

**Database (later, and only with approval):** pre-change `pg_dump` (or a Supabase PITR restore point) plus a documented row-count query per table; every migration ships with a tested downward migration; restore is rehearsed on a scratch project, not discovered during an incident.

**Storage:** object inventory exported before any visibility change; bucket visibility is a reversible one-click, but **crawled URLs cannot be uncrawled** — hence V-2 before D-5, and P0-4's switch to paths-not-URLs before anything new is written.

**Deployment:** nothing deployed. When it finally is, the first deploy is to a preview URL with V-1/V-2 answered; production promotion is a separate, explicit approval.

**Secrets:** the CI pattern that leaks a secret into expanded logs (H-2) is fixed in code (P3-4), but because that workflow has run daily (`cron "0 0 * * *"`), treat `SERVICE_ROLE`, `GOOGLE_API_KEY`, `CURRENCY_API_KEY` and `MONITORING_WEBHOOK_URL` as needing **rotation by you**. Until then the harvester may break and that is acceptable — a key we believe is over-exposed is worth more than a working scrape.

---

## 8. Dependencies and recommended batch

```
V-1 ──▶ D-1 ──▶ D-2,D-3 ──┐
V-2 ──▶ D-5 ──▶ P0-4 ◀────┤
P0-1 ──▶ P0-2 ◀───────────┘
P0-1,P0-2 ──▶ P1-2..P1-5          P0-3 ──▶ P1-*        P2-8 ──▶ P4-6
P0-1 ──▶ P3-6 (security regression tests need a stable contract)
P3-4 ──▶ owner rotation ──▶ restore harvester
```

| Batch | Contents | Type | Why grouped |
|---|---|---|---|
| **1 (approve now)** | P0-1, P0-2, P0-3, P0-5, **P1-1** | code only | The four P0 items plus the build fix are independent of every unknown in §6; they close the unauthenticated-spend, identity-spoofing, error-collapse and header gaps, and make a clean clone build. Restoring `package-lock.json` (§2) happens with this batch on your word. |
| 2 | V-1…V-5, D-1 | read-only, you run | Converts assumptions into facts. |
| 3 | P0-4, D-2, D-3, D-5, D-6 | **db + approval + backup** | Now safe: column and constraint names are known. |
| 4 | P1-2…P1-5, P2-1…P2-11, P3-1…P3-6 | code/config | UI truthfulness + integrity + a11y + audit gates. |
| 5 | P4-1…P4-6 | new integrations | Only after the product is truthful and its access control is real. |

---

## 9. The exact first implementation task

**Task: `P0-1` + `P0-2` — make `POST /api/analyze` trust the session instead of the caller, in a single revertable commit on a local branch.**

Files: `app/api/analyze/route.ts`, `services/database.ts` (`getDatasetInsights`, `deleteDataset` ownership predicates, no-swallow of the save error), `components/UploadCard.tsx:117-125` (send the real `access_token`).

Deliberately excluded from this task, so the diff stays reviewable: rate limiting (its own item, because it needs your choice of limiter backend), the lazy Supabase client (P1-1), storage signing (P0-4, blocked on V-2), and any schema change.

Steps:
1. `git checkout -- package-lock.json` (only if you approve §2), then `git switch -c remediation/phase-2`.
2. Add `services/serverSupabase.ts` — server-side client built from the two `NEXT_PUBLIC_*` names, used **only** inside route handlers to verify bearer tokens. No service-role key anywhere in the web app.
3. `route.ts`: read `authorization`, `getUser(token)`; `401` on absent/invalid; drop `userId` from the body contract entirely; ownership-check `datasetId` against the verified user before `saveInsight`; if persistence fails, fail the response instead of returning `200`.
4. `UploadCard.tsx`: `const { data: { session } } = await supabase.auth.getSession()` and send `Authorization: Bearer <session.access_token>`.
5. Local tests only (localhost binds to the machine; earlier `next start` runs on ports 3111-3113 were killed and the `GEMINI_API_KEY` used was a literal invalid ASCII test string, never a real credential): unauthenticated → `401`; authenticated happy path; cross-tenant `datasetId` → rejected.
6. `npx tsc --noEmit`, `npx eslint .`, `npm run build`, then `git add` the three files and commit. No push.

Acceptance: `curl -s -o /dev/null -w '%{http_code}' -X POST http://localhost:3000/api/analyze -H 'content-type: application/json' -d '{"dataset":[1]}'` prints **401** — today, on the live site and locally, the identical command prints **500**.

---

## 10. What this plan does not do

It does not connect external agricultural APIs (rule 1 — P4 is scoped and gated). It does not touch production Supabase, RLS, storage, or environment variables (rule 2). It pushes and deploys nothing (rule 3). It truncates, deletes, or resets no user data (rule 4). It changes no layout, palette, typography, or animation — every UI item here is a copy or label change plus additive accessibility fixes (rule 5). It invents no statistic, signature, testimonial, or real-time capability — §4 removes those rather than polishing them, and P2-7 hands the testimonial decision back to you (rule 6). It prints no secret value anywhere, including in the §3.3 table, which lists names only (rule 7).

**Stopping here for your approval.** Nothing in this document has been implemented. The recommended decision is a yes/no on **Batch 1** (§8) plus a word on the `package-lock.json` restore (§2); §6's five probes and the testimonial decision (P2-7) are yours whenever convenient, and Batch 3 cannot responsibly begin until V-1 and V-2 come back.
