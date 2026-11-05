# Phase 3 — real report data inside `/dashboard/insights`

What Phase 3 wired, what it deliberately did not wire, and every synthetic figure that is still on
screen. Phase 2 built the contract and the orchestrator
([`REPORT_DATA_ARCHITECTURE.md`](REPORT_DATA_ARCHITECTURE.md)); this document covers the call site.

## Files

| File | Role |
| --- | --- |
| `lib/report/request.ts` | The wire grammar: parameter names, ranges, refusals. Imported by the browser **and** the route. No `next/server`, no `lib/data/api`. |
| `app/api/report/insight-data/route.ts` | Unchanged behaviour, now delegating query parsing to `parseReportQuery`. Auth first, `private, no-store`, identity from the confirmed token only. |
| `hooks/useReportBundle.ts` | Reads the caller's own Supabase session, sends `Authorization: Bearer <token>`, keeps the whole bundle, aborts a superseded request. Fetches only when the farmer presses Build. |
| `lib/report/reportState.ts` | The six UI states, mapped from `meta.coverage`. Pure, so the harness can assert it against real bundles. Phase 4 added `describeInsights` beside it. |
| `components/report/InsightReportPanel.tsx` | The panel: scope chips, inputs, states, per-section evidence with full provenance, source register, warnings, attribution line. Phase 4 added `InterpretationBlock` inside it. |
| `app/dashboard/insights/page.tsx` | Two added lines: the import and `<InsightReportPanel />` between the header and the existing split pane. Nothing else moved — until Phase 4's Step 0, which is the page's auth/loading state and is documented in [`AI_EVIDENCE_GROUNDING.md`](AI_EVIDENCE_GROUNDING.md). |
| `components/data/ProvenanceLabel.tsx` | `KIND_LABEL` is now exported so the register uses the same value-kind words as the rest of the dashboard. |

## The flow

```
scope chip (Market | Region | National | My coordinates)
  → one selector per request          lib/report/request.ts :: buildReportQuery
  → GET /api/report/insight-data?…    Authorization: Bearer <caller's own session token>
  → parseReportQuery(url.search)      same module, same messages
  → buildReportBundle(… + caller)     nine read-only connectors
  → { ok, data: ReportBundle }        private, no-store
  → describeReport({loading,error,bundle})
  → panel: idle · loading · ready · partial · no-data · error

  → POST /api/report/insights with the same scope  (Phase 4: the interpretation, from a bundle
  → describeInsights(…)                            the server re-reads; see AI_EVIDENCE_GROUNDING.md)
```

## Two decisions worth stating

**GET, not POST.** The brief named `POST /api/report/insight-data`. The route that Phase 2 shipped
and verified is `GET`, and the brief also requires using "the route's actual request schema" — the
second instruction is the binding one, so Phase 3 calls `GET`. A report is a read: it writes no
record and runs no sync, which `GET` states in the verb itself. `POST` to this route returns `405`
(asserted in the harness). If a later phase needs a request body — a saved report, a batch — that
should be a new write route, not this one wearing a method it does not implement.

**One validator, both sides.** `buildReportQuery` and `parseReportQuery` live in the same module the
route imports. The panel therefore cannot send a field the route ignores, cannot send a lone `lat`,
cannot exceed a range without it being clamped the same way twice, and cannot name an author:
`caller` is not in `ReportQueryInput` (`Omit<ReportRequest, 'caller'>`), so the only identity the
bundle ever carries is the one `verifyCaller` read from the token. The harness asserts the round
trip, the four refusal messages verbatim, the clamps, and that the route source contains no second
parser.

## Scope selection is narrower than the route's grammar

`resolveScope` resolves by precedence (`marketId → market → region → coordinate → national`). A
picker that quietly kept an old region while the user switched to a market would send both and get
whichever the route preferred — the label on the page and the scope of the evidence would disagree.
So the panel sends exactly one selector (`given()` branches on the chip), and the harness counts
selectors per scope (`1 · 1 · 0 · 1`).

- **Region** list comes from `/api/data/locations` `regionNames`, which the harness proves is
  *exactly* `knownRegions()` — the set the report accepts. A region that cannot be filtered is not
  offered, so an unfilterable spelling can never be selected.
- **Market** list is the publisher's own place table; a report can only name a town WFP surveys.
- **My coordinates** is the same picker's typed box. Choosing a coordinate moves the chip to
  *My coordinates*, because a point between markets has no price row: the market section then prints
  the bundle's own reason instead of the nearest town's price.
