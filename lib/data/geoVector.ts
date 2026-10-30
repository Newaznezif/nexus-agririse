import { cachedFetch } from './cache';
import { bboxesIntersect, countFeatures, queryFeatures, type BBox, type NormalizedFeature } from './arcgis';
import { provenanceFor, SOURCES } from './sources';
import type { ConnectorResult, Provenance, SourceDescriptor, SourceError, ValueKind } from './types';

/**
 * Vector layers for the Ethiopia map, declared once and served through one route.
 *
 * Everything in this file was measured against the live services before it was
 * written, and the measurements are what the numbers below claim:
 *
 *  - The service the brief named for GRID3 Ethiopia administrative boundaries does
 *    not exist (HTTP 200 carrying `{"error":{"code":400,"message":"Invalid URL"}}`).
 *    The verified GRID3 Ethiopia service holds urban points, urban extents and a
 *    built-up index — so it is labelled as that, and not as administrative
 *    boundaries. The genuine region/zone/woreda/kebele outlines come from a
 *    different publisher, whose attribution is stated per layer.
 *  - `maxRecordCount` is 1,000 on the admin service and 2,000 elsewhere, so pages
 *    are clamped to the publisher's own number and paging is done with
 *    `resultOffset` under `orderByFields`, which was verified to return disjoint,
 *    ascending pages.
 *  - Simplification tolerance is in **degrees** once `outSR=4326` is requested.
 *    Asking for "2000 metres" was measured to collapse a river basin to a
 *    four-point box with no error raised, so no caller can pass metres here.
 *  - `bbox=lon,lat,lon,lat` is **accepted and ignored** by all three services: an Addis
 *    Ababa box on the kebele layer answered with the country's full 15,670 records.
 *    The envelope-`geometry` form is what actually filters (358 records for that box),
 *    so `arcgis.ts` sends only that and every "filtered to your view" claim is real.
 */

/** Ethiopia's published extent plus a margin, as used for every verified count. */
export const ETHIOPIA_BBOX: BBox = { minLongitude: 32.9, minLatitude: 3.3, maxLongitude: 48.1, maxLatitude: 15.1 };

type Provider = 'ethioAdmin' | 'grid3Eth' | 'cdeWater';
type LayerKind = 'point' | 'polygon';
export type VectorDetail = 'overview' | 'standard' | 'detailed';

interface ProviderConfig {
  source: SourceDescriptor;
  /** Service root; `layerId` is appended. */
  root: (layerPath: string) => string;
  objectIdField: string;
  maxRecordCount: number;
  /** Static reference datasets get a long TTL; a source that publishes no vintage is re-checked weekly. */
  ttlSeconds: number;
  /** Publisher vintage as an ISO date, or null when the publisher states none. */
  vintage: string | null;
  vintageNote: string;
}

const PROVIDERS: Record<Provider, ProviderConfig> = {
  ethioAdmin: {
    source: SOURCES.ethioAdminBoundaries,
    root: (path) => `https://services8.arcgis.com/oTalEaSXAuyNT7xf/arcgis/rest/services/Ethiopia_AdminBoundaries/FeatureServer/${path}`,
    objectIdField: 'OBJECTID',
    maxRecordCount: 1000,
    ttlSeconds: 30 * 86400,
    // The ArcGIS Online item carrying this service was last modified then; the
    // service publishes no per-record date, so that is the honest vintage.
    vintage: '2020-05-19',
    vintageNote: 'the publisher’s item record was last modified on 2020-05-19; no per-record date is published',
  },
  grid3Eth: {
    source: SOURCES.grid3Ethiopia,
    root: (path) => `https://services6.arcgis.com/kOvusPqAUjVWKF9D/arcgis/rest/services/ETH_SocialDistancing_v1_0/FeatureServer/${path}`,
    objectIdField: 'FID',
    maxRecordCount: 2000,
    ttlSeconds: 30 * 86400,
    vintage: '2021-07-21',
    vintageNote: 'GRID3 Ethiopia Social Distancing Layers v1.0, item last modified 2021-07-21',
  },
  cdeWater: {
    source: SOURCES.cdeEthiopia,
    root: (path) => `https://gis.cde.unibe.ch/gis/rest/services/${path}`,
    objectIdField: 'OBJECTID',
    maxRecordCount: 2000,
    ttlSeconds: 7 * 86400,
    // Verified absent: no serviceDescription date, no copyrightText, no editingInfo,
    // no hasStaticData. Claiming a vintage the publisher never stated would be a lie.
    vintage: null,
    vintageNote: 'the publisher states no date for this layer, so none is claimed here',
  },
};

