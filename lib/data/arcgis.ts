import { httpJson } from './http';

import type { SourceError } from './types';

/**
 * A small, deliberately boring client for ArcGIS REST feature services.
 *
 * Three things about these servers decide the shape of this file, and all three
 * were measured rather than assumed:
 *
 * 1. A publisher can answer HTTP 200 with an error inside the body
 *    (`{"error":{"code":499,"message":"Token Required for subscription content"}}`).
 *    Anything that only checks the status code reports those as successes, so the
 *    body is inspected before the data.
 * 2. `maxRecordCount` is 2,000 on every service used here. A page that stops at the
 *    limit is not a complete answer, so `exceededTransferLimit` and an independent
 *    `returnCountOnly` count are both consulted and a truncated read says so.
 * 3. Storage is often Web Mercator (102100) while the UI needs degrees. `outSR=4326`
 *    is requested and the response's own `spatialReference` is checked: if the
 *    publisher answers in metres anyway, that is a hard failure, not a silent
 *    mis-plot of 3800000 as a latitude.
 */

/** Ethiopia plus a margin, used only to reject nonsense coordinates — see `isPlausibleGeometry`. */
const PLAUSIBLE = { minLon: 20, maxLon: 62, minLat: -12, maxLat: 26 };

export interface BBox {
  minLongitude: number;
  minLatitude: number;
  maxLongitude: number;
  maxLatitude: number;
}

export type Position = [number, number];

export type FeatureGeometry =
  | { kind: 'point'; longitude: number; latitude: number }
  | { kind: 'line'; paths: Position[][] }
  | { kind: 'polygon'; rings: Position[][] };

/** One feature, normalised: WGS84 degrees, source id preserved, attributes whitelisted. */
export interface NormalizedFeature {
  sourceId: string;
  name: string | null;
  properties: Record<string, string | number | boolean | null>;
  geometry: FeatureGeometry;
  bbox: BBox;
  centroid: { latitude: number; longitude: number };
}

export interface FeatureQueryResult {
  features: NormalizedFeature[];
  /** Measured with `returnCountOnly` under the same filter — the truncation witness. */
  sourceCount: number;
  pages: number;
  /**
   * Two different failures, counted apart because they need two different sentences.
   * Measured on the live surface-water layer: 17 named lakes (Abiyata, Shala, Hawassa)
   * arrive with `rings: []` — the publisher has no shape for them — while other records
   * carry a shape that collapses at a coarse generalisation tolerance.
   */
  droppedNoGeometry: number;
  /** Records whose shape arrived but cannot be drawn: non-finite vertex, collapse, or implausible extent. */
  droppedUnplotable: number;
  truncated: boolean;
  /** The source cursor this page started from. */
  offset: number;
  pageSize: number;
  /** Total vertices actually drawn, so the UI can state the fidelity it is showing. */
  vertices: number;
  geometryType: string;
}

export type ArcgisOutcome<T> = { ok: true; value: T } | { ok: false; error: SourceError };

/** Why a record produced no shape: the publisher sent none, or the shape cannot be drawn. */
export type DropReason = 'no_geometry' | 'unplotable' | null;

/**
 * ArcGIS puts the real failure in the body. Map its own codes onto our stable
 * client-safe codes; the message is shortened and carries no URL.
 */
function bodyError(json: unknown): SourceError | null {
  const error = (json as { error?: { code?: number; message?: string; details?: unknown } })?.error;
  if (!error) return null;
  const raw = (error.message ?? 'The publisher rejected the request').toString().replace(/\s+/g, ' ').trim().slice(0, 160);
  const code = error.code;
  // 499 is ArcGIS's own "client closed connection", which in practice these servers
  // return for "subscription content, no token supplied".
  if (code === 499 || code === 401 || code === 403) return { code: 'auth_required', message: `Authorisation required by the publisher: ${raw}`, status: 200 };
  if (code === 404) return { code: 'no_data', message: `The publisher has no such service or layer: ${raw}`, status: 200 };
  if (code === 400 || code === 402) return { code: 'bad_input', message: `The publisher rejected this query: ${raw}`, status: 200 };
  return { code: 'http_status', message: `The publisher returned an error payload: ${raw}`, status: 200 };
}