- **National** offers no location and says why the point products will report a gap.

## The six states

| State | Trigger | What the panel prints | What it must not print |
| --- | --- | --- | --- |
| `idle` | nothing requested yet | one line saying no bundle exists | any figure, any count |
| `loading` | a request in flight — including a second request while the first bundle is still in hand | "Reading the publishers. Each source answers on its own schedule." | the previous bundle's data as if it were current |
| `ready` | every section `ready` | the bundle's own scope line, tables, provenance, register | a smoother summary than the sources gave |
| `partial` | ≥1 section answered, ≥1 did not | counts of what answered, plus each gap's reason | a total that hides the missing source |
| `no-data` | every section `unavailable` | each section's `unavailableReason` and "Nothing here is a substitute." | a placeholder, a zero, a cached figure |
| `error` | the route refused or the network failed | the route's `code` + `message` verbatim | a rewritten reason, or a silent retry |

`describeReport` passes `section.evidence`, `meta.sourceRegister` and `meta.warnings` through as the
**same object references** the bundle holds — not reshaped copies. The harness asserts reference
identity, which is the only assertion that actually proves nothing was stripped on the way to the
screen: `observedAt`, `retrievedAt`, `valueKind`, `units`, `coverage`, `spatial`, `stale`,
`servedFromCache` and `license` all reach the register table because the register *is* the bundle's.

## Honesty rules carried through the client

- **No invented strings.** Every sentence in the results block is either a status label or text
  taken from the bundle (`unavailableReason`, `scope.note`, `warnings[].message`, `demoNotice`,
  `attribution.note`). The harness asserts that every `YYYY-MM-DD` appearing anywhere in the mapped
  view also appears in the bundle JSON, so the panel cannot stamp a date a publisher did not give.
- **Demo separation.** `mode` follows the app's demo workspace toggle (`useDemoMode`), so a
  demo-session report is built in demo mode, carries `meta.demoNotice`, and the panel prints it in a
  labelled amber block above the figures. A production bundle's `demoNotice` is `null` — asserted.
  Demo mode does not change the data path: the same nine live connectors are read, which is exactly
  why the notice is needed rather than a different renderer.
- **Never a regional label on a national figure, never a point on a region.** The region scope line
  prints `"<Region> — read at <market centre>"` and carries `scope.note` verbatim, which states that
  climate and NDVI are point observations, not regional averages. Coordinate scope prints no price
  row at all.
- **No pixel averaging.** The panel reports NDVI as the sampled composites and band labels the
  bundle holds; it computes no regional statistic (the mapper has no averaging code to call).
- **No boundary or hydrology map.** Unchanged from Phase 2: the `licensing` warning is printed in
  the warning list, and nothing embeds those services.
- **No simulated authorisation.** The attribution line prints `Verified session: <email>` only when
  `attribution.verified` is true — which only the route's confirmed token can cause. With `caller`
  null the panel prints the bundle's own refusal note. There is no signature block and no `NX-AUTH`
  code in the panel; those live in the still-synthetic components listed below.
- **Read-only, always.** The panel issues one `GET`. No mutation, no sync call, no Supabase write.
  The only credential that crosses the network is the caller's own access token, in a header the
  server discards after verifying it.

## What is still synthetic (Phase 5b must remove or replace)

The panel is real; the components around it are not yet. Measured against the current files:

| Location | What it fakes |
| --- | --- |
| `components/CountrySection.tsx:28-48` | `getTrendData()` — six literal bars per `insight.trend` string; no price row is read |
| `components/CountrySection.tsx:50-60` | `getRiskData()` — three pie slices derived arithmetically from the `risk_level` string (`riskVal = 20/45/75`) |
| `components/CountrySection.tsx:62` | `NX-AUTH-…` "auth code" from a base64 slice of the insight id — not a signature |
| `components/CountrySection.tsx:76` | "SECURE CRYPTOGRAPHIC REPORTING SYSTEM" |
| `components/CountrySection.tsx:165-169` | three hardcoded strategic recommendations, identical for every report |
| `components/CountrySection.tsx:188-192` | three hardcoded "step-by-step" guidelines |
| `components/CountrySection.tsx:218-219` | "Digitally Signed By" over a fixed name |

