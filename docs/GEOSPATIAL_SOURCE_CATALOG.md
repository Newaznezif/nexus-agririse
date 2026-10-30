# Nexus AgriRise — Geospatial Source Catalog (Phase 1: Ethiopia discovery)

Status: **proposal, not an integration list.** Nothing in this file is wired into the app, and no
endpoint here has been added to production. Phase 1 asked for dataset discovery and endpoint
verification only.

Probe date: **2026-10-30**, all requests read-only (`GET`/KVP OGC operations, no tokens, no writes).
Every "verified" claim below names the operation that produced it; a homepage loading is never
counted as verification. Full request-level evidence, including the failures, is in
`docs/GEOSPATIAL_VERIFICATION_REPORT.md`. Risks and rejection rules are in
`docs/GEOSPATIAL_DATA_QUALITY.md`. How these sources would be reached in code is in
`docs/GEOSPATIAL_ARCHITECTURE.md`.

## 1. Reading the columns

| Column | Meaning |
| --- | --- |
| Protocol | Machine protocol actually exercised, not the protocol the provider advertises on its landing page. |
| Layer id / name | The addressable unit. A service is not a dataset; the layer is. |
| Extent | Measured envelope (metadata bbox *or* a bbox-restricted query count), with the CRS it was reported in. |
| CRS | As published by the service. `native` = what the layer is stored in; `requested` = what the server agreed to reproject to on request. |
| Formats | Output formats the service itself accepted in a read test. |
| Vintage | Observation/validity date of the data, from service metadata or attributes. |
| Retrieval | When we read it: all rows are 2026-10-30 unless the source is the repository's own earlier measurement. |
| Cadence | Update frequency as evidenced, not as marketed. |
| Licence | Text the service returned about licence/attribution. `unspecified` is a finding, not an oversight — see DQ-3. |
| Auth | What an unauthenticated caller got. |
| Limits | Pagination/record caps measured from the service's own `maxRecordCount` (ArcGIS) or honoured `count`/`startIndex` (OGC). |
| Verdict | `verified` / `partially verified` / `failed` / `unverified` — definitions in §5. |
| Use | `store` (persist normalised data), `display` (render as an external read-only layer), `both`, `none`. |

## 2. Ethiopia-relevant sources

### 2.1 Already in the repository — do not duplicate

| Provider | Dataset | Category | Endpoint actually used | Protocol | Extent | CRS | Formats | Vintage | Cadence | Licence | Auth | Limits | Verdict | Use |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| NASA GIBS | VIIRS NDVI 8-day, MODIS Terra NDVI 8-day, GPM IMERG precipitation | Vegetation, Climate | `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/<layer>/default/{date}/GoogleMapsCompatible_Level{8,9,6}/{z}/{y}/{x}.png` (`lib/data/gibs.ts:18,34,55,76`) | WMTS (KVP, time-enabled) | global, sampled over Ethiopia | 3857 | PNG tiles (colormap XML for value decode) | per-date layer dimension, probed back ≤20 days (`findLatestLayerDate`) | 8-day / 3-day | NASA open with citation | anonymous | n/a (tiles) | **verified** (in use; tile sampling decodes pixels in `lib/data/pngIndex.ts`) | both |
| geoBoundaries (gbOpen) | ETH ADM0/ADM1 outlines | Demographics & infrastructure (administrative) | `https://media.githubusercontent.com/media/wmgeolab/geoBoundaries/main/releaseData/gbOpen/ETH/geoBoundaries-ETH-ADM{0,1}_simplified.geojson` (`lib/data/boundaries.ts:16,23`) | static GeoJSON | country | 4326 | GeoJSON | 2016 snapshot | irregular, upstream | **CC BY 4.0** | anonymous | whole file (ADM1 simplified ≈391 KB, 11 features) | **verified** | store |
| Open-Meteo / NASA POWER | point climate | Climate | existing connectors | REST JSON | point | n/a | JSON | live + historical | hourly/daily | open with attribution | anonymous | per-request | **verified** (pre-existing) | store (not geospatial tiles) |

