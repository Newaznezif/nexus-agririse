import Papa from 'papaparse';

import { cachedFetch } from './cache';
import { httpText } from './http';
import { provenanceFor, SOURCES } from './sources';
import type { ConnectorResult, MarketPriceObservation, MarketSnapshot, PriceChange, SourceError } from './types';

/**
 * WFP's rEMS export for Ethiopia, served through the Humanitarian Data Exchange.
 * It is a monthly retail/wholesale survey of real Ethiopian markets (observed
 * values in ETB with the publisher's own USD conversion) and the only source in
 * this app that carries actual Ethiopian farm-gate style prices.
 *
 * The HDX link 302s to a presigned S3 URL whose query string carries an AWS
 * signature. We therefore keep the HDX URL as the identity of the endpoint and
 * never store or log the redirected address.
 */
const HDX_PRICES_URL =
  'https://data.humdata.org/dataset/2e4f1922-e446-4b57-a98a-d0e2d5e34afa/resource/87bac18e-f3aa-4b29-8cf8-76763e823dc5/download/wfp_food_prices_eth.csv';

/**
 * Whole-file download, once per 12 hours per process (see `getRowStore`).
 *
 * The file is 7.6 MB and measured 71 s from this machine on an ordinary link, so the 45 s used
 * elsewhere would fail every cold-cache request for the source that carries the market prices —
 * from a slow connection, which is exactly where an Ethiopian agro dealer is. It gets its own
 * budget instead of slowing every other connector down.
 *
 * No retry: two attempts on a stalled 7.6 MB download is four minutes of a spinner on a card.
 * The next page open retries naturally, and single-flight means the requests already in the
 * browser share the one attempt that is running.
 */
const FETCH_OPTIONS = { timeoutMs: 120_000, retries: 0, maxBytes: 24 * 1024 * 1024 };

interface RawRow {
  date?: string;
  admin1?: string;
  admin2?: string;
  market?: string;
  market_id?: string;
  latitude?: string;
  longitude?: string;
  category?: string;
  commodity?: string;
  unit?: string;
  priceflag?: string;
  pricetype?: string;
  currency?: string;
  price?: string;
  usdprice?: string;
}

function toNumber(v: string | undefined): number | null {
  if (typeof v !== 'string') return null;
  const n = Number(v.trim());
  return Number.isFinite(n) ? n : null;
}

function normalisePriceType(v: string | undefined): MarketPriceObservation['retail'] {
  const s = (v ?? '').toLowerCase();
  if (s.startsWith('retail')) return 'Retail';
  if (s.startsWith('whole')) return 'Wholesale';
  if (s.startsWith('aggregate')) return 'aggregate';
  return 'unknown';
}

function normaliseFlag(v: string | undefined): MarketPriceObservation['priceFlag'] {
  const s = (v ?? '').toLowerCase().replace(/"/g, '');
  if (s.startsWith('actual')) return 'actual';
  if (s.startsWith('aggregate')) return 'aggregate';
  if (s.startsWith('replaced')) return 'replaced';
  return 'unknown';
}

/** Exported for tests: parsing is pure, so a fixture proves it. */
export function parsePriceCsv(text: string): MarketPriceObservation[] {
  const parsed = Papa.parse<RawRow>(text.trim(), { header: true, skipEmptyLines: true });
  const out: MarketPriceObservation[] = [];
  for (const r of parsed.data) {
    const date = (r.date ?? '').trim();
    const market = (r.market ?? '').trim();
    const commodity = (r.commodity ?? '').trim();
    const price = toNumber(r.price);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !market || !commodity || price === null) continue;
    out.push({
      observedOn: date,
      market,
      marketId: (r.market_id ?? '').trim() || null,
      admin1: (r.admin1 ?? '').trim() || null,
      admin2: (r.admin2 ?? '').trim() || null,
      latitude: toNumber(r.latitude),
      longitude: toNumber(r.longitude),
      commodity,
      category: (r.category ?? '').trim() || null,
      unit: (r.unit ?? '').trim() || 'unknown',
      currency: (r.currency ?? '').trim() || 'ETB',
      price,
      usdPrice: toNumber(r.usdprice),
      retail: normalisePriceType(r.pricetype),
      priceFlag: normaliseFlag(r.priceflag),
    });
  }
  return out;
}

