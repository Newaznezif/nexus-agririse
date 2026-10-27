import { NextResponse } from 'next/server';

import { booleanParam, stringParam } from '@/lib/data/api';
import { getAdminBoundaries } from '@/lib/data/boundaries';
import { findLatestLayerDate, GIBS_LAYERS } from '@/lib/data/gibs';
import { DEFAULT_ETHIOPIAN_LOCATION } from '@/lib/data/ethiopianMarkets';
import { getAgroclimateDaily } from '@/lib/data/nasaPower';
import { getUsdRate } from '@/lib/data/nbeExchange';
import { getWeatherForecast, getWeatherHistory } from '@/lib/data/openMeteo';
import { SOURCES, toStatusEntry, type SourceStatusEntry } from '@/lib/data/sources';
import { getSyncFreshness } from '@/lib/data/sync';
import { getMarketSnapshot } from '@/lib/data/wfpMarketPrices';
import { getBenchmarkIndicators, getUnofficialRateSeries } from '@/lib/data/worldBank';
import type { ConnectorResult, SourceDescriptor } from '@/lib/data/types';

/**
 * GET /api/data/status
 *
 * The honest answer to "is this number coming from anywhere?". Each entry is a
 * real probe of one publisher, reduced to connected / stale / unavailable /
 * auth-required, with the observation and retrieval dates the UI shows next to
 * the figure. Nothing here is simulated: a source we cannot reach is reported as
 * unreachable, with the reason our HTTP layer actually got.
 *
 * Probing every source in one request is slow, so the default set is the four
 * light ones; `sources=all` runs the rest, which include the large CSV feeds.
 */

const LIGHT = ['open-meteo-forecast', 'nasa-power', 'nbe-indicative-rates', 'nasa-gibs'] as const;

/**
 * The probes that pull a bulk file rather than one small record: the WFP survey CSV, the
 * World Bank series, the historical archive and the boundary geometries.
 *
 * They run in a second wave. Fired together with the light probes on a cold cache they compete
 * for the same connection and the slowest ones exceed their 45-second budget, and the honest
 * answer "unavailable: request timed out" would then be a lie in the other direction — the
 * publisher is up, our own probe schedule starved it. Sequencing costs the status panel a few
 * seconds and buys a state that actually describes the publisher.
 */
const BULK = new Set(['wfp-ethiopia-prices', 'open-meteo-historical', 'worldbank-realtime-prices', 'worldbank-indicators', 'geo-boundaries']);

const location = {
  name: DEFAULT_ETHIOPIAN_LOCATION.name,
  admin1: DEFAULT_ETHIOPIAN_LOCATION.admin1,
  admin2: DEFAULT_ETHIOPIAN_LOCATION.admin2,
  latitude: DEFAULT_ETHIOPIAN_LOCATION.latitude,
  longitude: DEFAULT_ETHIOPIAN_LOCATION.longitude,
  coordinateSource: 'default' as const,
};

function compactDate(daysAgo: number): Date {
  return new Date(Date.now() - daysAgo * 86_400_000);
}

const iso = (d: Date) => d.toISOString().slice(0, 10);
const compact = (d: Date) => iso(d).replace(/-/g, '');

type Probe = { source: SourceDescriptor; run: () => Promise<ConnectorResult<unknown>> };

