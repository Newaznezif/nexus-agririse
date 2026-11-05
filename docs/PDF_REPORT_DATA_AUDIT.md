# PDF Report Data Audit — Phase 1

Scope: read-only inspection of the Insights PDF pipeline plus live read-only probes against
Production (`https://nexus-agririse.vercel.app`, deployed commit `19116b7`). No file in this
audit was modified, no SQL executed, no sync triggered, no secret read.

Probe timestamps: `2026-11-02T08:08Z` – `2026-11-02T08:12Z` (all responses `GET`, anonymous).

---

## 1. The actual PDF data flow today

```
user CSV upload ──► public.datasets (name, country, type, file_url)
        │
        └─► POST /api/analyze (app/api/analyze/route.ts)
                └─► services/ai.ts: first 50 rows → JSON string → Gemini prompt
                        └─► { marketSummary, riskLevel, priceTrend, crossBorderOpportunity }
                                └─► saveInsight() → public.insights (summary, risk_level, trend)

/dashboard/insights (app/dashboard/insights/page.tsx:40-48)
        getUserDatasets + getUserInsights → currentInsight / currentDataset
                └─► CountrySection (components/CountrySection.tsx)
                        └─► ExportButton → generatePDFReport(dataset, insight, name, role)
```

Inputs available to the PDF, in full (`types/index.ts:6-24`):

| Field | Type |
|---|---|
| `Dataset` | `id`, `user_id`, `name`, `country`, `type`, `file_url`, `created_at` |
| `Insight` | `id`, `user_id`, `dataset_id`, `summary` (text), `risk_level` (`Low\|Medium\|High`), `trend` (text), `created_at` |

**Finding P-1 (structural).** The PDF receives **no numeric data at all** — not one measurement,
not one price, not one coordinate. Two strings (`summary`, `trend`), one label (`risk_level`) and a
free-text country name are the entire evidence base. That is why every number printed in the report
must be invented: `services/pdfExport.ts` has nothing real to print. It is a type-level gap, not a
coding lapse, so it cannot be fixed inside `pdfExport.ts` alone.

**Finding P-2 (the two data worlds never meet).** The verified connectors (`lib/data/*`, exposed as
`/api/data/*`, rendered on `/dashboard/climate` and `/dashboard/map`) and the Insights/PDF pipeline
are disjoint. Nothing in the PDF path reads a connector, and no route composes them.

## 2. What is real vs synthetic in the current artefacts

| Location | Content | Classification today |
|---|---|---|
| `services/pdfExport.ts:48-71` | Histogram `[20,35,45,65,80,95]` / `[95,80,65,45,35,20]` / `[40,50,45,60,55,70]`, chosen by substring-matching `insight.trend`, x-axis labels `T-5…T-0` | Synthetic, captioned **"Trend Progression (Real-Time)"** |
| `services/pdfExport.ts:74-110` | Pie "Risk Impact / System Integrity / Market Stability" = `20/45/75` from the risk label, remainder split `0.6/0.4` | Synthetic percentages presented as an "Impact Allocation" |
| `services/pdfExport.ts:224` | Table row `['Impact Analysis', … , 'VERIFIED']` | Unverified claim of verification |
| `services/pdfExport.ts:238-242` | Three fixed recommendation paragraphs, identical for every report | Static prose presented as derived strategy |
| `services/pdfExport.ts:147,269` | `NX-AUTH-<base64(insight.id)>`, "Authorized Validation", signature line | Decorative; base64 of a UUID is not a signature |
| `components/CountrySection.tsx:27-60` | Same histogram + same risk pie (comment on :27 says "MOCK DATA FOR CHARTS") | Synthetic, headlined "Real-Time Trend Distribution" (:112) |
| `components/CountrySection.tsx:164-199` | Three fixed recommendations + three fixed steps, incl. "sub-30% risk impact" and "high-volatility T-0 indicators" | Synthetic jargon, no data behind it |
| `components/CountrySection.tsx:76,218-220` | "SECURE CRYPTOGRAPHIC REPORTING SYSTEM", "Digitally Signed By Augustin Nkundimana" | Not a real control |
| `components/ExportButton.tsx:13-17,109-113` | `AUTHORIZED_PROFILES` dropdown, "Authorized Profile" | A display name, not authentication. `generatorName` from the page is `user.email` (`insights/page.tsx:160`) and is not what gets printed |
| `components/ExportButton.tsx:133` | Button label "Encrypting…" | Nothing is encrypted; the 800 ms `setTimeout` (:58) only pretends to work |
| `data/demoInsights.ts:9,19,29` | "risen 14% quarter-on-quarter", "supply gap of ~180,000 MT", "FOB USD 920/MT", "USD 4.2M annually", "processing capacity covers only 12%" | AI-authored prose, indistinguishable once in the PDF |

