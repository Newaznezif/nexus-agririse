# Nexus AgriRise — Geospatial Architecture (Phase 1 proposal)

Status: **design only. No code was written for this document, no connector was registered, no
migration was created, nothing was deployed.** Phase 1's job was discovery plus endpoint
verification; this file turns what the probes measured into a buildable design so the decision to
approve or change it is cheap.

Evidence convention: a claim about an upstream service cites `docs/GEOSPATIAL_VERIFICATION_REPORT.md`
by row id (`N-*` Ethio-NSDI, `A-*` ArcGIS, `P-*` Ethiopian portals, `X-*` rejected candidates). A
claim about this repository cites `file:line`. Data-quality rules cited as `DQ-n` live in
`docs/GEOSPATIAL_DATA_QUALITY.md`. Dataset names, licences and verdicts live in
`docs/GEOSPATIAL_SOURCE_CATALOG.md`.

## 1. Constraints the probes imposed (not chosen — measured)

Each row is a constraint that follows from a measurement, and the design consequence it forces.

| Measured | Evidence | Design consequence |
| --- | --- | --- |
| ArcGIS Ethiopia services advertise `supportedQueryFormats: "JSON"` only — no `geoJSON` | A-3, A-4, A-6 | Never request `f=geojson`. Normalise GeoJSON ourselves from `f=json` + `geometryType`. |
| `maxRecordCount` 2000; the largest useful Ethiopia layer has **54,446** polygons | A-4 | Offset paging (`resultOffset`/`resultRecordCount`) with a deterministic sort and a page ceiling; a page limit that is not enforced turns one ingest into 28 unbounded requests. |
| WMTS `GetCapabilities` = **7,769,733 B** for 136 layers; WMS 667,200 B; WFS 249,650 B | N-1, N-2, N-4 | Capabilities are parsed once and stored, never per request. The shared byte ceiling is 12 MiB (`lib/data/http.ts:15`), so the WMTS document fits once and comfortably fails ever; it needs its own ceiling and its own cache key. |
| One country polygon = **118,466 B / 4,642 vertices** in 4326, 165,345 B reprojected to 3857 | N-17, N-18 | Geometry is the cost, not attributes. Display geometry must be decimated (the repo already caps rings at 140 points, `lib/data/boundaries.ts:37`); full geometry only where a storage decision exists (§7). |
| WMS `GetFeatureInfo` on that polygon returned the **entire 118 KB geometry** instead of an attribute record | N-14 | GFI is never an attribute lookup on polygons. Attributes come from WFS `propertyName` (≈0.5 KB/feature, N-19) or ArcGIS `outFields` + `returnGeometry=false`. See §5. |
| ArcGIS answers `499 Token Required for subscription content` and `404 Requested Service not available` **inside an HTTP 200 body** | A-9, A-10, A-11 (re-confirmed 2026-10-30: `http=200` with `{"error":{"code":499,…}}`) | `http.ts` classifies failures from `res.ok` (`lib/data/http.ts:110`), which never fires here. The ArcGIS client must treat `json.error` as a failure and map `499`→`auth_required`, `404`→`no_data`. This is a real bug class, not a hypothetical. |
| pycsw pagination returns identical pages for every `startIndex`; `maxrecords` is clamped to 10 | N-5, N-6 | No catalogue crawl. Discovery = a curated allow-list in code, plus a human-readable catalog. A connector that "discovers layers automatically" would ingest 10 of 133 records and look healthy. |
| NSDI TLS is a self-signed `CN=localhost`, one certificate, no SAN; strict clients fail with `SEC_E_UNTRUSTED_ROOT`; HTTP 302s to HTTPS | N-26, N-27, N-28 | NSDI can never be a browser-side tile source, and `fetch` as configured will refuse it. Server-side only, behind the open decision in §11.1. |
| MoA hub: expired certificate, and the same CKAN call that succeeded at `rows=25` returned 502 at `rows=0`; filtered search 504 | P-2, P-3, P-5, P-6, P-8 | Not schedulable. Retries (`lib/data/http.ts:47`) cannot fix a 60-second gateway failure; a job would report `partial` forever. |
| NSDI connectivity failed mid-session (`curl: (28) … after 21100 ms`) while neighbouring calls succeeded | N-29 | "Verified once" is not "available". Verification status must carry a timestamp and be re-checked (§8.2). |
| Blank-but-valid PNGs from correct-looking requests (axis order), and a WMS that is 100 % white over Ethiopia | N-9, N-11, X-1 | Coverage proof is a pixel/content test, never a status code (§4.2, DQ-1). |
| Layers whose published envelope is `-Infinity`, contradicts the title, or is impossible for its own CRS | 4 NSDI layers (DQ-7), A-8, N-24, X-2, X-5 | Metadata extent is a *claim*. Usable extent must be measured (§5.3, §6.4). |

## 2. Reuse first — what already exists and must not be re-plumbed

The typed-connector core already implements most of what a geospatial subsystem needs. Everything
below is present in the repository today.