const PROBES: Record<string, Probe> = {
  [SOURCES.openMeteoForecast.id]: {
    source: SOURCES.openMeteoForecast,
    run: () => getWeatherForecast({ location, forecastDays: 1, pastDays: 1, includeHourly: false }),
  },
  [SOURCES.openMeteoHistorical.id]: {
    source: SOURCES.openMeteoHistorical,
    run: () => getWeatherHistory({ location, start: iso(compactDate(6)), end: iso(compactDate(2)) }),
  },
  [SOURCES.nasaPower.id]: {
    source: SOURCES.nasaPower,
    run: () => getAgroclimateDaily({ location, start: compact(compactDate(10)), end: compact(compactDate(1)) }),
  },
  [SOURCES.wfpPrices.id]: {
    source: SOURCES.wfpPrices,
    run: () => getMarketSnapshot({ months: 2, limit: 20 }),
  },
  [SOURCES.nbeRates.id]: {
    source: SOURCES.nbeRates,
    run: () => getUsdRate(),
  },
  [SOURCES.worldBankPrices.id]: {
    source: SOURCES.worldBankPrices,
    run: () => getUnofficialRateSeries(3),
  },
  [SOURCES.worldBankIndicators.id]: {
    source: SOURCES.worldBankIndicators,
    run: () => getBenchmarkIndicators(['FP.CPI.TOTL.ZG']),
  },
  [SOURCES.nasaGibs.id]: {
    source: SOURCES.nasaGibs,
    run: () => findLatestLayerDate(GIBS_LAYERS[0]),
  },
  [SOURCES.geoBoundaries.id]: {
    source: SOURCES.geoBoundaries,
    run: () => getAdminBoundaries(1),
  },
};

export async function GET(request: Request): Promise<NextResponse> {
  const url = new URL(request.url);
  const wanted = stringParam(url, 'sources');

  const ids =
    wanted === null || wanted === 'light'
      ? [...LIGHT]
      : wanted === 'all'
        ? Object.keys(PROBES)
        : wanted.split(',').map((s) => s.trim()).filter((s) => s in PROBES);

  if (ids.length === 0) {
    return NextResponse.json(
      { ok: false, error: { code: 'bad_input', message: `Unknown source ids. Available: ${Object.keys(PROBES).join(', ')}` } },
      { status: 400 },
    );
  }

  const probeOne = async (id: string): Promise<SourceStatusEntry> => {
    const probe = PROBES[id];
    try {
      return toStatusEntry(probe.source, await probe.run());
    } catch (err) {
      // A connector throwing is itself a source failure, reported as such
      // rather than collapsing the whole status view.
      return toStatusEntry(probe.source, {
        ok: false,
        error: { code: 'network', message: err instanceof Error ? `Probe threw: ${err.name}` : 'Probe failed' },
      });
    }
  };

  const ordered = Object.keys(PROBES).filter((id) => ids.includes(id));
  const firstWave = ordered.filter((id) => !BULK.has(id));
  const secondWave = ordered.filter((id) => BULK.has(id));
  // Awaited one wave at a time on purpose: building both `Promise.all` arrays in one expression
  // would start the bulk downloads immediately and put us back where we started.
  const byId = new Map<string, SourceStatusEntry>();
  for (const wave of [firstWave, secondWave]) {
    for (const entry of await Promise.all(wave.map(probeOne))) byId.set(entry.id, entry);
  }
  const entries: SourceStatusEntry[] = ordered.map((id) => byId.get(id)!);

  const counts = entries.reduce<Record<string, number>>((acc, e) => {
    acc[e.state] = (acc[e.state] ?? 0) + 1;
    return acc;
  }, {});

  // `persisted=1` adds the sync's own bookkeeping: when a run last wrote, what it wrote, and
  // what it saw. This answers "is the pipeline alive?" separately from "is the publisher
  // reachable?", which the probes above answer. It carries counts and dates only — no rows,
  // no user data.
  //
  // When the flag is absent the field is absent, not an empty list. `[]` means "configured, but
  // no run has been recorded", and returning it here would let a caller who never asked for
  // pipeline data conclude the pipeline has never run.
  const sync = booleanParam(url, 'persisted') ? await getSyncFreshness() : undefined;

  return NextResponse.json(
    {
      ok: true,
      data: { checkedAt: new Date().toISOString(), counts, sources: entries, sync },
      provenance: null,
    },
    { status: 200, headers: { 'cache-control': 'public, max-age=0, s-maxage=60, stale-while-revalidate=120' } },
  );
}
