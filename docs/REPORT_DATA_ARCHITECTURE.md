# How real data reaches the AI Insight PDF

Phase 2 of the real-data report work: the report-data foundation, its contract, and what the PDF
and the AI layer are allowed to take from it. The audit that motivated it is in
[`PDF_REPORT_DATA_AUDIT.md`](PDF_REPORT_DATA_AUDIT.md), the checks are
[`scripts/check-report-data.mjs`](../scripts/check-report-data.mjs), and what Phase 4 added on top of
this contract — the evidence budget, the citation gate and the one route that spends a provider call —
is in [`AI_EVIDENCE_GROUNDING.md`](AI_EVIDENCE_GROUNDING.md).

## The path a number takes

```
/dashboard/insights ─Phase 3, live─▶ /api/report/insight-data   app/api/report/insight-data/route.ts
                                 │ confirms the caller's own token, then discards it
                                 ▼
                            resolveScope(request)           lib/report/scope.ts
                                 │ market · region · national · coordinate
                                 ▼
                            buildReportBundle(request)      lib/report/buildReportBundle.ts
                              climate      geospatial     market        economy
                            Open-Meteo    NASA GIBS     WFP rEMS     NBE + World Bank
                            NASA POWER    (3 layers)    World Bank   (rates, indicators)
                                 │ every value arrives as ConnectorResult<T>, i.e. a payload
                                 │ or an error, always with the publisher's own Provenance
                                 ▼
                              ReportBundle                 lib/report/types.ts
                                 │ one contract, two readers
                     ┌───────────┴───────────┐
                     ▼                       ▼
             buildEvidencePackage      services/pdfExport.ts
             (Phase 4, live: the AI    (Phase 5: the pages)
              text route)
```

Nothing in the middle invents a value. `buildReportBundle` calls the same read-only connectors the
dashboard already uses; it does not talk to Supabase, does not run a sync, and holds no credentials
of its own. The Gemini key never enters this path — `services/ai.ts` reads it on the server, and the
only identity the bundle can print is the one the route confirmed from the caller's token.

What is *not* connected yet, stated plainly: `services/pdfExport.ts` still renders its own synthetic
figures, so the PDF is not evidence-backed until Phase 5 replaces them. The call site is no longer
one of the gaps — Phase 3 mounted `components/report/InsightReportPanel.tsx` on
`/dashboard/insights`, which calls this route and renders the bundle with its provenance intact
([`INSIGHTS_REPORT_INTEGRATION.md`](INSIGHTS_REPORT_INTEGRATION.md)). `components/CountrySection.tsx`
— the panel beside it on that page — is still synthetic, and Phase 5b owns it.

## What fills each section

| Section | Sources called | Evidence ids | What it can refuse to do |
| --- | --- | --- | --- |
| climate | Open-Meteo forecast, NASA POWER daily, NASA POWER climatology normals | `climate.open-meteo`, `climate.power`, `climate.normals` | read a coordinate a report does not have |
| geospatial | NASA GIBS: VIIRS NDVI 8-day, MODIS Terra NDVI 8-day, IMERG precipitation rate | `geospatial.<layer>` | average pixels into a region, draw a trend on < 3 composites |
| market | WFP Ethiopia rEMS survey (snapshot + commodity history), World Bank grain overview at national scope | `market.snapshot`, `market.overview`, `market.history` | attribute a survey price to a coordinate between markets |
| economy | NBE daily indicative rates, World Bank unofficial rate series, World Bank indicators | `economy.nbe`, `economy.unofficial`, `economy.benchmarks` | present an annual indicator as a daily figure |

## The five rules that make a figure traceable

1. **One provenance vocabulary.** `lib/report/types.ts` imports `Provenance`, `ValueKind`,
   `QualityTier` and `SourceError` from `lib/data/types.ts` and defines no rival type. Freshness and
   attribution therefore mean the same thing in the dashboard, the bundle and the PDF.
2. **A value the publisher did not supply stays `null`.** Table cells may be `null`, a chart point's
   `y` may be `null`, and the harness fails the build if `null`/`undefined`/`NaN`/`''` reach the page
   as text. Missing is never zero.
3. **An empty answer is a gap, not a blank table.** `withRows` (buildReportBundle.ts:575) and the
   market snapshot's own guard turn "the source answered, but returned no rows for this scope" into a
   `no_data` error naming the scope and the month actually reached, so the section degrades to
   `partial` and the source register says `unavailable` — instead of printing a heading over nothing.