| Primitive | Where | Why the geospatial layer uses it as-is |
| --- | --- | --- |
| One HTTP path with hard timeout, jittered retries, rate-limit mapping, byte ceiling, and a deliberate refusal to log query strings or `response.url` | `lib/data/http.ts:13-18`, `:41-55`, `:60-88`, `:110-127` | All connectors. The no-URL-logging rule matters doubly here: HDX-style signed redirects (`http.ts:8-10`) and any future token-bearing ArcGIS URL must not reach logs. |
| `httpJson` / `httpText` / `httpBytes` | `lib/data/http.ts:169-171` | `httpText` for XML capabilities, `httpJson` for ArcGIS, `httpBytes` for tiles. |
| Process TTL cache with single-flight de-duplication, and failures *never* cached | `lib/data/cache.ts:68-96`, `:109-120` | Capabilities parsing and layer verification. |
| `Provenance` — source, sourceUrl, endpoint, license, retrievedAt, observedAt, valueKind, units, methodology, quality, coverage, maxAgeSeconds, stale, servedFromCache | `lib/data/types.ts:29-51` | A geometry or raster reference must ship with the same fields; nothing new is needed to make "as of" visible. |
| `ConnectorResult<T>` discriminated outcome, client-safe `SourceErrorCode`s | `lib/data/types.ts:53-65`, `:17-27` | New connectors return the same shape, so `fromConnector`/`withExtras` (`lib/data/api.ts:36,66`) and the status view need no changes. |
| `SourceDescriptor` already includes `category: 'geospatial'`, and `cadence` incl. `8daily`/`irregular`; `provenanceFor` computes staleness from both publisher lag and our copy age | `lib/data/types.ts:67-82`, `lib/data/sources.ts:79-99`, `:103-112`, `:126-148`, `:154-166` | Registering an Ethiopia source = one entry in `SOURCES`, plus the seed call. geoBoundaries and GIBS are already registered that way. |
| `GeospatialLayer` (meaning + caveat + tile template + matrix set + zooms + latest confirmed date + value range/units/kind) | `lib/data/types.ts:239-261` | This is the external-layer display contract. New layers fit it; no parallel type. |
| Indexed-PNG decode with paeth/filter handling and a typed failure reason | `lib/data/pngIndex.ts:13,23,37` | The value-reading path for tiled rasters (§4.4). Needs one addition, not a rewrite: GetMap/tile responses from GeoServer come back RGBA, not paletted (§4.4). |
| Boundary parsing, exterior-ring extraction, **ring decimation to 140 points**, area/centroid math | `lib/data/boundaries.ts:37,51,63,79,98` | Normalisation for display geometry already exists and is tested in production. |
| Ethiopia country box `3.4 ≤ lat ≤ 14.9`, `33.0 ≤ lon ≤ 48.0` | `lib/data/locations.ts:97-98` | The single coverage gate for every dataset, already used by the sample route (`app/api/data/geospatial/route.ts:48`). |
| Chunked upsert with conflict target, batch size 400, per-row fallback, lease-guarded run | `lib/data/sync.ts:50`, `:143-175`, `:707-718`, `:765` | Vector ingest writes through exactly this path, so no second ingestion mechanism. |
| Service-role client, window-guarded, sync-only | `lib/supabaseAdmin.ts` (`getSyncClient`, used at `lib/data/sync.ts:1`) | The only writer. Nothing in this design gives a browser a write path. |
| Schema house style: `data` schema, domains `data.value_kind`/`data.quality`, `touch_replaced_at` trigger, a comment on every table and load-bearing column, an anti-credential check on URL templates, a mandatory-caveat check, then `enable`+`force` RLS with **zero policies** and `revoke all … from anon, authenticated` | `supabase/migrations/20261026000100_data_schema_preparation.sql:30,69-70,128-131,161`, `20261026000500_data_satellite_observations.sql:48-57,71-74,153-162` | §7 follows this pattern rather than inventing one. |

Also governing: `AGENTS.md` at the repository root states this is **not** the Next.js this model was
trained on and requires reading `node_modules/next/dist/docs/` before writing route or rendering
code. That step belongs to Phase 2 — it is a prerequisite for §9, not something this document
skips.

## 3. The common metadata interface

One curated registry is the front door. No connector is reachable by URL from client code; the
client asks for a `layerId`, and the server resolves it through the registry.

```
GeoSourceEntry (registry row, authored in code + mirrored to the DB table in §7)
  id                  stable key, e.g. 'grid3-eth-builtup-l2'
  provider            'GRID3 / WorldPop (ArcGIS Online)'      → Provenance.source
  category            one of the six Phase-1 categories
  protocol            'arcgis-feature-service' | 'wms' | 'wfs' | 'wmts' | 'wcs' | 'static-geojson'
  endpoint            base URL (no credentials — same constraint the DB already enforces on tile templates)
  layerId             '2' | 'geonode:eth_adm0' | 'ETH_ADM0'   ← the addressable unit
  sridsAllowed        measured list; unknown SRIDs are a load-time failure, not a runtime surprise
  license / attribution   verbatim text the service returned, plus how it was obtained
  authRequired        false | 'token'      (every Phase-1 candidate that passed is false)
  useFlags            'store' | 'display' | 'both'
  limits              measured maxRecordCount / honoured count / page ceiling
  verification        status ('verified' | 'partially verified' | 'failed' | 'unverified')
                      + verifiedAt + the test id that produced it (N-17, A-5, …)
  qualityFindings     DQ-n list — so a caveat is data, not prose in a component
  ttl                 cache/refresh policy per object class (§8.2)
  caveat              mandatory, ≥20 chars, mirroring satellite_layers_states_limits
```