export interface VectorLayerDefinition {
  id: string;
  title: string;
  meaning: string;
  caveat: string;
  group: 'administrative' | 'settlement' | 'hydrology';
  provider: Provider;
  /** Provider-relative path, exactly as verified (e.g. "Basins/MapServer/0"). */
  path: string;
  layerLabel: string;
  kind: LayerKind;
  nameFields: string[];
  keepFields: string[];
  /** Total Ethiopia-wide features measured from `returnCountOnly` when this was written. */
  measuredCount: number;
  featureLimit: number;
  toleranceDegrees: number;
  maxPointsPerRing: number;
  /** True when the layer is too dense to serve country-wide and needs a view extent. */
  needsBbox: boolean;
  color: string;
  valueKind: ValueKind;
  /** Attribute units the publisher does not state itself, so the UI can be accurate. */
  attributeNotes: string;
}

export const VECTOR_LAYERS: VectorLayerDefinition[] = [
  {
    id: 'eth-region',
    title: 'Regions and city administrations',
    meaning: 'The 11 top-level administrative areas of Ethiopia as published geometries, each with its official region code.',
    caveat: 'A 2020 vintage. It still shows SNNPR as one region and does not reflect the regional splits recognised since, so it describes the publisher’s data, not today’s administration.',
    group: 'administrative',
    provider: 'ethioAdmin',
    path: '3',
    layerLabel: 'Regions (Level 1)',
    kind: 'polygon',
    nameFields: ['REGIONNAME'],
    keepFields: ['REGIONNAME', 'RID', 'Shape__Area'],
    measuredCount: 11,
    featureLimit: 20,
    toleranceDegrees: 0.002,
    maxPointsPerRing: 500,
    needsBbox: false,
    color: '#047857',
    valueKind: 'estimated',
    attributeNotes: 'Shape__Area is the publisher’s own area in square metres — measured against the polygon it ships (Tigray reads 56,053 km², Addis Ababa 556 km²).',
  },
  {
    id: 'eth-zone',
    title: 'Zones',
    meaning: '81 second-level administrative areas, each carrying its four-digit zone code and parent region name.',
    caveat: 'Names are upper-cased as published and two fields (AREA, PERIMETER) are in units the publisher never documented, so they are not shown. 2020 vintage.',
    group: 'administrative',
    provider: 'ethioAdmin',
    path: '2',
    layerLabel: 'Zones (Level 2)',
    kind: 'polygon',
    nameFields: ['ZONENAME', 'Zone'],
    keepFields: ['Z4ID', 'ZONENAME', 'Shape__Area'],
    measuredCount: 81,
    featureLimit: 100,
    toleranceDegrees: 0.002,
    maxPointsPerRing: 300,
    needsBbox: false,
    color: '#0e7490',
    valueKind: 'estimated',
    attributeNotes: 'Shape__Area is square metres as published; the undocumented AREA/PERIMETER fields are dropped.',
  },
  {
    id: 'eth-woreda',
    title: 'Woredas (districts)',
    meaning: '684 third-level districts with their 6-digit codes, parent zone and region — the administrative level most service delivery is planned at.',
    caveat: 'Outlines are generalised for drawing, and a 2020 vintage. Woreda boundaries have changed since; use them to locate a district, not to settle one.',
    group: 'administrative',
    provider: 'ethioAdmin',
    path: '1',
    layerLabel: 'Woredas (Level 3)',
    kind: 'polygon',
    nameFields: ['WOREDANAME'],
    keepFields: ['WOREDANO_', 'WOREDANAME', 'ZONENAME', 'REGIONNAME', 'Shape__Area'],
    measuredCount: 684,
    featureLimit: 700,
    toleranceDegrees: 0.005,
    maxPointsPerRing: 160,
    needsBbox: false,
    color: '#7c3aed',
    valueKind: 'estimated',
    attributeNotes: 'Shape__Area is square metres as published.',
  },
  {
    id: 'eth-kebele',
    title: 'Kebeles (lowest administrative unit)',
    meaning: 'The 15,670 fourth-level units — the smallest published administrative geometry for Ethiopia, each linked to its woreda, zone and region.',
    caveat: 'Too dense to draw for the whole country: the map serves at most 1,000 of them for the extent you are looking at, and says so. Geometry is heavily simplified.',
    group: 'administrative',
    provider: 'ethioAdmin',
    path: '0',
    layerLabel: 'Kebeles (Level 4)',
    kind: 'polygon',
    nameFields: ['RK_NAME', 'W_NAME'],
    keepFields: ['RK_NAME', 'RK_CODE', 'W_NAME', 'Z_NAME', 'R_NAME', 'Shape__Area'],
    measuredCount: 15670,
    featureLimit: 1000,
    toleranceDegrees: 0.002,
    maxPointsPerRing: 60,
    needsBbox: true,
    color: '#be123c',
    valueKind: 'estimated',
    attributeNotes: 'Shape__Area is square metres as published.',
  },
  {
    id: 'cde-basin',
    title: 'River basins',
    meaning: 'The 12 main river basins of Ethiopia as polygon outlines, each named.',
    caveat: 'No date is published for this layer and the licence is not stated by the server, so it is shown for reading, not for redistribution. Basins cross national borders; only the Ethiopian portions are named.',
    group: 'hydrology',
    provider: 'cdeWater',
    path: 'Basins/MapServer/0',
    layerLabel: 'Main basin',
    kind: 'polygon',
    nameFields: ['Name'],
    keepFields: ['Name', 'Shape_Area', 'Shape_Length'],
    measuredCount: 12,
    featureLimit: 12,
    toleranceDegrees: 0.005,
    maxPointsPerRing: 400,
    needsBbox: false,
    color: '#0284d7',
    valueKind: 'estimated',
    attributeNotes: 'Shape_Area and Shape_Length are the publisher’s own values; the units it does not state are metres and square metres of its projection.',
  },
  {
    id: 'cde-subbasin',
    title: 'Sub-basins',
    meaning: '75 sub-basin polygons inside the main basins, identified by the publisher’s numeric codes.',
    caveat: 'The layer carries no names at all, only an ID and GRIDCODE, so a selected sub-basin can be cited by code but not by name. No licence or date is published.',
    group: 'hydrology',
    provider: 'cdeWater',
    path: 'Basins/MapServer/1',
    layerLabel: 'Sub basin',
    kind: 'polygon',
    nameFields: [],
    keepFields: ['ID', 'GRIDCODE', 'Shape_Area'],
    measuredCount: 75,
    featureLimit: 75,
    toleranceDegrees: 0.005,
    maxPointsPerRing: 250,
    needsBbox: false,
    color: '#0369a1',
    valueKind: 'estimated',
    attributeNotes: 'No name attribute exists in this layer.',
  },
  {
    id: 'cde-watershed',
    title: 'Watersheds',
    meaning: '1,697 catchment polygons derived by the publisher from terrain, the finest hydrological unit available here.',
    caveat: 'Too many to draw country-wide: the map serves the first 600 in the current view and reports how many exist. No names, no date and no licence are published.',
    group: 'hydrology',
    provider: 'cdeWater',
    path: 'Watersheds/MapServer/0',
    layerLabel: 'Watershed',
    kind: 'polygon',
    nameFields: [],
    keepFields: ['Shape_Area', 'Shape_Length'],
    measuredCount: 1697,
    featureLimit: 600,
    toleranceDegrees: 0.01,
    maxPointsPerRing: 120,
    needsBbox: true,
    color: '#15803d',
    valueKind: 'estimated',
    attributeNotes: 'Only the publisher’s own area and length are kept; there is no identifying attribute.',
  },
  {
    id: 'cde-dam',
    title: 'Dams',
    meaning: '93 dam locations as points, with the OpenStreetMap id and name the publisher’s dataset was built from.',
    caveat: 'A point is a location, not an extent, and no completion date is published: a dam built after this snapshot will be missing. Whether a dam is operational is not stated.',
    group: 'hydrology',
    provider: 'cdeWater',
    path: 'Dams/MapServer/0',
    layerLabel: 'Dam',
    kind: 'point',
    nameFields: ['name'],
    keepFields: ['name', 'type', 'osm_id'],
    measuredCount: 93,
    featureLimit: 93,
    toleranceDegrees: 0,
    maxPointsPerRing: 0,
    needsBbox: false,
    color: '#b45309',
    valueKind: 'observed',
    attributeNotes: 'osm_id links each point to the OpenStreetMap feature it was derived from.',
  },
  {
    id: 'cde-surface-water',
    title: 'Surface water bodies',
    meaning: '380 lake and riverbank polygons the publisher describes as perennial and occasional surface water.',
    caveat: 'Per the publisher, these are derived from ESA CCI land cover at 20/100 m, so a small seasonal pond may be absent and a polygon is a classification, not a measured shoreline. Measured in this layer: 17 records, among them the named lakes Abiyata, Shala, Hawassa, Awasa and Beseka, are published with an empty geometry, so they are counted but cannot be drawn.',
    group: 'hydrology',
    provider: 'cdeWater',
    path: 'Surface_water/MapServer/0',
    layerLabel: 'Surface water',
    kind: 'polygon',
    nameFields: ['Name'],
    keepFields: ['Code', 'Name', 'Shape_Area'],
    measuredCount: 380,
    featureLimit: 380,
    toleranceDegrees: 0.005,
    maxPointsPerRing: 100,
    needsBbox: false,
    color: '#0ea5e9',
    valueKind: 'estimated',
    attributeNotes: 'Many Name values are empty strings; an unnamed water body is shown as such rather than given a label.',
  },
  {
    id: 'grid3-urban-point',
    title: 'GRID3 urban centres (points)',
    meaning: '212 named urban centres with the latitude and longitude the publisher stores as attributes, each linked to its built-up extent.',
    caveat: 'A point marks a settlement, not its size. GRID3 labels these as version 1.0 data from 2021; a town that has grown since is unchanged here.',
    group: 'settlement',
    provider: 'grid3Eth',
    path: '0',
    layerLabel: 'Urban Points',
    kind: 'point',
    nameFields: ['urb_NAME'],
    keepFields: ['urb_NAME', 'adm0_NAME', 'adm0_ISO3', 'PNT_LAT', 'PNT_LON', 'uext_ID'],
    measuredCount: 212,
    featureLimit: 212,
    toleranceDegrees: 0,
    maxPointsPerRing: 0,
    needsBbox: false,
    color: '#facc15',
    valueKind: 'estimated',
    attributeNotes: 'PNT_LAT/PNT_LON are the publisher’s own coordinates and should match the plotted point.',
  },
  {
    id: 'grid3-urban-extent',
    title: 'GRID3 built-up extents',
    meaning: '204 urban footprint polygons — the physical extent of each settlement, not its administrative boundary.',
    caveat: 'The layer has no settlement name of its own; it joins to the urban points through its uext_ID. Outlines are simplified for drawing.',
    group: 'settlement',
    provider: 'grid3Eth',
    path: '1',
    layerLabel: 'Urban Extents',
    kind: 'polygon',
    nameFields: [],
    keepFields: ['uext_ID', 'adm0_ISO3', 'Shape__Area', 'Shape__Length'],
    measuredCount: 204,
    featureLimit: 204,
    toleranceDegrees: 0.0005,
    maxPointsPerRing: 200,
    needsBbox: false,
    color: '#a21caf',
    valueKind: 'estimated',
    attributeNotes: 'Shape__Area is square metres as published.',
  },
  {
    id: 'grid3-built-up-index',
    title: 'GRID3 built-up index units',
    meaning: '54,446 small polygons, each with the share of its area that is built up, a population density figure and, where the publisher scored the unit, the resulting social-distancing index value.',
    caveat: 'This is a modelled risk surface from 2021 built on 2020 imagery and population estimates: the index is an ordinal score, not a count of people, and it was built for a pandemic mobility question, not for agriculture.',
    group: 'settlement',
    provider: 'grid3Eth',
    path: '2',
    layerLabel: 'Index',
    kind: 'polygon',
    nameFields: [],
    keepFields: ['uext_ID', 'UNIT_AREA', 'BUILT_AREA', 'BUILT_PROP', 'POP_DENS', 'BUILTscore', 'POPscore', 'INDEXvalue'],
    measuredCount: 54446,
    featureLimit: 1500,
    toleranceDegrees: 0.0005,
    maxPointsPerRing: 60,
    needsBbox: true,
    color: '#f97316',
    valueKind: 'modeled',
    attributeNotes: 'UNIT_AREA and BUILT_AREA are square metres as published — measured against the shipped polygons. The figures below come from the country-wide verification read of 1,500 units on 2026-10-30, not from the extent currently on screen: median unit 0.042 km², largest 18.8 km², so "small" is typical rather than guaranteed. BUILT_PROP is that share and holds exactly (BUILT_AREA ÷ UNIT_AREA). BUILTscore runs 0–5; POPscore runs 0–9 and INDEXvalue 0–6.5 in half steps, so neither is the 1–5 scale the documentation implies. Both POPscore and INDEXvalue also carry -99, the publisher’s not-scored value (42 of those 1,500 units): -99 means the unit was not scored, not that it scored low. POP_DENS spans 0–20,470 with no unit stated by the service, so it is served as the relative figure it is.',
  },
];