This table used to carry ten more rows, all of them in the PDF. **Phase 5 removed them** — the
histogram built from `[40, 50, 45, 60, 55, 70]`, the pie built from `riskVal = 20/45/75`, the
"AUTHORIZED BY" line, `NX-AUTH-…` on the cover, and the two synthetic chart placements are gone from
`services/pdfExport.ts`, and `scripts/pdf-checks.mjs` now asserts against the renderer's source that
they stay gone. What remains above is dashboard-only: nothing in that table is reachable from the
report bundle, the bundle cannot produce any of it, and the panel does not display it. Phase 5b
replaces the dashboard's figures with the same bundle the panel already shows.

## Verification

- `node scripts/check-report-data.mjs --base http://127.0.0.1:3100` → **6966/6966 assertions
  passed** (Phase 2's cases plus: the query round trip for all four scopes and demo; the four
  refusal messages; clamping on both sides; a lone coordinate never sent; blank names dropped; the
  120-character cap where the route applies it; no identity field on the wire; the route source
  holding no second parser; `describeReport` mapped against five real bundles with the expectation
  recomputed from section statuses; provenance/register/warning reference identity; row and
  non-null-point counts recomputed; `no-data` from a synthesised all-unavailable bundle; national
  scope claiming no market; region scope naming its anchor; demo notice carried; `regionNames ===
  knownRegions()` over HTTP; `POST` → `405`; unauthenticated `GET` → `401`).
- `npx tsc --noEmit` clean. `npm run build` clean; `/dashboard/insights` still prerenders.
- `npx eslint` on the seven touched files: no errors, no warnings. (`app/dashboard/insights/page.tsx`
  keeps two pre-existing `react-hooks` errors in code Phase 3 did not touch.)
- **Client bundle check:** the panel's text appears in `.next/static/chunks/…`, while
  `buildReportBundle` and `verifyCaller` appear in **no** client chunk — the orchestrator and the
  token verification stayed server-side. No Supabase URL or JWT is inlined in any client chunk
  built on this machine (nothing was configured to inline).

## Not verified, and why

**The panel has not been exercised in a browser against a real bundle.** Two environment facts on
this machine, both measured:

1. There is no `.env.local` (only `.env.example`, whose values are deliberately empty), so
   `NEXT_PUBLIC_SUPABASE_URL` / `_ANON_KEY` are unset. `/api/report/insight-data` therefore answers
   every caller `401`/`503`, and no Supabase session exists for the client to present. Deny-by-default
   is the correct behaviour; it also means the authenticated success path cannot be reached here.
2. The in-app browser surface is hidden (`visibilityState: hidden`, screenshot refused), so
   framer-motion content does not mount and no visual check was possible even for the signed-out
   shell.

Related finding, recorded here as a defect and now fixed: with no session, `/dashboard/insights`
rendered `Syncing Intelligence Streams…` indefinitely — `fetching` started `true` and `fetchData()`
returned early when `!user`, so the page neither redirected nor revealed the panel. Phase 4's Step 0
resolved it (spinner gate `loading || fetching || (user && !fetched)`, plus a stated signed-out block
with a link to `/login`); see *Step 0* in
[`AI_EVIDENCE_GROUNDING.md`](AI_EVIDENCE_GROUNDING.md). The assertion that a signed-out first paint
carries no spinner text is part of the `--base` harness run.

To complete the browser verification, on a machine with the project's `.env.local`:

```
cd C:\Users\lenovo\NexusAgririse
npm run dev -- --port 3100
```

then sign in at `http://localhost:3100/login`, open **AI Insights**, and in *Evidence report data*:
pick Market (a town from the list) → Build; switch to Region and build; switch to National and build
( climate/satellite must appear as gaps, not zeros ); type a coordinate outside any market and build
( the market section must refuse ); sign out in a second tab and build ( the panel must state
`auth_required`, not "no data" ).

## Open items this phase leaves

- The panel shows chart *summaries* (title, point count, units, spatial basis, or the reason it is
  not plotted) rather than recharts plots: drawing the bundle's series is Phase 5's renderer work,
  and adding a second chart implementation here would have been the "unrelated UI refactor" the
  brief forbids.
- `marketId` scope is accepted by the route and validator but not offered in the UI; the market chip
  sends the publisher's name, which resolves to the same place.
- ~~Phase 4 will fill `bundle.findings`~~ — it did not, and deliberately so. The interpretation is a
  separate `InsightsPayload` from `POST /api/report/insights`, rendered by `InterpretationBlock`
  inside this panel; the bundle stays a read that stands alone when no model answers. Phase 4's gate,
  failures and verification are in [`AI_EVIDENCE_GROUNDING.md`](AI_EVIDENCE_GROUNDING.md).