4. **Every table and chart names the scope its rows really cover**, as `spatial`
   (`single-pixel`, `grid-cell`, `market`, `region-markets`, `national-survey`), separately from the
   scope the caller asked for. A single market's price is never labelled a regional or national
   figure, and a satellite pixel is never labelled a field.
5. **Anything this application computed is a `DerivedFigure`** with a `formula`, `inputs` (other
   evidence ids) and `valueKind: 'estimated'`. The only app-computed chart today is the month-on-month
   movement bar (buildReportBundle.ts:667), whose points exist only where the publisher surveyed the
   same market, unit and price type in two consecutive months.

## Availability states

`ready` = every source the section called answered; `partial` = at least one answered and at least
one did not; `unavailable` = nothing honest to show, with `unavailableReason` and no evidence at all.
Each failed source additionally produces a `source_unavailable` warning and an `unavailable` register
line, and each stale one a `source_stale` warning. Staleness is independent of readiness — a source
can answer faithfully and still be old, which the register shows as `stale` alongside both dates:
`observedAt` (the publisher's) and `retrievedAt` (ours).

## The three approved decisions, recorded in the contract

- **Imagery:** only NASA GIBS composites are read for the report, and the geospatial section's own
  caveats state that boundary and hydrology services are excluded pending redistribution terms
  (buildReportBundle.ts:262). No ArcGIS/CDE/GRID3/geoBoundaries call appears in any bundle.
- **Granularity:** market and region scopes are supported; region prices are only shown once the
  rows the filter returns match the requested region, proven at the connector (`/api/data/markets`
  forwards `region`, and `admin1` matching is exact and case-insensitive). National data is labelled
  `national-survey` and never re-titled as regional.
- **Cover identity:** `ReportAttribution` is `{verified, displayName, note}`. It is populated only
  from a token the route confirmed. When unverified, `displayName` is `null` and the PDF must omit
  the signature block — no "Authorized by", no "Digitally Signed By", no NX-AUTH code. The reference
  `NX-REP-YYYYMMDD-XXXXXX` is a lookup key for the sources page, not a signature.

## What the PDF prints

`lib/report/pdfDocument.ts` turns a bundle and an interpretation payload into a block program, and
`services/pdfExport.ts` draws that program with the page geometry it has always had. What the pages
say:

- a table is `ReportTable.rows` under `ReportTable.columns` — field names only, never a literal value;
- a chart is drawn only when its series carries points; otherwise the chart area is kept and the
  bundle's own `unavailableReason` is printed inside it, so an empty box cannot read as a zero;
- truncation is printed as `rowsOmitted` with `omissionNote`, so a capped table cannot read as a
  complete one;
- the sources page is `meta.sourceRegister`, one line per evidence id, with licence, both dates,
  `valueKind`, coverage, `state`; a register field the connector never received prints as `not
  supplied` or `not stated` rather than a guess;
- `meta.demoNotice` prints on the cover of a demo bundle and every demo page carries the demo mode
  line, and `meta.warnings` become the data-status strip;
- an interpretation page is the model's sentences with their evidence ids, the sentences the gate
  dropped and why, and the payload's own account of which figures it was shown;
- a stored analysis record (`generatePDFReport`) is labelled as a record on every page, prints no
  source register it does not have, and never asks for the Unicode face its Latin text does not need.

The visual identity — A4, the inset frame, the emerald header band, table striping, typography — is
the layout the previous cover had. Only the source of the numbers changed. Full Phase 5 detail,
including the embedded Open Font License face and the cover fit rules:
[`PDF_REPORT_DATA_AUDIT.md`](PDF_REPORT_DATA_AUDIT.md) §7.

## Known limits, measured rather than assumed

- **Evidence budget.** `buildEvidencePackage` caps facts at 180 and allocates them round-robin across
  the evidence items that answered, then re-sorts the survivors into bundle order, so no section can
  be cut out of the AI's view by a wider one ahead of it. The cap itself is still a cap: the budget is
  shared per item rather than per section, and `truncated` names each item's `kept N of M`. Strategy
  and remaining limits: [`AI_EVIDENCE_GROUNDING.md`](AI_EVIDENCE_GROUNDING.md).
- **The series window.** `getCommodityHistory`'s `months` parameter is a row budget, not a time
  window, so a commodity series can span years the price table does not cover. The bundle states the
  span it actually prints, in the history caveats.
- **Market names are matched exactly.** Both price connectors now compare the publisher's `market`
  case-insensitively and in full (wfpMarketPrices.ts:196 and :368), after the harness caught that the
  snapshot used a substring match while the history series did not — which let a report on one town
  print another town's similarly-named prices. Partial names are resolved before filtering, by
  `findPlaceByName` against `/api/data/locations`, so the caller still types "Asayt" and gets Asayta.
- **Live source state.** Open-Meteo returned `503` for every point in the run that produced this
  note, which is why `climate` is `partial` in the sample output rather than `ready` — the case the
  harness exists to catch: the report still ships, labelled.
- **The WFP and World Bank price files are blocked at HDX's edge, and this is a publisher access
  decision, not a bug in our request.** Measured 2026-11-04 against `wfp_food_prices_eth.csv` and
  `real-time-currency-prices-for-ethiopia.csv`:
  - `curl` on this machine still gets `302` → presigned S3 → `200`, 7 944 760 bytes, `text/csv`, so
    the file is intact and the URL has not moved. HDX's own CKAN API (`/api/3/action/resource_show`)
    answers `200` from Node too, and reports the resource `active`, `url_type: upload`,
    `datastore_active: false`, size 7 944 760, `metadata_modified` 2026-11-02, MD5
    `e31994e3d8b72fb3832e9428f5a624d6`.
  - Every Node request is refused: 10 consecutive `httpText` calls returned `406` with body
    `{"error":"Blocked due to bot activity.","info":"…contact hdx@un.org…"}` or `202` with
    `x-amzn-waf-action: challenge` and a zero-byte body, alternating deterministically. Header shape
    changes nothing — `Accept: text`, `text/csv, */*`, `*/*`, none, `Accept-Encoding: identity` vs
    `gzip`, Node core `https` vs `fetch`, and even curl's own `User-Agent` all still get challenged,
    so the rule keys on the client (its TLS/HTTP shape), not on anything we send or on this IP.
  - There is no alternate publisher path: `download_url`, `alt_url` and `hdx_rel_url` all point back
    to the same blocked route, the resource is not datastore-backed (`datastore_search` → `404`),
    HDX's own `hxlproxy` CSV service is blocked the same way, and the unsigned S3 object answers
    `403 AccessDenied` (only HDX's signed redirect grants read).
  - A browser cannot fetch it for us either. The `302` hop carries
    `Access-Control-Allow-Origin: https://data.humdata.org`, so a cross-origin `fetch` from
    `nexus-agririse.vercel.app` fails CORS before the S3 response's `Access-Control-Allow-Origin: *`
    is ever reached.
  - **What we changed:** the transport now names this condition instead of guessing at it. A `406`,
    or a failed status or an empty body carrying `x-amzn-waf-action`, becomes `publisher_blocked` and
    is **not** retried (retrying is measured to change nothing, and the price file is 7.9 MB); a `200`
    that really does carry the file is still served even if that header is present, because the bytes
    are the evidence. A `2xx` that carries zero bytes becomes `empty_response`, so the connectors no
    longer report `parse_failed — Price file parsed to zero usable rows` about a file that never
    arrived. `Accept` is now a legal media range per payload kind (`Accept: text` is not one — a type
    needs a subtype), which is header correctness rather than a fix: it does not change HDX's answer.
    The card text on `/dashboard/market-intelligence` comes from these messages, so it now says the
    data is published and our server is not being allowed to download it, instead of implying WFP has
    no prices.
  - **What we did not do:** spoof a browser fingerprint, solve the WAF challenge, or route the fetch
    through a third-party proxy to get round a rule the publisher chose to apply.
  - **Restoring live price values needs a decision, not a patch.** The options are: ask HDX for
    programmatic access (their own error message gives `hdx@un.org` for exactly this case), approve a
    different publisher for Ethiopian prices knowing it changes what every price card means, or serve
    the last synced copy from Supabase once the sync has actually stored rows (it has never run here,
    so today there is no stored copy to show).
- **No persistence.** No table, migration or sync was added. Re-running a bundle re-reads the
  publishers, subject to the process cache in `lib/data/cache.ts`.

## Running the checks

```bash
cd C:\Users\lenovo\NexusAgririse
node --no-warnings scripts/check-report-data.mjs --quiet
node --no-warnings scripts/check-report-data.mjs --base http://127.0.0.1:3000   # also proves the routes
node --no-warnings scripts/check-pdf-render.mjs                                 # seven PDFs + the record
node --no-warnings scripts/check-pdf-live.mjs                                   # the same oracle over a live bundle
node --no-warnings scripts/check-http-transport.mjs                             # status/header → error rules, stubbed upstream
node --no-warnings scripts/check-market-availability.mjs                        # the market routes' four feed states, stubbed upstream
python scripts/render-pdf-pages.py                                              # pages to PNG for layout
```

The first half imports the orchestrator directly (Node strips the TypeScript types;
`scripts/ts-report-hooks.mjs` supplies the `@/` alias) and builds real bundles against the live
publishers, covering all eight cases in the brief: complete availability, partial availability,
missing climate, missing geospatial, missing market, stale data, demo mode, AI unavailable. The
`--base` half covers what only HTTP can prove — that the routes forward `region` and `mode`, that both
report routes answer an unauthenticated caller with `auth_required`, `data: null` and
`cache-control: private, no-store`, that `GET` on the insights route and `POST` on the read route both
answer `405`, and that a visitor with no session gets a stated sign-in state rather than a spinner.
A failing assertion exits 1; a run that could not reach the first builder exits 2, so a dead network is
never reported as a green build.

`scripts/check-pdf-render.mjs` is the deterministic half: it builds the seven bundles in
`scripts/pdf-fixtures.mjs` (complete, partial, stale, unavailable chart, no data, demo, a Ge'ez-script
report), renders each to a real PDF under `artifacts/pdf/`, and runs the same oracle
`scripts/pdf-checks.mjs` that the live harness runs — so a rule proven on a fixture is proven by the
same code path as on live data. Text is read back two ways: `pdftotext -enc UTF-8` for what a person
sees, and the raw content streams for what the file actually drew, which is how an unsupported
character becomes a testable `[?]` rather than a silent loss. `scripts/render-pdf-pages.py` rasterises
the pages that geometry fails on — cover, a table page, a chart page, the last page — because
overflow, clipping and a placeholder drawn over a table cannot be seen in extracted text.

`scripts/check-http-transport.mjs` is the only harness in the set that stubs the upstream, and only for
transport facts: how a status code and a header line become a `SourceError`. It pins the two conditions
HDX's edge serves today (`406`, and `202` with `x-amzn-waf-action`) as `publisher_blocked` and not
retried, a zero-byte `2xx` as `empty_response` rather than a parser verdict, and the pre-existing rules
(`503` retried, `404` not, a malformed JSON body `parse_failed`) so this change cannot quietly move
them. A stub is the only way to make the zero-byte case reproducible — a real publisher does not offer
it on demand — and no publisher value passes through it, so nothing here can present a fixture as a
source's answer. The live behaviour is still proven by `check-report-data.mjs`, which fails on the real
publishers and exits 2 rather than reporting green.

`scripts/check-market-availability.mjs` sits above that harness and runs the real route handlers, the real
connectors and the real process cache against the same stubbed upstream, because the four states a price
feed can be in are not ones a live publisher hands out on demand: a `406` refusal, a zero-byte answer, a
survey month older than the freshness window, and a normal answer. It pins what Market Intelligence owes a
reader in each — that a refusal is reported as `publisher_blocked` with an `unavailable` block naming the
publisher, the reason and the last moment this process read the file (or `null`, when it never has) and
`substituteUsed: false`; that a blocked feed leaves no invented observation date and claims no high quality;
that a cached copy keeps the `retrievedAt` it was actually stored at and arrives flagged
`servedFromCache`; that a four-month-old survey month is `stale` while the retrieval still reads today; that
a scope with no rows is a `200` with no `unavailable` block at all, never dressed as an outage; and that two
HDX feeds failing together leave the NBE series and the World Bank indicators on the page with their own
provenance. The stub is a publisher-answer model keyed on URL identity — an un-stubbed URL throws — so no
assertion here can silently describe a source nobody was watching, and no value in it is anyone's price.

`scripts/check-pdf-live.mjs` runs that same oracle over a bundle built from the publishers in this
hour, for the days a publisher will not answer the full harness: it builds one live bundle, prints
each section's status and its own reason, and renders it. It passes `caller: null`, because no token
is verified in a test process — the file then prints `Unverified. No authenticated session was
confirmed for this request` instead of a confirmed-session line this run cannot stand behind.
