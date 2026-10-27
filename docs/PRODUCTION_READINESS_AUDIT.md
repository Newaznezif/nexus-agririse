# Nexus AgriRise — Production Readiness Audit

**Audit date:** 2026-10-26
**Repository audited:** `main` @ `a73f1d2c3592e9c1310f037d66f48414eeb14c8f` (https://github.com/Newaznezif/nexus-agririse)
**Local path:** `C:\Users\lenovo\NexusAgririse`
**Live site checked:** https://nexus-agririse.vercel.app/
**Mode:** READ ONLY. No source file, database, storage object, or deployment setting was modified.

---

## 0. Note on the working directory (important, read first)

The folder attached to this session, `C:\Users\lenovo\NexusAgririse`, **was completely empty** (verified: `find` returned zero entries, and a filesystem-wide search for `nexus*` / `*agririse*` found only two copies of the pitch-deck PDF). No project source existed on this machine.

To audit real source rather than infer it from the website, I cloned the public repository into that empty folder (`git clone`, exit code 0, 25 top-level entries). Everything below is derived from that checked-out source, not from the deployed site's appearance.

Build verification created only untracked, gitignored artifacts: `node_modules/` and `.next/`. Nothing was committed, pushed, or deployed.

---

## 1. Executive summary

Nexus AgriRise is a visually strong Next.js 16 App Router front end with a **thin, partially disconnected back end**. The presentation layer is production-quality; the data, security, and claims layers are not.

Verified status of the quality gates (commands actually run):

| Gate | Command | Result |
|---|---|---|
| Install | `npm install` | **PASS** (exit 0) |
| Type check | `npx tsc --noEmit` | **PASS** (exit 0, 0 errors) |
| Lint | `npx eslint .` | **FAIL** — 16 errors, 62 warnings |
| Build (clean clone, no env) | `npm run build` | **FAIL** — `Error: supabaseUrl is required` while collecting page data for `/api/analyze` |
| Build (with placeholder env) | `NEXT_PUBLIC_SUPABASE_URL=… NEXT_PUBLIC_SUPABASE_ANON_KEY=… npm run build` | **PASS** — 23 routes, all pages prerendered static |
| Tests | none exist | **No test framework is installed. Zero tests of any kind.** |
| Dependencies | `npm audit` | **FAIL** — 27 vulnerabilities (2 critical, 19 high, 5 moderate, 1 low) |

The five things that block production use:

1. **The core advertised feature is broken in production.** `POST /api/analyze` returns `500 {"error":"AI analysis failed"}` on the live site right now. Confirmed twice — once with `curl` from the CLI, once from inside a real browser on the deployed origin.
2. **`/api/analyze` is completely unauthenticated.** No session check, no CSRF check, no rate limit, no payload size limit. Anyone on the internet can burn the server's Gemini quota. Confirmed by an anonymous browser `fetch` that reached the handler.
3. **There are two incompatible `insights` schemas.** `harvester/setup_insights.sql` creates `insights` **without** `user_id` and `dataset_id`; the app (`services/database.ts:70-80`) inserts both. The Python pipeline inserts neither. The app's own data and the pipeline's data cannot see each other, and one of the two is guaranteed to be failing against the live database.
4. **A large amount of what looks like live intelligence is fabricated or never wired up.** The charts in `CountrySection`/`pdfExport` are invented from keyword matching; `ChatAssistant` is a hardcoded keyword bot branded "Online | AI Powered"; the entire daily scraping pipeline writes into tables **no web page ever reads**; and five of the eleven dashboard routes are "Coming Soon" placeholders that are still advertised as live capabilities in the marketing copy and in `ComingSoonModule`'s own status chips (`Security: Encrypted`, `AI Core: Ready`).
5. **No `.env.example` exists** (it is gitignored by the `.env*` pattern and was never committed), so a fresh clone cannot even build. Deployment is not reproducible.

The good news: none of this requires a rewrite. The stack is sound, the type layer is clean, and the design system is genuinely good. This is an integration, authorization, and truthfulness problem — a repair-and-wire job, not a rebuild.

---

## 2. Technology stack and architecture

### Confirmed stack

| Layer | Choice | Evidence |
|---|---|---|
| Framework | Next.js **16.2.6**, App Router, Turbopack | `package.json:24`, build banner `▲ Next.js 16.2.6 (Turbopack)` |
| Language | TypeScript 5, `strict: true` | `package.json:45`, `tsconfig.json:8` |
| React | 19.2.4 | `package.json:27-28` |
| Styling | Tailwind CSS v4 (CSS-first `@theme`), `tw-animate-css` | `app/globals.css:1-4`, `postcss.config.mjs` |
| Components | shadcn-style local primitives + `@base-ui/react` | `components.json`, `components/ui/button.tsx:1` |
| Animation | framer-motion 12 | used in 11 files |
| Charts | recharts 3 | `CountrySection.tsx`, `ComparisonChart.tsx` |
| Backend | Supabase (`@supabase/supabase-js` 2.105.4) — Postgres + Auth + Storage | `lib/supabaseClient.ts` |
| AI | Google Gemini via `@google/generative-ai` 0.24.1, model `gemini-1.5-flash-latest` | `services/ai.ts:12-15` |
| PDF | `jspdf` 4 + `jspdf-autotable` 5, client-side | `services/pdfExport.ts` |
| CSV | `papaparse` 5 | `services/csvParser.ts` |
| Toasts | `react-hot-toast` 2 | `app/layout.tsx:34` |
| Pipeline | Python 3.11 — playwright, playwright-stealth, supabase-py, httpx, google-genai | `harvester/requirements.txt` |
| Pipeline orchestration | GitHub Actions, daily cron + on-push-to-main | `.github/workflows/harvester.yml:3-8` |
| Hosting | Vercel | live site headers (`Server: Vercel`, `X-Vercel-Id`) |
| Package manager | npm (`package-lock.json`, 414 KB) | repo root |

### Architecture as actually built

```
Browser (all pages are "use client")
  │
  ├── Supabase anon key ──► PostgREST: datasets, insights, harvester_status
  │                    └──► Storage bucket "datasets" (public URLs)
  │                    └──► Supabase Auth (email/password)
  │
  └── POST /api/analyze (Next route, NO auth check)
             └──► Gemini (GEMINI_API_KEY, server-side)
             └──► saveInsight() via the ANON client, trusting a client-supplied userId

GitHub Actions (daily) ──► Python harvester (SERVICE_ROLE key)
             └──► market_intelligence, environmental_data, exchange_rates
             └──► unified_market_intel (view)
             └──► insights  (rows WITHOUT user_id / dataset_id)
             └──► harvester_status.last_run  ◄── the ONLY table the web app reads from this pipeline
```

Key structural facts, each verified:

- **There is no `middleware.ts`.** `/dashboard/*` has zero edge or server protection.
- **Every route is a client component.** Build output marks all 22 pages `○ (Static)`; only `/api/analyze` is `ƒ (Dynamic)`. There is no server-rendered data fetching anywhere, and no RSC data layer.
- **The only server-side code in the app is one route handler.** All business logic runs in the browser against the anon key.
- **The web app reads exactly three tables** (`harvester_status`, `datasets`, `insights`) — confirmed by grepping every `.from(...)` call in `app/`, `components/`, `hooks/`, `lib/`, `services/`, `utils/`. The harvester writes to four tables plus a view that **nothing in the web app ever queries**.

### Dead and misplaced code

- `services/api.ts` — a pure mock (`return { data: 'Mock data from ' + endpoint }`), imported by nothing. Delete or replace.
- `components/ui/button.tsx` + the `@base-ui/react` dependency it alone uses — imported by nothing. The app has its own `components/Button.tsx`.
- Runtime dependencies with **zero imports**: `openai`, `axios`, `sonner`, `@lottiefiles/dotlottie-react`, `@shadcn/ui`.
- `shadcn` and `@shadcn/ui` are CLI tooling (they pull in `@modelcontextprotocol/sdk`, `@hono/node-server`, and vulnerable `zod`) sitting in **`dependencies`**, not `devDependencies`. This is the direct cause of a large share of the 27 audit findings, and it is shipped into the app's install graph.
- `harvester/__pycache__/*.pyc` — five compiled Python binaries are committed to the repository.

---

## 3. Feature inventory

Legend: **Working** = verified functioning. **Partial** = exists but incomplete/misconnected. **Visual-only** = renders but has no backend. **Missing**. **Needs verification** = cannot be proven from source alone.

### 3.1 Accounts and identity

| Feature | Status | Evidence |
|---|---|---|
| Sign up | **Partial** | `app/signup/page.tsx:60` calls `supabase.auth.signUp`. Ignores `data.user`/`data.session`, then hard-redirects to `/dashboard` after 2s (`:66-67`). If email confirmation is ON in Supabase, the user lands on a dashboard they cannot use. Behaviour depends on a Supabase dashboard setting — **Needs verification.** |
| Sign in | **Partial** | `app/login/page.tsx:50` — real Supabase password sign-in, error surfaced, spinner, `autoComplete` set. Works, but untestable here because Supabase hosts are unreachable from this machine (§11). |
| Sign out | **Working** | `hooks/useAuth.tsx:44-46`, wired in `Sidebar.tsx:161` and `Navbar.tsx:107/149`. |
| Password recovery | **Missing** | No `resetPasswordForEmail`, no `/forgot-password` route, no recovery-token handler anywhere in the repo. A "Forgot password" link does not even exist on the login page. |
| Session management | **Partial** | Default Supabase browser storage. No server-side validation, no idle timeout, no refresh handling, no re-auth on sensitive actions. |
| Profile / account settings | **Visual-only** | `app/dashboard/settings/page.tsx` — see below. |
| Roles / permissions | **Missing** | No `profiles` table, no role column, no RLS by role, no admin concept anywhere. Yet `ExportButton.tsx:13-17` presents a picker of three hardcoded "Authorized Profiles" (Director General / Executive / Market Lead) that any anonymous visitor can select. |
| Team / org sharing | **Missing** | Claimed on the homepage: "Only authorized people in your team can see or access your information" (`app/page.tsx:441`). No team concept exists. |
| Protected routes | **Partial (client-side only)** | `app/dashboard/page.tsx:67-73` and equivalents redirect to `/login` in a `useEffect`. The HTML is still prerendered and served; the guard is a client-side flash, not an access control. |

Settings page in detail (`app/dashboard/settings/page.tsx`), because it is entirely decorative:
- `:21-24` "Edit" profile → `toast.success('Profile editing enabled…')` and the comment `// In a real app, this would open a modal`. Nothing is edited.
- `:26-29` Notifications toggle → local `useState` only, never persisted, never read. The label "Email alerts for market changes" describes a feature that does not exist.
- `:31-33` "Manage" security → always fires `toast.error('2FA Configuration is currently under maintenance')`. There is no 2FA to configure; this is a permanent dead button.
- `:35-46` "Clear Cache" → fake 1.5s delay, then removes `localStorage` keys `cached_insights` and `dashboard_state`, **which are never written by any code in the repo**.
- Only genuinely useful fact on the page: it displays `user.email` (`:76`).

### 3.2 Agricultural intelligence

| Feature | Status | Evidence |
|---|---|---|
| Farmer-specific profiles (crops, farm location, growing conditions) | **Missing** | The data model has no farmer, no farm, no field, no plot, no crop entity. `Dataset` (`types/index.ts:6-14`) is only `{name, country, type, file_url}`. The product currently serves an analyst uploading a CSV, not a farmer describing their farm. |
| Soil information / soil-health recommendations | **Visual-only, and derived from a mock** | `harvester/environment_enricher.py:81` writes `soil_moisture_pct` from Open-Meteo (real), but `:72-75` computes **`ndvi_index` as a fabricated formula** from soil moisture — the code comment states it outright: `# NDVI Index (Mocked/Estimated as Open-Meteo doesn't provide direct satellite NDVI)… We simulate an index`. `/dashboard/climate` is a Coming-Soon placeholder (`app/dashboard/climate/page.tsx:7`), and no page reads `environmental_data`. |
| Weather / climate insights | **Partial, never surfaced** | Real daily data is harvested into `environmental_data` (`environment_enricher.py:32-40`, Open-Meteo, 14 past + 7 forecast days) but **no web page ever queries that table**. |
| Irrigation recommendations | **Missing** | No such logic exists. Recommendation text is hardcoded boilerplate (`CountrySection.tsx:165-168`, `pdfExport.ts:238-242`). |
| Crop planning / cultivation guidance | **Missing** | Out of scope for the current model; see §10 recommendation. |
| Market prices | **Partial, never surfaced, and silently wrong when it would be** | `harvester/main.py` scrapes ECX and NAEB into `market_intelligence`. Nothing reads it. Worse, the price normalisation is unsafe: `unified_market_intel` falls back to hardcoded 2026 FX rates (`recreate_view.sql:12-14`: ETB `0.018`, RWF `0.00078`) and `normalization_engine.py:47-51` repeats those constants, so a failed API call silently produces plausible-but-wrong USD prices. Prices are also parsed **positionally** (`main.py:73` `cells[4]`, `:122` `cells[1]`) from HTML tables of third-party sites — a column reorder on ECX silently changes what your price means, with no test to catch it. |
| "Arbitrage" / opportunity values | **Visual-only** | `recreate_view.sql:33` defines `net_opportunity_value = price_usd_per_mt - 150` — a single hardcoded $150/MT logistics constant subtracted from every row, with no counterparty price involved. It is not an arbitrage calculation. |
| Personalised recommendations from real user data | **Missing** | The AI prompt (`services/prompts.ts`) sees only the uploaded CSV. The UI then discards 2 of the 4 AI fields — see §4. |
| Data-source / update-time / limitation disclosure | **Missing (critical for trust)** | The only freshness signal in the whole app is `harvester_status.last_run` shown as a chip on the dashboard hero (`app/dashboard/page.tsx:128-131`). No insight card, chart, PDF, or table states its source, its capture time, whether it is real or demo, or its confidence. `Climate risk` and `NDVI` are presented with no caveat at all. |
| Country coverage | **Contradicted by copy** | `services/comparison.ts:28` — `SUPPORTED_COUNTRIES = ['Ethiopia','Rwanda','Central African Republic']`. The homepage (`:90`, `:444`), services page (`:45`) and chatbot (`ChatAssistant.tsx:96`) all claim "14+ African markets". |

### 3.3 AI recommendations

| Feature | Status | Evidence |
|---|---|---|
| Real provider connected | **Yes, but failing in production** | `services/ai.ts` calls Gemini `gemini-1.5-flash-latest`. Live endpoint returns 500 (§11). That model name is deprecated on the Gemini API, and `GEMINI_API_KEY` may simply be unset in Vercel — both are consistent with the observed 500. |
| Server-side call, secret kept server-side | **Working** | `GEMINI_API_KEY` is read only in `services/ai.ts:6`, which is imported only by `app/api/analyze/route.ts`. Verified: no client file imports `services/ai` or `@google/generative-ai`. |
| Input validation | **Partial** | Route checks `Array.isArray(dataset) && length > 0` (`route.ts:10-15`). No limit on row count, cell width, total bytes, or key count. `ai.ts:22` slices to 50 rows *after* the whole payload is parsed and re-serialised. |
| Output validation | **Partial** | `ai.ts:44-46` checks three of four fields exist; the regex at `:38` (`/\{[\s\S]*\}/`) is greedy across the entire response, so any prose containing braces breaks parsing. No enum check on `riskLevel` despite the prompt demanding it. No schema validator (no zod in app code). |
| Rate limiting | **Missing** | None — not on the route, not in `next.config.ts` (which is an empty stub, `next.config.ts:3-5`). |
| Timeouts | **Missing** | No `AbortSignal`, no timeout on `model.generateContent`. A slow Gemini hangs the serverless function until platform timeout. |
| Error handling | **Partial** | `catch` returns generic `AI analysis failed`. But `route.ts:43` tests for the string `'OPENAI_API_KEY is missing'`, while `ai.ts:8` throws `'GEMINI_API_KEY is missing…'` — the branch is dead, and `ai.ts:65` collapses every distinct failure into one message, so operators cannot tell a missing key from a retired model from a quota breach. |
| Loading states | **Partial** | `UploadCard` has staged progress text. The insights page has a spinner. No cancellation, no retry, no partial-failure messaging. |
| Graceful fallback when provider is down | **Missing** | If `/api/analyze` fails, `UploadCard.tsx:127-129` throws and the dataset is left uploaded-but-unanalyzed. No queue, no retry, no deferred analysis. |
| Usage metadata | **Missing** | No logging of model, token count, latency, cost, or failure class. |
| Fabrication guard | **Missing (critical)** | The prompt asks for factual market claims but adds no instruction to abstain, cite, or hedge. The result is signed and exported as an "investor-grade" report. See §7/§8 of SECURITY_REVIEW.md. |

### 3.4 Dashboard and data management

| Feature | Status | Evidence |
|---|---|---|
| Real dashboard backed by persistent data | **Partial** | `app/dashboard/page.tsx:56-65` fetches the user's real datasets. But `:98` computes `insightCount = isDemoMode ? demoInsights.length : 0`, and `:161` renders `value={isDemoMode ? insightCount : '—'}` — so **a real user's "AI Insights Generated" card always shows `—`, even with insights.** The dashboard never calls `getUserInsights`. |
| Search | **Working** | `DatasetTable.tsx:24-27` client-side filter over name+country, with a proper no-results state (`:67-70`). |
| Sorting | **Missing** | No sortable columns anywhere. |
| Pagination | **Missing** | All `.select("*")` calls are unbounded (`services/database.ts:53, 92, 106`) — every dataset and insight for a user is loaded forever. |
| Create | **Working (conditionally)** | `UploadCard.tsx:82-148` — storage upload → `saveDataset` → `/api/analyze`. Blocked here by network reachability; see §11. |
| Read | **Working (conditionally)** | as above. |
| Update | **Missing** | There is no update path for any record. No rename, no re-analyze, no country correction — and `country` is forced to `'Global'` at insert (`UploadCard.tsx:104`) with no way to change it. |
| Delete | **Missing (code exists, no UI)** | `services/database.ts:121-132` defines `deleteDataset` but **it is never called from any component**. Datasets cannot be deleted from the product. Orphaned storage objects also accumulate: `deleteDataset` would not delete the uploaded file. |
| Validation | **Partial** | Client-side only: `.csv` extension/MIME, 10 MB, non-empty (`UploadCard.tsx:37-52`). Server re-validates nothing about the file (it never sees it). |
| Loading / empty / error states | **Good** | `InsightSkeleton`, `InsightTimeline.tsx:72-86` empty state, `DatasetTable.tsx:57-66`, `ComparisonChart.tsx:48-59`. This is a genuine strength. |
| Accurate calculations | **FAIL** | `analytics/page.tsx:88` `successRate = lowRiskCount / insightsCount` is labelled "Low Risk Ratio" but the metric is meaningless (ratio of AI risk labels, not of outcomes). `:114/125/136` show `14.2K / 12,400 / 89%` invented totals in demo mode. `:87` `i.risk_level.toLowerCase()` throws if the nullable DB column is null — `harvester/setup_insights.sql:7` declares `risk_level TEXT` with no NOT NULL. |
| Status accuracy | **FAIL** | `DatasetTable.tsx:120-123` renders a green "Processed" badge for **every row unconditionally**. A dataset whose AI analysis failed is displayed as processed. |

### 3.5 Product-wide integration

| Item | Status |
|---|---|
| Contact form | **Visual-only.** `app/contact/page.tsx:9-13` calls `preventDefault()` then `alert("Message sent! …")`. No state, no `name` attributes, no API route, no insert, no mail. Every enquiry is silently discarded while the user is told the team will reply. |
| Pricing page | **Visual-only.** No payment provider, no plan column, no entitlement logic exists anywhere. "Start Free Trial" has no trial behind it; "Contact Sales" leads to the dead form above. |
| Chat assistant | **Visual-only + false claim.** `ChatAssistant.tsx` is a `if (q.includes(...))` keyword matcher (no AI call) whose header permanently reads `Online | AI Powered` (`:165`). It also recites specific market figures as facts (`:101-107`). |
| Five dashboard modules | **Placeholders.** `/dashboard/climate`, `/forecasts`, `/map`, `/audit`, `/security` all render `ComingSoonModule`. That component (`ComingSoonModule.tsx:36-39`) displays hardcoded status chips `Data Sync: Initializing`, `AI Core: Ready`, `Security: Encrypted` — asserting capabilities on pages that have no capabilities. |
| `/#insights` nav link | **Partial.** `Navbar.tsx:42` links to a same-page hash on `/` only; from any other route it lands on `/` without scrolling reliably (Next hash handling), and `isActive` (`:49`) marks it active by path match only. |
| Language switcher | **Partial, third-party.** Google Translate widget only (`LanguageSwitcher.tsx:27-42`); no app-level i18n, no translated content, no `lang` attribute update. Requests `includedLanguages: en,am,rw,sg,sw` — Google Translate support for Kinyarwanda (`rw`) and Sango (`sg`) must be verified; unsupported codes silently no-op. |
| Theme toggle | **Partial.** Persists to `localStorage` (`Navbar.tsx:33`) but the initial paint is always light and `<html>` carries `suppressHydrationWarning` (`app/layout.tsx:31`) to hide the resulting mismatch. |
| Demo mode | **Partial.** Real and useful, but `DemoModeContext.tsx:15` is plain `useState(false)` with no persistence, so it resets on every reload or direct URL entry. `app/dashboard/page.tsx:68-73` still redirects to `/login` if there is no Supabase session, so demo mode cannot be entered by URL — only by clicking the toggle on `/login` or `/dashboard`. |
| PDF export | **Working.** Verified end-to-end in a real browser against the live site in demo mode: clicked "Export PDF", button reached the "Click to Save" state with no console error. (Concerns about its *content*, not its mechanics, are in §8 and SECURITY_REVIEW.md.) |

---

## 4. Frontend → backend integration gaps

Ordered by severity. These are the specific wires that are not connected.

1. **The whole harvester is an orphan.** The web app never reads `market_intelligence`, `environmental_data`, `exchange_rates`, or `unified_market_intel` — confirmed by grepping every Supabase call in the codebase. A daily cron with service-role credentials, stealth browser automation, and an AI step runs against production and its output is displayed nowhere except a "last run" timestamp. Either surface it or stop running it.
2. **Two incompatible `insights` schemas on one table name.** App: `user_id`, `dataset_id`, `summary`, `risk_level`, `trend` (`services/database.ts:70-80`, README `:40-41`). Pipeline: `summary`, `risk_level`, `trend` only (`harvester/intelligence_generator.py:110-115`, `harvester/setup_insights.sql:4-10`). Consequences: the pipeline's insights are invisible to `getUserInsights()` (which filters `.eq("user_id", userId)`), and if the live table matches the app, the pipeline insert fails silently — the code only prints to stdout (`intelligence_generator.py:135-139`).
3. **`crossBorderOpportunity` is computed and then thrown away.** The prompt demands 4 fields (`services/prompts.ts:17-22`), the type declares 4 (`types/ai.ts:1-6`), but `route.ts:22-28` persists only 3. `InsightCard.tsx:85` then guards on `(insight as any).cross_border_opportunity`, a column that no writer ever populates — so the "Cross-Border Opportunity Insights" panel **can never render**. The component even contains a 10-line stream-of-consciousness comment admitting the author was unsure (`InsightCard.tsx:25-34`).
4. **`/api/analyze` trusts client-supplied identity.** `userId` and `datasetId` come from the request body (`route.ts:8`) and go straight into an insert (`database.ts:71-79`) using the **anon** key. A caller can attach an insight to any user's account, or pass an arbitrary `datasetId`.
5. **`analytics` page reads insights from the wrong service.** `app/dashboard/analytics/page.tsx:12` imports `getUserInsights` from `services/database`, while `insights`, `comparison`, and `InsightTimeline` import a *different* `getUserInsights` from `services/insights`. Two functions, same name, different return shapes (`{success, error}` vs `{data, error}`) — a latent source of silently-swallowed errors.
6. **Uploaded rows are parsed twice and stored zero times.** `UploadCard` parses the CSV for preview (`:59`), then re-parses the whole file into memory for the AI call (`:115`). Only `file_url` is persisted; the parsed rows are never stored, so no page can chart real numbers from a user's own dataset. This is precisely why the trend and risk charts had to be fabricated (§8).
7. **`country` is hardcoded to `'Global'`** at insert (`UploadCard.tsx:104`), but `compareCountries` filters on exact country names (`comparison.ts:32-34`). Real users therefore always produce **zero** comparison rows for all three countries, and `identifyOpportunities` falls through to its hardcoded seed opportunities (`comparison.ts:105-125`) — meaning the "Opportunity Gap Analysis" a real user sees is fabricated stock text, not their analysis.
8. **`setSelectedCountry(dsRes.data[0].country)`** (`insights/page.tsx:47`) sets the selected region from the newest dataset, but `Dataset.country` is typed non-optional (`types/index.ts:10`) while the DB column is nullable (`harvester/setup.sql` has no `datasets` table at all; README declares `country` present). `selectedCountry` can become `undefined` and then `d.country === selectedCountry` matches nothing.
9. **No `datasets` table SQL exists in the repository.** README `:39-41` tells the operator to create `datasets`/`insights` by hand in the Supabase editor; `harvester/setup_insights.sql` covers only a conflicting `insights`. There is no version-controlled definition of `datasets` — its real columns, constraints, and RLS policies are unknown.
10. **No storage-bucket provisioning or policy SQL exists.** `services/storage.ts:11-24` targets a bucket named `datasets` and then calls `getPublicUrl`, which only works if the bucket is **public**. There is no migration creating or configuring that bucket, so bucket privacy is entirely undocumented and unverifiable from source.

---

## 5. Database and data integrity

**Migration strategy: none.** There are no Supabase migrations, no `supabase/config.toml`, no `db pull` artefacts, and no CLI usage. Schema lives in seven loose `.sql` files in `harvester/` with `-- Run this in the Supabase SQL Editor` instructions. `recreate_view.sql` begins with `DROP VIEW IF EXISTS unified_market_intel` — a destructive statement an operator is told to paste by hand. There is no history, no ordering, and no way to reproduce production's actual schema from the repository. **This is the single largest reliability risk in the project** and it makes every other data finding impossible to close out confidently.

Confirmed defects:

| # | Issue | Location | Impact |
|---|---|---|---|
| D1 | Two conflicting definitions of the same view | `setup_normalization.sql:13-43` vs `recreate_view.sql:6-38` | The latter adds FX fallbacks (`0.018`, `0.00078`, `COALESCE(er.rate_to_usd, 0.001)` — note the *inconsistent* third fallback of 0.001 vs 1.0). Which one is live is unknown; prices differ by orders of magnitude depending on the answer. |
| D2 | Silent stale FX rates | `recreate_view.sql:12-14`, `normalization_engine.py:47-51` | If `CURRENCY_API_KEY` is unset the engine warns and uses hardcoded fallbacks (`:18`) — the view then cannot distinguish a real rate from a guess. Wrong money numbers with no flag. |
| D3 | No `datasets` table DDL | README `:40` | Unverifiable columns/constraints/RLS. |
| D4 | `insights` schema conflict | §4 item 2 | Pipeline/app data invisible to each other; likely silent insert failure. |
| D5 | Nullable `risk_level` / `summary` vs untyped client code | `setup_insights.sql:7-9`, `analytics/page.tsx:87`, `CountrySection.tsx:29,52` | `.toLowerCase()` on null → runtime crash of the analytics page. |
| D6 | No indexes declared | all SQL | Queries filter `user_id`, `dataset_id`, `created_at`; only `id`/`key`/`currency_code`/`UNIQUE(location_name,date)` are constrained. Full scans grow with data. |
| D7 | No FK from `insights.dataset_id` → `datasets.id` | `setup_insights.sql` | Orphan insights survive dataset deletion; `InsightTimeline.tsx:91` silently renders `dataset={undefined}`. |
| D8 | `market_intelligence.timestamp` is naive-UTC in a `timestamptz` column | `main.py:75` `datetime.utcnow().isoformat()` (no offset, deprecated in 3.12) | Ambiguous freshness; breaks the view's `DATE(ms.timestamp) = e.date` join (`recreate_view.sql:37`) across timezone boundaries, so climate data silently stops matching its market. |
| D9 | Positional HTML scraping | `main.py:69-77`, `:119-127` | A column change at ECX/NAEB silently mislabels prices; there is zero test coverage to detect it. Also no dedupe key: `upsert(data_list)` (`main.py:30`) has no conflict target, so it inserts duplicates daily unless an unlisted unique constraint exists. |
| D10 | Public bucket for user uploads | `storage.ts:22-24` | See SECURITY_REVIEW.md C-3. |
| D11 | Unbounded `select("*")` | `database.ts:53,92,106` | Unbounded result sets. |
| D12 | Committed Python bytecode | `harvester/__pycache__/*.pyc` | Repo hygiene; `.pyc` for `main`, `intelligence_generator`, `normalization_engine`, `environment_enricher`, `pre_flight_check` (cPython 3.13) reveals compiled internals and signals local runs were never cleaned. |
| D13 | `MONTHLY_AVG_RAINFALL = 100.0` hardcoded | `environment_enricher.py:58-66` | The `climate_risk_score` (1/5/8) that the AI is told to "Evaluate" (`intelligence_generator.py:71`) rests on a placeholder constant, with the comment conceding "In a production system, this would be queried from historical averages." |

---

## 6. Authentication and authorization gaps

- **No `middleware.ts`** → no server-side gate for `/dashboard/*`, and no protection for `/api/analyze`. All 22 pages are also prerendered to static HTML at build time.
- **Authorization is entirely absent, and it is absent in the exact places that matter.** `deleteDataset(datasetId)` (`database.ts:121-125`) deletes by id with no user scoping; `saveInsight` writes any caller's `user_id`; `getDatasetInsights(datasetId)` (`database.ts:89-94`) reads by dataset id with no ownership check. Every one of these depends 100% on Row-Level Security that the repository does not define, and for `datasets` does not even document. **The signup page promises "Row-level data isolation — your datasets are only ever yours" (`app/signup/page.tsx:124`) and there is no evidence in the repository that this is true.**
- **RLS that *is* defined is read-only-by-service-role and would lock the app out.** `market_intelligence`, `insights`, `environmental_data`, `exchange_rates` each get exactly one policy: `FOR ALL USING (auth.role() = 'service_role')` (`setup.sql:20-23`, `setup_insights.sql:16-19`, `setup_env.sql:21-24`, `setup_normalization.sql:47-48`). If production's `insights` matches `setup_insights.sql`, **authenticated users can read zero rows** — the app would show empty everywhere while the harvester writes fine. `harvester_status` is the sole exception, deliberately public (`setup_status.sql:14-15`).
- **No roles or permission model.** No `profiles` table, no `role` column, no admin area. "Authorized Profile" in `ExportButton.tsx:13-17` and the sidebar's "AUTHORIZED" chip (`Sidebar.tsx:155`) are decorative strings.
- **No re-authentication for sensitive operations**, no session-length policy, no revocation path.
- **No password policy** beyond a client-side `length < 6` check (`signup/page.tsx:54`) that is enforced nowhere server-side; the "password strength" meter (`:71-77`) grades on length only.
- **No email-confirmation or recovery flow handling** (§3.1).
- **Demo mode fabricates an identity.** `useAuth.tsx:48-54` substitutes a `mockUser` with `id: 'demo-user-id'` for the real user object. Any component that trusts `user.id` in demo mode would write rows owned by `demo-user-id`. Currently no demo path writes to the DB, but nothing structurally prevents it — a one-line feature change creates production data pollution. `AuthContextType.user` is typed `User | any | null` (`:9`), which disables the type checker as a guard.
- **Secrets handling in CI is unsafe.** See SECURITY_REVIEW.md H-2.

---

## 7. Security findings

Full detail, impact, remediation, and verification steps are in **`docs/SECURITY_REVIEW.md`**. Summary:

| ID | Severity | Finding |
|---|---|---|
| C-1 | Critical | `/api/analyze` is unauthenticated, unthrottled, and burns the server's paid Gemini key |
| C-2 | Critical | Broken access control: server-side insert trusts client-supplied `userId`/`datasetId` via the anon key |
| C-3 | Critical | User-uploaded agricultural datasets are written to a public storage bucket (`getPublicUrl`) |
| C-4 | Critical | No version-controlled migrations or RLS definition for `datasets`/`insights`; the product's central security claim is unverifiable |
| H-1 | High | Fabricated analytics, charts, "cryptographic" signatures, and hardcoded AI recommendations presented as verified intelligence |
| H-2 | High | Secret interpolated into a curl command line in CI, with a hardcoded third-party webhook fallback; Gemini key sent in a URL query string |
| H-3 | High | 27 `npm audit` findings (2 critical, 19 high), aggravated by CLI tooling in `dependencies` |
| H-4 | High | No Content-Security-Policy, X-Content-Type-Options, Referrer-Policy, frame-ancestors, or Permissions-Policy; `Access-Control-Allow-Origin: *` observed on live responses |
| M-1 | Medium | Greedy JSON-extraction regex + unvalidated AI output reaches the DOM and the PDF report |
| M-2 | Medium | Service-role key used by a scraper in shared CI runners; unbounded, unverified third-party HTML enters production tables |
| M-3 | Medium | Unbounded queries; double CSV parse; 100 ms infinite interval in `LanguageSwitcher`; ~130-day stale cached HTML |
| M-4 | Medium | Error messages and `console.error` leak internal detail; the two API keys for one provider (`GEMINI_API_KEY` vs `GOOGLE_API_KEY`) invite silent outage |
| M-5 | Medium | No consent/disclosure surface: no `/privacy`, `/terms`, or data-processing page anywhere, while the product stores user-uploaded business data |
| L-1 | Low | Committed `.pyc`; README describes OpenAI/GPT-4o-mini while the code uses Gemini; unused `openai`/`axios`/`sonner` deps; `AGENTS.md`/`CLAUDE.md` and `.vscode/settings.json` committed |

---

## 8. Performance, reliability, mobile, accessibility

### Reliability (verified failures)
- **`npm run build` fails on a clean clone.** `lib/supabaseClient.ts:6` runs `createClient` at module scope, and the API route imports it, so page-data collection throws `supabaseUrl is required`. Confirmed; passes only when placeholder env values are supplied.
- **AI analysis is returning 500 in production right now.** Confirmed twice (§1).
- **`Buffer` is not a browser global.** `typeof Buffer === "undefined"` on the live site. It happens to work because Turbopack bundles a module-scoped shim — `pdfExport.ts:269` and `CountrySection.tsx:62` are relying on a bundler implementation detail with no `package.json` browser polyfill declared. One build-config change breaks export. Use `btoa`/`Uint8Array` instead.
- **Recharts layout failure, live.** Console on `/dashboard/insights`: `The width(-1) and height(-1) of chart should be greater than 0` — the charts render into an unsized container, so the fabricated chart is also a broken chart.
- **Supabase request failures are logged and ignored on the live dashboard.** 13 `ERR_NAME_NOT_RESOLVED` console errors from the `harvester_status` and `datasets` calls, with no user-visible degraded state (`app/dashboard/page.tsx:43-45` swallows into `console.error`). *Caveat: this machine cannot reach `*.supabase.co` at all (even `api.supabase.co` fails DNS), so I cannot tell whether production's Supabase project is genuinely down or whether this is local network policy. See §11.*
- **Lint errors flag real React defects**: 5× `react-hooks/set-state-in-effect` (cascading renders), `react-hooks/immutability` on `document.cookie` writes (`LanguageSwitcher.tsx:79-80`), and "Cannot call impure function during render" at `ChatAssistant.tsx:52` (`new Date()` in the `useState` initializer → guaranteed hydration mismatch).
- **100% of page code is `"use client"`.** No route is statically optimised server-side; even the fully static `/testimonial` (`page.tsx:1`) and `Footer.tsx:1` (which uses `"use client"` only for `new Date().getFullYear()`) ship client bundles.

### Performance
- No `next/image` anywhere; `next.config.ts` is an empty stub with no `images.remotePatterns`, so hotlinked images (`AfricaMap.tsx:50` Wikipedia SVG, `:89` `flagcdn.com`, `about/page.tsx` Unsplash `onError` fallbacks) bypass optimisation and leak visitor context to third parties.
- Unbounded `select("*")` (§5 D11), no pagination, no `limit`.
- Sidebar is 320 px by default and resizable to 500 px with mouse only (`Sidebar.tsx:20-41`); width is not persisted, and the resize handle has no keyboard path or `aria` role.
- `LanguageSwitcher.tsx:66-72` runs `document.body.style` writes every 100 ms forever, for the lifetime of the tab, and never cleans up the injected `<script>`.
- Homepage animations: two `animate-pulse` 120 px blur layers plus `scale-110 lg:scale-125` transform on the map (`app/page.tsx:129-130`, `:183`) with **no `prefers-reduced-motion` handling anywhere in the codebase**.

### Mobile
- Responsive scaffolding is genuinely good (grid breakpoint coverage across `sm/md/lg/xl`).
- Real problems: the **floating chat button and the floating sidebar hamburger occupy the same corner** (`ChatAssistant.tsx:140` `bottom-8 right-8`; `Sidebar.tsx:77` `bottom-6 right-6`) — on mobile dashboard pages they overlap and one covers the other. `Sidebar` renders inside `dashboard/layout.tsx` as `fixed inset-y-0` full-height, covering 100% of a phone screen at its 320 px width until toggled. Country selector lists scroll horizontally with `scrollbar-hide` (`insights/page.tsx:115`) — an affordance-only cue with no visual scrollbar, poor discoverability on touch. The chat window is a fixed `h-[500px]` (`:155`), which overflows short landscape viewports.
- `app/testimonial/page.tsx` and the chat's `getBotResponse` keyword list include the typo branch `q.includes('how can i sue')` (`ChatAssistant.tsx:85`) — harmless, but it is the kind of artifact a panel will notice.

### Accessibility (concrete, WCAG-mapped)
- **1.4.1 Use of colour:** `DemoToggle.tsx:9-22` conveys state only by colour and dot position, with a `title` and no `aria-pressed`/`role="switch"`. `RiskBadge`/`MarketTrendCard` risk colours are likewise colour-primary.
- **4.1.2 Name, role, value:** `ComingSoonModule` chips, the sidebar resize handle, and `AfricaMap.tsx:68-74` hotspots (plain `<div>`s with only `onMouseEnter`/`onMouseLeave` — no `tabIndex`, `role`, or `onFocus`) make the "Nexus Intelligence Node" panel **completely unreachable by keyboard or touch**.
- **1.3.1 Info and relationships:** four `<label>`s in `app/contact/page.tsx:82-112` have no `htmlFor` and their inputs have no `id`/`aria-label`.
- **2.4.6 Headings / label:** `DatasetPreview.tsx:34-36` builds `<th>` from raw CSV header text — untrusted, unlabelled, and screen-reader-noisy.
- **2.4.7 Focus visible:** `components/Button.tsx:16` sets `focus:outline-none` and relies on a ring; the Navbar theme/hamburger buttons (`Navbar.tsx:96-102`, `:117-123`) have **no focus ring at all**.
- **Nested interactive controls:** `<Link>` wrapping `<button>` in `app/services/page.tsx:157-161`, `app/pricing/page.tsx:104`, `Navbar.tsx:109`.
- **1.4.3 Contrast:** `app/dashboard/page.tsx:215` renders insight trend text in `text-gray-500 italic`; `analytics`/`ComparisonChart` empty states use `text-gray-300 dark:text-gray-600` (`ComparisonChart.tsx:55`) on white/near-black — both fail 4.5:1. `about/page.tsx` icon-only social links have no `aria-label` and no text.
- **1.1.1 Non-text:** one image on the live homepage has no `alt` (measured in-browser: `imgsNoAlt: 1` of 8).
- **3.1.1 Language:** `<html lang="en">` is hardcoded (`app/layout.tsx:31`) while the product offers 5 languages, and Google Translate rewrites DOM text without updating `lang`.
- **No status messages:** AI analysis, upload, and export results are never announced via `aria-live`. The `Toaster` is visual only.
- **SEO/social:** live homepage has **0 `og:` tags and no `canonical`** (measured in-browser); `app/layout.tsx:20-23` defines one global `metadata` and no route overrides it — no `title`/`description`/`openGraph`/`twitter`/`metadataBase`, so shared links render blank, and there is no `sitemap.ts` or `robots.ts`.

---

## 9. Deployment and environment configuration gaps

**Required environment variables — names only; no values were read or printed.**

| Variable | Where required | Scope | Notes |
|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | `lib/supabaseClient.ts:3` | public | Needed **at build time** (see §8) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `lib/supabaseClient.ts:4` | public | Needed at build time; legacy anon-key pattern — Supabase now recommends `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`/`PUBLISHABLE_KEY` |
| `GEMINI_API_KEY` | `services/ai.ts:6` | **secret** | Server-only; correctly never imported by client code |
| `SUPABASE_URL` | `harvester/*.py` | secret context | CI secret `SUPABASE_URL` |
| `SUPABASE_SERVICE_ROLE_KEY` | `harvester/*.py` | **secret** | CI reads it from `secrets.SERVICE_ROLE` (`harvester.yml:44`) — inconsistent naming |
| `SERVICE_ROLE` | `pre_flight_check.py:12`, `intelligence_generator.py:18` | **secret** | Accepts a *second* alias for the same service-role key |
| `GOOGLE_API_KEY` | `intelligence_generator.py:19`, `pre_flight_check.py:13` | **secret** | Different name from the web app's `GEMINI_API_KEY` for the same provider |
| `CURRENCY_API_KEY` | `normalization_engine.py:11` | secret | Optional; falls back to stale hardcoded rates |
| `MONITORING_WEBHOOK_URL` | `harvester.yml:72` | secret | Interpolated into a shell command |

Gaps:
- **No `.env.example`.** README `:29-33` tells operators to `cp .env.example .env.local`, but that file is not in the repository — and cannot have been committed, because `.gitignore:35` (`.env*`) excludes it before `.env.local` on `:36`. So the documented setup path is broken and a fresh clone cannot build.
- **`next.config.ts` is an empty stub** — no security headers, no image domains, no `poweredByHeader` off, no bundle analysis. Headers should be added here (§SECURITY H-4).
- **No CI for the web app at all.** The only workflow is the harvester; nothing builds, lints, or tests the Next.js app before it reaches `main`.
- **No branch protection is enforceable from the repo**, and the README (`:52-60`) documents a `main`/`dev`/`feature/*` flow while `git ls-remote` shows **only `main` exists** on the remote — the documented workflow is not in use.
- **No preview/staging environment** is evidenced; there is one production URL.
- **No README drift control:** README `:7` says "Next.js 14+", `:10` says the AI engine is "OpenAI (GPT-4o-mini)", and `:19/:36` list `OPENAI_API_KEY` — all three contradict the code (Next 16, Gemini, `GEMINI_API_KEY`). An operator following the README will configure the wrong secret and see the 500 in §1.
- **The harvester runs on every push to `main`** (`harvester.yml:4-5`) in addition to the daily cron, meaning any merge to production triggers a live scrape with service-role credentials against production data.
- **`.gitignore` double-lists `.vercel`** (`:40` and `:46`).

---

## 10. Prioritised implementation roadmap

Sequenced so the app is runnable at every step. Nothing here requires a rewrite or a stack change. Estimates are of *my* edits, not of your review time.

### Phase A — Make it buildable, truthful, and safe (do first; blocks everything)

**A1. Restore reproducible configuration.**
- Add a committed `.env.example` (names only) listing all nine variables from §9, and add a `!.env.example` negation to `.gitignore`.
- Fix `lib/supabaseClient.ts` to fail with a clear message instead of crashing page-data collection; read env lazily or guard the export so `/api/analyze` can be collected without values.
- Correct the README's framework and AI-engine claims (`Next.js 16.2.6`, Gemini, `GEMINI_API_KEY`).
- *Acceptance:* `git clone && npm ci && npm run build` succeeds with no secrets present; `npm run lint` exits 0; `npx tsc --noEmit` still exits 0.

**A2. Put a real authentication and rate-limit gate on `/api/analyze`.**
- Validate the Supabase JWT server-side (`Authorization` header → `supabase.auth.getUser(token)`) and derive `userId` from the verified session — never from the body. Reject when `userId` from the token ≠ `dataset` owner (check ownership in the DB, don't trust the id).
- Enforce a max request size and max row count *before* the AI call; add a timeout/`AbortSignal`; add per-user rate limiting.
- Return distinct, logged error classes (missing key / provider 4xx / provider timeout / quota) with a generic client message.
- *Acceptance:* anonymous `curl -X POST /api/analyze` → **401**, not 500; a request >N rows or >M KB → 413; expired/foreign token → 403; a unit test covers each branch; a load test of 20 anonymous requests in 10 s is rejected.

**A3. Remove every fabricated fact from user-facing surfaces.** This is the highest-value work for an incubation panel, because it is what they will probe.
- Delete the fabricated chart series in `CountrySection.tsx:28-60` and `pdfExport.ts:48-110`; render real values or render an explicit "no numeric series stored for this dataset" empty state. (A12 — storing parsed rows — is what eventually lets these be real.)
- Rename "SECURE CRYPTOGRAPHIC REPORTING SYSTEM" / "Authorized System Code" / `Encrypting…` / `OFFICIAL SIGNATURE (DIGITAL PROXY)` to what they are: a reference id and a report footer. If signing is wanted, implement it properly server-side with a real HMAC over the report body.
- Remove the hardcoded "Strategic Recommendations" and "Step-by-Step Resolution Guidelines" (`CountrySection.tsx:165-198`, `pdfExport.ts:238-242`), or label them "Generic guidance, not derived from your data".
- Fix the misleading numbers: `DatasetTable.tsx:120-123` derive Status from whether an insight exists; `dashboard/page.tsx:98,161` fetch and show the real insight count; `analytics/page.tsx:114,125,136` never show `14.2K/12,400/89%` outside a clearly watermarked demo context.
- Reduce `identifyOpportunities` (`comparison.ts:105-125`) to return `[]` when no real data exists, and let the existing empty state render.
- *Acceptance:* a grep for the removed constants returns nothing; on a real (non-demo) account with one uploaded dataset, **every** visible number traces to either a DB row or an AI field; no surface uses "real-time", "live", "verified", "encrypted", or "cryptographic" unless it is demonstrably that.

**A4. Correct the marketing claims to match the build.**
- Replace "14+ African markets" with the true coverage (3 regions today), or state it as a target with a date.
- Remove or build: pricing plans (§3.5), the chat assistant's "AI Powered" label, `ComingSoonModule`'s "AI Core: Ready / Security: Encrypted" chips, the homepage's team-privacy and "24/7 / autonomous / live alerts / multilingual data processing" claims, and "100% Data Privacy Guaranteed".
- Either wire the contact form to a real destination (Supabase table + notification) or remove it.
- *Acceptance:* a claims table in this document maps each marketing sentence to the code that proves it, with anything unprovable removed; no `<a href="#">` or no-op `onClick` remains.

**A5. Publish the AI's data provenance.**
- On every insight card, chart, PDF, and climate/market surface: source, capture time, model/provider, whether values are measured vs inferred, and the update cadence.
- Stop presenting the simulated NDVI (`environment_enricher.py:72-75`) and the placeholder rainfall baseline (`:58`) as measurements; label NDVI as a derived index or remove it until real satellite data is wired.
- *Acceptance:* no derived value appears without a source label; the NDVI column is either real or renamed and caveated.

### Phase B — Data layer integrity

**B1. Adopt version-controlled migrations.** Move the seven loose `harvester/*.sql` files into `supabase/migrations/000N_*.sql`, add `datasets`, add the storage-bucket + policy definitions as SQL, and **verify against live with `supabase db pull` before writing the baseline** so the migrations describe reality. Never run destructive statements (`recreate_view.sql:4` `DROP VIEW`) without a stated backup/rollback plan and your approval.
- *Acceptance:* one command reproduces the full schema from an empty project; production matches it; RLS policies for every exposed table live in version control.

**B2. Resolve the `insights` conflict.** One table, one schema, with `user_id`, `dataset_id`, `summary`, `risk_level`, `trend`, `cross_border_opportunity`, `source`, `generated_by`, `created_at`. Pipeline rows get an explicit system ownership (`source = 'harvester'`, `user_id is null`) and the app queries them by `source` instead of by user. Add `NOT NULL` where the UI dereferences (`risk_level`, `trend`), FK `insights.dataset_id → datasets.id`, and indexes on `(user_id, created_at desc)`, `(dataset_id)`, `(source, created_at desc)`.
- *Acceptance:* `analytics`, `insights`, and `comparison` pages render pipeline insights *and* user insights correctly, distinguished by label.

**B3. Store parsed rows; keep the file as provenance.** Persist uploaded rows (a `dataset_rows` table or JSONB column, bounded) so charts and AI prompts can be rebuilt from stored data, and so the CSV is parsed once (`UploadCard.tsx:59` + `:115`).
- *Acceptance:* an insight can be regenerated from stored data without re-uploading; a real dataset produces a chart with real numbers.

**B4. Fix country attribution.** Replace the hardcoded `country: 'Global'` (`UploadCard.tsx:104`) with a user-selected country (validated against a server-side list), and make `Dataset.country` nullable in types where the DB is nullable.
- *Acceptance:* after upload, "Countries Covered", the region selector, and `compareCountries` all reflect the true country; a real user can produce real comparison rows.

**B5. Make pipeline ingestion verifiable.** Replace positional `cells[4]` scraping with header-keyed extraction; add a conflict target for the `upsert`; store `raw_row` + `source_url` + `captured_at`; emit a hard failure when zero rows parse; make FX conversion record which rate was used and whether it was a fallback; add a real arbitrage computation (two named markets, one commodity, transport + tariff as *stated assumptions*, both rates shown) instead of `price - 150`.
- *Acceptance:* a fixture-based test per source proves correct column mapping; a source layout change fails loudly instead of silently writing wrong prices; every published `price_usd_per_mt` carries its rate and its provenance.

**B6. Make privacy real, then claim it.** Private `datasets` bucket with per-owner policies; serve files through short-lived signed URLs instead of `getPublicUrl` (`storage.ts:22-24`).
- *Acceptance:* a request for user A's file as user B or anonymously is rejected; the signup page's RLS promise is backed by a committed policy and a test.

### Phase C — Feature completion

**C1. Password recovery:** `/forgot-password` + `/reset-password` using `resetPasswordForEmail` and `onAuthStateChange`; handle `session === null` after signup (confirm-required vs instant) explicitly instead of a blind 2 s redirect.
- *Acceptance:* a user who forgot their password can self-recover end-to-end; a signup under email-confirmation produces correct guidance and does not land in a broken dashboard.

**C2. Roles and profiles:** `profiles` table synced from `auth.users`, `role` enum (`farmer`, `analyst`, `admin`), RLS keyed on it; enforce on the server, and delete the fake "Authorized Profile" picker (`ExportButton.tsx:13-17`).
- *Acceptance:* an admin action by a non-admin is rejected at the DB/API layer, not hidden in the UI.

**C3. Wire the harvester into the product** (or remove the pipeline): a real Market Prices module reading `unified_market_intel` with freshness, source, and caveats; a real Climate Monitor reading `environmental_data`.
- *Acceptance:* dashboard shows harvested prices with capture time and source; the daily cron's output is visible or the cron is disabled.

**C4. Complete the analysis round trip:** persist `crossBorderOpportunity`, add retry/re-analyze on failure, add dataset delete (call the existing `deleteDataset`, plus the storage object), add pagination + sorting to `DatasetTable`.
- *Acceptance:* a failed analysis is visibly retryable; a user can delete their dataset and its file; lists paginate.

**C5. Fix the real bugs:** remove `Buffer` from client paths (use `btoa`); null-guard `risk_level`/`summary`/`trend` at every dereference; unify the two `getUserInsights` into one exported function; give the Recharts containers explicit sizes; resolve the chat-vs-sidebar floating-button collision; move the `new Date()` out of render in `ChatAssistant.tsx:52`; set `insightsCount` correctly on the dashboard.
- *Acceptance:* `eslint .` reports 0 errors; the chart warnings are gone from the console; export works with no `Buffer` reference.

**C6. Delete dead code:** `services/api.ts`, `components/ui/button.tsx`, and the unused `openai`, `axios`, `sonner`, `@lottiefiles/dotlottie-react`, `@shadcn/ui` deps; move `shadcn` to `devDependencies`; add `harvester/__pycache__/` to `.gitignore` and remove the committed `.pyc`.
- *Acceptance:* `npm audit`'s dependency graph shrinks; nothing in the repo returns an unused-export search hit.

### Phase D — Hardening and QA

**D1. Security headers** in `next.config.ts`: CSP (`self` + explicit `verbatim scripts`/`wasm-unsafe-eval` for Google Translate, `https://*.supabase.co`, `https://api.googlecontent.com`), `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `frame-ancestors 'none'`, `Permissions-Policy`, `referrerPolicy` on outbound links. Tighten CORS if the `*` is self-configured.
- *Acceptance:* securityheaders.com returns ≥ A; CSP in Report-Only with zero violations, then Enforce.

**D2. CI for the app:** a workflow running `npm ci`, `tsc --noEmit`, `eslint .`, `next build`, plus a dependency audit; branch protection on `main`; stop running the harvester on push.
- *Acceptance:* a PR that breaks the build cannot merge.

**D3. Dependency remediation:** `npm audit fix` for the 24 fixable findings; plan (with approval) for `next` → 16.4.3 for `sharp`, and for the `zod` findings with no fix, which requires dropping/upgrading `shadcn`/`@shadcn/ui`.
- *Acceptance:* `npm audit` reports 0 critical/high, or each residue is documented with a justification.

**D4. Test suite** — `vitest` + `@testing-library/react` for units (auth context, comparison logic, csvParser, prompts/`riskLevel` enum, PDF filename sanitiser), `@playwright/test` for critical journeys (sign up → confirm → sign in → upload → analyze → view insight → export; login → demo mode → read-only tour; **negative**: anonymous `POST /api/analyze` is 401; user B cannot read user A's dataset).
- *Acceptance:* coverage of the auth, upload, analyze, and export paths; CI blocks on failure.

**D5. Accessibility pass** on §8's list: `aria-pressed` on DemoToggle; `tabIndex`/`role`/`aria-label` on `AfricaMap` hotspots; `htmlFor`/`id` on contact labels; keyboard resize plus a persisted width; visible focus everywhere; `prefers-reduced-motion`; contrast fixes; `aria-live` for async results; per-route `metadata` plus OG/twitter, `sitemap.ts`, `robots.ts`.
- *Acceptance:* automated axe scan clean on `/`, `/login`, `/dashboard`, `/dashboard/insights`; a keyboard-only user reaches every interactive element; **a screen-reader user can tell demo data from real data.**

**D6. Honest demo mode:** persist `isDemoMode` to `localStorage` so it survives reload; watermark every demo card, chart, and PDF page with "DEMO DATA"; never let a demo write (make `saveDataset`/`saveInsight` throw if `user.id === 'demo-user-id'`).
- *Acceptance:* reload keeps demo state; a screenshot of any demo screen shows the watermark; a demo-mode write attempt fails and is tested.

---

## 11. Assumptions requiring your verification

These are **not** confirmed findings. I could not verify them from this machine, and I have not guessed at them.

1. **Whether production's Supabase project is healthy.** The live site's client bundle references the project ref `qaidhpvxdmrsjvdcavns`, and every browser call to it produced `ERR_NAME_NOT_RESOLVED`. **However, this machine cannot resolve `api.supabase.co` either — the whole `*.supabase.co` domain is blocked here.** So this may be entirely my network, not your production. Please run from your own shell and browser and tell me what you see:
   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" https://qaidhpvxdmrsjvdcavns.supabase.co/rest/v1/harvester_status?key=eq.last_run
   nslookup qaidhpvxdmrsjvdcavns.supabase.co
   ```
   A `401`/`404` from your side means the host is fine and my console errors are an artifact. A DNS failure from your side means the project is paused or deleted — which would explain everything.
2. **The actual live schema.** Whether `insights` has `user_id`/`dataset_id`, whether `datasets` exists as README describes, what RLS policies are attached, and whether the `datasets` storage bucket is public. `supabase db pull` (or the SQL below) is authoritative. Nothing in the repository proves the production state.
   ```sql
   SELECT table_name, column_name, is_nullable, data_type
     FROM information_schema.columns
    WHERE table_schema='public' ORDER BY table_name, ordinal_position;
   SELECT tablename, policyname, permissive, roles, cmd, qual
     FROM pg_policies WHERE schemaname='public';
   SELECT relname, relrowsecurity FROM pg_class
     WHERE relname IN ('datasets','insights','market_intelligence','harvester_status');
   SELECT id, name, public FROM storage.buckets;
   ```
3. **Why `/api/analyze` returns 500.** Either `GEMINI_API_KEY` is unset in Vercel, or `gemini-1.5-flash-latest` has been retired on the Gemini API (the model name is already deprecated). Both produce the identical generic message because `services/ai.ts:65` flattens every error. Distinguish them by checking Vercel's env-var *names* (not values) and the Vercel function logs for the `console.error` at `services/ai.ts:50`.
4. **Whether email confirmation is enabled.** Determines whether `app/signup/page.tsx:66-67`'s blind 2-second redirect is a cosmetic issue or a broken onboarding.
5. **Google Translate support for `rw` (Kinyarwanda) and `sg` (Sango).** If unsupported, the language menu offers two dead options.
6. **Whether `market_intelligence` has a unique constraint backing the harvester's `upsert`.** `main.py:30` calls `upsert` with no conflict target; without a constraint this inserts duplicates daily.
7. **Whether the harvester is currently succeeding.** Its GitHub Actions run history is authoritative; its output cannot be observed from the web app because nothing reads it.
8. **Whether the deployed Vercel build supplies build-time Supabase env vars.** It evidently does (the site is live and prerendered), but the repo cannot reproduce that, and `X-Vercel-Cache: HIT` with `Age: 11234154` (~130 days) suggests the deployed HTML is very stale relative to `main`.
9. **Whether `Access-Control-Allow-Origin: *` on live responses is your configuration or Vercel default.** `next.config.ts` sets nothing.
10. **Which of `setup_normalization.sql` vs `recreate_view.sql` is actually applied** — they define the same view differently, and the answer changes every derived price.
11. **Whether the pitch deck's numbers** (`C:\Users\lenovo\Downloads\NEXUS AGRIRISE PITCH DECK.pdf`) match what the platform currently does. Not read for this audit; worth reconciling before a panel Q&A.

---

## Appendix A — routes audited

Build output enumerated 23 routes. Pages: `/`, `/about`, `/contact`, `/pricing`, `/services`, `/testimonial`, `/login`, `/signup`, `/icon.svg`, `/api/analyze`, and `/dashboard` with `analytics`, `audit`, `climate`, `comparison`, `forecasts`, `insights`, `map`, `security`, `settings`, `upload`. Placeholders: `audit`, `climate`, `forecasts`, `map`, `security`.

## Appendix B — commands actually run

| Command | Exit | Outcome |
|---|---|---|
| `git ls-remote https://github.com/Newaznezif/nexus-agririse` | 0 | repo reachable, single branch `main` |
| `git clone … NexusAgririse` | 0 | 25 top-level entries |
| `npm install --no-audit --no-fund` | 0 | 551 packages |
| `npx tsc --noEmit` | 0 | no type errors |
| `npx eslint .` | 1 | 16 errors, 62 warnings |
| `npm run build` | 1 | `Error: supabaseUrl is required` (`/api/analyze` page-data collection) |
| `npm run build` (placeholder env) | 0 | 23 routes, 22 static + 1 dynamic |
| `npm audit` | 1 | 27 vulnerabilities: 2 critical, 19 high, 5 moderate, 1 low |
| `curl -i POST /api/analyze` (live, anonymous) | 0 | **500** `{"error":"AI analysis failed"}` |
| `curl -sI /` (live) | 0 | 200; HSTS present; no CSP/XCTO/Referrer-Policy/frame-ancestors; `Access-Control-Allow-Origin: *`; `Age: 11234154` |
| Browser probe (live, demo mode) | — | `typeof Buffer === "undefined"`; `og` tags 0; `canonical` absent; 13 Supabase `ERR_NAME_NOT_RESOLVED`; 2 Recharts size warnings |
| Browser: demo toggle → `/dashboard` → `/dashboard/insights` → Export PDF | — | demo renders; insight card renders `NX-AUTH-AW5ZLWRLBW8TMQ==`; export reaches "Click to Save" |
| Browser: unauthenticated `fetch('/api/analyze')` | — | 500 — confirms the handler is publicly reachable |

## Appendix C — files read in full

All 60 tracked source files were read: every page under `app/`, every component in `components/` and `components/ui/`, all 9 `services/`, both `context/` and `hooks/` modules, `lib/`, `types/`, `utils/`, `data/`, all 5 `harvester/*.py`, all 6 `harvester/*.sql`, `harvester/requirements.txt`, `.github/workflows/harvester.yml`, `package.json`, `next.config.ts`, `tsconfig.json`, `eslint.config.mjs`, `postcss.config.mjs`, `components.json`, `app/globals.css`, `.gitignore`, `README.md`, `AGENTS.md`.
