# Nexus AgriRise — Geospatial Data Quality (Phase 1 rules and findings)

This file is the quality half of the Phase-1 deliverables: the rules a geospatial source must pass
before it may appear on a map or in a row, and the specific findings (`DQ-n`) that the probes
produced. `docs/GEOSPATIAL_SOURCE_CATALOG.md` cites these ids per dataset;
`docs/GEOSPATIAL_ARCHITECTURE.md` cites them as design constraints;
`docs/GEOSPATIAL_VERIFICATION_REPORT.md` holds the request-level evidence behind every number here.

Why this file exists: the platform's standing rule is that no number reaches a farmer without its
units, observation date, retrieval date and kind of value (`lib/data/types.ts:1-7`). A map layer is a
number with a boundary drawn around it, and a wrong boundary or a placeholder population is more
persuasive than a wrong table cell. The findings below are ordered from "this fooled us mid-probe"
(DQ-1) to "this is a slow-burn risk" (DQ-11).

## 1. Adoption gates

A dataset moves from *candidate* to *display* or *store* only when all of these are satisfied,
each by a measurement recorded against the dataset, not by an assertion in a document.

| Gate | Test | Pass condition | Fails as |
| --- | --- | --- | --- |
| G-1 Reachable by a conforming client | strict-TLS request with no trust override (`curl` without `-k`) | handshake verifies; else the source is server-side-only at best, and only behind the §11.1 decision in ARCHITECTURE | N-26, P-6 |
| G-2 Real coverage over Ethiopia | ArcGIS `returnCountOnly` with and without `bbox=33,3.4,48,15&bboxSR=4326`; OGC GetMap/GetTile with the correct axis order | bbox-restricted count equals total count, **and** the image contains drawn pixels inside the country box (`lib/data/locations.ts:97-98`) | A-5 passes; X-1 fails at 262,144/262,144 white px |
| G-3 Content, not status | decode the PNG (`node:zlib` over IDAT), count non-white/non-transparent px, distinct-colour histogram, drawn-pixel bounding box | drawn px > 0 and the drawn bbox is not a corner artefact | N-9, N-11 |
| G-4 Attributes are real | WFS `propertyName` without geometry at `startIndex` 0 / mid / last, or ArcGIS `outFields` + `returnGeometry=false` | values vary, are plausible, and are not constants or nulls | N-19 → DQ-4 |
| G-5 Metadata internally consistent | published envelope vs title vs declared CRS vs the data itself | no contradiction; envelope legal for its CRS | A-8, N-24, X-2/X-3/X-5 → DQ-2, DQ-7 |
| G-6 Licence text exists and is ours to rely on | item `licenseInfo`/`accessInformation`, CKAN `license_id`, capabilities `Fees`/`AccessConstraints`, the publisher's own terms | explicit permission for the intended use, and the *original* creator's terms checked when fields reveal republication | DQ-3 |
| G-7 Vintage fits the claim | the service's own date fields (`observedAt`, `valid_on`/`valid_to`, item `created`) | a "current" indicator requires an observation date within the staleness budget the UI shows (`lib/data/sources.ts:143-146`) | DQ-9 |
| G-8 Reproducible availability | the same request succeeds on a repeat visit, or the failure is recorded as the norm | verified twice, days apart, before a scheduled job depends on it | N-29, P-5, P-8 → DQ-10 |

Anything that fails G-2 or G-5 is **rejected**, not flagged. Everything else is flagged and carries
its `DQ-n` list into the registry so the caveat travels with the data
(ARCHITECTURE §7.2 `quality_findings`).

## 2. Findings