/**
 * Measured against the live publishers: a generalised page is 1–4 s, but CDE was
 * observed to stall past 25 s on one cold basin request, and the same layer asked for
 * without generalisation is 5.2 MB in 116 s. One attempt is therefore capped at 15 s
 * with a single retry — in line with the other connectors in this directory — so a
 * stalled service returns an honest timeout rather than blocking a dashboard render.
 */
async function arcgisJson<T>(url: string): Promise<ArcgisOutcome<T>> {
  const res = await httpJson(url, { timeoutMs: 15_000, retries: 1, maxBytes: 16 * 1024 * 1024 });
  if (!res.ok) return { ok: false, error: res.error };
  const inBody = bodyError(res.json);
  if (inBody) return { ok: false, error: inBody };
  return { ok: true, value: res.json as T };
}

/* ------------------------------------------------------------------ *
 * Geometry normalisation
 * ------------------------------------------------------------------ */

function finitePosition(raw: unknown): Position | null {
  if (!Array.isArray(raw)) return null;
  const [lon, lat] = raw as [unknown, unknown];
  if (typeof lon !== 'number' || typeof lat !== 'number') return null;
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
  if (lon < -180 || lon > 180 || lat < -90 || lat > 90) return null;
  return [lon, lat];
}

const round = (value: number, precision: number) => {
  const factor = 10 ** precision;
  return Math.round(value * factor) / factor;
};

/** Signed shoelace area; sign tells the ring's winding in the returned coordinates. */
function twiceSignedArea(ring: Position[]): number {
  let sum = 0;
  for (let i = 0; i < ring.length - 1; i += 1) {
    const [x0, y0] = ring[i];
    const [x1, y1] = ring[i + 1];
    sum += x0 * y1 - x1 * y0;
  }
  return sum;
}

function keepEveryNth(ring: Position[], maxPoints: number, precision: number): Position[] {
  const step = Math.max(1, Math.ceil(ring.length / Math.max(3, maxPoints)));
  const out: Position[] = [];
  for (let i = 0; i < ring.length; i += step) {
    const [lon, lat] = ring[i];
    const next: Position = [round(lon, precision), round(lat, precision)];
    // Server-side generalisation plus rounding to 4 decimals produces runs of identical
    // vertices; three copies of one coordinate is not an outline, it is payload weight.
    const previous = out[out.length - 1];
    if (previous && previous[0] === next[0] && previous[1] === next[1]) continue;
    out.push(next);
  }
  const first = out[0];
  const last = out[out.length - 1];
  if (first && last && (first[0] !== last[0] || first[1] !== last[1])) out.push([first[0], first[1]]);
  return out;
}

/**
 * esriPolygon.rings is a flat list of exterior rings and holes across possibly
 * several polygons. ArcGIS's convention is clockwise-outside, but not every
 * publisher follows it, so the winding is inferred from the payload itself: the
 * majority orientation (by absolute area) is taken to be the exterior. When every
 * ring shares one orientation there is nothing to distinguish, so each ring is
 * kept as its own outline — which is what a dashboard needs, and the methodology
 * says so.
 */
function exteriorRings(ringsRaw: unknown, maxPoints: number, precision: number): Position[][] {
  if (!Array.isArray(ringsRaw)) return [];
  const candidates: { ring: Position[]; area: number }[] = [];
  for (const raw of ringsRaw) {
    if (!Array.isArray(raw)) continue;
    const ring: Position[] = [];
    for (const position of raw) {
      const p = finitePosition(position);
      // A single bad vertex would otherwise silently open a gap in the outline, so
      // the whole ring is rejected instead of patched.
      if (!p) { ring.length = 0; break; }
      ring.push(p);
    }
    if (ring.length < 4) continue;
    candidates.push({ ring, area: twiceSignedArea(ring) });
  }
  if (candidates.length === 0) return [];

  let positive = 0;
  let negative = 0;
  for (const c of candidates) {
    if (c.area > 0) positive += c.area;
    else negative += -c.area;
  }

  let kept = candidates;
  if (positive > 0 && negative > 0) {
    const exteriorIsPositive = positive >= negative;
    kept = candidates.filter((c) => (exteriorIsPositive ? c.area > 0 : c.area < 0));
    // Every ring rejected by the filter would leave an empty overlay; keep them all
    // rather than claim a layer that has no shapes.
    if (kept.length === 0) kept = candidates;
  }

  return kept.map((c) => keepEveryNth(c.ring, maxPoints, precision)).filter((r) => r.length > 3);
}