export const VECTOR_LAYER_BY_ID = new Map(VECTOR_LAYERS.map((l) => [l.id, l]));

function fail(error: SourceError, definition: VectorLayerDefinition, endpoint: string): ConnectorResult<VectorLayerPayload> {
  return { ok: false, error, provenance: provenanceFor(PROVIDERS[definition.provider].source, { endpoint, observedAt: PROVIDERS[definition.provider].vintage, valueKind: definition.valueKind, units: 'degrees (WGS84)', methodology: 'No features could be read from the publisher for this layer.', coverage: 'Ethiopia', quality: 'low' }) };
}

export interface VectorLayerPayload {
  layerId: string;
  title: string;
  meaning: string;
  caveat: string;
  group: string;
  layerLabel: string;
  geometryKind: LayerKind;
  color: string;
  features: NormalizedFeature[];
  returned: number;
  /**
   * Features whose own extent never touches the Ethiopia envelope. Several of these
   * publishers issue region-wide layers, so a lake in Kenya is a real record here —
   * counted and stated rather than quietly clipped away.
   */
  outsideExtent: number;
  /** What the publisher says exists under the same filter. */
  sourceCount: number;
  /** Measured, not inferred: fewer drawn than exist means the view is partial. */
  truncated: boolean;
  /** Records the publisher sent with no shape at all — attributes-only rows. */
  droppedNoGeometry: number;
  /** Records whose shape arrived but could not be drawn at this tolerance. */
  droppedUnplotable: number;
  vertices: number;
  pages: number;
  pageSize: number;
  featureLimit: number;
  /** Source records skipped before this page — the caller's pagination cursor. */
  offset: number;
  /**
   * False for the small layers the publisher scopes to Ethiopia itself: the whole
   * published layer comes back, so a requested view extent is carried in `bbox` for
   * the legend but was never applied upstream. Saying so beats implying a filter.
   */
  extentFiltered: boolean;
  toleranceDegrees: number;
  /** Approximate ground distance the tolerance represents at this latitude, for the legend. */
  toleranceMeters: number;
  bbox: BBox;
  attributeNotes: string;
  vintageNote: string;
  publisherLayer: string;
}