Connector signature, unchanged in kind from the existing five:

```
fetchArcgisFeaturePage(entry, page)  -> Promise<ConnectorResult<GeoFeatureCollection>>
getWfsFeatureType(entry)             -> Promise<ConnectorResult<GeoFeatureCollection>>
getWmtsLayerMeta(entry)              -> Promise<ConnectorResult<GeoLayerMeta>>
getRasterReference(entry)            -> Promise<ConnectorResult<GeoRasterRef>>
```

`GeoFeatureCollection` is the single normalised interchange: **RFC 7946 GeoJSON in EPSG:4326,
longitude-first**, plus the entry's provenance and the measured page metadata. Everything a
provider returns (ArcGIS JSON, WFS GML/GeoJSON, a static file) is converted into that shape at the
edge of the connector, so the store, the API and the map never learn what a provider's wire format
was. It also means a PostGIS load is one expression away (`ST_SetSRID(ST_GeomFromGeoJSON(x), 4326)`)
without the storage layer depending on a provider.

Module layout (proposal — Phase 2, and only after the §11 decisions):

```
lib/geo/registry.ts        the allow-list + resolution from layerId
lib/geo/providers/arcgis.ts     f=json, error-in-200 handling, offset paging
lib/geo/providers/wfs.ts        caps → DescribeFeatureType → hits → attribute sample → geometry
lib/geo/providers/wms.ts        caps → GetMap with per-version axis order → pixel-content check
lib/geo/providers/wmts.ts       cached capabilities decomposition, KVP GetTile
lib/geo/providers/raster.ts     WCS metadata only; no GetCoverage without an approved crop
lib/geo/providers/staticGeojson.ts
lib/geo/crs.ts              SRID registry, axis order, envelope sanity checks
lib/geo/normalize.ts        → GeoJSON 4326, ring decimation, property whitelisting
lib/geo/verify.ts           the Phase-1 gates as repeatable code
```

`lib/data/*` stays as it is; the existing GIBS and geoBoundaries paths are not moved, and no
existing provider is replaced (Phase 1 forbids it, and GIBS is genuinely working).

## 4. Per-protocol connector rules

### 4.1 ArcGIS REST (FeatureServer)

1. `GET <service>?f=json` → layers[] + `maxRecordCount` + `supportedQueryFormats` + `capabilities`.
   Refuse a service whose `supportedQueryFormats` lacks the format we asked for; on every Ethiopia
   service measured it is `"JSON"` alone (A-3, A-6).
2. Per layer: `?f=json` for `geometryType`, `fields`, `extent` and its `spatialReference` — note
   GRID3 reports its extent in wkid 102100 while the item extent is geographic (A-4), so the two
   must not be compared without converting deliberately.
3. Coverage proof, cheapest first: `returnCountOnly=true`, then the same query with
   `bbox=33,3.4,48,15&bboxSR=4326`. **The bbox-restricted count must equal the total count** to
   claim the layer is Ethiopia-wide (A-5). That is one small request per layer and it is the only
   honest coverage test on ArcGIS.
4. Licence/attribution: `www.arcgis.com/sharing/rest/content/items/<serviceItemId>?f=json` →
   `licenseInfo`, `accessInformation`, `extent`, `created`/`modified` (A-2). If `serviceItemId`
   does not resolve — as it failed for all four services of the "ArcGIS Ethiopia" org (X-6) — the
   dataset is *not adoptable*, because publisher and licence are unverifiable.
5. Paging: `resultOffset`/`resultRecordCount` with `orderByFields=OBJECTID ASC` (unsorted paging
   can repeat or skip rows). Page ceiling enforced from the measured count, not from a guess. Stop
   and report `partial` if the ceiling would truncate — silently short pages are how a 54,446-feature
   layer becomes a 2,000-feature "sample" that is presented as national.
6. `outFields` + `returnGeometry=false` for attribute sampling.
7. Every response: check `json.error` before anything else (§1 row 7). `499` → `auth_required`,
   `404` → `no_data`, and a `200` whose body is an error must never be counted as a success.
8. Static data: `hasStaticData=true` + `minScale`/`maxScale` are recorded into the registry (A-6
   has `maxScale 76444`, i.e. the layer disappears when zoomed past ≈1:76k — a display rule, not a
   bug).

### 4.2 WMS