**Finding P-3.** `services/pdfExport.ts:214-216` prints `insight.summary` verbatim. In Demo Mode the
summary is `data/demoInsights.ts` (fabricated figures), and in real mode it is Gemini output whose
numbers are not checked against any source. The PDF has no `isDemoMode` input at all
(`ExportButton`/`generatePDFReport` signatures), so a demo report is byte-for-byte claimable as
production intelligence. Requirement 9 of the brief is currently unsatisfiable.

**Finding P-4 (region).** Region resolution is `dataset.country`, a free-text string from an uploaded
file name. Demo data alone spans `Ethiopia`, `Rwanda`, `Central African Republic`
(`data/demoDatasets.ts:8,17,26`). Every verified connector is Ethiopia-scoped (`/api/data/locations`
answers 11 `regionNames`: Addis Ababa, Afar, Amhara, B. Gumuz, Dire Dawa, Gambela, Harari, Oromia,
SNNPR, Somali, Tigray). There is **no** country/region → coordinate or admin-code resolution step
anywhere in the Insights path.

## 3. What Production actually returns right now (measured, read-only)

All routes answer with the envelope `{ ok, data, provenance }` or `{ ok:false, error, provenance }`
(`lib/data/types.ts:63-65`). `Provenance` (`types.ts:29-51`) already carries `source`, `sourceUrl`,
`endpoint`, `license`, `retrievedAt`, `observedAt`, `valueKind`
(`observed|modeled|forecast|estimated|imputed`), `units`, `methodology`, `quality`, `coverage`,
`maxAgeSeconds`, `stale`, `servedFromCache`. **The provenance machinery the brief asks for already
exists and is populated.**

