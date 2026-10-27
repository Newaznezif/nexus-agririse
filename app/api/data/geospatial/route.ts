import type { NextResponse } from 'next/server';

import { badRequest, errorResponse, fromConnector, intParam, isoDateParam, numberParam, stringParam, withExtras } from '@/lib/data/api';
import { getAdminBoundaries } from '@/lib/data/boundaries';
import { findLatestLayerDate, GIBS_LAYERS, sampleLayerAtCoordinate } from '@/lib/data/gibs';
import { isWithinEthiopia, resolveLocation } from '@/lib/data/locations';
import { provenanceFor, SOURCES } from '@/lib/data/sources';

/**
 * GET /api/data/geospatial
 *
 *  - `view=layers`     the published composites, each with the newest date GIBS
 *                      actually answers for, plus its meaning and its caveat
 *  - `view=boundaries` geoBoundaries ETH outlines (ADM0 or ADM1), simplified here
 *  - `view=sample`     one physical value read out of a tile for one coordinate
 *
 * The map is not decorative: a layer entry carries the date of the scene, and a
 * sample carries the pixel footprint and the colour-map band it came from.
 */
export async function GET(request: Request): Promise<NextResponse> {
  const url = new URL(request.url);
  const view = stringParam(url, 'view') ?? 'layers';

  if (view === 'boundaries') {
    const level = intParam(url, 'level', 0, 1, 1) as 0 | 1;
    return fromConnector(await getAdminBoundaries(level), 7 * 86400);
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