⚠️ The geoBoundaries URL is **branch-pinned (`main`), not commit-pinned**, so "the boundary we drew
today" is not guaranteed to be "the boundary we drew last month". See DQ-6.

### 2.2 Ethio-NSDI — `https://ethionsdi.gov.et` (GeoNode + GeoServer 2.x + pycsw)

The richest Ethiopian government geospatial catalogue found in this pass, and the only one offering
WMS + WFS + WCS + WMTS + CSW together. Fees `NONE`, AccessConstraints `NONE` on all four
capabilities documents. Anonymous reads work.

| Dataset (layer) | Category | Protocol / endpoint | Layer id | Extent (measured) | CRS | Formats | Vintage | Cadence | Licence | Auth | Limits | Verdict | Use |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Country outline | Demographics & infrastructure (boundary) | WMS `GET /geoserver/wms`, WFS `GET /geoserver/wfs`, WMTS `GET /geoserver/gwc/service/wmts` | `geonode:eth_adm0` | 32.9999 3.3221 .. 47.9862 14.9000 (caps bbox); GetMap draws over the full canvas | native 4326; `srsName=EPSG:3857` honoured although **not advertised** | PNG (WMS), GeoJSON/GML (WFS), PNG tiles (WMTS) | unknown — no attribute date | unknown, `dct:modified` 2026-03-30 is the record date, not the data date | `Fees NONE`, no licence statement in any record | anonymous | WFS 1 feature; country polygon ≈118 KB in 4326 / ≈165 KB in 3857, 4,642 vertices | **verified** (see TLS blocker §4) | both |
| Woreda/sub-city boundaries | Demographics & infrastructure | WFS | `geonode:eth_woreda_2013` | 32.856 3.358 .. 48.170 14.846 | native **32637 (UTM 37N)** | GeoJSON | "2013" in the name | irregular | unspecified | anonymous | 789 features (`resultType=hits`) | **verified as a boundary; FAILED as demographics** — attributes are Addis sub-city rows with `population` fixed at 150000, and national rows carry `population: 0`, `name: null` (DQ-4) | display only, with a caveat |
| Roads | Demographics & infrastructure | WFS | `geonode:eth_roads` | 33.006 3.323 .. 47.949 14.817 | 4326 | GeoJSON | unknown | unknown | **unspecified, and the attribute vocabulary (`med_descri`, `rtt_descri`, `f_code_des`, `iso`) matches a commercial road schema, so redistribution rights are unproven** | anonymous | 1,650 features | partially verified (read works; provenance unresolved — DQ-3) | none until provenance is answered |
| Market places | Agriculture (market points) | WFS | `geonode:market_places` | 38.726 8.868 .. 38.863 9.068 (**Addis only**) | 4326, with `x_coord`/`y_coord` duplicated in UTM metres | GeoJSON | unknown | unknown | unspecified | anonymous | 34 points | partially verified — **not a national market network**, and one category value is literally `Main Markeing Center` | display of Addis markets, no indicator use |
| Regional boundaries (`afar`, `amhara`, `oromia`, `somali`, `gambella`, `benishangul_gumuz`, `dire_dawa_shemach`, `harar_shemach`) | Demographics & infrastructure | WFS | per-region layers | each region's own envelope, all inside Ethiopia | 4326 (some 20137) | GeoJSON | unknown | unknown | unspecified | anonymous | small feature counts | verified reads; vintage unknown | store (candidate, after vintage is confirmed) |
| Addis social-service layers (~40 layers: hospitals, schools, quarries, food stores, covid-era support) | Demographics & infrastructure | WFS/WMS | `geonode:general_hosp`, `geonode:rural_schools`, `geonode:aa_covid19_sites`, … | mostly Addis-area envelopes | 4326 / 3857 / **20137 (legacy Ethiopian grid)** | GeoJSON, PNG | 2020–2021 era content | dormant | unspecified | anonymous | tens of features | partially verified — 2013–2021 vintage, unsuitable for a "current" indicator | none |
| Abbay (Blue Nile) basin soil coverage | Agriculture/soil, Water | WMTS/WMS | `geonode:abbay_basin_gsocseq_finalsoc_ssm2_2030_2` | basin, envelope inside Ethiopia | not read | PNG tile, WCS not offered for it | name asserts a 2030 projection | static | unspecified | anonymous | tile/raster only | partially verified — **the only genuinely agricultural raster surfaced on the portal, and its semantics were never read** (needs `DescribeCoverage`/legend work in Phase 2) | display candidate |
| Satellite "LASAC" tiles (`geonode__geonode_aa14`, plus `LASAC Data aa19/aa22/Mekelle 2023-06-30` records) | Vegetation/Agriculture (suspected) | WCS 2.0.1 `GET /geoserver/wcs` | 2 coverages total | `aa14`: 467536 993370 .. 472535 998369 in **EPSG:32637** = a ~5 km × 5 km tile | 32637, 2.181 m pixels, `nativeFormat image/tiff` | WCS GetCapabilities works; **GetCoverage rejected our range subset** ("Invalid point value 0:3…") | `Mekelle 2023-06-30` record date | irregular | unspecified | anonymous | 2 coverages | partially verified — the published range unit is `W.m-2.Sr-1`, i.e. **spectral radiance, not a derived agronomic indicator** (DQ-5) | none as-is |
| Landslide probability (`geonode__geonode_ls_probability_prediction001`) | Terrain/hazard | WCS | 1 coverage | envelope −162008 381834 .. 1493451 1642104 in EPSG:32637 ≈ **1,650 km × 1,260 km — impossible for UTM zone 37N** | 32637 claimed | — | unknown | unknown | unspecified | anonymous | — | failed as a usable product (broken envelope) | none |

