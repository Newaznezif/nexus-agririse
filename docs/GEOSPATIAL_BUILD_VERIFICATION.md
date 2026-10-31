# Nexus AgriRise — Geospatial Build Verification (Phase 6)

This is the **build** verification, not the discovery report. `GEOSPATIAL_VERIFICATION_REPORT.md`
(Phase 1) answered "do these endpoints exist and do they actually contain Ethiopia?". This document
answers the next question: **does the code that now ships really retrieve, normalise, describe and
draw those datasets, and what did the live responses say?**

Everything below was measured on **2026-10-30** against the running dev build on this workstation, again
against the production bundle after `npm run build`, and against the publishers' own servers. Nothing was
mocked, stubbed or hand-entered. Where a publisher did not answer, that is recorded as a failure rather
than smoothed over.

Read-only throughout: `GET` on our own routes, `GET f=json` on the publishers' feature services, no
tokens (all three services are anonymous), no writes, no database contact.

---

## 1. How to reproduce

From the repository root, in a second terminal:

```
cd C:/Users/lenovo/NexusAgririse
npm run dev
```

Then, in the first terminal:

```
cd C:/Users/lenovo/NexusAgririse
node scripts/check-data-routes.mjs --base http://localhost:3000
```

The runs quoted here used `--base http://localhost:3000`. If the harness reports every route
connection-refused, the dev server is almost certainly bound to IPv6 only — check with
`netstat -ano | grep :3000`, which happens on this machine depending on how `next dev` was started.
Add `--quiet` to see only failures.

The harness is safe to run repeatedly: it only issues the same `GET`s the dashboard issues. The single
write-capable route (`POST /api/data/sync`) is deliberately probed with **no token and with a wrong
token**, so it must refuse before touching any publisher.

To empty the process cache between runs — which is the only way to prove a read really went upstream —
restart `npm run dev`. Every run quoted below was started against a freshly restarted server, and the
`retrievedAt` timestamps in the evidence are all inside the same 26-second window as the run itself.

The same harness and the same browser drivers were then run against the **production build** rather than
the dev server, in this order:

```
cd C:/Users/lenovo/NexusAgririse
npm run build
npx next start -p 3100
node scripts/check-data-routes.mjs --base http://localhost:3100
```

A fresh `next start` process also starts with an empty cache, so this is the stronger of the two runs:
nothing in it can be served from a read the dev server happened to have made earlier. That is the run
behind §12's `1516/1516`, whose 15 layer reads printed as `fetched upstream by this request` fall between
18:01:35 and 18:02:22Z — i.e. inside the run, not inherited from anything before it.

The browser half was driven over the Chrome DevTools Protocol (headless Chrome on port 9333), because the
in-app browser reports a 0×0 viewport and cannot be used for pixel or network assertions. The drivers
(`cdp-map-test.cjs`, `cdp-offcountry-test.cjs` run twice, `cdp-tile-test.cjs`, `cdp-grid3-panel-test.cjs`)
and the raw logs
(`check-routes-run*.log`, `map-test-run4.log`, `offcountry.log`) were kept outside the repository in the
scratch directory `Documents/Qoder/2026-10-26/c8245c6e/`, alongside the Phase 1 probe output — the same
convention as the discovery report. Everything asserted below is reproducible from the two commands above;
the logs are the evidence, not the method.

## 2. What is under test

| Route | What it does | Verified here |
| --- | --- | --- |
| `GET /api/data/geospatial?view=layers` | NASA GIBS composite catalogue + newest scene dates | §7 |
| `GET /api/data/geospatial?view=sample&layer=…&lat=…&lon=…` | one physical pixel read from a GIBS tile | §7 |
| `GET /api/data/geospatial?view=boundaries&level=0\|1` | geoBoundaries ADM0/ADM1 outlines | §5 |
| `GET /api/data/geospatial?view=vectors` | the twelve ArcGIS layers with a live count each | §4 |
| `GET /api/data/geospatial?view=vector&layer=…&detail=…&bbox=…&limit=…&offset=…` | normalised features + provenance | §4, §6 |

## 3. Contract results

Final run: **`1516/1516 assertions passed. All contracts hold.`**, exit code 0, against both `next dev`
(`check-routes-dev2.log`) and the production bundle (`check-routes-prod2.log`). The 1498 that the run
history below ends on was the last run before the §12 review corrections; the 18 assertions it gained are
15 area-centroid checks (one per polygon feature sampled) and 3 strengthened paging/count checks.

Of the 1498 run recorded in the table below, the geospatial sections carried ~1,060: 98 in the GIBS/geoBoundaries payload section, 55 in the
ADM0/ADM1 boundary section, 907 in the vector sections (919 `ok` lines minus the 12 per-layer evidence
table lines, which print but do not assert). Those proportions still hold at 1516 — every assertion added
since is geospatial.

The run history is worth stating, because the first failures were **harness bugs, not product bugs**:

| Run | Result | What changed |
| --- | --- | --- |
| run1 | 936/940, 4 FAILED | three GRID3 *points* failed "bbox ordered": a point's bbox is legitimately degenerate (`min == max`), so the assertion was wrong, not the data. The fourth, "outlines, not stubs", demanded ≥8 vertices per ring; the published maxima for the eleven regions are `[80, 369, 287, 48, 28, 382, 424, 7, 4, 266, 431]` — two of them really are 7 and 4 points after decimation. |
| run2 | 941/941 | points allowed to be degenerate; rings required 3+ vertices; polygon maxima required to *vary* |
| run3 | 1401/1401 | full twelve-layer sweep added |
| run4 | 1413/1413 | boundaries + paging + detail blocks |
| run5 | 1468/1468 | unit-measurement assertions, secrets-hygiene probes on the new routes |
| run6 | **1498/1498** | the GRID3 score-domain case (§8) and its −99 disclosure guard, written after a second live sample contradicted the ranges the layer text quoted from the first |

Two assertions that already existed were **wrong about shipped behaviour** and were corrected to match
it rather than the other way round: `GET /api/data/sync` lists six tasks (five live + the gated
`geo-vectors`), not five, and it exposes `configured`/`gated` alongside `tasks`. The `gated` entries are
asserted to name the table they are waiting on (`/^data\.[a-z_]+$/`), which is how the UI can say "not
persisted yet" honestly.

`view=boundaries` had no coverage at all before this phase. It now has 55 assertions, including two
behaviours found by probing instead of assuming:

- `?level=7` does **not** 400. `intParam` clamps, so the route answers `200` with the deepest level that
  exists — ADM1 — and every area carries `level: 1`. Asserted as clamping, because that is what it does.
- With no `level`, the default is **ADM1** (the region outlines), which is what the map asks for; ADM0 is
  reachable only by asking for it.

## 4. Per-provider live evidence — the twelve ArcGIS layers

All twelve read `HTTP 200` on their own route. `Published` is the publisher's own `returnCountOnly`
under an Ethiopia envelope, taken by the index route; `Returned` is what the feature read delivered.
Example attributes are verbatim from the response body. The table is from run6, retrieved
`2026-10-30T16:50:28–16:51:19Z`; an independent run at `16:17Z` (run5, against a separately restarted
server) produced **identical counts, vertex totals and first-feature attribute JSON** for all twelve,
which is the reproducibility check that matters here. The first read of each layer+bbox key went
upstream — the log marks each one `(fetched upstream by this request)` or `(process cache)` and does not
assert which.

| Layer | Publisher endpoint (layer id) | Published | Returned | Vertices | Tol. | Example attributes (first feature) | Vintage |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `eth-region` | `services8.arcgis.com/oTalEaSXAuyNT7xf/…/Ethiopia_AdminBoundaries/FeatureServer/3` | 11 | 11 | 2,864 | 0.006° | `{"REGIONNAME":"Addis Ababa","RID":"14","Shape__Area":556495861.5869141}` | 2020-05-19 |
| `eth-zone` | `…/FeatureServer/2` | 81 | 81 | 7,725 | 0.006° | `{"Z4ID":"0311","ZONENAME":"BAHIR DAR","Shape__Area":7053531.166015625}` | 2020-05-19 |
| `eth-woreda` | `…/FeatureServer/1` | 684 | 684 | 12,067 | 0.015° | `{"WOREDANO_":"140102","WOREDANAME":"Nefas Silk","ZONENAME":"Region 14","REGIONNAME":"Addis Ababa","Shape__Area":60194723.38183594}` | 2020-05-19 |
| `eth-kebele` | `…/FeatureServer/0` | 15,670 | 120 (225 in that extent) | 1,354 | 0.006° | `{"RK_NAME":"Menagesha Town","RK_CODE":4051202,"W_NAME":"Welmera","Z_NAME":"West Shewa","R_NAME":"Oromiya","Shape__Area":1158977.3542480469}` | 2020-05-19 |
| `cde-basin` | `gis.cde.unibe.ch/gis/rest/services/Basins/MapServer/0` | 12 | 12 | 2,104 | 0.015° | `{"Name":"Genale Dawa","Shape_Area":180072503747.3534,"Shape_Length":2899486.4631048073}` | none stated |
| `cde-subbasin` | `…/Basins/MapServer/1` | 75 | 74 | 3,031 | 0.015° | `{"ID":15905,"GRIDCODE":2439,"Shape_Area":193409272180.3971}` | none stated |
| `cde-watershed` | `…/Watersheds/MapServer/0` | 1,697 | 8 (of 8 in that extent) | 96 | 0.03° | `{"Shape_Area":565604386.4150491,"Shape_Length":212147.2457195026}` | none stated |
| `cde-dam` | `…/Dams/MapServer/0` | 93 | 93 | 93 | 0° | `{"name":"Gilgel Gibe III Dam","type":"dam","osm_id":186396967}` | none stated |
| `cde-surface-water` | `…/Surface_water/MapServer/0` | 380 | 344 | 1,933 | 0.015° | `{"Code":1,"Name":"","Shape_Area":4648979.080097991}` | none stated |
| `grid3-urban-point` | `services6.arcgis.com/kOvusPqAUjVWKF9D/…/ETH_SocialDistancing_v1_0/FeatureServer/0` | 212 | 212 | 212 | 0° | `{"urb_NAME":"Asosa","adm0_NAME":"Ethiopia","adm0_ISO3":"ETH","PNT_LAT":10.06339194,"PNT_LON":34.5466386,"uext_ID":107}` | 2021-07-21 |
| `grid3-urban-extent` | `…/FeatureServer/1` | 204 | 204 | 3,492 | 0.0015° | `{"uext_ID":8,"adm0_ISO3":"ETH","Shape__Area":66490363.466308594,"Shape__Length":29360.365781462373}` | 2021-07-21 |
| `grid3-built-up-index` | `…/FeatureServer/2` | 54,446 | 120 (13,109 in that extent) | 484 | 0.0015° | `{"uext_ID":209,"UNIT_AREA":27600.5235127,"BUILT_AREA":3692.81087743,"BUILT_PROP":0.133795,"POP_DENS":1976.34647624,"BUILTscore":2,"POPscore":1,"INDEXvalue":1.5}` | 2021-07-21 |

Geometry validation, per feature, for all 1,963 features returned by the sweep: the publisher's record
id is preserved; attributes are a plain object; the bbox is ordered and within ±180/±90 (strictly
ordered for polygons, legitimately degenerate for points); the centroid lies inside its own bbox; every
ring has 3+ vertices; every vertex is a finite `[lon, lat]` **in degrees**; ring vertices lie inside the
feature bbox; and at least one feature per layer actually falls inside the Ethiopia envelope
(`32.9–48.1 E, 3.3–15.1 N`). GRID3 urban points were additionally cross-checked against the publisher's
own `PNT_LAT`/`PNT_LON` fields (agreement within 0.002°), and the whitelisted attribute subset survived
normalisation in every case.

