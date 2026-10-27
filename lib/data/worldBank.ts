import Papa from 'papaparse';

import { cachedFetch } from './cache';
import { httpJson, httpText } from './http';
import { provenanceFor, SOURCES } from './sources';
import type { ConnectorResult, EconomicIndicator, SourceError } from './types';

/**
 * Two distinct things live here, and the app must never blur them:
 *
 *  1. The World Bank's Ethiopia real-time price feed, which carries a monthly
 *     *unofficial* (parallel-market) ETB/USD observation alongside official
 *     publications. That is an Ethiopian observation.
 *  2. World Bank open-data indicators, which are international benchmarks on an
 *     annual cadence. They are not real-time and are not local prices.
 */

const WB_CURRENCY_CSV =
  'https://data.humdata.org/dataset/7752a1d8-7d7a-4feb-a857-11026dad7188/resource/7a810731-78d5-4342-b5aa-7ed4e5f8eab9/download/real-time-currency-prices-for-ethiopia.csv';

const WB_API = 'https://api.worldbank.org/v2/country/ETH/indicator';

/** Annual indicators we display as benchmarks, with the publisher's own units. */
export const WB_BENCHMARKS: { code: string; name: string; unit: string; frequency: EconomicIndicator['frequency'] }[] = [
  { code: 'PA.NUS.FCRF', name: 'Official exchange rate (PA, national currency per US$)', unit: 'ETB per US$', frequency: 'annual' },
  { code: 'FP.CPI.TOTL.ZG', name: 'Inflation, consumer prices (annual %)', unit: '% per year', frequency: 'annual' },
  { code: 'NV.AGR.TOTL.ZG', name: 'Agriculture, value added (annual % growth)', unit: '% growth per year', frequency: 'annual' },
];

interface RawCurrencyRow {
  DATES?: string;
  mkt_name?: string;
  exchange_rate_unofficial?: string;
  currency?: string;
  year?: string;
  month?: string;
}