function toPaths(pathsRaw: unknown, maxPoints: number, precision: number): Position[][] {
  if (!Array.isArray(pathsRaw)) return [];
  const out: Position[][] = [];
  for (const raw of pathsRaw) {
    if (!Array.isArray(raw)) continue;
    const path: Position[] = [];
    for (const position of raw) {
      const p = finitePosition(position);
      if (!p) { path.length = 0; break; }
      path.push(p);
    }
    if (path.length < 2) continue;
    out.push(keepEveryNth(path, maxPoints, precision));
  }
  return out;
}

function boundsOf(rings: Position[][]): BBox | null {
  let minLat = 90;
  let maxLat = -90;
  let minLon = 180;
  let maxLon = -180;
  let seen = 0;
  for (const ring of rings) {
    for (const [lon, lat] of ring) {
      seen += 1;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
      if (lon < minLon) minLon = lon;
      if (lon > maxLon) maxLon = lon;
    }
  }
  if (seen === 0) return null;
  return { minLatitude: minLat, minLongitude: minLon, maxLatitude: maxLat, maxLongitude: maxLon };
}

/**
 * Area centroid of one ring by the shoelace integral, or null when it encloses no area.
 * Esri rings are usually closed; both forms are handled so the last edge is not dropped.
 */
function ringCentroid(ring: Position[]): { latitude: number; longitude: number } | null {
  const n = ring.length;
  if (n < 3) return null;
  const closed = ring[0][0] === ring[n - 1][0] && ring[0][1] === ring[n - 1][1];
  const steps = closed ? n - 1 : n;
  let twice = 0;
  let sumX = 0;
  let sumY = 0;
  for (let i = 0; i < steps; i += 1) {
    const [x0, y0] = ring[i];
    const [x1, y1] = ring[(i + 1) % n];
    const cross = x0 * y1 - x1 * y0;
    twice += cross;
    sumX += (x0 + x1) * cross;
    sumY += (y0 + y1) * cross;
  }
  if (Math.abs(twice) < 1e-12) return null;
  return { latitude: sumY / (3 * twice), longitude: sumX / (3 * twice) };
}

/**
 * Area-weighted centroid of a feature's exterior rings, falling back to the centre of its
 * bbox only when nothing encloses area. This is the point the map samples satellite pixels
 * at, and the middle of a concave outline's bounding box can sit outside the outline it
 * names — reading that pixel and calling it the feature's value would be wrong.
 */
function areaCentroidOf(rings: Position[][], bbox: BBox): { latitude: number; longitude: number } {
  let weight = 0;
  let longitude = 0;
  let latitude = 0;
  for (const ring of rings) {
    const centroid = ringCentroid(ring);
    const area = Math.abs(twiceSignedArea(ring)) / 2;
    if (!centroid || !Number.isFinite(area) || area === 0) continue;
    weight += area;
    longitude += centroid.longitude * area;
    latitude += centroid.latitude * area;
  }
  if (weight === 0) return { latitude: (bbox.minLatitude + bbox.maxLatitude) / 2, longitude: (bbox.minLongitude + bbox.maxLongitude) / 2 };
  return { latitude: latitude / weight, longitude: longitude / weight };
}

/**
 * Rejection guard for the three failure modes measured on these services: coordinates
 * already in metres that the publisher never converted, an advertised extent of ±Infinity,
 * and a decode slip that puts a vertex on another continent. A feature whose coordinates are
 * not on the African side of the map is not plotted.
 */
function isPlausibleGeometry(bbox: BBox): boolean {
  return (
    bbox.minLongitude >= PLAUSIBLE.minLon
    && bbox.maxLongitude <= PLAUSIBLE.maxLon
    && bbox.minLatitude >= PLAUSIBLE.minLat
    && bbox.maxLatitude <= PLAUSIBLE.maxLat
    // A polygon spanning half the globe is a decoding error, not a basin.
    && bbox.maxLongitude - bbox.minLongitude <= 40
    && bbox.maxLatitude - bbox.minLatitude <= 40
  );
}

