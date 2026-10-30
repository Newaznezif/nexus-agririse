# Nexus AgriRise — Geospatial Endpoint Verification Report (Phase 1)

All probes ran on **2026-10-30** from this workstation, read-only: `GET` on OGC KVP endpoints and
ArcGIS REST `f=json` metadata/query, no tokens, no POST, no writes, no downloads of bulk rasters.
User-Agent sent on every request: `NexusAgriRise-Phase1-discovery/1.0 (read-only metadata probe)`.
Raw responses were kept outside the repository (scratch dir
`Documents/Qoder/2026-10-26/c8245c6e/pg-parse/geo-probe/`), together with the probe scripts
(`probe_nsdi2.sh`, `probe_nsdi3.sh`, `probe_portals.sh`, `probe_final.sh`, `arcgis_verify.cjs`,
`items.cjs`) and a `urls.log` of every request. **No secret was involved in any of these requests** —
every one used an anonymously reachable read.

The verification question for each endpoint was: does a *data* operation return something whose
content demonstrably relates to Ethiopia? "The homepage loads" was never accepted as an answer.

**This is the discovery stage only.** What the shipped build actually does with these endpoints — the
live per-layer reads, the normalised features, the browser evidence, and the places where the data is
imperfect — is recorded in `GEOSPATIAL_BUILD_VERIFICATION.md` (Phase 6).

## 1. Ethio-NSDI — `ethionsdi.gov.et`

