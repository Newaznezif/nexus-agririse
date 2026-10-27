import type { NextResponse } from 'next/server';

import { badRequest, fromConnector, intParam, stringParam } from '@/lib/data/api';
import { getCommodityHistory, getGrainOverview, getMarketSnapshot } from '@/lib/data/wfpMarketPrices';

/**
 * GET /api/data/markets
 *
 * WFP Ethiopia food prices (rEMS) — real surveyed Ethiopian market prices in ETB.
 * Nothing here is an international benchmark: the commodity, unit, market and
 * survey month always come from the publisher's rows.
 *
 *  - `mode=overview`  national retail average per grain for the newest survey month
 *  - `mode=snapshot`  latest month rows plus month-on-month movement (default)
 *  - `mode=history`   monthly series for one commodity, optionally one market
 */
export async function GET(request: Request): Promise<NextResponse> {
  const url = new URL(request.url);
  const mode = stringParam(url, 'mode') ?? 'snapshot';
  const commodity = stringParam(url, 'commodity');
  const market = stringParam(url, 'market');
  const region = stringParam(url, 'region');
  const months = intParam(url, 'months', 2, 24, 6);
  const limit = intParam(url, 'limit', 10, 500, 120);

  if (mode === 'overview') return fromConnector(await getGrainOverview(), 6 * 3600);

  if (mode === 'history') {
    if (!commodity) return badRequest('mode=history requires a commodity, e.g. commodity=Teff');
    return fromConnector(await getCommodityHistory({ commodity, market, months: Math.max(2, Math.min(120, intParam(url, 'months', 2, 120, 36))) }), 6 * 3600);
  }

  const retailRaw = stringParam(url, 'priceType');
  if (retailRaw && retailRaw !== 'Retail' && retailRaw !== 'Wholesale') {
    return badRequest('priceType must be Retail or Wholesale');
  }

  return fromConnector(
    await getMarketSnapshot({
      commodity,
      market,
      region,
      months,
      limit,
      retail: retailRaw === 'Retail' ? 'Retail' : retailRaw === 'Wholesale' ? 'Wholesale' : undefined,
      grainsOnly: stringParam(url, 'grainsOnly') === '1',
    }),
    6 * 3600,
  );
}