Two index-level claims are also asserted live, not trusted from the code: the count each layer's own
description quotes is still the publisher's count (`12/12 layers still carry the exact count measured
when this was verified`), and `status === 'available'` if and only if the live count is positive.

## 5. geoBoundaries — country and region outlines

`view=boundaries` reads geoBoundaries' `_simplified` GeoJSON from the `media.githubusercontent` host —
`…/wmgeolab/geoBoundaries/main/releaseData/gbOpen/ETH/ADM{0|1}/geoBoundaries-ETH-ADM{0|1}_simplified.geojson`
— because `raw.githubusercontent.com` serves a 131-byte Git LFS pointer for the same files. The connector
names the host it uses. The published files are 80,437 B (ADM0) and 391,053 B (ADM1) as served today, read
under a 30 s budget and a 6 MB ceiling.

| Level | HTTP | Areas | Outline points | Names seen | Codes |
| --- | --- | --- | --- | --- | --- |
| ADM0 | 200 | 1 | 133 | `Ethiopia` | `ETH` |
| ADM1 | 200 | 11 | 1,224 | `Addis Ababa`, `Afar`, `Amhara`… | `ET-AA` … `ET-TI`, all unique |

Asserted per area: publisher code present and unique, named, `level` echoed, ring decimated to the
stated ≤140-point budget, coordinates rounded to the stated 0.001°, every vertex inside the Horn
(30–50 E, 2–19 N), bbox ordered and containing its own vertices, centroid inside bbox, and the
methodology text admitting both the decimation and that these outlines "do not settle legal boundaries".
`observedAt` is `null` by design — a boundary vintage is a publication date, not an observation — and
the provenance says so rather than leaving the UI to invent a date.

## 6. Paging, truncation and detail level — measured, not asserted from the code

**Extent filtering.** `eth-kebele&bbox=38.6,8.8,39.0,9.2&detail=overview&limit=40` returns 40 features,
`extentFiltered: true`, and the **quantised** extent `38.5 / 8.75 / 39.0 / 9.25` (snapped to the 0.25°
grid, clamped to the country). The publisher reports 225 kebels for that box, so `truncated: true` and
coverage reads `40 of 225 published features…`. At `0.006°` (~658 m) those 40 polygons carry 451 vertices
in one page of 40.

**Offset paging.** `limit=20&offset=0` vs `offset=20` over the same box: identical `sourceCount` (225),
zero `sourceId` overlap, and every page-2 id strictly greater than every page-1 id. The methodology
string says "starting from the publisher's own offset", which is what makes the second page honest.

**Detail level.** `cde-basin`, same extent, two readings: 2,104 vertices at overview tolerance
(0.015° ≈ 1,644 m) against 4,460 at detailed (0.00125° ≈ 137 m) — a 2.1× vertex difference produced by the
publisher's own generalisation, with `toleranceMeters` translated to ground distance both times so the
legend can say metres. `eth-region` reads `0.006°` (~657 m) at standard detail. Detailed tolerance never
falls below the 0.0005° floor, and overview never exceeds 0.05°.

**Short reads must be explained.** If `returned < sourceCount`, the response must either be labelled
`truncated` — and then the methodology must contain "STOPPED AT THE REQUESTED LIMIT" — or the dropped
counts must make up the difference. This is what caught the two real accounting cases below.

## 7. Satellite imagery (NASA GIBS) — the part that is not vectors

98 assertions cover the composite catalogue and the pixel read-out. Three composites are offered, each
with a meaning, a caveat, units and a range, a tile template that is asserted to carry no credential
material, and a **newest scene date confirmed by an actual TimeStack request** rather than a constant.
The live pixel read-out in the browser (38.75 E, 9.02 N) returned `0.506 NDVI`, band `0.5026,0.5101`,
scene date `2026-10-29` — one day before this verification run, which is what an 8-day composite on that
sensor should look like.

## 8. Attribute units — how they were verified, and the three texts they forced to change

Several publishers ship area fields with no stated unit. Rather than guess, the areas were **measured**:
each polygon's rings are re-integrated from the returned lon/lat coordinates (shoelace on
`lon·111320·cos(lat)`, `lat·111320`) and divided into the publisher's own figure. If the field were square
kilometres the ratio would be ~1e-6; if the publisher's geometry were still in Web Mercator metres the
ratio would sit at 1/cos²(lat) ≈ 1.03–1.06 around 9–14° N. Measured against `eth-region` today:

| Region | Publisher `Shape__Area` | Recomputed from its own rings | Ratio |
| --- | --- | --- | --- |
| Oromia | 331,065 km² | 326,913 km² | 1.013 |
| Tigray | 56,053 km² | 53,050 km² | 1.057 |
| Addis Ababa | 556 km² | 543 km² | 1.024 |
| Hareri | 383 km² | 371 km² | 1.033 |

The ratio is ~1, so the field is square metres of the publisher's projection — and the few percent above 1
is exactly the Mercator inflation the generalised rings cannot reproduce, which is itself the proof that
the number is a projected-plane area rather than a geodesic one. It is therefore *not* a km² field and not
an exact ground area, and the layer text now says so.

Three descriptions in `lib/data/geoVector.ts` were wrong once checked against live data, and were
corrected in this phase — these were user-visible text, not comments, and the corrections are part of the
same uncommitted work, so nothing wrong was ever released.

1. `eth-region.attributeNotes` claimed `Shape__Area` was "about 10,000 km² for Tigray". Measured against the
   polygons the publisher ships, the field is **square metres**, and Tigray reads **56,053 km²** — the full
   ranking is Oromia 331,065, Somali 319,248, Amhara 159,686, SNNPR 111,031, Afar 99,516, Tigray 56,053,
   Beneshangul Gumu 52,276, Gambela 31,410, Dire Dawa 1,091, Addis Ababa 556, Hareri 383 km². The old note
   was wrong about the unit *and* about the region.
2. `grid3-built-up-index` claimed `UNIT_AREA`/`BUILT_AREA` were "roughly km² at this scale". They are
   **square metres**; `BUILT_PROP` reproduces exactly as `BUILT_AREA ÷ UNIT_AREA` (0 mismatches over 400
   units read).
3. The same layer described a "1-5 social-distancing index". It is not 1–5, and the first attempt to
   describe what it *is* was also wrong, which is the more useful finding:

   | Sample | `BUILTscore` | `POPscore` | `INDEXvalue` | `UNIT_AREA` (km²) | `POP_DENS` |
   | --- | --- | --- | --- | --- | --- |
   | 1,500 units around Addis Ababa (first pass) | 0–5 | 0–9 | 0–7 in half steps | 0.010–0.445 | 0–8,104 |
   | 1,500 units over the country envelope (second pass) | 0–5 | **−99** and 0–9 | **−99** and 0–6.5 in half steps | 0.010–**18.776**, median 0.042 | 0–**20,470** |

   `−99` is the publisher's not-scored sentinel and it is real: **42 of the 1,500 country-wide units carry
   −99 in both `POPscore` and `INDEXvalue`**. A range quoted from one sample is a sample statistic, not the
   field's domain — so the shipped text now names the sample it read, states that −99 means "not scored"
   rather than "scored low", and stops claiming a unit-size ceiling the second sample broke.

The corrections are worth keeping in the record because they are the general finding: **a field name is
not a unit, a publisher's documentation is not a measurement, and one read is not a domain.**

The second pass is now a route assertion rather than a note in a document. Run6 added 30 assertions that
read the same 1,500-unit country sample the layer text quotes, and fail if a `-99` is served while
`attributeNotes` does not explain it, or if `BUILT_PROP` stops equalling `BUILT_AREA ÷ UNIT_AREA`. The
evidence line it prints is what §8 was written from:

```
note  1500 units read: UNIT_AREA 0.010–18.776 km² (median 0.042),
      BUILTscore 0…5, POPscore -99…9, INDEXvalue -99…6.5 — 42 carry the -99 not-scored sentinel