Catalogue surface: WMS advertises 137 `Layer` elements / 269 name references; **WFS advertises 69
feature types with zero `OtherCRS` entries**; WMTS capabilities is **7,769,733 bytes for 136
TileLayers over 6 matrix sets**; the pycsw catalogue holds **133 records but its pagination is
broken** (every `startIndex` returns the identical 10 identifiers, and `maxrecords=40` is clamped to
10), so the full inventory could not be enumerated programmatically.

### 2.3 ArcGIS Online — public, anonymous, query-tested

`https://www.arcgis.com/sharing/rest/search` works anonymously and is the discovery route (793 items
match `title:"Ethiopia" AND type:"service"`).

| Dataset | Category | Service URL | Layer id | Extent (measured) | CRS | Formats | Vintage | Cadence | Licence | Auth | Limits | Verdict | Use |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| GRID3 Ethiopia settlement layers v1.0 | Demographics & infrastructure, Terrain(built-up) | `https://services6.arcgis.com/kOvusPqAUjVWKF9D/arcgis/rest/services/ETH_SocialDistancing_v1_0/FeatureServer` (owner `WorldPop_Soton`, item `672a9cbb360b4c809b684768ffb5645d`) | L0 points (212), L1 urban extents (204), **L2 built-up + density (54,446)** | 34.490 3.519 .. 44.319 14.335 (item extent); every layer's bbox-restricted count equals its total count | storage 102100, `outSR` accepted | `supportedQueryFormats: JSON` **only — no geoJSON** | 2021 (v1.0, "Social Distancing" era) | static snapshot (`hasStaticData: true`) | item `licenseInfo`: redistribution under **Creative Commons Attribution** (CC BY) | anonymous | `maxRecordCount: 2000` → L2 needs ≈28 `resultOffset` pages | **verified** (metadata, layer enumeration, count + bbox counts) | both — store L2 aggregates, display L0/L1 |
| Basemap Ethiopia polygons | Demographics & infrastructure (admin names/codes) | `https://services1.arcgis.com/E30nMIuUoea7pBjP/arcgis/rest/services/Basemap_Ethiopia/FeatureServer` | L0 `Basemap_Ethiopia_polygons` (107) | 3672630 379452 .. 5342026 1671398 (3857) = ≈33–46.9 E, 3.4–15.1 N | 102100 | JSON only | GRID3-style `adm2_pcode` with **`valid_on`/`valid_to`** columns → dated, current at publication | static (`hasStaticData: true`) | item `licenseInfo` empty → **unspecified** | anonymous | `maxRecordCount: 2000`, 107 rows; `maxScale 76444` → not drawn past ≈1:76k | verified read; licence unresolved | display candidate; store only if licence answered |
| Ethiopia Forests Data | Vegetation (protected areas) | `https://services6.arcgis.com/zOnyumh63cMmLBBH/arcgis/rest/services/Ethiopia_Forest_Data/FeatureServer` | L0 (57 polygons) | 34.371 4.704 .. 42.428 13.816 (item extent) | 102100 | JSON only | item created 2024-06-12, modified 2024-07-03 | irregular | **`licenseInfo` null**, `accessInformation` null | anonymous | 2000/page, 57 rows | partially verified — fields are `WDPAID`, `WDPA_PID`, `PA_DEF`, `DESIG`: this is **UN-WDPA/IUCN protected-area data republished by a third party under no stated licence** (DQ-3) | none until WDPA terms are checked |
| Ethiopia Biodiversity Data | Vegetation | `…/Ethiopia_Biodiversity_Data/FeatureServer` | L0 (79 polygons) | 33.165 3.402 .. 43.609 14.447 | 102100 | JSON only | created/modified 2024 | irregular | `licenseInfo` null | anonymous | 2000/page | partially verified — same WDPA field set as above | none until licence answered |
| Ethiopia National Forest Priority Areas | Vegetation | `…/Ethiopia_National_Forest_Priority_Areas/FeatureServer` (owner `rcmrd_online`) | L0 (57) | same envelope as Forests Data | 102100 | JSON only | 2023-03-25 | static | `licenseInfo` null; `accessInformation` "Ethiopia Forest Development" | anonymous | 2000/page | partially verified | display candidate with attribution to Ethiopia Forest Development, pending licence |
| 40 Church Forests in Northern Ethiopia | Vegetation | `https://services3.arcgis.com/jQx3MSUVUlE1Xz9I/arcgis/rest/services/40_Church_Forests_in_Northern_Ethiopia/FeatureServer` | L0 (40 points) | **37.554 11.599 .. 37.647 11.685 — a ~10 km window**, not 40 dispersed sites | 102100 | JSON only | item description: "Archived on June 16, 2025 by NGS admin" | archived | `licenseInfo` null | anonymous | `maxRecordCount: 1000` | **failed** for our purpose — archived, and the envelope contradicts the title (DQ-2) | none |
| Ethiopia TIPA points (Kew/RBGE) | Agriculture (indigenous land management sites) | `https://services2.arcgis.com/Zh40oETt5seUAu0e/arcgis/rest/services/Ethiopia_TIPA_Point/FeatureServer` | many single-feature layers, one per IPA (L1…L18+) | 34.596 6.958 .. 39.760 10.048 (**south-west only**) | 4326 | JSON | 2021-08-23 | static | `licenseInfo` empty string | anonymous | 2000/page but 1 feature per layer → a request per site | partially verified — fragmented service shape, partial country coverage | none in Phase 1 |