type Loaded = { ok: true; rows: MarketPriceObservation[] } | { ok: false; error: SourceError };

async function loadAllRows(): Promise<Loaded> {
  const res = await httpText(HDX_PRICES_URL, FETCH_OPTIONS);
  if (!res.ok) return { ok: false, error: res.error };
  const rows = parsePriceCsv(res.text);
  if (rows.length === 0) return { ok: false, error: { code: 'parse_failed', message: 'Price file parsed to zero usable rows' } };
  return { ok: true, rows };
}

interface RowStore {
  rows: MarketPriceObservation[];
  latestDate: string;
  servedFromCache: boolean;
  retrievedAt: string;
}

/** Whole-file snapshot, shared by every market query and cached per process. */
async function getRowStore(): Promise<RowStore | { error: SourceError }> {
  const outcome = await cachedFetch<{ rows: MarketPriceObservation[]; latestDate: string }>('wfp:prices:all', 12 * 3600, async () => {
    const loaded = await loadAllRows();
    if (!loaded.ok) return { ok: false, error: loaded.error };
    const latestDate = loaded.rows.reduce((max, r) => (r.observedOn > max ? r.observedOn : max), '');
    return { ok: true, value: { rows: loaded.rows, latestDate } };
  });

  const value = outcome.value;
  if (!value.ok) return { error: value.error };
  return {
    rows: value.value.rows,
    latestDate: value.value.latestDate,
    servedFromCache: outcome.servedFromCache,
    retrievedAt: new Date(outcome.storedAt).toISOString(),
  };
}

function marketProvenance(o: { observedAt: string | null; servedFromCache: boolean; coverage: string; retrievedAt?: string }) {
  return provenanceFor(SOURCES.wfpPrices, {
    endpoint: HDX_PRICES_URL,
    observedAt: o.observedAt,
    // A survey observation, not a model output or a forecast.
    valueKind: 'observed',
    units: 'ETB per published unit (100 KG / KG / Head / L / Unit); usdPrice is WFP’s own conversion',
    methodology:
      'WFP market-monitoring survey of Ethiopian retail and wholesale outlets, published monthly on the ~15th. Prices are observations in the market’s currency; only rows with the same market, unit and price type are compared.',
    coverage: o.coverage,
    retrievedAt: o.retrievedAt,
  });
}

const GRAIN_TERMS = ['teff', 'maize', 'wheat', 'sorghum', 'barley', 'millet'] as const;

export function isGrainCommodity(name: string): boolean {
  const lower = name.toLowerCase();
  return GRAIN_TERMS.some((t) => lower.includes(t));
}

export interface MarketQuery {
  region?: string | null;
  market?: string | null;
  commodity?: string | null;
  /** Match grain and cereal commodities only. */
  grainsOnly?: boolean;
  retail?: 'Retail' | 'Wholesale';
  /** Number of most recent observation months to include. */
  months?: number;
  limit?: number;
}

/**
 * Latest-month rows plus the month-on-month movement per market/commodity.
 * Every comparison keeps unit and price type fixed, so a 100 KG wholesale quote
 * is never divided against a KG retail quote.
 */