- Capabilities: parse `Layer` name list, `CRS` per layer, `EX_GeographicBoundingBox`, `Fees`,
  `AccessConstraints`. Namespace-tolerant parsing is required: the real documents carry
  `xmlns:geonode` attributes and prefixed elements, which is what made a naive regex return zero
  matches during this phase (N-1).
- Discard any layer whose geographic bbox is degenerate (`-Infinity`, or min > max) — 4 NSDI
  layers publish such envelopes (DQ-7) — and fall back to a measured extent.
- **Axis order is per version and per CRS, and getting it wrong is silent.** Measured on one
  layer, one size, one CRS: 1.3.0 + 4326 with `BBOX=lat,lon` → 4,708 drawn px; with `BBOX=lon,lat`
  → **0 drawn px, both HTTP 200** (N-8 vs N-9). 1.3.0 + 3857 wants `Emin,Nmin`; the swapped form
  again returns a valid empty PNG (N-10 vs N-11). 1.1.1 wants lon,lat. The client therefore encodes
  the table in `crs.ts` and never accepts a caller-built bbox.
- Every GetMap result is content-checked before it is called coverage: decode, count non-white and
  non-transparent pixels, take the distinct-colour histogram and the drawn-pixel bounding box (the
  method used for N-8…N-13 and for rejecting X-1 at 262,144/262,144 white px). A blank image is a
  **failure**, never "no data in this viewport".
- GetFeatureInfo is not used for attributes (§5.2).

### 4.3 WFS

Order of operations, cheapest first, each step a gate:

1. `GetCapabilities` → `FeatureType` list, `DefaultCRS`, `OtherCRS` (**measured: 0 `OtherCRS`
   elements across all 69 types**, N-2), `Fees`/`AccessConstraints`.
2. `DescribeFeatureType` → property names/types; this is where a commercial-origin vocabulary shows
   up (`med_descri`, `rtt_descri`, `f_code_des` — N-20, DQ-3).
3. `GetFeature&resultType=hits` → counts without geometry (715 B for the country polygon, N-15;
   789/1,650/34 for the other layers, N-16).
4. Attribute-only sample with `propertyName` (no geometry), `count=2`, probes at
   `startIndex` 0 / mid / last → this is what exposed the placeholder populations and null names
   (N-19, DQ-4). A dataset whose attribute probes are placeholders does not get a demographics
   label regardless of how well its geometry renders.
5. Only then: geometry pull, in pages, requesting `srsName=EPSG:4326` explicitly. GeoServer here
   *does* reproject to 3857 on request despite advertising nothing (N-18), but that behaviour is
   unadvertised, so the connector treats successful reprojection as a bonus to verify per layer,
   not as a guarantee — and never ships untransformed 32637/20137 coordinates (§6).

### 4.4 WMTS / tiled raster

- Never fetch 7.77 MB per session (N-4). Decompose once: `Layer` → `TileMatrixSetLink` →
  `TileMatrixLimits`, store the result. The limits are informative: GeoWebCache's `TileOutOfRange`
  messages disclosed the **seeded** column/row ranges (18–20, 14–15 at z5), which is direct evidence
  that the gridset covers Ethiopia only (N-21) — a fact worth recording in the registry rather than
  rediscovering per tile.
- Tile requests are KVP `GetTile` with `{Time}/{TileMatrix}/{TileRow}/{TileCol}` templates, exactly
  the pattern already in production (`lib/data/gibs.ts:34,55,76`).
- Value reading stays the house pattern: sample one pixel at one coordinate and store the value,
  the scene date and the pixel footprint (`lib/data/types.ts:263-276`,
  `supabase/migrations/20261026000500…sql:80-121`). The whole-raster path is out of scope (§10.2).
- One gap to close in Phase 2, honestly stated: `decodeIndexedPng` (`lib/data/pngIndex.ts:37`)
  handles paletted PNGs, which is what GIBS colormap tiles are. GeoServer returns RGBA
  (`N-22`: 256×256 RGBA, alpha-based drawn-pixel count). So either an RGBA variant of the decoder or
  a `format=image/png; mode=…`/colormap request must be chosen per layer; the probe did this with
  `node:zlib` inline and that logic belongs in the repo if WMTS raster is adopted.

### 4.5 WCS / raster metadata

Metadata-only by default: `GetCapabilities` (2 coverages total on NSDI, N-3) and `DescribeCoverage`
(N-23/N-24) to record envelope, axis labels, offset vectors, `rangeType` uom and `nativeFormat`.
`GetCoverage` was reachable but rejected our subset syntax (N-25), and one of the two coverages has
an impossible envelope (N-24) while the other is a ~5 km radiance tile (N-23). Consequences baked
into the design: **no bulk raster download**, `rangeType` must be stored and displayed as published
(`W.m-2.Sr-1` is spectral radiance, not vegetation — DQ-5), and a coverage is only worth a
`GetCoverage` when there is a named, approved regional product behind it.

### 4.6 Static GeoJSON and CSW

- geoBoundaries: the only change this phase recommends is **pinning to a commit, not to `main`**
  (DQ-6) and recording the file's byte size + a digest at retrieval.