### 2.4 Sources that exist but could not be verified from here

| Source | What we found | Verdict |
| --- | --- | --- |
| CAMELS-Eth (JICA) Basin Explorer | `https://camels.ethmetbulletin…/`→ page 200 (62,875 B). The UI exposes `download-catchment-geojson`, `download-lakes-geojson`, `download-gauging-station-geojson`, `download-water-level-station-geojson` **as client-side anchors only**; no resolvable data URL appears in the served HTML. | unverified — Water-category candidate worth a Phase 2 manual/API request |
| WALRIS (Ethiopia Water and Land Resource Centre) | root 200 (41,751 B, Drupal), `/api/...` guess → 404 "Not Found" HTML. | unverified |
| LSC-Hub geoportal | `https://lschub-geoportal.vercel.app` — `/data/datasets` (58,844 B) and `/geoportal` (70,812 B) render; copy says "Access and visualize geospatial layers from our GeoServer", and partner logos name EIAR, ILRI, ISRIC, CIMMYT, ACATECH. **No GeoServer/WMS/WFS URL appears anywhere in the served HTML; `/api/datasets` → 404.** | unverified — the promise is documented, the endpoint is not discoverable without reading their JS bundles or contacting EIAR |
| WorldPop | `https://www.worldpop.org/` root 200 (274,581 B). `GET /rest/data?pop=total&iso3=ETH` → **HTTP 500** (6,015 B HTML), same via `hub.worldpop.org`, and `/geodata/listing?category=population` → 404. | failed (REST API not functioning on the day of the probe) — GRID3-on-ArcGIS (CC BY) covers the same need today |
| ArcGIS Living Atlas (aggregated) | Every Ethiopia item we reached through `sharing/rest/search` is `access: public`, but the two most relevant Esri-published services are **subscription-gated at the data endpoint** (§4 / report G-2). | partially verified — item metadata only |

