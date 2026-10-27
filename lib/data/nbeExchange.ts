import { cachedFetch } from './cache';
import { httpJson } from './http';
import { provenanceFor, SOURCES } from './sources';
import type { ConnectorResult, ExchangeRateObservation, SourceError } from './types';

/**
 * National Bank of Ethiopia — Daily Indicative Exchange Rates.
 *
 * NBE's own wording matters here: the figure is "meant to be only a reference
 * exchange rate, but is not a mandatory transaction exchange rate", and it is a
 * weighted average of the previous day's bank FX transactions. That is the
 * methodology string the UI shows, not a paraphrase.
 */
const NBE_ENDPOINT = 'https://api.nbe.gov.et/api/filter-exchange-rates';

const METHODOLOGY =
  'Weighted average of FX transactions conducted by banks on the previous working day; published by NBE as a reference rate, not a mandatory transaction rate.';

interface NbeRow {
  buying?: string;
  selling?: string;
  weighted_average?: string;
  date?: string;
  currency?: { name?: string; code?: string };
}

interface NbeResponse {
  success?: boolean;
  message?: string;
  status?: number;
  data?: NbeRow[];
}

function toNumber(v: unknown): number | null {
  const n = typeof v === 'string' ? Number(v.replace(/,/g, '')) : Number(v);
  return Number.isFinite(n) ? n : null;
}

export function buildNbeUrl(date: string): string {
  return `${NBE_ENDPOINT}?date=${date}`;
}

/** Exported for tests: the publisher nests the currency under a `currency` object. */
export function parseNbeResponse(json: NbeResponse): { rows: ExchangeRateObservation[]; publishedOn: string | null } {
  const data = Array.isArray(json.data) ? json.data : [];
  const rows: ExchangeRateObservation[] = [];
  for (const r of data) {
    const code = (r.currency?.code ?? '').trim().toUpperCase();
    if (!code) continue;
    rows.push({
      observedOn: (r.date ?? '').trim() || new Date().toISOString().slice(0, 10),
      currencyCode: code,
      currencyName: (r.currency?.name ?? '').trim() || null,
      weightedAverage: toNumber(r.weighted_average),
      buying: toNumber(r.buying),
      selling: toNumber(r.selling),
    });
  }
  const publishedOn = rows.length ? rows.map((r) => r.observedOn).sort()[rows.length - 1] : null;
  return { rows, publishedOn };
}

function provenance(endpoint: string, observedAt: string | null, cacheHit: boolean, retrievedAt?: string) {
  return provenanceFor(SOURCES.nbeRates, {
    endpoint,
    observedAt,
    valueKind: 'observed',
    units: 'ETB per 1 unit of foreign currency',
    methodology: METHODOLOGY,
    coverage: 'Ethiopia, official bank FX window',
    servedFromCache: cacheHit,
    retrievedAt,
  });
}

function failure(error: SourceError, endpoint: string): ConnectorResult<ExchangeRateObservation[]> {
  return { ok: false, error, provenance: provenance(endpoint, null, false) };
}

/**
 * One business day of official rates. Weekends and holidays answer with the
 * nearest published date rather than nothing, which the caller must show as
 * `observedAt` rather than assuming "today".
 */
export async function getExchangeRates(date?: string): Promise<ConnectorResult<ExchangeRateObservation[]>> {
  const iso = date ?? new Date().toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return failure({ code: 'bad_input', message: 'Date must be YYYY-MM-DD' }, NBE_ENDPOINT);

  const url = buildNbeUrl(iso);
  const outcome = await cachedFetch<{ rows: ExchangeRateObservation[]; publishedOn: string | null }>(`nbe:${iso}`, 6 * 3600, async () => {
    const res = await httpJson(url, { timeoutMs: 20_000 });
    if (!res.ok) return { ok: false, error: res.error };
    const parsed = parseNbeResponse(res.json as NbeResponse);
    if (parsed.rows.length === 0) return { ok: false, error: { code: 'no_data', message: `NBE published no rates for ${iso}` } };
    return { ok: true, value: parsed };
  });

  const built = outcome.value;
  if (!built.ok) return failure(built.error, url);

  return {
    ok: true,
    data: built.value.rows,
    provenance: provenance(url, built.value.publishedOn, outcome.servedFromCache, new Date(outcome.storedAt).toISOString()),
  };
}

/** USD and the trade partners an Ethiopian farmer actually meets. */
export async function getUsdRate(): Promise<ConnectorResult<ExchangeRateObservation | null>> {
  const all = await getExchangeRates();
  if (!all.ok) return all;
  const usd = all.data.find((r) => r.currencyCode === 'USD') ?? null;
  return { ok: true, data: usd, provenance: all.provenance };
}

/**
 * Short official history. The publisher only answers per-date, so this walks
 * back at most `maxDays` calendar days and stops as soon as it has `wanted`
 * distinct publications — bounded fan-out, not a scrape.
 */
export async function getUsdRateSeries(o: { wanted?: number; maxDaysBack?: number } = {}): Promise<
  ConnectorResult<{ observedOn: string; usdToEtb: number | null }[]>
> {
  const wanted = Math.max(1, Math.min(12, o.wanted ?? 5));
  const maxDaysBack = Math.max(wanted, Math.min(30, o.maxDaysBack ?? 14));
  const today = new Date();
  const points: { observedOn: string; usdToEtb: number | null }[] = [];
  const seen = new Set<string>();

  for (let back = 0; back < maxDaysBack && points.length < wanted; back += 1) {
    const d = new Date(today.getTime() - back * 86_400_000).toISOString().slice(0, 10);
    const res = await getExchangeRates(d);
    if (!res.ok) continue;
    const usd = res.data.find((r) => r.currencyCode === 'USD');
    if (!usd || usd.weightedAverage === null || seen.has(usd.observedOn)) continue;
    seen.add(usd.observedOn);
    points.push({ observedOn: usd.observedOn, usdToEtb: usd.weightedAverage });
  }

  points.sort((a, b) => a.observedOn.localeCompare(b.observedOn));

  if (points.length === 0) {
    return { ok: false, error: { code: 'no_data', message: 'No official USD rates found in the lookback window' }, provenance: provenance(NBE_ENDPOINT, null, false) };
  }

  return {
    ok: true,
    data: points,
    provenance: provenance(NBE_ENDPOINT, points[points.length - 1].observedOn, false),
  };
}