- CSW/pycsw: allow-list driven (§1 row 8). Records are read for licence/attribution text only.

## 5. Payload ceilings and the read shapes that stay inside them

### 5.1 Ceilings (explicit per call, overridable via `HttpOptions.maxBytes`, `lib/data/http.ts:20-27`)

| Object | Measured cost | Proposed ceiling |
| --- | --- | --- |
| WMS/WFS capabilities | 667 KB / 250 KB | 2 MB |
| WMTS capabilities (one-off, then cached in DB) | 7.77 MB | 10 MB, single-flight, and never on a request path |
| GetMap 600×400 | 3.9 KB (blank) – 123 KB | 1 MB |
| One tile | 3.6–4.7 KB | 512 KB |
| ArcGIS page of 2,000 polygons | not yet measured (§7.4) | 8 MB, and a page that hits the ceiling is a hard failure, not a truncated success |
| WFS geometry page | country polygon alone = 118 KB (4326) / 165 KB (3857) | 4 MB |
| Attribute-only feature | ≈0.5 KB/feature | 1 MB |

### 5.2 GetFeatureInfo is the expensive way to ask a cheap question

N-14 is the finding this section exists for: asking a WMS for the attribute record under a point
inside Ethiopia's country polygon returned a 118,456 B FeatureCollection containing the entire
4,642-vertex ring. The rule: attribute lookups go through `outFields`+`returnGeometry=false`
(ArcGIS) or `propertyName` (WFS); GFI is reserved for genuinely "what is under this pixel" cases and
must carry a byte ceiling of its own.

### 5.3 Extent is measured, not trusted

For every adopted dataset the registry stores *both* the published envelope and the extent we
measured (bbox-restricted count, GetMap drawn-pixel bounding box, or geometry vertex min/max), with
the method recorded. Where they disagree, the dataset is flagged and the measured value is used —
this is the rule that caught A-8 (a "40 Church Forests" layer spanning 10.4 × 9.8 km), N-24 and X-2.

## 6. CRS policy

### 6.1 Registry

SRIDs seen in the wild during this phase: **4326**, **3857** (and ArcGIS's equivalent **102100**),
**32637** (UTM 37N), **20137** (legacy Ethiopian grid), plus **32647/32648** on rejected
Mekong-oriented layers. The registry lists per layer: native SRID, accepted request SRIDs, and
whether the server demonstrably reprojects. Anything not in the registry fails at load time with
`bad_input` rather than producing plausible-looking coordinates.

### 6.2 Normalisation rule

Store and serve **4326 only**, lon/lat, RFC 7946. Transformation happens only when the provider does
it (ArcGIS `outSR`, WFS `srsName`) and is verified by re-running the envelope check after
conversion. **We do not invent coordinate math.** No hand-rolled UTM→geographic conversion in
application code: if a layer cannot be served in 4326 by its own server, it is not adopted, or it is
adopted only as an external display layer where the renderer asks for the tiles. `EPSG:20137` in
particular has no transformation parameters published in the service metadata we read, so a
"guess-the-ellipsoid" conversion would be an untraceable error source.

### 6.3 Axis order

`crs.ts` owns the table, per version: WMS 1.1.x = `lon,lat` always; WMS 1.3.0 + geographic CRS =
`lat,lon`; WMS 1.3.0 + projected CRS = depends on the CRS's own axis order (measured: 3857 answered
`Emin,Nmin`, N-10). Callers pass a `bbox` object, never a string.

### 6.4 Envelope sanity checks (all cheap, all before any download)

1. Geographic-looking bbox with any |value| > 180 ⇒ it is metres labelled as degrees ⇒ reject.
2. Declared UTM zone wider than the zone: Ethiopia spans 33–48 E, which crosses **36N (30–36 E),
   37N (36–42 E) and 38N (42–48 E)**; six degrees of longitude at ≈10° N is about 660 km, so
   N-24's 1,655 × 1,260 km "EPSG:32637" envelope is impossible and proves broken georeferencing.
   Corollary: a *national* Ethiopian dataset expressed in a single UTM zone is itself a
   generalisation — it cannot be true to more than a third of the country — and must not be
   silently re-zoned.
3. Degenerate/`-Infinity` envelope ⇒ metadata unusable ⇒ measure instead (DQ-7).
4. Final gate for every dataset: does any part of it intersect the country box
   (`lib/data/locations.ts:97-98`)? Layers whose whole envelope lies at 90–116 E (X-2, X-5) fail
   here regardless of their titles.

## 7. Proposed database schema — for review, **not applied**

### 7.1 Preconditions, stated as gates

Nothing here may be migrated until both are true:

- **G-1: PostGIS availability is unknown.** The repository contains no geometry column, no `ST_*`
  call and no spatial migration (`grep` over `supabase/migrations/*.sql` finds none of the six
  files mentioning it), and the live database was never probed. The checks are read-only and must be
  run by whoever owns the database — this session does not execute SQL against Supabase:
  `select extname, extversion from pg_extension where extname like 'postgis%';`,
  `select name, default_version from pg_available_extensions where name in ('postgis','postgis_raster');`,
  `select current_setting('server_version');`, and whether the `data` schema's owner may
  `create extension`. Whether PostGIS can be enabled is a platform decision, not an assumption this
  design gets to make.
- **G-2: licence answered per dataset** (§11.4). An "unspecified" licence is treated as *no
  permission* (DQ-3), so a row cannot be inserted until `license` holds real text.

### 7.2 Three tables, one purpose each

Following the style of `20261026000500_data_satellite_observations.sql` — `data` schema, the
`data.value_kind`/`data.quality` domains, a comment on every table and load-bearing column,
`record_added_at`/`record_replaced_at` with the `data.touch_replaced_at()` trigger, and security at
the end.

**`data.geo_layers`** — the registry from §3 as a table, so a caveat and a verification status are
queried rather than remembered. Columns: `layer_id pk`, `title`, `category` (constrained to the six),
`provider`, `protocol` (constrained to the six in §3), `endpoint`, `layer_ref`, `srid_native`,
`srid_accepted text[]`, `license` (not null, not blank), `attribution`, `auth_required boolean`,
`use_store/use_display boolean`, `max_record_count`, `page_limit`, `published_envelope` (+ its SRID),
`measured_envelope` (+ method + measured_at), `observed_at`, `update_cadence`, `verification_status`
(constrained to `verified|partially verified|failed|unverified`), `verified_at`, `verified_by_test`,
`quality_findings text[]` (DQ keys), `meaning`, `caveat`, `methodology`, `coverage`, `units`,
`value_kind`, `quality`, `ttl_seconds`, `availability_checked_at`, `availability_error`, timestamps.
Constraints copied from the satellite file's precedent: `geo_layers_no_credentials_in_url`
(checking `endpoint`/template against `%api_key%|%token%|%secret%`, `…000500…sql:48-52`),
`geo_layers_states_limits` (caveat ≥20 chars, `:55-57`), plus `license` non-blank and
`verification_status <> 'verified' or (verified_at is not null and verified_by_test is not null)` —
i.e. **the schema itself refuses an unverified "verified" row**, which is the Phase-1 rule made
durable.

**`data.geo_features`** — persisted, normalised vector features. `feature_id bigint identity pk`,
`layer_id fk`, `feature_key` (stable upstream id: ArcGIS `OBJECTID`/`adm2_pcode`, WFS `fid`) with a
unique index on `(layer_id, feature_key)`, `name`, `admin1`, `admin2`, `properties jsonb` (whitelisted
keys only, §10.3), `geometry` — **either `geometry(MultiPolygon|Polygon|LineString|Point, 4326)` when
G-1 passes, or `jsonb` holding RFC 7946 coordinates when it does not** — plus `geom_bbox` four
double-precision columns with a `check` that they intersect Ethiopia's box, `vertex_count` or
`coordinate_count`, `observed_at`, `retrieved_at`, the provenance columns written by
`provColumns()` (`lib/data/sync.ts:98`), and timestamps. `srid` is *not* a free column: 4326 or the
load fails.

**`data.geo_raster_references`** — metadata and an external pointer, never pixels. `coverage_id pk`,
`layer_id fk`, `title`, `envelope` + `srid` + `axis_labels`, `resolution_meters`, `band_count`,
`range_uom` (verbatim, e.g. `W.m-2.Sr-1`), `native_format`, `source_asset_url`, `retrieved_at`,
`methodology`, `caveat`. The comment on `range_uom` states that a radiance unit is not an agronomic
indicator (DQ-5), so nobody later "converts" it silently. No blob column, no `bytea`, no raster
storage — consistent with the existing rule that full rasters do not belong in a row-per-value table
(`supabase/migrations/20261026000500…sql:11-14`).

### 7.3 Security posture of the schema

Copy the satellite precedent exactly, because it is already the production pattern for `data.*`:

```
alter table data.geo_layers   enable row level security;   force row level security;
alter table data.geo_features enable row level security;   force row level security;
alter table data.geo_raster_references enable row level security; force row level security;
revoke all on data.geo_layers, data.geo_features, data.geo_raster_references from anon, authenticated;
```

RLS **enabled and forced with zero policies**, so the tables are readable/writable only by the table
owner or a `bypassrls` role. No `grant` to `anon`/`authenticated`, no read policy, no `PUBLIC` grant.
The dashboard keeps reading through route handlers that use the service-role client
(`lib/supabaseAdmin.ts`), which is how `market_price_observations`, `daily_climate` and
`satellite_observations` already work. **This design adds no new write path and no new reader role.**
Any later need for anon readability is a separate, evidence-backed change — the H-6/M-8 findings in
`docs/SECURITY_REVIEW.md` are precisely why a "just add a read policy" shortcut is not taken here.

### 7.4 What is deliberately *not* in the schema yet

- No spatial index (`USING gist`) until G-1 passes; without PostGIS there is no such operator class,
  and claiming one would be fiction.