```

## 9. Where the data is genuinely imperfect, and how the build says so

- **`−99` is a live value in GRID3's score fields**, in 42 of the 1,500 units read country-wide. Nothing in
  the frontend computes a colour, a rank or a statistic from those fields (grep for `INDEXvalue`/`POPscore`
  finds only the `keepFields` whitelist), so their only exposure is the raw attribute panel — which the
  layer note now explains. The route fails if that explanation is ever removed while `−99` is still served.
- **17 CDE surface-water records are published with an empty geometry**, among them the named lakes
  Abiyata, Shala, Hawassa, Awasa and Beseka. They are counted, not drawn, and the legend states that
  they are counted but cannot be drawn. A naive loop would have silently dropped 17 lakes.
- **36 of 380 surface-water polygons do not survive the read**: 17 have no geometry (above), 19 collapse
  below drawable size at overview tolerance. `droppedNoGeometry` + `droppedUnplotable` + `returned`
  accounts for all 380; nothing vanishes.
- **1 sub-basin of 75** is likewise not drawable at overview tolerance.
- **344 of 380 surface-water bodies touch the Ethiopia envelope**; the rest are published region-wide.
  They are kept and counted (`0/344 … do not touch the Ethiopia envelope`), not clipped away.
- **`open-meteo-historical` did not answer** in the status section of run5 *and* run6 — the harness
  reported `not answering — open-meteo-historical: Could not reach the upstream host`, 8/9 publishers
  answered, and the source stayed marked unavailable. Investigated after run6, and **the cause is a
  defect in our own code, not the publisher being down** — an earlier version of this bullet claimed it
  was not a code defect, and that claim was wrong. `lib/data/openMeteo.ts:16` sends the archive query to
  `https://historical-api.open-meteo.com/v1/archive`, a hostname that does not exist:
  `nslookup historical-api.open-meteo.com 8.8.8.8` answers *"Non-existent domain"*. The comment at
  `:14-15` blames a DNS block on this dev machine, which the measurement contradicts — this fails
  everywhere, for every reader. The publisher's real host is `archive-api.open-meteo.com` (resolves to
  5.9.98.12) and it answers the exact URL this connector builds, unchanged apart from the host:

  ```
  GET https://archive-api.open-meteo.com/v1/archive?latitude=9.0200&longitude=38.7500&start_date=2025-06-20&end_date=2025-07-05&daily=precipitation_sum,temperature_2m_max,temperature_2m_min,et0_fao_evapotranspiration&timezone=Africa%2FAddis_Ababa
  → 200, 976 B in 1.22 s, daily keys [time, precipitation_sum, temperature_2m_max, temperature_2m_min, et0_fao_evapotranspiration], elevation 2379.0, generationtime_ms 1.57
  ```

  16 daily rows came back (2025-06-20 → 2025-07-05; first row 5.9 mm, Tmax 23.3 °C, Tmin 9.9 °C,
  ET0 3.82 mm; units `mm · °C · °C · mm`). Those five `daily` keys are exactly the ones `parseSeries`
  reads, so the fix is the one line.
  Measured blast radius: `?mode=history` on `/api/data/weather` can only ever return a network 502
  (`app/api/data/weather/route.ts:43`) and this source's status probe always fails
  (`app/api/data/status/route.ts:68`). No page sends `mode=history` today — the route's only UI consumer
  is `components/data/ClimateMonitor.tsx:121`, which asks the *forecast* host for `past_days`, i.e. a
  working path. That is how a dead host sat unnoticed. The harness asserts only the 400 case for
  `mode=history` (`scripts/check-data-routes.mjs:225`) and has no success case, so neither the 1498 nor
  the final 1516 green run in §3 ever touched it; closing that assertion gap belongs with the fix.
  **Deliberately not fixed in this commit:** `lib/data/openMeteo.ts` is not geospatial work, and this
  push is scoped to geospatial files. It is recorded as §14 item 5 and left for approval instead of
  being folded in silently.
  **No longer attributable to this workstation.** After the push, the same request was sent to the live
  deployment (§15): `https://nexus-agririse.vercel.app/api/data/weather?lat=9&lon=38&mode=history&start=2026-01-01&end=2026-01-31`
  answered **502 `network`, "Could not reach the upstream host"** at 18:16:58Z, while
  `?mode=forecast` on the same host answered 200 seconds earlier. Vercel's network path is not this
  machine's resolver, so the "blocked on this dev machine" reading is now closed: every reader of the
  deployed app gets the failure. The same probe also shows a smaller inaccuracy — the failure's own
  provenance labels its source "Open-Meteo Forecast API" even on the archive path.
- **CDE is slow, and the extent filter is what keeps it usable.** Through the app route, CDE reads measured
  1.0–7.4 s (`cde-watershed&detail=overview` across the country took 7.4 s; `cde-basin&detail=detailed`
  5.2 s). The count query the connector actually sends — envelope geometry, `returnCountOnly=true` — came
  back cold from `Basins/MapServer/1` in **1.5 s**. The same layer queried *without* the spatial filter
  streamed **2.1 MB and was still going when it was cut off at 60 s**. The ArcGIS client budgets 15 s with
  one retry, so CDE is served, but the first paint of the hydrology layers is visibly slower than the
  Esri-hosted ones. That is stated rather than fixed.
- The CDE services publish **no date and no licence**, so `observedAt` is `null`, a `vintageNote` says no
  date is published, and the licence text says "shown for reading with attribution … redistribution is
  not established" instead of implying permission that was never granted.

## 10. Frontend verification with real responses