## 3. Coverage by the six target categories

| Category | Best current option | Honest gap |
| --- | --- | --- |
| Agriculture | MoA Agricultural Data Hub soil grids (WoSIS, SoilGrids250m, HWSD, WISE, ISCN) — but cert-broken; NSDI Abbay basin soil coverage | no machine-readable *crop statistics* endpoint found; EIAR/CSA data is tabular, not spatial |
| Vegetation | NASA GIBS NDVI (already in use, 8-day, free, tile-samplable); RCMRD forest/protected-area polygons (licence unresolved) | tree-cover-loss endpoint is dead (404) |
| Terrain | NSDI has no elevation service; GIBS has no DEM | **open**: SRTM/DEM is a Phase 2 discovery item, ideally COG on a CDN rather than a national portal |
| Climate | Open-Meteo + NASA POWER point data (verified, in use); GIBS IMERG precipitation tiles | no national station network endpoint verified |
| Water | NSDI `geonode:river_sand`, lakes within the Ethiopia basemap service; CAMELS (unverified) | no verified gauge *time series* endpoint |
| Demographics & infrastructure | GRID3 Ethiopia (CC BY, 54,446 built-up/density polygons), geoBoundaries ADM0/ADM1 (CC BY 4.0), NSDI `eth_adm0`/regions | NSDI woreda populations are placeholder values; WorldPop REST is 500 |

## 4. Blockers that decide suitability

1. **Ethio-NSDI's TLS is not usable by a conforming client.** A strict (browser-equivalent) request
   fails with `SEC_E_UNTRUSTED_ROOT`; `openssl s_client` shows a **self-signed `CN=localhost` leaf,
   one certificate in the chain, no SAN extensions**, valid 2026-03-27 → 2031-03-26. Plain HTTP
   302-redirects to HTTPS. Consequence: NSDI can never be an in-browser tile/overlay source, and our
   own `fetch`-based HTTP layer (`lib/data/http.ts`) will refuse it as written. Treat it as a
   server-side candidate behind a documented trust decision, not as a live integration.
2. **MoA Agricultural Data Hub's certificate is expired** (`SEC_E_CERT_EXPIRED`), later attempts
   failed the TLS handshake outright, and its CKAN API intermittently returns 502/504 after ~60 s.
   The catalogue itself is real (CKAN 2.9.5, **1,915 datasets**, resource formats include WMS 15,
   WFS 7, WCS 3, TIF 24, ZIP 5 in the first 25 packages) and is the most Ethiopia-specific
   agricultural inventory found — but it is currently unreachable by a secure client, and **none of
   the 25 sampled packages declares a licence**.
3. **Esri-published Ethiopia boundaries are subscription-only.** `ETH_Boundaries_view/FeatureServer`
   answers `499 Token Required for subscription content` to metadata *and* every query while the item
   record stays public; `licenseInfo` is the **Esri Master License Agreement**. Rejected for both
   storage and display.