- No `geography`/`cast` helpers, no `ST_Area`-derived columns: per-feature area was never measured,
  and computing it in the app from a projected source is how unit errors are born.
- No GRID3 bulk load. Feature counts are measured (212 / 204 / 54,446, A-4) but **per-row byte cost
  is not**, so the storage decision for the 54,446-feature density layer needs one real page pulled
  in Phase 2 first. Storing it is likely wrong anyway: `POP_DENS`/`BUILT_AREA`/`BUILT_PROP` are more
  useful aggregated per admin unit than as 54k polygons.
- No view. The satellite migration removed its convenience view for a stated reason (`…000500…sql:134-147`):
  a view hard-codes meaning. The same logic applies — `unified_market_intel` is the live example of
  what a view's grants and dependencies cost to unwind (SECURITY_REVIEW H-6/M-8).
- No sync-task registration, no cron, no migration file. Proposed file name for the eventual review:
  `supabase/migrations/<timestamp>_data_geospatial_registry_and_features.sql`, plus a preflight row
  in `supabase/migrations/README.md`. **Not created here.**

## 8. Ingestion and scheduling design

### 8.1 Path

One new task key (`'geospatial'`) in `SYNC_TASK_KEYS` (`lib/data/sync.ts:707`), run inside the
existing lease-guarded `runSync` (`:728-…`, `SYNC_LEASE_KEY` at `:718`), writing via
`upsertBatch(rows, table, onConflict)` with `BATCH_SIZE` 400 and per-row fallback (`:143-175`).
Provenance columns come from `provColumns(p)` (`:98`) so geospatial rows carry the same
`retrieved_at`/`observed_at`/`license`/`methodology`/`quality` fields as price and climate rows.
Error surface stays client-safe: `SourceError` messages are sanitised upstream (`http.ts:114-119`,
`types.ts:55`) and never include a body.

### 8.2 Refresh policy (proposed TTLs, all cache-first)

| Object | TTL | Rationale from measurement |
| --- | --- | --- |
| Capabilities-derived layer metadata | 30 days | GeoNode/GeoServer layer sets move slowly; 7.77 MB per read makes casual refresh absurd. |
| Verification re-run (coverage + counts + blank-image test) | 14 days | Availability drifted mid-session (N-29, P-8); a stale "verified" is a lie with a date on it. |
| Vector features (boundaries, admin names) | 30 days, or manual | GRID3 `hasStaticData=true` (A-6) — polling a snapshot is self-inflicted load. |
| Admin name/code tables with `valid_on`/`valid_to` | re-check on the validity window | A-6 shows the data is dated by design; "when does this stop being current" is answerable and must be asked. |
| Tile/scene availability (`findLatestLayerDate` pattern) | per request, cached single-flight | already the GIBS behaviour (`app/api/data/geospatial/route.ts:56-65`). |
| CSW inventory | manual | pagination broken (N-6). |

A failed re-verification sets `verification_status` to the measured value and fills
`availability_error`; the app must surface the last-good copy as *dated*, never as current — the same
two-signal staleness rule `provenanceFor` already applies (`lib/data/sources.ts:143-146`).

## 9. Display path

- External layers are **read-only**, requested straight from the publisher by the browser where the
  publisher is public and has a valid certificate (GIBS today), or through our route where a licence
  or attribution must be attached. NSDI and MoA are excluded from direct browser use outright (§11.1,
  §11.2) — a browser will reject them exactly as strictly (N-26, P-6).
- Adding a tile host is a security-relevant change: it touches the content-security policy and the
  outbound host allow-list, so it belongs in review, not in a component.
- `latestAvailableDate`-style fields are mandatory on any rendered layer; the date of the scene goes
  on the map, as it does for GIBS (`lib/data/types.ts:256-257`).
- Attribution comes from the registry row (`license`/`attribution`), never hard-coded in JSX, so the
  text we show is the text the service gave us.
- Before Phase 2 writes any route/component, read `node_modules/next/dist/docs/` per `AGENTS.md`.

## 10. Security rules, mapped to enforcement points