function normalizeFeature(
  raw: { attributes?: Record<string, unknown>; geometry?: Record<string, unknown> | null },
  options: { objectIdField: string; nameFields: string[]; keepFields: string[]; maxPointsPerRing: number; precision: number },
  fallbackId: string,
): { feature: NormalizedFeature | null; reason: DropReason } {
  const attributes = raw.attributes ?? {};
  const geometry = raw.geometry;

  const rawId = attributes[options.objectIdField] ?? attributes.FID ?? attributes.OBJECTID ?? attributes.id ?? fallbackId;
  const sourceId = typeof rawId === 'number' || typeof rawId === 'string' ? String(rawId).trim() : fallbackId;
  let name: string | null = null;
  for (const field of options.nameFields) {
    const value = attributes[field];
    if (typeof value === 'string' && value.trim() !== '') {
      name = value.trim().slice(0, 120);
      break;
    }
  }

  const properties: Record<string, string | number | boolean | null> = {};
  for (const field of options.keepFields) {
    if (!(field in attributes)) continue;
    const value = attributes[field];
    if (value === null || value === undefined) {
      properties[field] = null;
    } else if (typeof value === 'number') {
      properties[field] = Number.isFinite(value) ? value : null;
    } else if (typeof value === 'boolean' || typeof value === 'string') {
      properties[field] = typeof value === 'string' ? value.slice(0, 160) : value;
    }
    // Anything nested is not a dashboard attribute; it is dropped rather than stringified.
  }

  if (!geometry) return { feature: null, reason: 'no_geometry' };

  // `f=json` geometries carry no per-feature `type`: a point is simply `{x,y}` and a
  // polygon is `{rings}`, with the geometry type declared once at the response level.
  // Reading only `geometry.type` dropped every point feature on two live services.
  const isPointShape = typeof geometry.x === 'number' || typeof geometry.longitude === 'number';
  const isLineShape = Array.isArray(geometry.paths);
  const isRingShape = Array.isArray(geometry.rings) || Array.isArray(geometry.coordinates);

  if (isPointShape) {
    const x = geometry.x ?? geometry.longitude;
    const y = geometry.y ?? geometry.latitude;
    const p = finitePosition([x, y]);
    if (!p) return { feature: null, reason: 'unplotable' };
    const [lon, lat] = [round(p[0], options.precision), round(p[1], options.precision)];
    const bbox = { minLatitude: lat, maxLatitude: lat, minLongitude: lon, maxLongitude: lon };
    if (!isPlausibleGeometry(bbox)) return { feature: null, reason: 'unplotable' };
    return { feature: { sourceId, name, properties, geometry: { kind: 'point', longitude: lon, latitude: lat }, bbox, centroid: { latitude: lat, longitude: lon } }, reason: null };
  }

  if (isLineShape) {
    const paths = toPaths(geometry.paths, options.maxPointsPerRing, options.precision);
    const bbox = boundsOf(paths);
    if (paths.length === 0) return { feature: null, reason: 'no_geometry' };
    if (!bbox || !isPlausibleGeometry(bbox)) return { feature: null, reason: 'unplotable' };
    return {
      feature: { sourceId, name, properties, geometry: { kind: 'line', paths }, bbox, centroid: { latitude: (bbox.minLatitude + bbox.maxLatitude) / 2, longitude: (bbox.minLongitude + bbox.maxLongitude) / 2 } },
      reason: null,
    };
  }

  if (!isRingShape) return { feature: null, reason: 'no_geometry' };

  // Both `Polygon` and a MultiPolygon's `coordinates` arrive as `rings` in esri JSON.
  const rawRings = geometry.rings ?? geometry.coordinates;
  if (!Array.isArray(rawRings) || rawRings.length === 0) return { feature: null, reason: 'no_geometry' };
  const rings = exteriorRings(rawRings, options.maxPointsPerRing, options.precision);
  const bbox = boundsOf(rings);
  if (rings.length === 0 || !bbox || !isPlausibleGeometry(bbox)) return { feature: null, reason: 'unplotable' };
  const centre = areaCentroidOf(rings, bbox);
  // Rounding to the payload's own precision can nudge a centroid that sits exactly on the
  // edge of a paper-thin polygon outside its bbox, so the rounded value is clamped back in.
  const centroid = {
    latitude: Math.min(bbox.maxLatitude, Math.max(bbox.minLatitude, round(centre.latitude, options.precision))),
    longitude: Math.min(bbox.maxLongitude, Math.max(bbox.minLongitude, round(centre.longitude, options.precision))),
  };
  return {
    feature: { sourceId, name, properties, geometry: { kind: 'polygon', rings }, bbox, centroid },
    reason: null,
  };
}