function toNumber(v: string | undefined): number | null {
  if (typeof v !== 'string' || v.trim() === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Exported for tests. Keeps only the national "Market Average" line. */
export function parseWbCurrencyCsv(text: string): { observedOn: string; unofficialUsdToEtb: number }[] {
  const parsed = Papa.parse<RawCurrencyRow>(text.trim(), { header: true, skipEmptyLines: true });
  const out: { observedOn: string; unofficialUsdToEtb: number }[] = [];
  for (const r of parsed.data) {
    if ((r.mkt_name ?? '').trim() !== 'Market Average') continue;
    const date = (r.DATES ?? '').trim();
    const value = toNumber(r.exchange_rate_unofficial);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || value === null || value <= 0) continue;
    out.push({ observedOn: date, unofficialUsdToEtb: value });
  }
  return out.sort((a, b) => a.observedOn.localeCompare(b.observedOn));
}

type WbApiResponse = [{ total?: number; date?: string } | null, RawIndicatorRow[] | null];
interface RawIndicatorRow {
  date?: string;
  value?: number | string | null;
  country?: string;
}

/** Exported for tests: the API returns a two-element tuple, and nulls out gaps. */
export function parseWbIndicator(json: unknown, meta: (typeof WB_BENCHMARKS)[number]): EconomicIndicator | null {
  if (!Array.isArray(json) || json.length < 2) return null;
  const rows = json[1];
  if (!Array.isArray(rows)) return null;
  const observations = rows
    .map((r) => ({ period: String(r.date ?? '').trim(), value: typeof r.value === 'number' ? r.value : null }))
    .filter((o) => /^\d{4}$/.test(o.period))
    .sort((a, b) => a.period.localeCompare(b.period));
  if (observations.length === 0) return null;
  return { code: meta.code, name: meta.name, frequency: meta.frequency, unit: meta.unit, observations };
}

function failure(error: SourceError, endpoint: string, units: string, methodology: string, kind: 'observed' | 'estimated'): ConnectorResult<never> {
  return {
    ok: false,
    error,
    provenance: provenanceFor(SOURCES.worldBankPrices, {
      endpoint,
      observedAt: null,
      valueKind: kind,
      units,
      methodology,
      coverage: 'Ethiopia',
      quality: 'low',
    }),
  };
}

/**
 * Monthly parallel-market ETB/USD. Shown next to the NBE official rate, never
 * merged with it: the two measure different things.
 */
export async function getUnofficialRateSeries(months = 12): Promise<
  ConnectorResult<{ series: { observedOn: string; unofficialUsdToEtb: number }[] }>
> {
  const wanted = Math.max(2, Math.min(60, months));
  const outcome = await cachedFetch<{ series: { observedOn: string; unofficialUsdToEtb: number }[] }>('wb:currency', 24 * 3600, async () => {
    // 5.7 MB, and at the throughput this file has been measured at that is ~55 s — over the
    // 45 s used for the small JSON endpoints. Cached 24 h, so it is paid once, and not retried
    // for the same reason as the WFP survey file: a stalled bulk download should fail fast and
    // honestly rather than double the wait on a card.
    const res = await httpText(WB_CURRENCY_CSV, { timeoutMs: 120_000, retries: 0, maxBytes: 24 * 1024 * 1024 });
    if (!res.ok) return { ok: false, error: res.error };
    const series = parseWbCurrencyCsv(res.text);
    if (series.length === 0) return { ok: false, error: { code: 'parse_failed', message: 'No national average exchange observations found' } };
    return { ok: true, value: { series } };
  });

  const built = outcome.value;
  if (!built.ok) {
    return failure(built.error, WB_CURRENCY_CSV, 'ETB per US$', 'World Bank real-time price feed, national market average line.', 'observed');
  }

  const recent = built.value.series.slice(-wanted);
  return {
    ok: true,
    data: { series: recent },
    provenance: provenanceFor(SOURCES.worldBankPrices, {
      endpoint: WB_CURRENCY_CSV,
      observedAt: recent[recent.length - 1]?.observedOn ?? null,
      valueKind: 'observed',
      units: 'ETB per US$ (unofficial / parallel market)',
      methodology:
        'World Bank real-time price monitoring, monthly national "Market Average" line. This is the unofficial market rate and is deliberately kept apart from NBE’s official indicative rate.',
      coverage: `Ethiopia, national average, last ${recent.length} months`,
      quality: 'medium',
      retrievedAt: new Date(outcome.storedAt).toISOString(),
      servedFromCache: outcome.servedFromCache,
    }),
  };
}

/** Annual international benchmarks — explicitly not live data. */
export async function getBenchmarkIndicators(codes: string[] = WB_BENCHMARKS.map((b) => b.code)): Promise<
  ConnectorResult<{ indicators: EconomicIndicator[] }>
> {
  const selected = WB_BENCHMARKS.filter((b) => codes.includes(b.code));
  if (selected.length === 0) return failure({ code: 'bad_input', message: 'Unknown indicator code' }, WB_API, 'various', 'World Bank open data', 'estimated');

  const results = await Promise.all(
    selected.map(async (meta) => {
      const url = `${WB_API}/${meta.code}?format=json&per_page=40&mrnev=3`;
      const outcome = await cachedFetch<EconomicIndicator>(`wb:ind:${meta.code}`, 7 * 86400, async () => {
        const res = await httpJson(url, { timeoutMs: 25_000 });
        if (!res.ok) return { ok: false, error: res.error };
        const indicator = parseWbIndicator(res.json, meta);
        if (!indicator) return { ok: false, error: { code: 'no_data', message: `No rows for ${meta.code}` } };
        return { ok: true, value: indicator };
      });
      return { meta, outcome };
    }),
  );

  const indicators: EconomicIndicator[] = [];
  let firstError: SourceError | null = null;
  for (const r of results) {
    const built = r.outcome.value;
    if (!built.ok) {
      firstError ??= built.error;
      continue;
    }
    indicators.push(built.value);
  }

  if (indicators.length === 0) {
    return failure(firstError ?? { code: 'no_data', message: 'No benchmark indicators returned' }, WB_API, 'various', 'World Bank open data indicators', 'estimated');
  }

  const latestPeriod = indicators
    .flatMap((i) => i.observations.map((o) => o.period))
    .filter((p) => /^\d{4}$/.test(p))
    .sort()
    .at(-1);

  return {
    ok: true,
    data: { indicators },
    provenance: provenanceFor(SOURCES.worldBankIndicators, {
      endpoint: `${WB_API}/…`,
      // An annual series: the "observation" is the reference year, not a date.
      observedAt: latestPeriod ? `${latestPeriod}-12-31` : null,
      valueKind: 'estimated',
      units: indicators.map((i) => `${i.code}: ${i.unit}`).join(' · '),
      methodology:
        'World Bank national accounts / WDI compilations. Published annually with a lag of roughly one year, so these are context benchmarks and must not be read as current-month figures.',
      coverage: 'Ethiopia (annual series)',
      quality: 'medium',
    }),
  };
}