`components/data/EthiopiaRegionMap.tsx` on `/dashboard/map`, driven through CDP against the live dev
build. The full suite ran twice (`map-test-run4.log`, then `map-test-run5.log` after the §8 text
corrections, to confirm the shipped UI still behaves identically); both exit 0 with `errors: 0` in the
console throughout, and the figures below are from the second, post-correction run. A focused third
driver (`cdp-grid3-panel-test.cjs`) checks the layer prose end-to-end.

- **Initial paint**: 23 paths, 372 circles, 6 imagery tiles, zoom 5, 3 metric chips, basin outlines
  present.
- **Feature click**: selecting a CDE basin opened a panel reading `Genale Dawa · publisher feature id 1
  · polygon · from Main basin (layer 0)`, `CENTROID 5.4200 N, 40.4450 E`, `OWN EXTENT 3.397–7.443 N ·
  37.043–43.847 E`, and the publisher's own unmodified `Shape_Area` / `Shape_Length`, plus the "what this
  does not mean" text and the attribution.
- **All twelve layers switched on**: `12` layers reported on the map, **4,521 paths and 372 circles**
  drawn, and twelve separate "of N published features" denominators (11, 81, 684, 15,670, 12, 75, 1,697,
  93, 380, 212, 204, 54,446). 3 partial-read chips, 3 extent chips, 20 cache chips, 0 off-country.
- **Pan**: view centre moved 8.90 N 40.40 E → 5.72 N 45.02 E and the extent-scoped denominators were
  **re-requested and changed**: kebels 15,670 → 15,005, watersheds 1,697 → 1,574, built-up units
  54,446 → 51,515. That is the clearest proof that these are live queries, not a cached bundle.
- **Zoom 5 → 7 → 8**: detail label moved to `standard`, tolerance chips re-read (0.002° ≈ 219 m),
  vertex counts per layer changed (3,088 / 12,337 / 521 / 3,686), and tile count tracked the new view
  zoom. Double-click zoomed 7 → 8.
- **Off-country refusal** (`cdp-offcountry-test.cjs`, run twice — `offcountry.log` and, after the server
  restart for run6, `offcountry-run2.log`): panning west in five steps reached 8.90 N 30.40 E; the app then
  stated *"Kebeles (lowest administrative unit), Watersheds, GRID3 built-up index units are served for the
  view extent, and this view no longer overlaps Ethiopia, so nothing was requested for them. Pan back over
  the country to load real features."* — and **25 vector requests had been made in total with 0 added while
  off-country**. Both runs produced the same transcript. The extent-clamp prevents a real class of nonsense
  queries.
- **Imagery**: 30 GIBS tile responses captured at the network layer, all `200 image/png`
  (`8/124/163.png`, `5/15/18.png`, …). Timing was taken from `Network.responseReceived`, since
  cross-origin tile responses are opaque to `PerformanceObserver`.
- **Reset** restored the exact initial centre `8.90 N, 40.40 E` with the extent chips back.
- **The §8 text correction, seen in the browser** (`cdp-grid3-panel-test.cjs`): switching on the built-up
  index alone drew **1,500 unit polygons out of 1,523 paths on the map**; clicking the first selected
  `grid3-built-up-index · 1` and the panel showed the publisher's unmodified fields —
  `uext_ID 869`, `UNIT_AREA 19839.1517727`, `BUILT_AREA 3323.20628618`, `BUILT_PROP 0.167507`,
  `POP_DENS 4447.63175456`, `BUILTscore 2`, `POPscore 4`, `INDEXvalue 3` — at centroid
  **7.2146 N, 35.3840 E**, own extent 7.214–7.216 N · 35.383–35.385 E, together with the corrected
  "About these fields" note, the "what it does not mean" caveat and the CC BY 4.0 licence line. The
  driver asserted the note explains `-99` as not-scored rather than low (`explainsSentinel: true`), and
  reported no console or page-exception events.

So the attribute text the harness checks is the same string a farmer sees under a selected polygon, not a
parallel copy.

### The same three drivers, re-run against the production build

Everything above was driven against `next dev`. After `npm run build`, the whole set was re-driven against
`next start -p 3100` (`cdp-map-test-prod.cjs`, `cdp-offcountry-test-prod.cjs`,
`cdp-grid3-panel-test-prod.cjs` → `map-test-prod3.log`, `offcountry-prod2.log`,
`grid3-panel-prod2.log`), so the UI evidence covers the optimized bundle rather than only the dev server.
All three exited 0, and all three ran against the build that already contains the §12 corrections. The
browser drivers ran *after* the §12 harness against the same process, so the map's layer reads were
largely cache hits — the UI labels them honestly (20 "Cached copy" chips, 9 whole-extent, 0 off-country,
no console or exception events in that state), and the upstream-going proof is the harness run, not this
one.

- initial paint, twelve-layer switch-on (**4,521 paths, 372 circles, `onTheMap: "12"`**), the click panel,
  zoom 5 → 7 → 8 with `standard` detail and 0.002° (~219 m) tolerance chips, and reset to 8.90 N 40.40 E
  all reproduced;
- pan moved the centre 8.90 N 40.40 E → 5.72 N 45.02 E and re-requested the extent-scoped layers, giving
  **15,401 / 1,645 / 53,275** published-feature denominators. They are not the dev run's 15,005 / 1,574 /
  51,515: these are live counts for whatever extent is on screen, quantised to the 0.25° grid, so the two
  runs asked for different windows. The behaviour that matters — the numbers change when the view changes
  — is the same;
- the count-freshness chip (§12 item 8) renders on the production bundle as
  **`CACHED COUNTS · upstream at 2026-10-30 17:40:01 UTC`**, which is the §12 harness run's own upstream
  minute, not the page-load minute — the panel now says where its numbers came from;
- at zoom 7 in `standard` detail two extent layers read **`437 of 437`** and **`1,477 of 1,477`** published
  features in the window, i.e. a complete view rather than a partial one, alongside the partial-window
  chips (`partialChips: 3`, `extentChips: 3`) on the wider pan;
- **34 GIBS tile responses, all `200 image/png`**, and an empty console/exception list;
- the off-country refusal reached the same 8.90 N 30.40 E in five westward steps with the same wording and
  **25 vector requests in total, 0 added while off-country**;
