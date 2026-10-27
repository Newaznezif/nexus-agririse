import { NextResponse } from 'next/server';

import { badRequest, errorResponse, fromConnector, intParam, isoDateParam, stringParam } from '@/lib/data/api';
import { getExchangeRates, getUsdRateSeries } from '@/lib/data/nbeExchange';
import { getBenchmarkIndicators, getUnofficialRateSeries, WB_BENCHMARKS } from '@/lib/data/worldBank';

/**
 * GET /api/data/exchange
 *
 * Ethiopian foreign-exchange and macro context, kept in three clearly separate
 * buckets because they are not the same kind of number:
 *
 *  - `official`   NBE daily indicative rate (a reference rate, published per date)
 *  - `unofficial` World Bank monthly national "Market Average" parallel rate
 *  - `benchmarks` World Bank annual indicators, explicitly not current data
 *
 * No bucket is ever presented as live, and each carries its own provenance, so the
 * UI cannot accidentally blend a monthly survey with a daily publication.
 */
export async function GET(request: Request): Promise<NextResponse> {
  const url = new URL(request.url);
  const date = isoDateParam(url, 'date');
  if (date === 'invalid') return badRequest('date must be YYYY-MM-DD');

  const focus = stringParam(url, 'focus') ?? 'all';

  if (focus === 'official') {
    return fromConnector(await getExchangeRates(date ?? undefined), 6 * 3600);
  }

  if (focus === 'official-series') {
    return fromConnector(await getUsdRateSeries({ wanted: intParam(url, 'points', 1, 12, 5) }), 6 * 3600);
  }

  if (focus === 'unofficial') {
    return fromConnector(await getUnofficialRateSeries(intParam(url, 'months', 2, 60, 12)), 24 * 3600);
  }

  if (focus === 'benchmarks') {
    const codes = stringParam(url, 'codes');
    const selected = codes ? codes.split(',').map((c) => c.trim().toUpperCase()).filter(Boolean) : WB_BENCHMARKS.map((b) => b.code);
    return fromConnector(await getBenchmarkIndicators(selected), 7 * 86400);
  }

  if (focus !== 'all') return errorResponse({ code: 'bad_input', message: 'Unknown focus' });

  // Combined view: three independent results, each with its own provenance.
  const [officialSeries, unofficial, benchmarks] = await Promise.all([
    getUsdRateSeries({ wanted: intParam(url, 'points', 1, 12, 5) }),
    getUnofficialRateSeries(intParam(url, 'months', 2, 60, 12)),
    getBenchmarkIndicators(),
  ]);

  return NextResponse.json(
    {
      ok: true,
      data: {
        categories: ['official', 'unofficial', 'benchmark'] as const,
        official: officialSeries.ok ? officialSeries.data : null,
        unofficial: unofficial.ok ? unofficial.data.series : null,
        benchmarks: benchmarks.ok ? benchmarks.data.indicators : null,
      },
      provenance: {
        official: officialSeries.ok ? officialSeries.provenance : null,
        unofficial: unofficial.ok ? unofficial.provenance : null,
        benchmark: benchmarks.ok ? benchmarks.provenance : null,
      },
      errors: {
        official: officialSeries.ok ? null : officialSeries.error,
        unofficial: unofficial.ok ? null : unofficial.error,
        benchmark: benchmarks.ok ? null : benchmarks.error,
      },
    },
    { status: 200, headers: { 'cache-control': 'public, s-maxage=900, stale-while-revalidate=2700' } },
  );
}
