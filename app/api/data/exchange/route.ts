import { NextResponse } from 'next/server';

import { badRequest, errorResponse, fromConnector, intParam, isoDateParam, stringParam } from '@/lib/data/api';
import { getExchangeRates, getUsdRateSeries, nbeUnavailable } from '@/lib/data/nbeExchange';
import { getBenchmarkIndicators, getUnofficialRateSeries, WB_BENCHMARKS, wbIndicatorsUnavailable, wbParallelRateUnavailable } from '@/lib/data/worldBank';

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
    const result = await getExchangeRates(date ?? undefined);
    return fromConnector(result, 6 * 3600, nbeUnavailable(result));
  }

  if (focus === 'official-series') {
    const result = await getUsdRateSeries({ wanted: intParam(url, 'points', 1, 12, 5) });
    return fromConnector(result, 6 * 3600, nbeUnavailable(result));
  }

  if (focus === 'unofficial') {
    const result = await getUnofficialRateSeries(intParam(url, 'months', 2, 60, 12));
    return fromConnector(result, 24 * 3600, wbParallelRateUnavailable(result));
  }

  if (focus === 'benchmarks') {
    const codes = stringParam(url, 'codes');
    const selected = codes ? codes.split(',').map((c) => c.trim().toUpperCase()).filter(Boolean) : WB_BENCHMARKS.map((b) => b.code);
    const result = await getBenchmarkIndicators(selected);
    return fromConnector(result, 7 * 86400, wbIndicatorsUnavailable(result));
  }

  if (focus !== 'all') return errorResponse({ code: 'bad_input', message: 'Unknown focus' });

  // Combined view: three independent results, each with its own provenance.
  const [officialSeries, unofficial, benchmarks] = await Promise.all([
    getUsdRateSeries({ wanted: intParam(url, 'points', 1, 12, 5) }),
    getUnofficialRateSeries(intParam(url, 'months', 2, 60, 12)),
    getBenchmarkIndicators(),
  ]);

  // One category failing never turns the others off: this body keeps answering ok:true with the
  // rows it did get, and says per category which publisher is missing, why, and when this process
  // last read it. `unavailable` mirrors `errors` key for key so the panel cannot show one without
  // the other.
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
      unavailable: {
        official: nbeUnavailable(officialSeries),
        unofficial: wbParallelRateUnavailable(unofficial),
        benchmark: wbIndicatorsUnavailable(benchmarks),
      },
    },
    { status: 200, headers: { 'cache-control': 'public, s-maxage=900, stale-while-revalidate=2700' } },
  );
}