| Route (GET) | Measured result | valueKind | observedAt | stale |
|---|---|---|---|---|
| `/api/data/status?sources=light` | 4 sources `connected`: Open-Meteo, NASA POWER, NBE, NASA GIBS | — | per source | false |
| `/api/data/locations` | 65 places + 65 markets with `latitude/longitude/admin1/marketId`; `default` = Addis Ababa (480, 9.02, 38.75); 11 `regionNames` | — | — | — |
| `/api/data/weather?lat=9.02&lon=38.75&days=7&pastDays=45` | 52 daily rows, **46 past + 6 forecast, each row flagged `isForecast`**; `current` block; `elevationM` 2379; precipitation/temp/RH/wind/ET0 per day | `forecast` (whole payload) | 2026-11-02T11:00 | false |
| `/api/data/agroclimate?…&days=180` | 180 daily modeled points (**2 trailing null days** — publication lag, preserved not filled); 36 normals (12 months × PRECTOTCORR/RH2M/T2M); `annualNormalMmPerDay` 2.96 | `modeled` | 2026-11-01 | false |
| same, `derived` | **Real computed rainfall anomaly**: period 2026-05-06→2026-11-01, observed 1360.4 mm vs expected 855.1 mm, **+59.1 %**, daysWithData 178/180, `sufficientCoverage:true` | `estimated` (correctly labelled derived) | — | — |
| `/api/data/markets?mode=overview` | 10 grain commodity groups, e.g. Teff (white) 14,068.33 ETB/100 KG across 12 markets | `observed` | **2026-07-15** | **true** |
| `/api/data/markets?mode=snapshot&limit=6` | 10 rows with `observedOn, market, marketId, admin1, admin2, latitude, longitude, commodity, unit, currency, price, usdPrice, retail, priceFlag:"actual"` | `observed` | 2026-07-15 | true |
| `/api/data/markets?mode=history&commodity=Teff (white)` | **960 dated observations, 2020-04-15 → 2026-07-15**, all `priceFlag:"actual"`, unit `100 KG`, currency ETB | `observed` | 2026-07-15 | true |
| `…&market=Addis Ababa&months=24` | 20 rows for that market only, 2020-03-15 → 2021-10-15 (**this market's Teff record stops in 2021**) | `observed` | — | — |
| `…&region=Oromia` | **`region` is silently ignored in history mode** — 960 rows spanning Oromia, SNNPR, Tigray, Addis Ababa, Amhara, Dire Dawa | `observed` | — | — |
| `/api/data/exchange?focus=official-series&points=6` | 6 daily NBE rows, 2026-10-26 → 2026-11-02, `usdToEtb` ≈ 160.99 | `observed` | 2026-11-02 | **false** |
| `/api/data/exchange?focus=unofficial` | 12 monthly points (World Bank-derived), e.g. 2025-09 → 143.82 | `estimated` | — | — |
| `/api/data/exchange?focus=benchmarks` | 3 indicators with dated observations: `PA.NUS.FCRF` 2022 51.76 / 2023 54.60 / 2024 82.60, plus CPI and agricultural growth | `estimated` | 2025-12-31 | false |
| `/api/data/geospatial?view=layers` | 3 GIBS layers with `latestAvailableDate`, `units`, `resolution`, `cadence`, `license`, own `valueKind` (NDVI `observed`, IMERG `modeled`) | mixed | 2026-11-01 | false |
| `/api/data/geospatial?view=sample&layer=VIIRS_SNPP_NDVI_8Day&lat=9.02&lon=38.75&date=2026-10-21` | **Real pixel value NDVI 0.3038**, `band "0.3001,0.3076"`, `pixelSizeMeters 604`, quality medium, plus a `layer.caveat` string that already forbids reading NDVI as yield | `observed` | 2026-10-21 | false |
| same, `MODIS_Terra_NDVI_8Day` | NDVI **0.2776**, 302 m pixel; caveat states the two sensors are not interchangeable | `observed` | 2026-10-21 | false |
| same, `IMERG_Precipitation_Rate` | `value: null`, quality **low** — honest no-data, not a zero | `modeled` | 2026-10-21 | false |
| `/api/data/geospatial?view=boundaries&level=1` | 11 ADM1 areas with `centroid`, `bbox`, polygon rings (92–132 points) | `estimated`, `observedAt: null` | — | — |
| `/api/data/geospatial?view=vectors` | 12 layers (eth-region/zone/woreda/kebele, cde-basin, …) with `vintage` and licence text | — | vintage 2020-05-19 | — |

Conclusion: climate series, rainfall anomaly vs normals, NDVI point values, real dated WFP price
series, NBE daily FX and World Bank macro indicators are **retrievable today, anonymously, with
units and provenance attached**. The report does not need the `data.*` schema, and therefore needs
no migration and no sync.

## 4. Gaps that block a real-data report

| # | Gap | Evidence | Consequence |
|---|---|---|---|
| G-1 | PDF inputs carry no numbers | `types/index.ts:6-24` | New report-data model + orchestration route required |
| G-2 | No region → coordinate resolution | `insights/page.tsx:64-73`, `locations` route exists but is unused there | Report cannot be region-aware without a resolver step |
| G-3 | `mode=history` ignores `region` | `app/api/data/markets/route.ts:27` forwards only `{commodity, market, months}` | A "regional" price chart would silently show national data |
| G-4 | Whole-series payloads are large | 960 rows = 288 KB (`bytes` measured) | Orchestrator must aggregate server-side before the PDF |
| G-5 | NDVI is one pixel, not a region | `view=sample` returns a single coordinate; no polygon aggregation exists | A regional NDVI *average* cannot be reported honestly; per-market pixels can |
| G-6 | WFP latest month is 2026-07-15, `stale: true` | provenance measured above | Report must say "as of 15 July 2026", never "current" |
| G-7 | Per-market coverage differs | Addis Ababa Teff ends 2021-10 while national ends 2026-07 | Charts must label each series' own last observation |
| G-8 | Map imagery redistribution is not licensed | `eth-region` licence reads *"Redistribution is not established"*; CDE similar | Embedding raster snapshots/PDF-attached tiles is a licensing question, not a technical one |
| G-9 | `POST /api/analyze` fails in Production | `docs/PRODUCTION_READINESS_AUDIT.md:153` (§11, `500`; `GEMINI_API_KEY` vs retired `gemini-1.5-flash-latest`) | Grounded-AI pages must degrade to a factual summary without pretending AI ran |
| G-10 | Demo Mode is invisible to the PDF | `generatePDFReport` signature, `pdfExport.ts:6-11` | Needs an explicit `reportMode` flag on the artefact |
| G-11 | No test framework | `package.json` scripts: only `node scripts/*.mjs` | "Report-data tests" means a new node harness in the existing `scripts/check-data-routes.mjs` style, not jest/vitest |
| G-12 | `services/database.ts` + `public.insights` content is unobservable from here | RLS-scoped; anonymous `*/0` | Whether any real insight exists in Production is **unknown**, not assumed |
| G-13 | Authored-person names hardcoded | `ExportButton.tsx:13-17`, `CountrySection.tsx:219`, `pdfExport.ts:275` | Cover "Authorized by" must come from the signed-in identity or be labelled as an attribution choice |

## 5. Constraints confirmed for this task

- Five security files remain uncommitted and untouched (`git status` during this audit:
  `docs/SECURITY_REVIEW.md`, `harvester/recreate_view.sql`, `harvester/setup_normalization.sql`,
  `supabase/migrations/20261027000100_market_intel_view_lockdown.sql`, `supabase/migrations/README.md`
  — all still `M`, none staged, none merged).
- No SQL, no migration, no sync, no Vercel setting change was performed, and the design above needs none.
- `GEMINI_API_KEY` / `SUPABASE_SERVICE_ROLE_KEY` were never read or printed; the Gemini key is used
  server-side only (`services/ai.ts:6`, imported only by `app/api/analyze/route.ts`).

## 6. Proposed Phase 2–5 shape (not yet implemented, awaiting approval)

1. **`lib/report/types.ts`** — `ReportBundle`: `meta` (reference, generatedAt, reportMode
   `demo|production`, scope), `scope` (resolved place/market/region with coordinates + admin ids +
   the resolver's own confidence), `sections[]` each `{ status: ready|partial|unavailable, rows,
   series, provenance, caveats[] }`, `derived[]` (each with formula + inputs), `findings[]` (each
   citing `evidenceIds`), `warnings[]`, `sourceRegister[]`. Reuse `Provenance`/`ValueKind` verbatim —
   no second provenance vocabulary.
2. **`lib/report/buildReportBundle.ts`** (server-only) — calls the existing connectors directly (no
   HTTP loopback, no duplicated fetch logic), aggregates to chart-sized arrays, and keeps
   `{ok:false}` as a section state instead of dropping it.
3. **`app/api/report/insight-data/route.ts`** — read-only `GET`, returns the bundle for a resolved
   scope; no secret, no write, RLS-safe (it exposes only what `/api/data/*` already exposes).
4. **`services/pdfExport.ts`** — same cover, border, emerald palette, typography and table styling;
   charts fed by `bundle.series`; each chart block gains title/unit/date-range/scope/source/caveat;
   a synthetic value is replaced by an honest "insufficient data" container state, never another number.
5. **Region resolution** — map `dataset.country` + insight text to `locations` markets/regions;
   if it does not resolve to an Ethiopian scope, the report says so and the section stays unavailable.
6. **`scripts/check-report-data.mjs`** — harness for full/partial/missing/stale/demo/AI-failure cases.

Open decisions that need the user before Phase 2:
- **D-1** Map/satellite imagery in the PDF: GIBS is NASA open data (citable), but the EthioAdmin/GRID3/CDE
  vector services state redistribution is not established. Include imagery, or restrict page 4 to
  numeric samples + attribution and skip embedded maps?
- **D-2** Scope of "region-aware" in phase 1 of this feature: market-level (65 catalogued markets with
  coordinates), region-level (11 regions, requires fixing G-3 first), or both?
- **D-3** Does the PDF keep the three named profiles as a display-only attribution, or drop the
  "Authorized by / Digitally signed" claims that no authentication backs?

## 7. Phase 5 as implemented

D-3 was answered by dropping the claims: the cover now prints either the confirmed session's name or
`NO CONFIRMED SESSION`, and states in the same box that a choice made in the browser has no
authentication behind it. G-10 and G-13 are closed the same way — `meta.reportMode` decides whether
`DEMO — NOT LIVE DATA` appears, and the attribution line comes from `verifyCaller`, never from a
hardcoded profile.

Two modules, and the split is the point:

| File | Touches | May write |
| --- | --- | --- |
| `lib/report/pdfDocument.ts` | nothing but `ReportBundle` + `InsightsPayload` types | every sentence about data, as a `PdfBlock` program |
| `services/pdfExport.ts` | jsPDF, the DOM, the clock | geometry only — colours, boxes, tables, lines |

The renderer holds no report vocabulary: a harness assertion reads its source and refuses it if a
contract field name (`.provenance`, `.valueKind`, `.unavailableReason`, `.rowsOmitted`, `.license`,
`.coverage`) or a clock appears there, so no date and no figure can enter the page except through a
block. The reverse holds too — the model decides what is said and never where it is drawn.

What changed about the numbers, against §2 of this audit:

- `drawHistogram(…, trend)` and `drawPieChart(…, riskLevel)` are gone, along with the `[40, 50, 45,
  60, 55, 70]` array and the `riskVal = 20/45/75` slices. A chart is drawn only from
  `ReportChart.series` points the bundle carried; when a chart has no points the chart area is kept
  and the bundle's own `unavailableReason` is printed inside it, under a dashed frame labelled `No
  chart drawn — the chart area is kept, the figure is not invented.`
- `NX-AUTH-…`, `VERIFIED`, `AUTHORIZED BY`, `Digitally Signed By` and `SECURE CRYPTOGRAPHIC REPORTING
  SYSTEM` are gone from the PDF. The cover footnote says the file is not signed, sealed or encrypted
  and that its reference is a lookup key.
- Every table cell that is `null` prints as an em dash, with a caption stating that a dash is not
  zero. Units, `valueKind`, coverage, observed date and retrieval date are printed per row group from
  the evidence item they belong to.
- A chart is drawn from every point the bundle carries, not from the shorter window the model was
  sent; its caption names the counts, e.g. `Retail price, fourteen survey months — 12 of 14 published
  points, 2 with no value (left as gaps)`. What the model was actually given is printed on the
  interpretation page from the payload's own `selection` and `truncated` fields.
- The source register is rebuilt from `meta.sourceRegister` — one row per evidence id with the
  publisher's licence, both dates, `valueKind`, coverage and state. A register field the connector
  never received prints as `not supplied` / `not stated`; nothing is inferred to fill it.

**Script coverage.** jsPDF's standard faces cannot draw Ethiopic. `services/pdfUnicodeFont.ts` loads
`public/fonts/AbyssinicaSIL-Regular.ttf` (SIL Open Font License 1.1, text in
`public/fonts/LICENSE-abyssinica.txt`) and the renderer embeds it only when the document actually
needs it — a Latin-only report stays the size it was. Characters no embedded face can draw are not
dropped and not silently replaced: they appear as `[?]` in place, and the last page lists every
affected code point (`U+062F, U+0628, U+064A` for the Arabic partner names in the test corpus) beside
the statement that no figure, unit or date is affected. The UI reports the same list.

**Cover fit.** The previous cover assumed two short lines and a two-word attribution. The title, the
`REQUESTED BY` heading and the attribution note are now measured and fitted: the title steps down
from 42 pt until it clears the column, the heading steps down from 10 pt until it clears half the
box, and the note is wrapped at 7 pt inside a box whose height is computed from the lines it
actually needed. The visual identity is unchanged — A4, a 0.5 pt `240,240,240` frame inset 10 pt, the
Emerald-600 `5,150,105` header band, `31,41,55` headings, the `249,250,251` attribution box, striped
autotables and the `Page i of n` footer.

Verification is in [`REPORT_DATA_ARCHITECTURE.md`](REPORT_DATA_ARCHITECTURE.md#running-the-checks):
`scripts/pdf-checks.mjs` is the shared oracle, `scripts/check-pdf-render.mjs` runs it over seven
deterministic bundles and writes the PDFs, and `scripts/check-report-data.mjs` runs the same oracle
over the live bundle. `scripts/render-pdf-pages.py` rasterises the pages for the layout checks that
text extraction cannot make.