- the built-up-index panel showed the reworded note verbatim — *"The figures below come from the
  country-wide verification read of 1,500 units on 2026-10-30, not from the extent currently on screen"*,
  with `(42 of those 1,500 units)` for the sentinel — alongside the eight publisher fields
  (`explainsSentinel: true`, `mentionsUnitArea: true`, no console events), and 1,500 of 54,446 units
  drawn.

The screenshot artifacts of these states (`map-*.png`, `tile-b-initial.png`) are in the scratch
directory, outside the repository. They are corroborating, not primary: every claim above has a number
from a log behind it.

## 11. Storage: nothing was persisted, and the build says so

- `GET /api/data/sync` on this workstation reports **`configured: false`** (no `.env.local`, so no
  database credentials are present at all). No run of this verification wrote a single row.
- `supabase/migrations/20261030000100_data_geospatial_reference.sql` is marked **`STATUS: PROPOSED, NOT
  APPLIED`** in its own header. It has been parsed by PostgreSQL's grammar and read; it has never been
  run against this project's database.
- Consequently the sync task `geo-vectors` is **gated**: `GATED_SYNC_TASKS` + `probeTable` check for
  `data.geo_vector_layers`, find it absent, and stay out of the run instead of reporting a sync it did
  not perform. `data.geo_vector_features` is therefore empty, and the map deliberately serves all twelve
  layers live from the publishers rather than from our own tables.
- Even after the registry half is applied, the feature-archive half is intentionally **not** shipped:
  storing geometries needs the publisher's `f=geojson` response with its own ring grouping, and that
  form has not been verified against these three services. The live route uses `f=json` and re-groups
  rings in our code — right for drawing, not something to bake into an archive untested.

## 12. Gates

### Found by the pre-commit review, fixed, and proved

After every section above was written and every gate was green, the complete diff was read again as a
review. Ten defects survived that reading; each is listed with the check that settles it, because "the
reviewer said so" is not evidence. All ten were fixed in this same stage, and every gate below was then
re-run against the fixed state.

1. **The gated sync wrote three columns the registry never declared.** `syncGeoVectorRegistry` sends
   `methodology`, `coverage` and `quality` for every layer, and `data.geo_vector_layers` did not have them
   — so the first real run after applying the migration would have rejected every row and the task would
   have reported `failed` while the SQL itself stayed valid. The three columns are now declared
   (`20261030000100_…sql:146-148`), in the same order and with the same types as `data.satellite_layers`.
   Proof: a script diff of the insert object's keys against the table's column list reports
   `WRITE-NOT-DECLARED: []` (36 keys, 47 columns; the remainder are `record_added_at`/`record_replaced_at`
   defaults, the `layer_id` merge key, and nullable `tolerance_meters`).
2. **A harness assertion that could fail correct data.** The geoBoundaries check required ≤140 points per
   ring, but `decimate` samples at most 140 *distinct* points and then appends the closing vertex, so 141
   is the legal maximum and a legitimate outline would have been reported as a defect. Now `<= 141` with
   the reason in a comment, and `boundaries.ts`'s own `methodology` string says
   "at most 140 distinct points per ring plus the closing vertex repeated at the end" instead of implying
   a 140-point ceiling on what is shipped.
3. **A layer could get stuck reading forever.** `useVectorLayers` evicted answers past 48 stored paths by
   recency alone; dropping a path the map still asked for left that layer with no answer and no way to
   re-request one, because the fetch effect only restarts when the request signature changes. `trim` now
   takes the currently wanted set and evicts only paths that are not wanted.
4. **Two assertions that could pass on a partial answer.** The kebele paging check accepted any response
   that looked paged; it now requires both pages to have returned 20 features, and the numeric-id and
   ascending-order checks are unconditional rather than inside a branch that an empty page skips. The
   `grid3-urban-point` count check now asserts `pages === 1 && returned === 212 && sourceCount === 212`,
   so a truncated first page can no longer satisfy a "one page, 212 records" claim.
5. **"Centroid" was not a centroid.** `arcgis.ts` reported the midpoint of a feature's bounding box under
   that label, and the satellite read-out samples GIBS NDVI and NASA POWER *at that point* — so for an
   L-shaped or elongated polygon the pixel and the weather series were being taken somewhere the feature
   does not necessarily cover. Replaced with a real area centroid (shoelace integral per ring, rings
   weighted by |area|, bbox centre only as a fallback), with the rounded value clamped back into its own
   bbox because rounding can push a centroid that sits exactly on a paper-thin polygon's edge outside it.
   Measured on live ADM1 data from the rebuilt production server, the old value and the new one differ by
   up to **0.5639° latitude / 0.2137° longitude (≈62 km)** for Oromia; Afar 0.3683°/0.2338°, Amhara
   0.3425°/0.3192°, Somali 0.3220°/0.1906°, Tigray 0.2243°/0.2208°, Gambela 0.2120°/0.1317°, SNNPR
   0.0184°/0.1936°, Benishangul-Gumuz 0.0388°/0.0463°, Dire Dawa 0.0215°/0.0316°, Addis Ababa
   0.0143°/0.0136°, Harari 0.0018°/0.0067°. The harness now recomputes the area centroid independently
   from the outline it received and asserts agreement to 1e-4, per feature, which is why the assertion
   count rose.
6. **Our own validation was attributed to a publisher.** Asking for an unregistered layer returned
   provenance naming CDE hydrology, as though Bern had refused the request. That response now names this
   app's own registry, links to the file that defines it, states `endpoint: 'none'`, and says in
   `methodology` that no publisher was asked.
7. **Sample statistics were presented as if they described the view.** The built-up-index attribute note
   quoted medians and the `−99` count next to the on-screen extent; those figures come from the
   country-wide verification read of 1,500 units on 2026-10-30. The text now says so explicitly, and the
   production browser run quotes the new wording verbatim (§10).
8. **A freshness claim a cache makes false.** The index panel said the publisher counts were run when the
   page loaded; `/api/data/geospatial?view=vectors` is cached for six hours, so on most loads that was
   not true. The panel now carries an explicit chip — `counts from this request` or `cached counts` — plus
   the upstream timestamp the provenance actually reports. Verified against the running production server:
   three consecutive cached answers all reported `servedFromCache=true` with
   `retrievedAt=2026-10-30T17:40:01.707Z`, i.e. the moment of the real upstream read and not the moment of
   the request, and the rendered panel showed `CACHED COUNTS · upstream at 2026-10-30 17:40:01 UTC`.