### DQ-1 — HTTP 200 is not evidence of data
**Statement.** Every success signal used in this project is a content check, because a geospatial
service will happily answer 200 with nothing in it.
**Measured.** Three blank-but-valid PNGs came back from correct-looking requests on the same layer,
same size, same CRS: N-9 (0 drawn px, 0 colours, 3,906 B) against N-8 (4,708 drawn px, 255 colours,
19,515 B) — the only difference was bbox axis order. N-11 reproduced the same trap in EPSG:3857.
X-1 rendered 600×400 px, one distinct colour, 100 % white, over an Ethiopian bbox. And on ArcGIS,
`499 Token Required for subscription content` and `404 Requested Service not available` both arrived
**inside an HTTP 200 body** (A-9, A-10, A-11; re-confirmed 2026-10-30 as `http=200` with the error
JSON).
**Rule.** Status code is never a verification result. `http.ts` classifies failures from `res.ok`
(`lib/data/http.ts:110`), which cannot see an ArcGIS in-body error, so provider clients must inspect
`json.error` first (ARCHITECTURE §4.1.7). A blank image is a failure, not "no data in this viewport".

### DQ-2 — The published extent contradicts the dataset's own title
**Statement.** A layer can be reachable, licensed, and geographically not what it says it is.
**Measured.** `40_Church_Forests_in_Northern_Ethiopia` returns exactly 40 features but its extent is
4,180,447 1,300,139 .. 4,190,800 1,309,925 in EPSG:3857 ≈ **10.4 km × 9.8 km** (A-8) — one small
window, not a country's church forests; the item description also says "Archived on June 16, 2025".
Two layers on the same host advertise Ethiopian titles with extents at **91.5–109.4 E** (Mekong basin,
X-2/X-5), and `Population_density`/`Mountain_classes` are stored in **EPSG:32647** (zone 47N, wrong
for Ethiopia) with malformed extents (X-3). `Ethiopia_Tree_Cover_Loss_2001_2019`'s item record is
public while its service answers 404 (A-11) — a stale item pointing at a dead service.
**Rule.** Envelope is checked against the country box before anything else, and the title is treated
as marketing. Registry stores published *and* measured extent with the method (ARCHITECTURE §5.3).
**Effect.** Rejected: all of the above.

### DQ-3 — Licence unproven, or third-party republication of someone else's data
**Statement.** "Publicly readable" and "licensed for our use" are different claims, and the most
common gap in this pass was licence silence.
**Measured.**
- `Ethiopia_Forest_Data`, `Ethiopia_Biodiversity_Data`, `Ethiopia_National_Forest_Priority_Areas`:
  reads work, `licenseInfo` is **null** (A-7), and the 34 field names — `WDPAID`, `WDPA_PID`,
  `PA_DEF`, `ORIG_NAME`, `DESIG` — are the UN-WDPA/IUCN protected-area schema. So the publisher on
  the item record is a republisher, and the terms that matter are WDPA's, not the account's.
- `geonode:eth_roads` attributes (`med_descri`, `rtt_descri`, `f_code_des`, `iso`) are a commercial
  road-product vocabulary (N-20). Nobody told us where the roads came from; the field names did.
- MoA hub: **all 25 sampled packages have `license_id` unset** (P-2), including EIAR land-cover and
  the ISRIC/SoilGrids-derived soil grids — where the original creator's terms are certainly not the
  portal's.
- `Basemap_Ethiopia`: `licenseInfo` empty (A-6), despite dated admin codes that look useful.
- Esri-published Ethiopia items: `licenseInfo` = **Esri Master License Agreement** (A-2), and the
  data endpoint is subscription-gated anyway (A-10).
- NSDI: `Fees: NONE`, `AccessConstraints: NONE` on all four capabilities documents (N-1…N-4) — that
  is *no fee*, not a licence grant, and no CSW record supplied licence text.
**Rule.** `unspecified` is treated as **no permission**, not as probably fine. A licence string is
required in the registry and in the DB column (`license not null`, non-blank), and where a field
vocabulary reveals a third-party origin, the original creator's terms must be read and cited.
**Effect.** RCMRD/forest layers and `eth_roads` are display-blocked pending an answer; GRID3 (CC BY,
A-2) and geoBoundaries (CC BY 4.0) are the two Ethiopia datasets in this pass with an explicit grant.