| # | Request (abridged; full URLs in `urls.log`) | Response | Content check | Conclusion |
| --- | --- | --- | --- | --- |
| N-1 | `GET /geoserver/wms?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetCapabilities` | 200, `text/xml`, 667,200 B | 137 `<Layer>` elements, 269 `<Name>` refs, all `geonode:*`; `Fees NONE`, `AccessConstraints NONE`; ops = GetCapabilities/GetMap/GetFeatureInfo; provider block "GeoNode Local GeoServer" | WMS exists and is anonymous |
| N-2 | `GET /geoserver/wfs?...REQUEST=GetCapabilities` (version 2.0.0) | 200, 249,650 B | **69 `FeatureType`**, `Fees NONE`, `AccessConstraints NONE`; ops GetCapabilities/DescribeFeatureType/GetFeature; **0 `OtherCRS` elements across all 69 types**; `DefaultCRS` values seen: 4326, 3857, **20137**, **32637** | WFS exists; no advertised reprojection |
| N-3 | `GET /geoserver/wcs?...REQUEST=GetCapabilities` (2.0.1) | 200, 641,652 B | ops GetCapabilities/DescribeCoverage/GetCoverage; **exactly 2 `CoverageSummary`**: `geonode__geonode_aa14` ("LASAC_Data"), `geonode__geonode_ls_probability_prediction001` | WCS is published but nearly empty |
| N-4 | `GET /geoserver/gwc/service/wmts?REQUEST=GetCapabilities` | 200, `text/xml`, **7,769,733 B** | 136 `<Layer>`, 816 `TileMatrixSetLink`, matrix sets `EPSG:3857`, `3857x2`, `4326`, `4326x2`, `900913`, `900913x2`; `Fees NONE` | WMTS works; capabilities doc is too large to fetch per-session |
| N-5 | `GET /catalogue/csw?...request=GetRecords&elementsetname=summary&maxrecords=40` | 200, 19,426–34,974 B | `numberOfRecordsMatched="133"`, `numberOfRecordsReturned="10"`, `nextRecord="11"` | pycsw 3.0-dev catalogue; anonymous |
| N-6 | Same, `startIndex` = 1/11/21/31/41/51/61/71/81/91/101/111/121/131 | 200, each exactly 34,974 B | **identifier sets byte-for-byte equal across all 14 pages** (checked by comparing the `dc:identifier` arrays) | **Pagination broken** — cannot enumerate 133 records |
| N-7 | `GET /geoserver/ows?service=CSW&request=GetRecords` (the GeoServer path) | 200, 516 B XML | `exceptionCode="InvalidParameterValue" locator="service"` → "No service: ( CSW )" | CSW lives at `/catalogue/csw`, not on GeoServer |
| N-8 | WMS GetMap `LAYERS=geonode:eth_adm0 CRS=EPSG:4326 BBOX=3.3,32.9,15.0,48.1 WIDTH=600 HEIGHT=400` (1.3.0) | 200, `image/png`, 19,515 B | decoded IDAT with `node:zlib`: **4,708 of 240,000 px non-white (1.96%), 255 distinct colours, drawn pixels span x 3..595, y 2..399** | **verified** — Ethiopia geometry is rendered |
| N-9 | WMS GetMap, same but `BBOX=32.9,3.3,48.1,15.0` (naive lon,lat under 1.3.0) | 200, `image/png`, 3,906 B | **0 drawn pixels, 0 colours, "nothing drawn"** | HTTP 200 + valid PNG ≠ coverage. The first pass over this endpoint produced this blank image and *looked* like a working service |
| N-10 | WMS GetMap `CRS=EPSG:3857 BBOX=3673900,366700,5344400,1694100` (East,North) | 200, 20,056 B | drawn content present | 3857 rendering works when the axis order is right |
| N-11 | WMS GetMap `CRS=EPSG:3857 BBOX=366700,3673900,1694100,5344400` (swapped) | 200, 3,906 B | 0 drawn px | same trap in projected space |
| N-12 | WMS GetMap `LAYERS=geonode:eth_woreda_2013` (correct 1.3.0 order) | 200, 123,210 B | **127,433 px drawn (53.10%), 1,816 colours, dominant fill `198,227,165`** | polygon render verified |
| N-13 | WMS GetMap `LAYERS=geonode:eth_roads` | 200, 79,956 B | 35,610 px drawn (14.84%), dominant `0,0,255` | line render verified |
| N-14 | WMS GetFeatureInfo on `eth_adm0` (1.3.0, `I/J`) | 200, `application/json`, 118,456 B | FeatureCollection with the full country polygon — i.e. GFI returned the whole 4,642-vertex geometry, not a small attribute record | works, but useless over a fat polygon; a design constraint, see ARCHITECTURE §5 |
| N-15 | WFS GetFeature `typeName=geonode:eth_adm0&resultType=hits` | 200, `text/xml`, 715 B | `numberMatched=1` | country outline is 1 feature |
| N-16 | WFS GetFeature hits for `eth_woreda_2013`, `eth_roads`, `market_places` | 200 each | **789**, **1,650**, **34** | feature volumes measured |
| N-17 | WFS GetFeature `typeName=geonode:eth_adm0&outputFormat=application/json&maxFeatures=2` | 200, 118,466 B | 1 feature, MultiPolygon, 9,284 coordinate numbers (4,642 vertices), x 33.000..47.986 y 3.322..14.900, `crs urn:ogc:def:crs:EPSG::4326`, 31 properties incl. `name_obsol:"Abyssinia|Italian East Africa"` | **verified**; and one country polygon costs ~118 KB |
| N-18 | Same with `srsName=EPSG:3857` | 200, 165,345 B | identical vertex count, x 3673536..5341797 y 370022..1677673 | server **reprojects on request despite advertising no `OtherCRS`** — behaviour usable but unadvertised |
| N-19 | WFS GetFeature `propertyName=fid,sub_city,name,population,regionname` (no geometry), `count=2`, `startIndex` 0/250/500/786 | 200, 823–1,120 B | geometry `null`; fid 1–2 = `sub_city:"Yeka"`, `population:150000`; fid 251–252 = `regionname:"SNNPR"/"Amhara"`, `population:0`, `name:null`; fid 787–788 `regionname:"Oromia"` | attribute-only reads are cheap (≈0.5 KB/feature), **and they expose the placeholder-population problem (DQ-4)** |
| N-20 | WFS GetFeature `typeName=geonode:eth_roads&count=2&startIndex=500` | 200, 1,592 B | MultiLineString, props `med_descri:"Without Median"`, `rtt_descri:"Secondary Route"`, `f_code_des:"Road"`, `iso:"ETH"` | reads work; the field vocabulary indicates a commercial road dataset of unstated origin (DQ-3) |
| N-21 | WMTS GetTile `LAYER=geonode:eth_adm0 TILEMATRIXSET=EPSG:900913 TILEMATRIX=EPSG:900913:5 TILECOL=16 TINEROW=12` | 400, `ows:ExceptionReport` | `TileOutOfRange / TILECOL — "Column 16 is out of range, min: 18 max:20"` | GeoWebCache reports the **seeded** column range: the gridset covers Ethiopia only |
| N-22 | Same with `TILEROW=12` corrected after the row error (`Row 12 out of range, min:14 max:15`) → z5/19/14, z5/20/15, z6/39/29 | 200, `image/png`, 4,664 / 3,648 / 4,554 B | 256×256 RGBA; drawn (α>0) px 831 (1.27%), 469 (0.72%), 715 (1.09%), colours `0,0,0,α` = the boundary line | **WMTS tiles verified inside Ethiopia** |
| N-23 | WCS DescribeCoverage `coverageid=geonode__geonode_aa14` | 200, `application/xml`, 5,371 B | `RectifiedGridCoverage`, Envelope `srsName EPSG/0/32637 axisLabels "E N"`, 467536.69 993370.16 .. 472535.65 998369.12 (**≈5 km × 5 km**), offsetVectors ±2.1810 m, `rangeType uom code "W.m-2.Sr-1"`, `nativeFormat image/tiff` | it is a ~5 km radiance tile, not a country dataset (DQ-5) |
| N-24 | WCS DescribeCoverage `...ls_probability_prediction001` | 200, 5,501 B | Envelope EPSG:32637, −162008 381834 .. 1493451 1642104 ≈ **1,650 km × 1,260 km** | impossible for UTM 37N → broken georeferencing |
| N-25 | WCS GetCoverage `coverageid=...aa14&subset=i(0:3)&subset=j(0:3)&format=image/tiff` | **400**, 573 B | `ExceptionText: "Invalid point value 0:3, it is not a number and it's not between double quotes"` | the operation is reachable and validating; **download path unverified** — a ranges-syntax question, not an availability one |
| N-26 | Strict TLS: same WMS GetCapabilities **without** any trust override | exit 000 | `curl: (60) schannel: SEC_E_UNTRUSTED_ROOT (0x80090325)` | **a conforming client cannot reach NSDI at all** |
| N-27 | `openssl s_client -connect ethionsdi.gov.et:443 -servername ethionsdi.gov.et -showcerts` | — | `s:CN=localhost`, `i:CN=localhost`, **1 certificate in chain**, "No extensions in certificate", `notBefore=Mar 27 2026`, `notAfter=Mar 26 2031`, `Verify return code: 18 (self-signed certificate)` | self-signed leaf for the wrong name; no CA to pin to |
| N-28 | `HEAD http://ethionsdi.gov.et/geoserver/wms` | 302 | `Location: https://ethionsdi.gov.et/geoserver/wms`, `Server: nginx/1.28.0` | no cleartext fallback — the redirect lands on the broken TLS path |
| N-29 | Two CSW requests during the paging sweep | exit 000 | `curl: (28) Failed to connect to ethionsdi.gov.et:443 after 21100 ms` while neighbours 400 ms away succeeded | intermittent availability (also consistent with rate-limiting after 14 rapid calls) |

