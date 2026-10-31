import { cachedFetch } from './cache';
import { httpJson } from './http';
import { provenanceFor, SOURCES } from './sources';
import type { ConnectorResult, SourceError } from './types';

/**
 * Administrative outlines for Ethiopia, from geoBoundaries (gbOpen).
 *
 * The published files are far finer than a dashboard needs, so the server
 * returns exterior rings decimated to a fixed point budget and rounded to three
 * decimals. That keeps a region map under a few kilobytes while staying honest:
 * the outline is a simplification of the publisher's geometry, and the
 * provenance says so.
 */

const GB_BASE = 'https://media.githubusercontent.com/media/wmgeolab/geoBoundaries/main/releaseData/gbOpen/ETH';

/**
 * raw.githubusercontent.com serves a 131-byte Git LFS pointer for these files,
 * which is why the media host is used instead.
 */
function boundaryUrl(level: 0 | 1): string {
  return `${GB_BASE}/ADM${level}/geoBoundaries-ETH-ADM${level}_simplified.geojson`;
}

export interface AdminBoundary {
  /** Publisher's stable code, e.g. "ET-AA". */
  id: string;
  name: string;
  level: 0 | 1;
  centroid: { latitude: number; longitude: number };
  bbox: { minLatitude: number; minLongitude: number; maxLatitude: number; maxLongitude: number };
  /** Exterior rings as [longitude, latitude] pairs, in the GeoJSON order. */
  rings: [number, number][][];
}

const MAX_POINTS_PER_RING = 140;

type Position = [number, number];

interface GeoGeometry {
  type: string;
  coordinates: unknown;
}

interface GeoFeature {
  properties?: { shapeName?: string; shapeISO?: string; shapeID?: string };
  geometry?: GeoGeometry;
}

function exteriorRings(geometry: GeoGeometry): Position[][] {
  if (geometry.type === 'Polygon') {
    const rings = geometry.coordinates as Position[][];
    return rings.length > 0 ? [rings[0]] : [];
  }
  if (geometry.type === 'MultiPolygon') {
    const polys = geometry.coordinates as Position[][][];
    return polys.filter((rings) => rings.length > 0).map((rings) => rings[0]);
  }
  return [];
}

function decimate(ring: Position[]): [number, number][] {
  const step = Math.max(1, Math.ceil(ring.length / MAX_POINTS_PER_RING));
  const out: [number, number][] = [];
  for (let i = 0; i < ring.length; i += step) {
    const p = ring[i];
    if (typeof p?.[0] !== 'number' || typeof p?.[1] !== 'number') continue;
    out.push([Math.round(p[0] * 1000) / 1000, Math.round(p[1] * 1000) / 1000]);
  }
  // A polygon needs its closing vertex to render as a closed shape.
  const first = out[0];
  const last = out[out.length - 1];
  if (first && last && (first[0] !== last[0] || first[1] !== last[1])) out.push(first);
  return out;
}

/** Shoelace area and centroid of one ring; area is signed. */
function ringAreaCentroid(ring: [number, number][]): { area: number; longitude: number; latitude: number } {
  let twiceArea = 0;
  let sx = 0;
  let sy = 0;
  for (let i = 0; i < ring.length - 1; i += 1) {
    const [x0, y0] = ring[i];
    const [x1, y1] = ring[i + 1];
    const cross = x0 * y1 - x1 * y0;
    twiceArea += cross;
    sx += (x0 + x1) * cross;
    sy += (y0 + y1) * cross;
  }
  if (twiceArea === 0) {
    const [x, y] = ring[0] ?? [0, 0];
    return { area: 0, longitude: x, latitude: y };
  }
  return { area: twiceArea / 2, longitude: sx / (3 * twiceArea), latitude: sy / (3 * twiceArea) };
}