### DQ-4 — Placeholder and contradictory attribute values
**Statement.** Geometry can be perfect while the numbers attached to it are filler.
**Measured.** `geonode:eth_woreda_2013` (789 features, N-16) read attribute-only at `startIndex`
0/250/500/786 (N-19): Addis sub-city rows carry **`population: 150000` identically**; rows further
down carry `population: 0` with **`name: null`**; a `regionname` is `SNNPR` on one row and `Oromia`
on another with the same filler value. `geonode:market_places` (34 points, N-16) is Addis-only
(38.73–38.86 E, 8.87–9.07 N) and contains a category literally spelled **`Main Markeing Center`** —
a hand-typed table, not a survey. `geonode:eth_adm0` carries `name_obsol: "Abyssinia|Italian East
Africa"` (N-17): historically interesting, and a warning that name fields need a validity date.
Conversely, `Basemap_Ethiopia` *does* carry `valid_on`/`valid_to` (A-6), which is the shape this
finding asks every name field to have.
**Rule.** Gate G-4. A dataset with constant or null key attributes is never labelled demographics,
population or market network, however well it renders (N-12 drew 53.1 % of the canvas). Typographical
evidence like `Main Markeing Center` is recorded because it predicts data quality better than any
landing page does.

### DQ-5 — Published units are not an indicator
**Statement.** A raster that exists is not a measurement of the thing we want.
**Measured.** NSDI WCS has exactly **2** coverages (N-3). `geonode__geonode_aa14` is a
`RectifiedGridCoverage` of **≈5 km × 5 km** (467536 993370 .. 472535 998369) at **2.181 m** pixels in
EPSG:32637 whose `rangeType` uom is **`W.m-2.Sr-1`** (N-23) — spectral radiance. Radiance is not
NDVI, not vegetation, not yield; deriving an index needs bands and a solar geometry we do not have.
`geonode__geonode_ls_probability_prediction001` claims EPSG:32637 with an envelope spanning
**1,655 × 1,260 km**, impossible for a 6°-wide UTM zone (N-24), so its georeferencing is broken
wherever its pixels came from. `GetCoverage` validated and rejected our range subset (N-25), so even
the download path is unproven. The one genuinely agricultural raster on the portal,
`abbay_basin_gsocseq_finalsoc_ssm2_2030_2`, has "2030" in its name — a projection, not an
observation, and its semantics were never read.
**Rule.** `range_uom` is stored and displayed verbatim (ARCHITECTURE §7.2); no unit is "converted"
into an indicator in application code; a single-zone raster is never presented as national; and a
projection is never rendered as current data.

### DQ-6 — Branch-pinned provenance is not provenance
**Statement.** A URL that names a mutable branch records *a file*, not *the bytes we used*.
**Measured.** The repository's live boundary source is
`…/wmgeolab/geoBoundaries/**main**/releaseData/gbOpen/ETH/geoBoundaries-ETH-ADM{0,1}_simplified.geojson`
(`lib/data/boundaries.ts:16`, `:23`). geoBoundaries publishes revisions; if upstream re-releases on
`main`, the outline under a farmer's cursor changes while every stored row keeps the old geometry —
and nothing in our data tells us which happened, because we do not keep a digest.
**Rule.** Pin to a commit/tag, or store the retrieved digest. The registry needs
`source_revision` (commit SHA or ETag) and `content_digest` alongside `retrieved_at`, so "the
boundary we drew last month" is reconstructible. This is the geospatial case of the general
provenance rule, and it is why `observedAt` alone is not enough.
**Effect.** Action item, not a rejection: geoBoundaries stays recommended (CC BY 4.0, working,
already used) **after** the pin is fixed — catalog §5 ranking #1 with that caveat.