/* ------------------------------------------------------------------ *
 * Service calls
 * ------------------------------------------------------------------ */

/**
 * The spatial filter, in the envelope-`geometry` form.
 *
 * Measured on the live services: `bbox=lon,min..&bboxSR=4326` is **accepted and
 * ignored** — an Addis Ababa envelope on the kebele layer returned the country's
 * whole 15,670 count and its first features from Tigray. The documented envelope form
 * (`geometry={"xmin":…}` with `geometryType`/`inSR`) is the one that filters: 358
 * features for the same box. A filter that silently does nothing would make every
 * "filtered to your view" claim below false, so there is exactly one way to ask.
 */
function applySpatialFilter(params: URLSearchParams, bbox: BBox | null): void {
  if (!bbox) return;
  params.set('geometry', JSON.stringify({ xmin: bbox.minLongitude, ymin: bbox.minLatitude, xmax: bbox.maxLongitude, ymax: bbox.maxLatitude }));
  params.set('geometryType', 'esriGeometryEnvelope');
  params.set('inSR', '4326');
  params.set('spatialRel', 'esriSpatialRelIntersects');
}

/** `returnCountOnly` under the same filter: the witness that a page is complete. */
export async function countFeatures(endpoint: string, bbox: BBox | null): Promise<ArcgisOutcome<number>> {
  const params = new URLSearchParams({ f: 'json', where: '1=1', returnCountOnly: 'true' });
  applySpatialFilter(params, bbox);
  const outcome = await arcgisJson<{ count?: unknown }>(`${endpoint}/query?${params.toString()}`);
  if (!outcome.ok) return outcome;
  const count = outcome.value.count;
  if (typeof count !== 'number' || !Number.isFinite(count)) return { ok: false, error: { code: 'parse_failed', message: 'The publisher did not answer the record count' } };
  return { ok: true, value: count };
}

export interface FeatureQueryOptions {
  endpoint: string;
  objectIdField: string;
  bbox: BBox | null;
  /** Attribute fields to keep, in the order the UI should show them. */
  keepFields: string[];
  nameFields: string[];
  /** Hard ceiling on features returned to one caller, regardless of the source count. */
  featureLimit: number;
  /** The page size the publisher itself allows (`maxRecordCount`: 1,000 on one service, 2,000 on the others). */
  layerMaxRecordCount: number | null;
  /**
   * Server-side generalisation tolerance **in degrees**, because `outSR=4326` puts
   * `maxAllowableOffset` in the output spatial reference. Passing metres here is a
   * silent data-corruption bug: a request for "2,000 m" was measured to ask for
   * 2,000 degrees and came back as a four-point box, with no error anywhere.
   */
  toleranceDegrees: number;
  maxPointsPerRing: number;
  precision: number;
  /** Skip this many source records before reading — the caller's page cursor. */
  startOffset?: number;
}

/**
 * Pages with `resultOffset`/`resultRecordCount` under a stable `orderByFields`, and
 * never claims a completeness it did not measure: `sourceCount` comes from a separate
 * `returnCountOnly` request under the same filter, and `truncated` is true whenever
 * fewer features were drawn than the publisher says exist.
 *
 * The page loop is bounded twice over — by `featureLimit` and by a request budget — so
 * a 54,000-feature layer cannot turn one dashboard render into fifty upstream calls.
 * Stopping early is reported, not hidden.
 */