/** Round a requested extent onto a 0.25° grid so repeat pans reuse one cache entry. */
export function quantiseBbox(bbox: BBox): BBox {
  const step = 0.25;
  const floor = (n: number) => Math.floor(n / step) * step;
  const ceil = (n: number) => Math.ceil(n / step) * step;
  const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
  return {
    minLongitude: clamp(floor(bbox.minLongitude), ETHIOPIA_BBOX.minLongitude, ETHIOPIA_BBOX.maxLongitude),
    minLatitude: clamp(floor(bbox.minLatitude), ETHIOPIA_BBOX.minLatitude, ETHIOPIA_BBOX.maxLatitude),
    maxLongitude: clamp(ceil(bbox.maxLongitude), ETHIOPIA_BBOX.minLongitude, ETHIOPIA_BBOX.maxLongitude),
    maxLatitude: clamp(ceil(bbox.maxLatitude), ETHIOPIA_BBOX.minLatitude, ETHIOPIA_BBOX.maxLatitude),
  };
}

function toleranceFor(definition: VectorLayerDefinition, detail: VectorDetail): number {
  if (definition.toleranceDegrees === 0) return 0;
  // A "detailed" view must never fall back to full resolution: the twelve basins
  // measure 5.2 MB and take 116 s ungeneralised, against 103 KB in 3 s at 0.005°.
  if (detail === 'detailed') return Math.max(0.0005, definition.toleranceDegrees / 4);
  if (detail === 'overview') return Math.min(0.05, definition.toleranceDegrees * 3);
  return definition.toleranceDegrees;
}