### DQ-7 — Degenerate or absent envelopes in published metadata
**Statement.** Capability documents lie by omission, and a parser that trusts them silently inherits
the lie.
**Measured.** In NSDI's WMS GetCapabilities, 33 `-Infinity` coordinate values appear across the
`EX_GeographicBoundingBox` blocks of **4 named layers** — `geonode:cultural_features`,
`geonode:gazetteer_50k_data`, `geonode:rural_schools`, `geonode:urban_schools` — out of 137 layers
(137 bounding boxes present, N-1). The same 4 are among the 69 WFS `FeatureType`s advertising
`LowerCorner=-Infinity` (N-2). Separately, WFS advertises **0 `OtherCRS` elements** for all 69 types,
yet the server demonstrably reprojects to EPSG:3857 when asked (N-18) — so under-advertising is as
real a hazard as over-advertising.
**Rule.** Metadata extent is a claim, never a gate input (ARCHITECTURE §5.3). Layers with
degenerate envelopes get their extent from a `returnExtentOnly`/`resultType=hits`-style read or from
the drawn-pixel bbox. Advertised CRS support is recorded as *advertised*, and reprojection is
re-tested per layer rather than assumed in either direction.

### DQ-8 — Mixed CRS inside one nominal source
**Statement.** "The NSDI boundaries" is not one coordinate space, and overlaying without normalising
produces a map that is confidently wrong.
**Measured.** Across the 69 WFS feature types the `DefaultCRS` values seen are 4326, 3857, **32637**
and **20137** (N-2). `geonode:eth_woreda_2013` is stored in **UTM 37N**, `geonode:eth_adm0` in 4326,
some regional layers in the **legacy Ethiopian grid 20137**, and `market_places` carries coordinates
twice — 4326 geometry plus `x_coord`/`y_coord` in UTM metres (catalog §2.2). GRID3 and every Esri
service measured store in **wkid 102100** while their item extents are geographic (A-4).
**Rule.** Normalise to 4326 lon/lat at the connector edge; reject unknown SRIDs at load; no
hand-rolled transforms — and note that 20137 has **no transformation parameters published in the
metadata we read**, so any "obvious" conversion would be an untraceable error (ARCHITECTURE §6.2).
Duplicate coordinate columns are checked against each other before either is trusted.

### DQ-9 — Vintage cannot support a "current" claim
**Statement.** The oldest failure mode is a fresh-looking layer describing an old reality.
**Measured.** `eth_woreda_2013` — the name is the vintage, and Ethiopian administrative geography has
changed since (region names in the data include `SNNPR`, which no longer exists as such). The Addis
social-service layers are 2020–2021, covid-era (`aa_covid19_sites`), and dormant. GRID3 Ethiopia v1.0
is a **2021** "Social Distancing" snapshot with `hasStaticData: true` (A-3/A-4). The MoA land-cover
resource is `ethiopian-lulc_2003_final` (P-2). The church-forest item was archived 2025-06-16 (A-8).
`dct:modified 2026-03-30` on an NSDI record is the **record's** date, not the data's (catalog §2.2).
**Rule.** Gate G-7. Every layer carries `observedAt` from the service or `null`, and the UI shows the
scene date beside the layer, exactly as GIBS already does (`lib/data/types.ts:256-257`). A record
date is never copied into `observedAt`. No dataset from this pass may be presented as a current
indicator; 2013–2021 material is dated context only, and `Basemap_Ethiopia`'s `valid_on`/`valid_to`
(A-6) is the model for how it should be published.

### DQ-10 — Availability drifts during a single session
**Statement.** One success is not a verified integration.
**Measured.** MoA CKAN answered `package_search?rows=25` in 11.9 s and then returned **502 for
`rows=0`** — the cheaper call — and 504 for a filtered search (P-2 vs P-3, P-4, P-5); later in the
same session the host failed the TLS handshake outright (P-8). NSDI threw
`curl: (28) Failed to connect … after 21100 ms` between two calls that succeeded in ~400 ms (N-29).
**Rule.** Gate G-8; `verification_status` carries `verified_at` and is re-run on a schedule
(ARCHITECTURE §8.2), and a failed re-check sets `availability_error` rather than quietly serving the
last-known-good copy as current. Retries with jitter (`lib/data/http.ts:47-55`) are for transient
faults; they are not a fix for a 60-second gateway timeout, and a job that always reports `partial`
erodes trust in the status view.