## 2. ArcGIS — ArcGIS Online and Esri-hosted Ethiopia services

| # | Request | Response | Check | Conclusion |
| --- | --- | --- | --- | --- |
| A-1 | `GET https://www.arcgis.com/sharing/rest/search?q=title:"Ethiopia" AND type:"service"&f=json&num=25` | 200, 61,399 B | `total=793`, 25 results, all `access: public`, each with `url`, `owner`, `modified`, `type` | **discovery route verified, anonymous** |
| A-2 | `GET /sharing/rest/content/items/<id>?f=json` for 13 Ethiopia items | 200, 4.9–6.6 KB | yields `licenseInfo`, `accessInformation`, `extent`, `created`/`modified`, real `url` — e.g. GRID3 item states *"These data may be redistributed following the terms of a Creative Commons Attribution…"*; Esri `ETH_Boundaries_view` items state *"This work is licensed under the Esri Master License Agreement"* | the licence/attribution field is reachable without a token |
| A-3 | `GET …/ETH_SocialDistancing_v1_0/FeatureServer?f=json` | 200, 3,648 B | 3 layers, `maxRecordCount=2000`, `supportedQueryFormats="JSON"` (**no geoJSON**) | **verified** |
| A-4 | layer 0/1/2 metadata + `query?where=1=1&returnCountOnly=true` | 200 | L0 points 212, L1 polygons 204, **L2 polygons 54,446** with `POP_DENS`, `BUILT_AREA`, `BUILT_PROP`, `UNIT_AREA`; extents reported in wkid 102100 | **verified**; 54,446 ÷ 2,000 ⇒ ≈28 `resultOffset` pages |
| A-5 | `query?where=1=1&bbox=33,3.4,48,15&bboxSR=4326&returnCountOnly=true` on each layer | 200 | bbox-restricted count **equals** the unrestricted count on Basemap Ethiopia (107), Forests (57), Biodiversity (79), Priority Areas (57), Church Forests (40), GRID3 L0/L1/L2 | **coverage proven by query, not by metadata** |
| A-6 | `Basemap_Ethiopia/FeatureServer?f=json` + layer 0 | 200, 3,125 B | L0 polygons 107, fields `adm2_name, adm2_pcode, adm1_name, adm1_pcode, adm0_name, adm0_pcode, valid_on, valid_to`; `hasStaticData=true`; `maxScale 76444`; JSON-only | **verified read**; licence `licenseInfo` empty |
| A-7 | `Ethiopia_Forest_Data`, `Ethiopia_Biodiversity_Data`, `Ethiopia_National_Forest_Priority_Areas` layer metadata | 200 | 34 fields each: `WDPAID`, `WDPA_PID`, `PA_DEF`, `NAME`, `ORIG_NAME`, `DESIG` … | **verified read**, and the field names identify the content as UN-WDPA protected-area data republished; `licenseInfo` null |
| A-8 | `40_Church_Forests_in_Northern_Ethiopia` layer + count | 200 | count 40, but extent 4180447 1300139 .. 4190800 1309925 (3857) ≈ **10.4 km × 9.8 km** | contradicts the title ⇒ quality failure (DQ-2); item description says "Archived on June 16, 2025" |
| A-9 | `Ethiopia_Boundary/FeatureServer` (owner `hermelal_USAID`) | 200 body, JSON error | `{"error":{"code":499,"message":"Token Required","messageCode":"SB_0005"}}` | **failed** for anonymous use |
| A-10 | `ETH_Boundaries_view/FeatureServer` (+ `/0`, + `/query`) | 200 body, JSON error | `{"code":499,"message":"Token Required for subscription content"}` on all three | **failed** — Esri Living Atlas data is subscription-gated at the data endpoint even though the item is public |
| A-11 | `tiles.arcgis.com/tiles/FBQzQHF5RHsmXbdp/arcgis/rest/services/Ethiopia_Tree_Cover_Loss_2001_2019/MapServer?f=json` | 200 body, JSON error | `{"code":404,"message":"Requested Service not available."}` while the item record still advertises it | **failed** — stale item, dead service |
| A-12 | `GET https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/6/36/50` | 200, 6,305 B | baseline sanity that tile paths over Ethiopia resolve at all | works, but Esri MLA-licensed; not adopted |
| A-13 | `GET https://www.arcgis.com/sharing/rest/search?q=title:"Ethiopia" AND type:"Map Server"…` | 200 | `total=0` for tiled Map Servers titled Ethiopia | no public cached Ethiopia tile service found via AGOL search |