9. **Three exports of `lib/data/arcgis.ts` nothing called.** `readLayerMetadata` (and its
   `LayerMetadata` type), `bboxFromParams` and `isInsideBBox` were dead in a file shipping for the first
   time: the registry carries the `objectIdField` / `maxRecordCount` that Phase 1 measured from those
   metadata reads, so the live path never asks. Deleted, after confirming no other file, script or
   document names them.
10. **Two doc comments that did not describe their code.** `isPlausibleGeometry`'s comment began
    mid-sentence — a fragment left by an earlier edit — and `LayerMetadata.supportsOrderBy` carried a
    comment describing a generalisation tolerance. Both corrected to what the code below them does.

Two further review remarks were checked and judged *not* defects, and are recorded rather than changed:
several payload assertions restate what the connector already builds (they are consistency checks on the
response shape, which is what a contract harness is for), and count drift is reported as a `note` instead
of an assertion, because a publisher re-counting its layer is not a broken contract.

### Gates, re-run against the fixed state

- `npx tsc --noEmit` — exit 0.
- `npx eslint` on all thirteen code files this phase touches (`lib/data/{geoVector,arcgis,boundaries,sources,sync,cache}.ts`,
  `app/api/data/{geospatial,sync}/route.ts`, `components/data/EthiopiaRegionMap.tsx`,
  `hooks/useVectorLayers.ts`, `app/dashboard/map/page.tsx`, `scripts/{check-data-routes,run-sync}.mjs`) —
  silent, exit 0.
- Repo-wide `npm run lint` — **79 problems (16 errors, 63 warnings), all pre-existing** in files unrelated
  to geospatial work (`react-hooks/set-state-in-effect`, `react/no-unescaped-entities`, one
  `@typescript-eslint/no-explicit-any`). The count is identical to the one recorded before this phase
  began: nothing was introduced here and nothing is dismissed — they are recorded as a separate piece of
  work.
- `npm run build` — exit 0 (`build-49c.log`). Next.js 16.2.6 (Turbopack), `Compiled successfully in 17.0 s`,
  TypeScript checked inside the build (`Finished TypeScript in 9.7 s`), 32 pages generated in 2.1 s,
  `/api/data/geospatial` listed as a dynamic (`ƒ`) route, no warnings and no errors in the log.
- `node scripts/check-data-routes.mjs --base http://localhost:3000` (the same code under `next dev`) —
  **1516/1516**, exit 0.
- `npx next start -p 3100` (fresh process from the build above, so an empty TTL cache), then
  `node scripts/check-data-routes.mjs --base http://localhost:3100` — **1516/1516**, exit 0. That run
  printed `counts were taken from each publisher by this very request` and 15 layer reads as
  `fetched upstream by this request` between 18:01:35 and 18:02:22Z, i.e. nothing in it was inherited
  from an earlier process. The count rose from 1498 to 1516 because of the strengthened and new assertions
  in items 2, 4 and 5 above; the earlier 1498/1498 runs are superseded, not contradicted. It reproduced the
  §4 findings on the optimized build: `12/12 layers still carry the exact count measured when this was
  verified`, `40 of 225` kebels in one paged extent with `20 + 20 kebele features … no overlap`,
  `2104 vertices at 0.015° (~1644 m) vs 4460 at 0.00125° (~137 m)` for the twelve basins,
  `0/344` surface-water bodies off-envelope, `42 carry the -99 not-scored sentinel`,
  ADM0 `1 areas, 133 outline points` and ADM1 `11 areas, 1224 outline points`, and the same
  `8/9 publishers answered` for the reason recorded in §9.
- The three browser drivers, re-run against that rebuilt production server — see §10.
- The migration re-parsed with PostgreSQL's own grammar (`pg_query` via emscripten, grammar version
  160001), statement by statement in a fresh process: **`PASS …40 statements, 0 grammar failure(s)`**
  `[DoStmt:1 CreateSchemaStmt:1 CreateStmt:3 CommentStmt:16 DropStmt:3 CreateTrigStmt:3 IndexStmt:4
  AlterTableStmt:6 GrantStmt:3]`. Worth recording honestly: a directory-wide loop that reuses one wasm
  module instance *falsely* fails on the largest files with `Ma[F[…]] is not a function` — an allocator
  limit in that harness, not a syntax error. Re-running the identical statements standalone passes them,
  which is how the failure was attributed to the harness and not to the SQL.
- Secrets hygiene: the harness now probes `/api/data/geospatial?view=vectors` and
  `…?view=vector&layer=eth-region` for credential material and for upstream URLs carrying a signature.
  Both clean; the twelve endpoints in the index are asserted `https` and asserted not to carry
  `key=`/`token=`/`signature`/`f=`/`where=`.

## 13. What this does **not** claim

1. **Not the deployed environment.** Everything in §1–§12 ran on this workstation — first against `next dev`,
   then against the `npm run build` output served by `next start` (§10, §12). That proves the production
   *bundle* behaves correctly here; it does not prove the Vercel deployment, its environment variables, its
   cold starts, or its network path to the publishers. What was measured after the push is recorded in §15,
   including the part that could not be measured from here and why.
2. **No database state.** No migration applied, no row written, no grant or RLS policy touched.
3. **No persistence proof for imagery tiles.** Tile reads go browser→NASA directly; the server only
   supplies the template and the scene date.
4. **The P9 preflight for the geospatial migration has not been run.** It requires a live Supabase
   connection and explicit approval before any SQL executes.
5. **Licence is not established for any of the three vector publishers.** All three answer anonymously,
   and none publishes a redistributable licence for these layers; the UI says so per layer.
6. **Counts drift.** `12/12` matched the counts measured earlier the same day, but GRID3 and CDE are
   living services; a later run may legitimately differ, and the harness prints drift as a note instead
   of forcing equality.
7. **Not every parameter combination was exercised.** The sweep reads all twelve at overview detail, plus
   targeted standard/detailed, paged, off-country and error-path cases. It is not a combinatorial proof.
   One gap is now known by name rather than inferred: `/api/data/weather?mode=history` has an error case
   but no success case in the harness, which is how the dead archive host described in §9 survived six
   green runs. Every other route mode below is asserted on a real response.

## 14. Next prerequisites before this can be called done