export async function getMarketSnapshot(q: MarketQuery = {}): Promise<ConnectorResult<MarketSnapshot>> {
  const store = await getRowStore();
  if ('error' in store) {
    return { ok: false, error: store.error, provenance: marketProvenance({ observedAt: null, servedFromCache: false, coverage: 'Ethiopia' }) };
  }

  const monthsBack = Math.max(1, Math.min(24, q.months ?? 6));
  const allDates = [...new Set(store.rows.map((r) => r.observedOn))].sort();
  const window = allDates.slice(-monthsBack);
  const latest = window[window.length - 1];

  const filtered = store.rows.filter((r) => {
    if (!window.includes(r.observedOn)) return false;
    if (q.region && (r.admin1 ?? '').toLowerCase() !== q.region.toLowerCase()) return false;
    if (q.market && !r.market.toLowerCase().includes(q.market.toLowerCase())) return false;
    if (q.commodity && !r.commodity.toLowerCase().includes(q.commodity.toLowerCase())) return false;
    if (q.grainsOnly && !isGrainCommodity(r.commodity)) return false;
    if (q.retail && r.retail !== q.retail) return false;
    return true;
  });

  const latestRows = filtered.filter((r) => r.observedOn === latest);
  const limit = Math.max(1, Math.min(500, q.limit ?? 120));

  return {
    ok: true,
    data: {
      asOfLatestObservation: latest,
      markets: new Set(latestRows.map((r) => r.market)).size,
      commodities: new Set(latestRows.map((r) => r.commodity)).size,
      rows: latestRows.slice(0, limit),
      changes: computeChanges(filtered),
    },
    provenance: marketProvenance({
      observedAt: latest,
      servedFromCache: store.servedFromCache,
      coverage: q.region ? `${q.region}, Ethiopia` : `Ethiopia (national survey, ${new Set(latestRows.map((r) => r.admin1)).size} regions at latest month)`,
      retrievedAt: store.retrievedAt,
    }),
  };
}

/**
 * Month-on-month change for each (market, commodity, unit, price type) series.
 * Returns only pairs where both months exist, so `changePct` is never inferred
 * from an unrelated market or a different unit.
 */
export function computeChanges(rows: MarketPriceObservation[]): PriceChange[] {
  const bySeries = new Map<string, MarketPriceObservation[]>();
  for (const r of rows) {
    const key = `${r.market}|${r.commodity}|${r.unit}|${r.retail}`;
    const bucket = bySeries.get(key);
    if (bucket) bucket.push(r);
    else bySeries.set(key, [r]);
  }

  const changes: PriceChange[] = [];
  for (const seriesList of bySeries.values()) {
    if (seriesList.length < 1) continue;
    const sorted = [...seriesList].sort((a, b) => a.observedOn.localeCompare(b.observedOn));
    const latest = sorted[sorted.length - 1];
    if (latest.price === null) continue;
    const previous = sorted.length > 1 ? sorted[sorted.length - 2] : null;
    const previousPrice = previous?.price ?? null;

    changes.push({
      commodity: latest.commodity,
      market: latest.market,
      unit: latest.unit,
      currency: latest.currency,
      latestObservedOn: latest.observedOn,
      latestPrice: latest.price,
      previousObservedOn: previous?.observedOn ?? null,
      previousPrice,
      changePct:
        previousPrice !== null && previousPrice > 0
          ? Math.round(((latest.price - previousPrice) / previousPrice) * 1000) / 10
          : null,
      observations: sorted.length,
    });
  }

  return changes.sort((a, b) => Math.abs(b.changePct ?? 0) - Math.abs(a.changePct ?? 0));
}

/**
 * The whole publisher window as rows, for persistence.
 *
 * Deliberately NOT `getMarketSnapshot`: that returns a page of the newest month, which is
 * right for a table and wrong for a store — a sync that saved 500 of ~15,000 observations
 * would look like a price history and would not be one. Unit, currency, market and survey
 * date are preserved per row so nothing has to be inferred later.
 */
export async function getObservationWindow(months = 24): Promise<ConnectorResult<MarketPriceObservation[]>> {
  const store = await getRowStore();
  if ('error' in store) {
    return { ok: false, error: store.error, provenance: marketProvenance({ observedAt: null, servedFromCache: false, coverage: 'Ethiopia' }) };
  }

  const wanted = Math.max(1, Math.min(60, months));
  const dates = [...new Set(store.rows.map((r) => r.observedOn))].sort();
  const window = new Set(dates.slice(-wanted));
  const rows = store.rows.filter((r) => window.has(r.observedOn));

  return {
    ok: true,
    data: rows,
    provenance: marketProvenance({
      observedAt: store.latestDate,
      servedFromCache: store.servedFromCache,
      coverage: `Ethiopia, ${window.size} survey months, ${new Set(rows.map((r) => r.market)).size} markets, ${new Set(rows.map((r) => r.commodity)).size} commodities`,
      retrievedAt: store.retrievedAt,
    }),
  };
}