export async function queryFeatures(options: FeatureQueryOptions): Promise<ArcgisOutcome<FeatureQueryResult>> {
  const pageSize = Math.max(1, Math.min(options.featureLimit, options.layerMaxRecordCount ?? 2000, 2000));
  const budget = 8;
  const tolerance = Math.max(0, Math.min(0.05, options.toleranceDegrees));

  const count = await countFeatures(options.endpoint, options.bbox);
  // A missing count is not a reason to refuse the features, but it is a reason to say
  // that completeness is unknown — surfaced as `sourceCount: -1`.
  const sourceCount = count.ok ? count.value : -1;

  const features: NormalizedFeature[] = [];
  let droppedNoGeometry = 0;
  let droppedUnplotable = 0;
  let vertices = 0;
  let pages = 0;
  let sawTransferLimit = false;
  const startOffset = Math.max(0, Math.trunc(options.startOffset ?? 0));
  let offset = startOffset;

  for (let page = 0; page < budget; page += 1) {
    if (features.length >= options.featureLimit) break;
    if (sourceCount >= 0 && offset >= sourceCount) break;

    const params = new URLSearchParams({
      f: 'json',
      where: '1=1',
      outFields: '*',
      returnGeometry: 'true',
      outSR: '4326',
      resultRecordCount: String(pageSize),
      resultOffset: String(offset),
    });
    if (options.bbox) applySpatialFilter(params, options.bbox);
    if (tolerance > 0) params.set('maxAllowableOffset', String(tolerance));
    if (options.objectIdField) params.set('orderByFields', `${options.objectIdField} ASC`);

    const outcome = await arcgisJson<{
      features?: { attributes?: Record<string, unknown>; geometry?: Record<string, unknown> | null }[];
      spatialReference?: { wkid?: number; latestWkid?: number };
      exceededTransferLimit?: boolean;
    }>(`${options.endpoint}/query?${params.toString()}`);
    if (!outcome.ok) {
      // A partial read is only honest if it is reported as partial; before the first
      // page there is nothing to report, so the provider error is returned unchanged.
      if (features.length === 0) return outcome;
      sawTransferLimit = true;
      break;
    }

    const body = outcome.value;
    const srid = body.spatialReference?.latestWkid ?? body.spatialReference?.wkid ?? null;
    if (srid !== null && srid !== 4326) {
      return { ok: false, error: { code: 'parse_failed', message: `The publisher answered in EPSG:${srid} although WGS84 was requested; coordinates were not plotted` } };
    }

    const batch = body.features ?? [];
    pages += 1;
    if (batch.length === 0) break;

    for (let i = 0; i < batch.length && features.length < options.featureLimit; i += 1) {
      const normalized = normalizeFeature(batch[i], options, String(offset + i + 1));
      if (!normalized.feature) {
        if (normalized.reason === 'no_geometry') droppedNoGeometry += 1;
        else droppedUnplotable += 1;
        continue;
      }
      features.push(normalized.feature);
      const geometry = normalized.feature.geometry;
      vertices += geometry.kind === 'point' ? 1 : geometry.kind === 'line' ? geometry.paths.reduce((n, p) => n + p.length, 0) : geometry.rings.reduce((n, r) => n + r.length, 0);
    }

    offset += batch.length;
    sawTransferLimit = body.exceededTransferLimit === true;
    if (batch.length < pageSize && !sawTransferLimit) break;
  }

  // Completeness is measured against the read cursor, not the returned count: a page
  // that stops because of `featureLimit`, a failed page, or a non-zero `startOffset`
  // has by definition not covered the source, while records that arrived without a
  // drawable shape are counted in `droppedNoGeometry`/`droppedUnplotable` instead.
  const truncated = sourceCount >= 0 ? offset < sourceCount : sawTransferLimit;
  return {
    ok: true,
    value: {
      features,
      sourceCount,
      pages,
      droppedNoGeometry,
      droppedUnplotable,
      vertices,
      truncated,
      offset: startOffset,
      pageSize,
      geometryType: features[0]?.geometry.kind ?? 'unknown',
    },
  };
}

/** Overlap test, not containment: a basin that leaves the frame still touches it. */
export function bboxesIntersect(a: BBox, b: BBox): boolean {
  return a.maxLongitude >= b.minLongitude && a.minLongitude <= b.maxLongitude && a.maxLatitude >= b.minLatitude && a.minLatitude <= b.maxLatitude;
}