/** 1° of latitude is ~111 km; the longitude factor shrinks with cosine, Ethiopia sits near 0.9. */
function toleranceMeters(degrees: number, latitude: number): number {
  return Math.round(degrees * 111_000 * Math.max(0.5, Math.cos((latitude * Math.PI) / 180)));
}

export async function getVectorLayer(
  layerId: string,
  options: { bbox?: BBox; detail?: VectorDetail; limit?: number; offset?: number } = {},
): Promise<ConnectorResult<VectorLayerPayload>> {
  const definition = VECTOR_LAYER_BY_ID.get(layerId);
  if (!definition) {
    return {
      ok: false,
      error: { code: 'bad_input', message: `Unknown vector layer. Available: ${VECTOR_LAYERS.map((l) => l.id).join(', ')}` },
      // This rejection came from this registry, not from any publisher, so it must not be
      // attributed to one — a named source here is read downstream as "that service answered".
      provenance: provenanceFor({
        id: 'nexus-vector-registry',
        name: 'This app’s vector layer registry (no publisher was contacted)',
        category: 'geospatial',
        homeUrl: 'https://github.com/Newaznezif/nexus-agririse/blob/fix/supabase-migration-safety/lib/data/geoVector.ts',
        license: 'Not a data response: our own request validation.',
        cadence: 'irregular',
        requiresKey: false,
      }, { endpoint: 'none', observedAt: null, valueKind: 'estimated', units: 'none', methodology: 'No such layer is registered here, so no publisher was asked.', coverage: 'none', quality: 'low' }),
    };
  }

  const provider = PROVIDERS[definition.provider];
  const endpoint = provider.root(definition.path);
  const bbox = quantiseBbox(options.bbox ?? ETHIOPIA_BBOX);
  const detail = options.detail ?? 'standard';
  const featureLimit = Math.max(1, Math.min(options.limit ?? definition.featureLimit, definition.featureLimit));
  const startOffset = Math.max(0, Math.trunc(options.offset ?? 0));
  const tolerance = toleranceFor(definition, detail);

  const outcome = await cachedFetch<VectorLayerPayload>(
    `geo:${definition.id}:${bbox.minLongitude.toFixed(2)}-${bbox.minLatitude.toFixed(2)}-${bbox.maxLongitude.toFixed(2)}-${bbox.maxLatitude.toFixed(2)}:${detail}:${featureLimit}:${startOffset}`,
    provider.ttlSeconds,
    async () => {
      const query = await queryFeatures({
        endpoint,
        objectIdField: provider.objectIdField,
        // A country-wide read of a layer the publisher itself scopes to Ethiopia gains
        // nothing from a bbox, and skipping it keeps the cache key stable.
        bbox: definition.needsBbox ? bbox : null,
        keepFields: definition.keepFields,
        nameFields: definition.nameFields,
        featureLimit,
        startOffset,
        layerMaxRecordCount: provider.maxRecordCount,
        toleranceDegrees: tolerance,
        maxPointsPerRing: definition.maxPointsPerRing,
        precision: 4,
      });
      if (!query.ok) return { ok: false, error: query.error };
      if (query.value.features.length === 0) {
        const unreadable = query.value.droppedNoGeometry + query.value.droppedUnplotable;
        return {
          ok: false,
          // "Nothing exists here" and "records exist but carry no drawable shape" are
          // different failures; the second is about the publisher's geometry, not ours.
          error: unreadable > 0
            ? { code: 'no_data', message: `The publisher sent ${unreadable} record(s) for this extent, but ${query.value.droppedNoGeometry} of them carry no geometry at all and ${query.value.droppedUnplotable} could not be drawn at this detail level` }
            : { code: 'no_data', message: 'The publisher answered with no features for this extent' },
        };
      }
      return {
        ok: true,
        value: {
          layerId: definition.id,
          title: definition.title,
          meaning: definition.meaning,
          caveat: definition.caveat,
          group: definition.group,
          layerLabel: definition.layerLabel,
          geometryKind: definition.kind,
          color: definition.color,
          features: query.value.features,
          returned: query.value.features.length,
          outsideExtent: query.value.features.filter((feature) => !bboxesIntersect(feature.bbox, ETHIOPIA_BBOX)).length,
          sourceCount: query.value.sourceCount,
          truncated: query.value.truncated,
          droppedNoGeometry: query.value.droppedNoGeometry,
          droppedUnplotable: query.value.droppedUnplotable,
          vertices: query.value.vertices,
          pages: query.value.pages,
          pageSize: query.value.pageSize,
          featureLimit,
          offset: startOffset,
          extentFiltered: definition.needsBbox,
          toleranceDegrees: tolerance,
          toleranceMeters: toleranceMeters(tolerance, (bbox.minLatitude + bbox.maxLatitude) / 2),
          bbox,
          attributeNotes: definition.attributeNotes,
          vintageNote: provider.vintageNote,
          publisherLayer: `${definition.layerLabel} (layer ${definition.path.split('/').pop()})`,
        },
      };
    },
  );

  const built = outcome.value;
  if (!built.ok) return fail(built.error, definition, endpoint);

  return {
    ok: true,
    data: built.value,
    provenance: provenanceFor(provider.source, {
      endpoint,
      // A reference dataset has a vintage, not an observation date; the tolerance and
      // the paging are ours and are stated in the methodology so nobody reads a
      // simplified outline as the publisher's own geometry.
      observedAt: provider.vintage,
      valueKind: definition.valueKind,
      units: 'degrees (WGS84, longitude then latitude)',
      methodology:
        `ArcGIS query on ${definition.layerLabel}: outSR=4326, generalised by maxAllowableOffset ${tolerance === 0 ? 'none (points carry no lines to simplify)' : `${tolerance}° (about ${toleranceMeters(tolerance, 10)} m at 10°N)`}, `
        + (definition.kind === 'point'
          ? 'each record is a single coordinate rounded to 0.0001°, with no generalisation to apply; '
          : `rings decimated to at most ${definition.maxPointsPerRing} vertices and rounded to 0.0001°; exterior rings only (inner rings dropped); `)
        + `${queryPageNote(built.value)} `
        + `${built.value.extentFiltered ? 'The publisher applied the requested bbox; ' : 'This layer is already scoped to Ethiopia by the publisher, so no bbox filter was applied upstream and the whole published layer is returned; '}`
        + `${built.value.outsideExtent > 0 ? `${built.value.outsideExtent} returned feature(s) do not touch the Ethiopia envelope — this layer is published region-wide, and they are kept and counted rather than clipped; ` : ''}`
        + `${built.value.droppedNoGeometry + built.value.droppedUnplotable > 0 ? `Absent from this response: ${built.value.droppedNoGeometry} record(s) the publisher itself sent with no geometry, and ${built.value.droppedUnplotable} whose outline collapses at this detail level (a finer detail returns more of them). ` : ''}`
        + `Attributes are the publisher’s own fields, unmodified. Outlines are approximate and do not settle legal boundaries.`,
      coverage: built.value.extentFiltered
        ? `${bbox.minLongitude}–${bbox.maxLongitude} E, ${bbox.minLatitude}–${bbox.maxLatitude} N · ${built.value.returned} of ${built.value.sourceCount >= 0 ? built.value.sourceCount : 'an uncounted number of'} published features`
        : `The whole published layer, served as the publisher scopes it (not filtered by extent) · ${built.value.returned} of ${built.value.sourceCount >= 0 ? built.value.sourceCount : 'an uncounted number of'} published features`,
      quality: definition.kind === 'point' ? 'high' : 'medium',
      retrievedAt: new Date(outcome.storedAt).toISOString(),
      servedFromCache: outcome.servedFromCache,
    }),
  };
}