/** National average per grain for the latest month, with the market count. */
export async function getGrainOverview(): Promise<
  ConnectorResult<{ asOf: string; commodities: { commodity: string; avgEtbPerUnit: number; unit: string; markets: number }[] }>
> {
  const store = await getRowStore();
  if ('error' in store) {
    return { ok: false, error: store.error, provenance: marketProvenance({ observedAt: null, servedFromCache: false, coverage: 'Ethiopia' }) };
  }

  const latest = store.latestDate;
  const rows = store.rows.filter((r) => r.observedOn === latest && isGrainCommodity(r.commodity) && r.retail === 'Retail');

  // Average within a unit only: "Teff 100 KG" and "Teff (white) KG" are different goods.
  const buckets = new Map<string, { sum: number; n: number; markets: Set<string> }>();
  for (const r of rows) {
    if (r.price === null) continue;
    const key = `${r.commodity}@@${r.unit}`;
    const b = buckets.get(key) ?? { sum: 0, n: 0, markets: new Set<string>() };
    b.sum += r.price;
    b.n += 1;
    b.markets.add(r.market);
    buckets.set(key, b);
  }

  const commodities = [...buckets.entries()]
    .map(([key, b]) => {
      const [commodity, unit] = key.split('@@');
      return { commodity, unit, avgEtbPerUnit: Math.round((b.sum / b.n) * 100) / 100, markets: b.markets.size };
    })
    .filter((c) => c.markets >= 2)
    .sort((a, b) => b.avgEtbPerUnit - a.avgEtbPerUnit);

  return {
    ok: true,
    data: { asOf: latest, commodities },
    provenance: marketProvenance({
      observedAt: latest,
      servedFromCache: store.servedFromCache,
      coverage: `Ethiopian retail survey, grain and cereal commodities at ${commodities.length} commodity/unit groups`,
      retrievedAt: store.retrievedAt,
    }),
  };
}

/** Monthly series for one commodity in one market — the chart data. */
export async function getCommodityHistory(q: {
  commodity: string;
  market?: string | null;
  months?: number;
}): Promise<ConnectorResult<{ series: MarketPriceObservation[] }>> {
  const store = await getRowStore();
  if ('error' in store) {
    return { ok: false, error: store.error, provenance: marketProvenance({ observedAt: null, servedFromCache: false, coverage: 'Ethiopia' }) };
  }

  const wantMonths = Math.max(2, Math.min(120, q.months ?? 36));
  const term = q.commodity.toLowerCase();
  const rows = store.rows
    .filter((r) => r.commodity.toLowerCase().includes(term) && (!q.market || r.market.toLowerCase() === q.market.toLowerCase()))
    .sort((a, b) => a.observedOn.localeCompare(b.observedOn))
    .slice(-wantMonths * 40);

  if (rows.length === 0) {
    return {
      ok: false,
      error: { code: 'no_data', message: `No WFP observations for “${q.commodity}” in this dataset` },
      provenance: marketProvenance({ observedAt: store.latestDate, servedFromCache: false, coverage: 'Ethiopia' }),
    };
  }

  const latest = rows[rows.length - 1].observedOn;
  return {
    ok: true,
    data: { series: rows },
    provenance: marketProvenance({
      observedAt: latest,
      servedFromCache: store.servedFromCache,
      coverage: `${q.commodity}${q.market ? ` at ${q.market}` : ' across Ethiopian markets'}`,
      retrievedAt: store.retrievedAt,
    }),
  };
}
