import type { NextResponse } from 'next/server';

import { fromConnector, withExtras } from '@/lib/data/api';
import { getAdminBoundaries } from '@/lib/data/boundaries';
import { DEFAULT_ETHIOPIAN_LOCATION, ETHIOPIAN_MARKET_LOCATIONS } from '@/lib/data/ethiopianMarkets';
import { listSelectablePlaces } from '@/lib/data/locations';
import { provenanceFor, SOURCES } from '@/lib/data/sources';

/**
 * GET /api/data/locations
 *
 * The places a farmer can select. Town names, region/zone labels and coordinates
 * are WFP's own, so a selected point is a real market centre rather than a pin we
 * guessed. `regions=1` adds the geoBoundaries ADM1 outlines used by the map.
 */
export async function GET(request: Request): Promise<NextResponse> {
  const url = new URL(request.url);
  const wantRegions = url.searchParams.get('regions') === '1';

  const payload = {
    places: listSelectablePlaces(),
    marketCatalogue: ETHIOPIAN_MARKET_LOCATIONS,
    default: DEFAULT_ETHIOPIAN_LOCATION,
    regionNames: [...new Set(ETHIOPIAN_MARKET_LOCATIONS.map((m) => m.admin1))].sort(),
  };

  if (!wantRegions) {
    return withExtras(
      {
        ok: true,
        data: payload,
        provenance: provenanceFor(SOURCES.wfpPrices, {
          endpoint: 'https://data.humdata.org/dataset/wfp-food-prices-for-ethiopia',
          observedAt: null,
          valueKind: 'observed',
          units: 'degrees (WGS84)',
          methodology:
            'Market centres and their region/zone labels as published in WFP’s Ethiopia market reference table. The publisher still groups the newer regions under the pre-2020 SNNPR label, and zone names are the source’s own strings.',
          coverage: `Ethiopia, ${payload.places.length} market centres`,
          quality: 'high',
        }),
      },
      {},
      7 * 86400,
    );
  }

  const boundaries = await getAdminBoundaries(1);
  if (!boundaries.ok) return fromConnector(boundaries, 7 * 86400);

  return withExtras(
    {
      ok: true,
      data: { ...payload, regions: boundaries.data },
      provenance: provenanceFor(SOURCES.geoBoundaries, {
        endpoint: 'https://www.geoboundaries.org/single-state.html?iso3=ETH&level=1',
        observedAt: null,
        valueKind: 'estimated',
        units: 'degrees (WGS84)',
        methodology: 'Market catalogue from WFP; administrative outlines from geoBoundaries, simplified server-side.',
        coverage: `Ethiopia, ${payload.places.length} market centres and ${boundaries.data.length} ADM1 areas`,
        quality: 'high',
      }),
    },
    {},
    7 * 86400,
  );
}