function queryPageNote(payload: VectorLayerPayload): string {
  const start = payload.offset > 0 ? `starting from the publisher’s record ${payload.offset + 1}, ` : '';
  const pages = `read ${start}in ${payload.pages} page(s) of at most ${payload.pageSize} records`;
  if (payload.truncated) return `${pages} and STOPPED AT THE REQUESTED LIMIT, so this is a partial view of ${payload.sourceCount} published features; `;
  return `${pages}, complete against the publisher’s own count; `;
}

/**
 * One `returnCountOnly` per registered layer: the cheapest possible proof of whether
 * the publisher answers, so a layer can be marked unavailable before anyone clicks it.
 */
export async function readVectorLayerIndex(): Promise<ConnectorResult<VectorIndexEntry[]>> {
  const outcome = await cachedFetch<VectorIndexEntry[]>('geo:index', 6 * 3600, async () => {
    const entries = await Promise.all(
      VECTOR_LAYERS.map(async (definition) => {
        const provider = PROVIDERS[definition.provider];
        const endpoint = provider.root(definition.path);
        const count = await countFeatures(endpoint, definition.needsBbox ? ETHIOPIA_BBOX : null);
        return {
          id: definition.id,
          title: definition.title,
          meaning: definition.meaning,
          caveat: definition.caveat,
          group: definition.group,
          layerLabel: definition.layerLabel,
          geometryKind: definition.kind,
          color: definition.color,
          needsBbox: definition.needsBbox,
          source: provider.source.name,
          license: provider.source.license,
          sourceUrl: provider.source.homeUrl,
          vintage: provider.vintage,
          vintageNote: provider.vintageNote,
          attributeNotes: definition.attributeNotes,
          measuredCount: definition.measuredCount,
          liveCount: count.ok ? count.value : null,
          status: count.ok ? (count.value > 0 ? 'available' : 'no_data') : 'unavailable',
          statusDetail: count.ok ? null : count.error.message,
          featureLimit: definition.featureLimit,
          endpoint,
        } satisfies VectorIndexEntry;
      }),
    );
    return { ok: true as const, value: entries };
  });

  if (!outcome.value.ok) {
    return {
      ok: false,
      error: outcome.value.error,
      provenance: indexProvenance(outcome.storedAt, outcome.servedFromCache, 'No layer could be measured; the publisher did not answer the count queries.'),
    };
  }

  return {
    ok: true,
    data: outcome.value.value,
    provenance: indexProvenance(outcome.storedAt, outcome.servedFromCache),
  };
}

function indexProvenance(retrievedAt: number, servedFromCache: boolean, methodology?: string): Provenance {
  return provenanceFor(SOURCES.ethioAdminBoundaries, {
    endpoint: 'three ArcGIS REST feature services (see each layer’s own endpoint)',
    observedAt: null,
    valueKind: 'estimated',
    units: 'counts, not geometries',
    methodology: methodology ?? 'One returnCountOnly query per layer under an Ethiopia envelope; a layer is marked available only if the publisher answers with a positive count and no error inside the body.',
    coverage: 'Ethiopia',
    quality: 'high',
    retrievedAt: new Date(retrievedAt).toISOString(),
    servedFromCache,
  });
}

export interface VectorIndexEntry {
  id: string;
  title: string;
  meaning: string;
  caveat: string;
  group: string;
  layerLabel: string;
  geometryKind: LayerKind;
  color: string;
  needsBbox: boolean;
  source: string;
  license: string;
  sourceUrl: string;
  vintage: string | null;
  vintageNote: string;
  attributeNotes: string;
  measuredCount: number;
  liveCount: number | null;
  status: 'available' | 'no_data' | 'unavailable';
  statusDetail: string | null;
  featureLimit: number;
  endpoint: string;
}