4. **The Ethiopian "ArcGIS Ethiopia" organisation's MapServers have no public provenance.** The
   directory listing requires a token, and the four `serviceItemId`s those services advertise all
   resolve to *"Item does not exist or is inaccessible"*, so licence and publisher are unverifiable.
   Two of them are also the wrong geography: `Deforestation (2001-2024)` spans 91.49–109.43 E
   (Mekong basin) and the crop-diversity layer is stored in **EPSG:32648 (UTM zone 48N)** with a
   negative X extent.
5. **NSDI catalogue pagination is broken**, so a connector cannot enumerate 133 records: it can only
   see the first 10 repeatedly. Any NSDI discovery must be a curated allow-list, not a crawl.

## 5. Verdict definitions and the ranked shortlist

- **verified** — an authenticated-free data operation on that exact endpoint returned content that
  we then *checked*: a WMS/WMTS image whose pixel histogram contains drawn geometry inside Ethiopia,
  a WFS/ArcGIS read whose feature count and bbox-restricted count agree, or a GeoJSON whose geometry
  envelope lies inside the country box. A 200 status alone never qualifies.
- **partially verified** — the endpoint answers reads, but at least one required field (licence,
  vintage, coverage, semantics) is unresolved or contradicted.
- **failed** — the endpoint refused us (token/subscription), returned dead-service/500, produced a
  provably empty or wrong-geometry product, or its TLS made the read non-reproducible.
- **unverified** — we could not reach a machine endpoint at all from the public surface; nothing is
  claimed about quality.

**Recommended initial datasets, ranked by relevance × reliability × licensing clarity:**

1. **geoBoundaries ETH ADM0/ADM1** (CC BY 4.0, already used) — fix the branch-pinning first. *store.*
2. **NASA GIBS NDVI + IMERG** (existing, verified) — *display + point sampling.* Deliberately not
   duplicated by any new connector.
3. **GRID3 Ethiopia built-up/density + urban extents** (CC BY, 2021 vintage, JSON-only, 2,000-record
   pages) — *store aggregates for the regions we show; display L0/L1.*
4. **Ethio-NSDI `geonode:eth_adm0` + region outlines** (free, genuinely Ethiopian, WFS + WMTS proven)
   — *store, but only after a human decides the certificate question in §4.1.*
5. **RCMRD forest / biodiversity / priority-area polygons** — *display-only pending licence; cite the
   UN-WDPA origin, not the republisher.*
6. **MoA Agricultural Data Hub soil grids** — the highest-relevance Ethiopian inventory found, blocked
   entirely by §4.2; revisit when the certificate is fixed and licences are declared.

Rejected in this pass: Esri subscription boundaries; `40 Church Forests` (archived, envelope
contradicts the title); the two WCS coverages (radiance + impossible envelope); NSDI
`eth_woreda_2013` population attributes (placeholder values); the Mekong-region layers; CDE `Farms`
(31 gazetteer points, not farms); the DEA "candidate" WMS (its only layer is Coastlines and it
rendered 262,144/262,144 white pixels over Ethiopia).

## 6. What this catalog does not prove

- It does **not** prove any of these sources is reachable from Vercel's runtime, or that the
  production app can render them — nothing was deployed, and the two Ethiopian portals fail TLS in
  ways a browser will also reject.
- It does **not** prove PostGIS is enabled on the project's database. The repository contains no
  geometry columns, no `ST_*` call and no spatial migration, and the live database was never probed
  for the extension. The schema proposal in `docs/GEOSPATIAL_ARCHITECTURE.md` §7 is conditional on
  that check.
- It does **not** settle a single licence. Every "unspecified" above is an action item, and per the
  standing rules an unspecified licence is treated as *no permission*, not as *probably fine*.
- Vintage claims are as-published by the service; where the service published nothing, this file says
  "unknown" rather than guessing a date.