### DQ-11 — Footprint mismatch between the geometry and the claim
**Statement.** The scale at which data exists bounds what can be said about a place.
**Measured / applicable.** The country polygon is **4,642 vertices** for the whole of Ethiopia
(N-17) and display geometry is decimated to ≤140 points per ring in the repo today
(`lib/data/boundaries.ts:37`) — an admin outline drawn at that level cannot support a statement
about a woreda. GRID3's density layer is polygon-per-settlement with `UNIT_AREA`/`BUILT_PROP`
columns (A-4): aggregating it to a region is defensible, reading it as a field is not. The existing
satellite schema already makes this visible per row via `pixel_size_meters` and the caveat that
"612 m NDVI pixel does not describe a quarter-hectare field"
(`supabase/migrations/20261026000500_data_satellite_observations.sql:120-121`); the same discipline
is required of vector layers. `Basemap_Ethiopia`'s `maxScale 76444` (A-6) is the publisher telling us
the scale below which it stops being meaningful — that belongs in the registry, not in a component.
**Rule.** Record resolution/footprint and scale hints per layer; refuse claims finer than the data's
own grain; keep the mandatory `caveat` column.

## 3. How a finding is expressed downstream

- Catalog: `DQ-n` per dataset row, plus the `Verdict` and `Use` columns it determined.
- Registry/DB: `quality_findings text[]`, `verification_status`, `verified_at`, `verified_by_test`,
  `measured_envelope` + method, `source_revision` + `content_digest`, mandatory `caveat`
  (ARCHITECTURE §7.2). The DB refuses `verified` without a dated test id, so DQ-1 is enforced by a
  constraint and not by diligence.
- UI: scene date, `stale`, `servedFromCache`, units, value kind — all already on `Provenance`
  (`lib/data/types.ts:29-51`).

## 4. Re-verification procedure (so this can be repeated, not remembered)

1. Strict-TLS reachability, no override (G-1).
2. Capabilities/`f=json` metadata read, with namespace-tolerant parsing, and the byte size recorded.
3. Layer enumeration; discard degenerate-envelope layers (G-5, DQ-7).
4. Cheap coverage test: ArcGIS `returnCountOnly` ± `bbox`; WFS `resultType=hits` (G-2).
5. Attribute probe: `propertyName` without geometry at first/mid/last index (G-4).
6. Image probe: GetMap/GetTile with axis order per version, then pixel histogram and drawn-pixel bbox
   (G-3).
7. Licence read: item `licenseInfo`/`accessInformation`, `Fees`/`AccessConstraints`, `license_id`,
   and third-party terms where the field vocabulary demands it (G-6).
8. Repeat one of the earlier successes on a different day (G-8).
9. Write every request into a dated log with no credentials, and record failures — the rejected
   candidates in `docs/GEOSPATIAL_VERIFICATION_REPORT.md` §4 are as much output as the adopted ones.

## 5. Honest limits of this assessment

- One probe day (2026-10-30), one network location, one user-agent. DQ-10 is a finding *about* that
  limitation, not a claim that it is overcome.
- Nothing was verified from Vercel's runtime, and no request was authenticated: every source that
  needs a token was recorded as `auth_required`/`failed`, not as absent.
- Bulk raster payloads were deliberately not downloaded, so radiometric quality of the two WCS
  coverages is *unassessed* rather than bad.
- Per-row storage cost for the largest vector layer (GRID3 L2, 54,446 features) was measured as a
  count only; the byte cost is unknown until one page is pulled in Phase 2.
- Licence questions are **open**, not answered pessimistically: DQ-3 blocks use until someone with
  authority reads the terms, and the standing rule that an unspecified licence means *no permission*
  is what makes the block real.
- No SQL was executed, no migration applied, no grant or RLS policy changed, nothing deployed,
  committed or pushed in producing this file.