| Standing rule | Where this design enforces it |
| --- | --- |
| No service-role keys or credentials in frontend code | Only `lib/supabaseAdmin.ts` holds the service-role client and it is window-guarded; connectors run server-side. Registry/tile URLs are DB-constraint-checked for credential-shaped text (§7.2, mirroring `…000500…sql:48-52`). |
| No secrets in logs or reports | `http.ts` deliberately never logs query strings or `response.url` (`:3-11`); `SourceError` carries a status, not an upstream body (`:114-119`). Every Phase-1 request was anonymous, so this report contains no credential of any kind. |
| No public database write permissions | §7.3: RLS enabled + forced, zero policies, `revoke all` from `anon`/`authenticated`, sole writer is the service-role sync path. |
| No unnecessary RLS policy changes | None proposed. Existing policies and grants are untouched, and the H-6/M-8 findings are cited rather than re-litigated. |
| External data is untrusted input | XML parsed with namespace tolerance and byte ceilings; JSON narrowed field-by-field into `properties` whitelists (unknown fields dropped, not stored); ArcGIS error-in-200 handled as failure (§4.1.7); geometry vertex caps + ring decimation (`lib/data/boundaries.ts:37,63`); response text never rendered as HTML (GFI/ArcGIS `content` can carry markup); coordinate ranges enforced by the same `latitude/longitude` checks the existing tables use (`…000500…sql:87-88`). |
| Server-side ingestion | §8.1 — all provider traffic originates in `runSync`/route handlers. |
| External map layers read-only | §9; no write operation is implemented for any protocol (the probes used only `GetCapabilities`/`DescribeFeatureType`/`GetFeature`/`GetMap`/`GetTile`/`DescribeCoverage` and ArcGIS `query`). |
| Do not claim an integration is live unless tested against its real source | `verification_status` + `verified_at` + `verified_by_test` columns and a table constraint that refuses `verified` without them (§7.2). |

## 11. Open decisions — blocking, and each one is a human call

1. **Ethio-NSDI trust.** Options: (a) do not integrate; (b) server-side-only exception with a pinned
   leaf certificate and a bespoke TLS agent; (c) ask the portal operator for a valid certificate.
   The leaf is self-signed `CN=localhost` with **no SAN and no CA to pin to** (N-27), so (b) buys
   fragility: any renewal changes the pin, and our verification becomes "does our pin match", not
   "is this the government's server". Recommendation: **(a) meanwhile, (c) as the ask** — and
   whichever is chosen, it is a documented exception with an owner, not a `-k` flag. Note also that
   (b) would require deviating from the platform's default TLS verification, which is a weakening
   that has to be justified, and NSDI's intermittent connectivity (N-29) would still make it a poor
   dependency for anything user-facing.
2. **MoA Agricultural Data Hub.** Highest-relevance Ethiopian inventory found (1,915 datasets, soil
   grids, WMS/WFS/WCS/TIF resources, P-2) and currently unusable: expired certificate (P-6), 502/504
   including on a call that had just succeeded (P-3, P-5), and no licence declared on any sampled
   package. Decision needed: contact the operator, or drop. No connector should be written against
   it until both the certificate and the licence text are real.
3. **PostGIS.** G-1. Until the four read-only checks in §7.1 come back, §7.2's geometry column type
   is undecided and any spatial query pattern is provisional.
4. **Licence clearance** for: RCMRD forests/biodiversity/priority areas (UN-WDPA field vocabulary,
   `licenseInfo` null — and the WDPA terms are the ones to check, not the republisher's, DQ-3);
   `eth_roads` (commercial road schema, N-20); `Basemap_Ethiopia` (empty `licenseInfo`, A-6);
   NSDI records (Fees `NONE` ≠ a licence grant, N-1…N-4).
5. **Can a 2021 static snapshot be presented as demographics?** GRID3 v1.0 is CC BY and
   coverage-proven, but it is a 2021 "social distancing" vintage product with `hasStaticData=true`
   (A-3/A-4). Rule: yes as *dated* context, no as a *current* indicator (DQ-9).
6. **Terrain/DEM remains an open gap** — no national elevation service was verified (catalog §3),
   and this design does not pretend otherwise.
7. **Esri subscription content**: excluded, since the org's Ethiopia services answer `499` at the
   data endpoint under the Esri MLA (A-10). Adopting them would require a paid agreement — a
   procurement decision, not a code one.

## 12. Phase 2 sequence, if approved

1. Resolve §11.1–§11.3 (TLS posture, MoA, PostGIS preflight results).
2. Read the Next.js 16 route/streaming docs (`AGENTS.md`), then scaffold `lib/geo/` with the registry
   as a code constant first — no DB tables yet.
3. Implement `verify.ts` so each adopted dataset carries a re-runnable gate, and run it against the
   live endpoints; record outputs in the verification report, dated.
4. Fix the geoBoundaries pin (DQ-6) — small, independent, no schema involved.
5. Only then draft the migration in §7 for review, with G-1/G-2 evidence attached, and add the
   `geospatial` sync task behind the existing lease.

## 13. Honest limits of this document

- It is a proposal drawn from one day of probing (2026-10-30) from one network location. Nothing was
  tested from Vercel's runtime, and two of the Ethiopian candidates fail TLS in ways a browser will
  also reject.
- No connector described here exists in code, and no measurement in it came from a mock, a fixture,
  or the app's own responses. Every upstream number traces to a row in
  `docs/GEOSPATIAL_VERIFICATION_REPORT.md`.
- The schema is **conditional and unapplied**: PostGIS availability is unverified, no SQL was
  executed, and adopting it requires the gates in §7.1 to be satisfied by the database owner.
- Licensing is unresolved wherever this file says so. `unspecified` means *do not use*, per DQ-3.
- No data described here is real-time, and the design gives the UI no way to imply otherwise: the
  `observedAt`/`retrievedAt` pair and the mandatory `caveat` are the load-bearing parts.