## 3. Ethiopian portals that were named as candidates

| # | Request | Response | Conclusion |
| --- | --- | --- | --- |
| P-1 | `GET https://data.moa.gov.et/api/3/action/status_show` (with trust override) | 200, 1,258 B, 15.2 s | CKAN **2.9.5**, site title "Ethiopian Ag. Datahub" |
| P-2 | `…/api/3/action/package_search?rows=25` | 200, 213,051 B, 11.9 s | **count = 1,915 datasets**; first-25 resource formats: HTML 28, unknown 36, **WMS 15, TIF 24, WCS 3, WFS 7, ZIP 5, PNG 10, PDF 2**; titles are soil grids (Extractable Boron, CEC, WoSIS P-retention, SoilGrids250m volumetric water content, HWSD, ISCN, WISE 5′/30″) and `ethiopian-lulc_2003_final` (EIAR); **every one has `license_id` unset**; orgs include EIAR, CIMMYT-Ethiopia, ATI, Bioversity, ACATECH |
| P-3 | `…/api/3/action/package_search?q=res_type:raster&rows=10&facet.field=…` | **504** after 60.2 s | filtered search unavailable |
| P-4 | `…/package_search?q=geodata&rows=10` and `…/geoserver/ows?GetCapabilities` | **502** after 59.2 / 60.1 s | server-side failure, not a 404 |
| P-5 | `…/package_search?rows=0` (no query at all) | **502** after 59.9 s | the same call that had succeeded at `rows=25` — availability is intermittent, so "the API works" is not a safe claim |
| P-6 | strict TLS (no override) on `data.moa.gov.et` | exit 000, `curl: (35) … SEC_E_CERT_EXPIRED (0x80090328)` | **certificate expired ⇒ a browser or our `fetch` layer cannot reach it** |
| P-7 | `HEAD http://data.moa.gov.et/api/3/action/status_show` | 301, `Location: https://…`, `Server: nginx/1.18.0 (Ubuntu)` | no cleartext fallback |
| P-8 | later re-tries of P-1 style calls | exit 000, `schannel: failed to receive handshake, SSL/TLS connection failed` | host degraded during the session |
| P-9 | `GET https://lschub-geoportal.vercel.app/`, `/data/datasets`, `/geoportal`, `/api/datasets` | 200 (113 KB), 200 (58,844 B), 200 (70,812 B), **404** (21,368 B) | a Next.js portal that *describes* a GeoServer ("Access and visualize geospatial layers from our GeoServer") but exposes **no GeoServer/WMS/WFS URL in any served HTML** and no `/api/datasets`; partner logos EIAR/ILRI/ISRIC/CIMMYT/ACATECH |
| P-10 | CAMELS-Eth basin explorer page | 200, 62,875 B (Drupal) | UI labels `download-catchment-geojson`, `download-lakes-geojson`, `download-gauging-station-geojson`, `download-water-level-station-geojson` exist only as `href="#download-links"` anchors; **no data URL in the HTML** ⇒ unverified |
| P-11 | WALRIS root / `/api/...` | 200 (41,751 B) / 404 "Not Found" | unverified |
| P-12 | `https://ethionsdi.gov.et/geoserver/<anything>` while the CSW sweep was failing | see N-29 | intermittent |