1. ~~Production build + deployment~~ — done, and the build passed; then re-run
   `node scripts/check-data-routes.mjs --base <production URL>` against the deployed routes. **This last
   step is still open**: the preview deployment that carries this commit is behind Vercel Deployment
   Protection, so an anonymous harness run cannot reach it. See §15 for the two ways to close it.
2. Verify `f=geojson` per service (ring grouping, CRS, and whether `exceededTransferLimit` still applies)
   before enabling the feature-archive half of the migration.
3. Apply the registry half of the migration **only with approval and a live preflight**, then confirm the
   `geo-vectors` task un-gates and writes.
4. Decide caching posture for serverless: the process cache dies with the container, which is why every
   payload carries its own `retrievedAt`; if a cold start per request becomes observable in production,
   that is a design change, not a tuning knob.
5. **Fix the dead Open-Meteo archive host (§9)** — change `ARCHIVE_HOST` at `lib/data/openMeteo.ts:16` to
   `https://archive-api.open-meteo.com/v1/archive`, replace the false "blocked by DNS on this dev
   machine" comment with the truth, and add a `mode=history` success case to
   `scripts/check-data-routes.mjs` so the assertion gap cannot hide it again. `lib/data/openMeteo.ts` is
   not geospatial work, so it is not part of the geospatial commit described in §12; it needs its own
   approval and its own commit. The host is now known to fail in the deployed environment too (§15), so
   this is a live user-facing defect, not a local annoyance.

## 15. After the push — what the deployment let me verify, and what it did not

Everything in this section was measured after the commit left this workstation, against GitHub's
unauthenticated REST endpoints and the live Vercel hosts. `gh` is not logged in on this machine, so the
statuses and deployments APIs were used directly; no Vercel token was read, sent, or needed.

**What was pushed.** `d458a15fa63ed7d0968de922412288f812348166` — *feat(geospatial): read Ethiopia's
reference layers from the live publishers*, 15 files, +4,031/−271, authored
`Newaz Nezif <newaznezif@gmail.com>`, fast-forward on `fix/supabase-migration-safety`
(`44d3337..d458a15`, no force). The five pending security-related files were left unstaged and untouched;
`git status` after staging showed exactly fifteen paths in the index and those five still modified only in
the working tree. A final scan of the staged diff for credential material before committing found only
prose about tokens in error messages, no secret values.

**The deployment built.** Vercel reported on the pushed SHA:

```
2026-10-30T18:07:27Z  pending  Vercel is deploying your app
2026-10-30T18:08:04Z  success  Deployment has completed
target https://vercel.com/newaznezifs-projects/nexus-agririse/D6iYGQSyeog9wMbxUQcQxdjqFdSu
```

GitHub's deployments API gives the same record: deployment id `7445424254`, environment `Preview`, ref
`d458a15…`, created `18:08:04Z`, creator `vercel[bot]`, environment URL
`https://nexus-agririse-e9c2ydfzo-newaznezifs-projects.vercel.app`. `check-suites` for the SHA is empty —
this integration reports through commit statuses only, which is why the statuses API is the authority here.

That build passing is worth stating precisely, because it is weaker than it sounds and stronger than
nothing: Vercel installed and compiled *the tree that is now on the branch*, so the artifact behind that
URL contains this commit, and nothing about the push was rejected by their pipeline. It does not say the
routes answer correctly there.

**The routes on that URL could not be probed.** Deployment Protection is on for previews:

```
GET https://nexus-agririse-e9c2ydfzo-newaznezifs-projects.vercel.app/api/data/geospatial?view=vectors
→ 302, body "Protected by Vercel Authentication"
```

and navigating there lands on `vercel.com/login?next=…`. So the 1,516-assertion harness has **not** been
run against the deployed geospatial bundle, and this document does not claim it has. Two ways to close
that gap, both of which belong to the owner of the project rather than to me: land the commit on `main`
so the unprotected production host carries it, then run
`node scripts/check-data-routes.mjs --base https://nexus-agririse.vercel.app`; or make one preview
reachable (their own logged-in browser, or a deployment-protection bypass). A bypass code is a secret,
so it should not be pasted into this conversation.

**What production actually serves today.** An earlier note in this project's history said production was
still on June's `main`; that is no longer true and the deployments API shows why. `origin/main` is
`676331c` — *Merge pull request #2 from Newaznezif/fix/supabase-migration-safety*, 2026-10-30 12:02:32
+03:00 — with a Production deployment at `09:03:18Z`. So `32097dc` (the H-6 lockdown migration file) and
`44d3337` (the Phase 1 documents) are on `main`; `d458a15` is **not**, which is exactly what the live host
shows:

| request (all read-only `GET`) | production answer |
| --- | --- |
| `geospatial?view=layers` | 200, `NASA GIBS`, retrieved `18:14:29Z` |
| `geospatial?view=boundaries&level=1` | 200, 11 regions, `geoBoundaries`, `18:16:54Z` |
| `geospatial?view=sample&…&date=2026-10-20` | 200, `18:16:56Z` |
| `geospatial?view=vectors` | **400 `bad_input` "Unknown view"** — the code is not deployed |
| `geospatial?view=vector&layer=grid3-urban-point` | **400 `bad_input` "Unknown view"** — same |
| `weather?mode=forecast` | 200, `Open-Meteo Forecast API`, `18:16:57Z` |
| `weather?mode=history&start=…&end=…` | **502 `network` "Could not reach the upstream host"**, `18:16:58Z` |
| `markets?mode=overview` | 200, 1,812 B, `WFP Ethiopia Food Prices (rEMS)` |
| `markets?mode=snapshot` | 200, 303,310 B |
| `markets?mode=history&commodity=Teff` | 200, 431,926 B |
| `exchange`, `status`, `locations`, `agroclimate`, `sync` (GET) | 200 / 200 / 200 / 200 / 200 |

Two honest notes on that table. The first attempt at the markets row asked for `/api/data/market?commodity=teff`
and got a 404 HTML page: that was my wrong path, not a production defect — the route is
`/api/data/markets`, and the corrected request is in the table. And `POST /api/data/sync` was
**deliberately not sent** to production: it is the write-capable route, and provable-but-unneeded
requests that could reach a database are not fired at a shared environment to demonstrate a refusal the
local harness already asserts.

The `mode=history` row is the one that changes a §9 conclusion rather than confirming it: the dead archive
host fails on Vercel's network too, so it is not a property of this workstation's resolver.
