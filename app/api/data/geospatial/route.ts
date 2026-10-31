import type { NextResponse } from 'next/server';

import { badRequest, errorResponse, fromConnector, intParam, isoDateParam, numberParam, stringParam, withExtras } from '@/lib/data/api';
import { type BBox } from '@/lib/data/arcgis';
import { getAdminBoundaries } from '@/lib/data/boundaries';
import { ETHIOPIA_BBOX, getVectorLayer, readVectorLayerIndex, VECTOR_LAYER_BY_ID, type VectorDetail } from '@/lib/data/geoVector';
import { findLatestLayerDate, GIBS_LAYERS, sampleLayerAtCoordinate } from '@/lib/data/gibs';
import { isWithinEthiopia } from '@/lib/data/locations';
import { provenanceFor, SOURCES } from '@/lib/data/sources';

/**
 * GET /api/data/geospatial
 *
 *  - `view=layers`     the published composites, each with the newest date GIBS
 *                      actually answers for, plus its meaning and its caveat
 *  - `view=boundaries` geoBoundaries ETH outlines (ADM0 or ADM1), simplified here
 *  - `view=sample`     one physical value read out of a tile for one coordinate
 *  - `view=vectors`    every registered vector layer with the publisher's own live
 *                      feature count, so an unavailable service is visible before
 *                      anyone clicks its toggle
 *  - `view=vector`     one layer's real geometries and attributes: `layer` (required),
 *                      `bbox=minLon,minLat,maxLon,maxLat`, `detail=overview|standard|
 *                      detailed`, `limit`, `offset` for paging
 *
 * The map is not decorative: a layer entry carries the date of the scene, and a
 * sample carries the pixel footprint and the colour-map band it came from.
 *
 * One route serves every geospatial view because that is how this repository names
 * them (`/api/data/<domain>?view=<x>`); the provider paths the brief listed map onto
 * `view=vector&layer=<id>` rather than becoming six near-identical endpoints.
 */
export async function GET(request: Request): Promise<NextResponse> {
  const url = new URL(request.url);
  const view = stringParam(url, 'view') ?? 'layers';

  if (view === 'boundaries') {
    const level = intParam(url, 'level', 0, 1, 1) as 0 | 1;
    return fromConnector(await getAdminBoundaries(level), 7 * 86400);
  }

  if (view === 'vectors') return fromConnector(await readVectorLayerIndex(), 6 * 3600);

  if (view === 'vector') {
    const layerId = stringParam(url, 'layer');
    if (!layerId) return badRequest(`view=vector requires layer, one of: ${[...VECTOR_LAYER_BY_ID.keys()].join(', ')}`);

    const bbox = readBbox(url);
    if (!bbox.ok) return badRequest(bbox.error);

    const requestedDetail = stringParam(url, 'detail') ?? 'standard';
    if (!DETAILS.includes(requestedDetail as VectorDetail)) {
      return badRequest('detail must be one of: ' + DETAILS.join(', '));
    }

    const limit = intParam(url, 'limit', 1, 5000, 0);
    return fromConnector(
      await getVectorLayer(layerId, {
        bbox: bbox.value,
        detail: requestedDetail as VectorDetail,
        limit: limit === 0 ? undefined : limit,
        offset: intParam(url, 'offset', 0, 200_000, 0),
      }),
      6 * 3600,
    );
  }

  if (view === 'sample') {
    const layerId = stringParam(url, 'layer');
    if (!layerId) return badRequest('view=sample requires layer, one of: ' + GIBS_LAYERS.map((l) => l.id).join(', '));

    const rawLat = numberParam(url, 'lat');
    const rawLon = numberParam(url, 'lon');
    if (rawLat === null || rawLon === null || Number.isNaN(rawLat) || Number.isNaN(rawLon)) {
      return badRequest('view=sample requires numeric lat and lon');
    }

    const date = isoDateParam(url, 'date');
    if (date === 'invalid') return badRequest('date must be YYYY-MM-DD');

    const sample = await sampleLayerAtCoordinate({ layerId, latitude: rawLat, longitude: rawLon, date: date ?? undefined });
    const layer = GIBS_LAYERS.find((l) => l.id === layerId);
    return withExtras(
      sample,
      {
        layer: layer ? { title: layer.title, meaning: layer.meaning, caveat: layer.caveat, units: layer.units, cadence: layer.cadence, resolution: layer.resolution } : null,
        withinEthiopia: isWithinEthiopia(rawLat, rawLon),
      },
      6 * 3600,
    );
  }

  if (view !== 'layers') return errorResponse({ code: 'bad_input', message: 'Unknown view' });

  const resolved = await Promise.all(
    GIBS_LAYERS.map(async (layer) => {
      const latest = await findLatestLayerDate(layer);
      return {
        ...layer,
        latestAvailableDate: latest.ok ? latest.data : null,
        availabilityError: latest.ok ? null : latest.error.message,
      };
    }),
  );

  return withExtras(
    {
      ok: true,
      data: { layers: resolved },
      provenance: provenanceFor(SOURCES.nasaGibs, {
        endpoint: 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/1.0.0/WMTSCapabilities.xml',
        observedAt: resolved.map((l) => l.latestAvailableDate).filter(Boolean).sort().at(-1) ?? null,
        valueKind: 'observed',
        units: 'per layer (see each layer’s units field)',
        methodology:
          'Layer list and tile-matrix sets read from the service’s own GetCapabilities; the newest date per layer is the most recent scene the tile endpoint actually serves.',
        coverage: 'Global composites; sampling is limited to Ethiopia in the UI',
        quality: 'high',
      }),
    },
    {},
    6 * 3600,
  );
}

const DETAILS: VectorDetail[] = ['overview', 'standard', 'detailed'];

/**
 * `bbox=minLon,minLat,maxLon,maxLat`. A box that cannot touch Ethiopia is rejected
 * rather than clamped: silently widening a request for Rotterdam into a request for
 * the Horn of Africa would return features the caller never asked about.
 */
function readBbox(url: URL): { ok: true; value?: BBox } | { ok: false; error: string } {
  const raw = stringParam(url, 'bbox');
  if (raw === null) return { ok: true };

  const parts = raw.split(',').map((p) => Number(p.trim()));
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) {
    return { ok: false, error: 'bbox must be four numbers: minLon,minLat,maxLon,maxLat' };
  }

  const [minLongitude, minLatitude, maxLongitude, maxLatitude] = parts;
  if (Math.abs(minLongitude) > 180 || Math.abs(maxLongitude) > 180 || Math.abs(minLatitude) > 90 || Math.abs(maxLatitude) > 90) {
    return { ok: false, error: 'bbox longitude must be within ±180 and latitude within ±90' };
  }
  if (minLongitude >= maxLongitude || minLatitude >= maxLatitude) {
    return { ok: false, error: 'bbox must run from the smaller coordinate to the larger one' };
  }
  if (!intersectsEthiopia({ minLongitude, minLatitude, maxLongitude, maxLatitude })) {
    return { ok: false, error: 'bbox does not overlap Ethiopia; these services publish Ethiopian layers only' };
  }

  return { ok: true, value: { minLongitude, minLatitude, maxLongitude, maxLatitude } };
}

function intersectsEthiopia(bbox: BBox): boolean {
  return (
    bbox.maxLongitude >= ETHIOPIA_BBOX.minLongitude &&
    bbox.minLongitude <= ETHIOPIA_BBOX.maxLongitude &&
    bbox.maxLatitude >= ETHIOPIA_BBOX.minLatitude &&
    bbox.minLatitude <= ETHIOPIA_BBOX.maxLatitude
  );
}