## 4. Non-Ethiopia candidates that the brief listed — rejected with evidence

| # | Candidate | Test | Result |
| --- | --- | --- | --- |
| X-1 | DEA / Australia "candidate" WMS pattern | GetCapabilities → its only WMS layer is Coastlines; GetMap over an Ethiopian bbox | PNG 600×400, **262,144 px, 1 distinct RGB colour (255,255,255) = 100 % white**. No Ethiopia coverage. Rejected |
| X-2 | `Landcover_2023`, `Forest_Cover_2000` on the same host | layer metadata | type `Raster Layer`, extents **90–116 E** — SERVIR-**Mekong**, and raster layers there are not queryable |
| X-3 | `Population_density`, `Mountain_classes` on the same host | layer metadata | `Raster Layer`, EPSG:32647 (zone 47N, wrong for Ethiopia), malformed extents |
| X-4 | CDE `Farms` | query a sample | **31 points**, GEOnet/GNS gazetteer naming — places named "Farm", not farm parcels. Rejected as an agriculture layer |
| X-5 | `Deforestation (2001-2024)`, crop-diversity MapServer (Ethiopia org) | service metadata | extents 91.5–109.4 E and EPSG:**32648** with negative X ⇒ Mekong-region data, mis-listed |
| X-6 | that org's directory `…/gis/rest/services/Ethiopia?f=json` | anonymous | `499 Token Required`; and all four advertised `serviceItemId`s return *"Item does not exist or is inaccessible"* ⇒ publisher/licence unverifiable |
| X-7 | WorldPop REST | `www`/`hub` `/rest/data?pop=total&iso3=ETH`; `/geodata/listing` | **500** (6,015 B HTML) and **404**; site root 200. Failed on the probe day |
| X-8 | `https://www.ethionet.gov.et` (a hostname I guessed, not a listed candidate) | openssl | `No such host is known` — discarded; recorded only so the chain log is complete |

## 5. Method notes that matter for Phase 2

1. **Pixel histograms, not status codes.** Every image test in this report decoded the PNG `IDAT` with
   `node:zlib` and counted non-transparent/non-white pixels plus the distinct-colour set. Three of the
   four "blank" results (N-9, N-11, X-1) were HTTP 200 with a perfectly valid PNG.
2. **WMS 1.3.0 axis order is the single biggest trap** found on this project: the same layer, same
   CRS, same size returns a correct map or an empty canvas depending only on whether the bbox is
   `(lat,lon)` or `(lon,lat)`. Any connector must send axis order per version and *verify drawn
   pixels*, then treat a blank result as a failure, not as "no data in this viewport".
3. **`returnCountOnly` + `bbox` is the cheapest coverage proof** on ArcGIS (A-5) and costs one small
   request per layer.
4. **Attribute-only reads** (`propertyName` without geometry, N-19) cost ~0.5 KB/feature and are the
   right way to sample provenance/quality fields before deciding to pull geometry.
5. **`resultType=hits`** gives feature counts without transferring geometry (N-15/16).
6. Nothing here was executed against the project database, deployed, committed or pushed.