export function parseBoundaries(payload: unknown, level: 0 | 1): AdminBoundary[] {
  const features = (payload as { features?: GeoFeature[] })?.features;
  if (!Array.isArray(features)) return [];

  const out: AdminBoundary[] = [];
  for (const f of features) {
    const geometry = f.geometry;
    if (!geometry) continue;
    const rings = exteriorRings(geometry).map(decimate).filter((r) => r.length > 2);
    if (rings.length === 0) continue;

    let minLat = 90;
    let maxLat = -90;
    let minLng = 180;
    let maxLng = -180;
    for (const ring of rings) {
      for (const [lng, lat] of ring) {
        if (lat < minLat) minLat = lat;
        if (lat > maxLat) maxLat = lat;
        if (lng < minLng) minLng = lng;
        if (lng > maxLng) maxLng = lng;
      }
    }

    // Area-weighted so an enclave-heavy MultiPolygon labels near its bulk.
    let totalArea = 0;
    let lng = 0;
    let lat = 0;
    for (const ring of rings) {
      const { area, longitude, latitude } = ringAreaCentroid(ring);
      const weight = Math.abs(area);
      totalArea += weight;
      lng += longitude * weight;
      lat += latitude * weight;
    }
    if (totalArea === 0) {
      lng = (minLng + maxLng) / 2;
      lat = (minLat + maxLat) / 2;
    } else {
      lng /= totalArea;
      lat /= totalArea;
    }

    out.push({
      id: (f.properties?.shapeISO ?? f.properties?.shapeID ?? `ETH-ADM${level}-${out.length}`).trim(),
      name: (f.properties?.shapeName ?? 'Unnamed area').trim(),
      level,
      centroid: { latitude: Math.round(lat * 10000) / 10000, longitude: Math.round(lng * 10000) / 10000 },
      bbox: {
        minLatitude: Math.round(minLat * 10000) / 10000,
        minLongitude: Math.round(minLng * 10000) / 10000,
        maxLatitude: Math.round(maxLat * 10000) / 10000,
        maxLongitude: Math.round(maxLng * 10000) / 10000,
      },
      rings,
    });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

function fail(error: SourceError, endpoint: string): ConnectorResult<AdminBoundary[]> {
  return {
    ok: false,
    error,
    provenance: provenanceFor(SOURCES.geoBoundaries, {
      endpoint,
      observedAt: null,
      valueKind: 'estimated',
      units: 'degrees (WGS84)',
      methodology: 'Administrative boundary outlines',
      coverage: 'Ethiopia',
      quality: 'low',
    }),
  };
}

export async function getAdminBoundaries(level: 0 | 1): Promise<ConnectorResult<AdminBoundary[]>> {
  const url = boundaryUrl(level);
  const outcome = await cachedFetch<AdminBoundary[]>(`gb:eth:adm${level}`, 7 * 86400, async () => {
    const res = await httpJson(url, { timeoutMs: 30_000, maxBytes: 6 * 1024 * 1024 });
    if (!res.ok) return { ok: false, error: res.error };
    const boundaries = parseBoundaries(res.json, level);
    if (boundaries.length === 0) return { ok: false, error: { code: 'no_data', message: 'Boundary file contained no usable polygons' } };
    return { ok: true, value: boundaries };
  });

  const built = outcome.value;
  if (!built.ok) return fail(built.error, url);

  return {
    ok: true,
    data: built.value,
    provenance: provenanceFor(SOURCES.geoBoundaries, {
      endpoint: url,
      // A boundary vintage, not an observation: the publisher's release date is
      // what the farmer should see, and the file itself carries none.
      observedAt: null,
      valueKind: 'estimated',
      units: 'degrees (WGS84, longitude then latitude)',
      methodology:
        `geoBoundaries gbOpen ADM${level} simplified geometry; exterior rings only (internal enclaves dropped), decimated to at most ${MAX_POINTS_PER_RING} distinct points per ring plus the closing vertex repeated at the end, and rounded to 0.001°. Outlines are approximate and do not settle legal boundaries.`,
      coverage: `Ethiopia, ${built.value.length} ADM${level} areas`,
      quality: 'medium',
      retrievedAt: new Date(outcome.storedAt).toISOString(),
      servedFromCache: outcome.servedFromCache,
    }),
  };
}
