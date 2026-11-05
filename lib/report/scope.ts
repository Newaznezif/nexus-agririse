import { findPlaceByName, findPlaceByMarketId, listSelectablePlaces, resolveLocation } from '@/lib/data/locations';
import type { SelectablePlace } from '@/lib/data/locations';
import type { SourceError } from '@/lib/data/types';
import { getMarketSnapshot } from '@/lib/data/wfpMarketPrices';
import type { ReportRequest, ReportScope } from './types';

/**
 * Turning a report request into a scope, and refusing when it cannot be honoured.
 *
 * This is the one place that decides how wide a claim in the report may be. The rule it exists
 * to enforce: a request for Oromia must never be answered with Addis Ababa numbers, and a
 * request for a hand-typed coordinate must never be answered with a national average presented
 * as if it belonged to that plot. Where the sources cannot meet the request, the scope says so
 * in `note` and the owning section degrades to `unavailable`.
 */

export type ScopeResolution = { ok: true; scope: ReportScope } | { ok: false; error: SourceError };

/** Regions the price publisher's own reference table spells, so filters match rows that exist. */
export function knownRegions(): string[] {
  return [...new Set(listSelectablePlaces().map((p) => p.admin1))].sort((a, b) => a.localeCompare(b));
}

/**
 * The market to read climate and satellite values for inside a region. Chosen from published
 * rows — the market the survey covers most — rather than picked arbitrarily, so the anchor is
 * traceable to the publisher instead of to a guess.
 */
async function regionAnchor(region: string, months: number): Promise<{ place: SelectablePlace; via: string } | null> {
  const snapshot = await getMarketSnapshot({ region, months, limit: 500 });
  const counts = new Map<string, number>();
  if (snapshot.ok) {
    for (const row of snapshot.data.rows) counts.set(row.market, (counts.get(row.market) ?? 0) + 1);
  }
  const best = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];

  // Coordinates must come from the catalogue: a market name with no published centre cannot be
  // sampled, and inventing one would move the whole report to a place nobody surveyed.
  const surveyed = best ? findPlaceByName(best[0]) : undefined;
  if (surveyed) {
    return { place: surveyed, via: `the most surveyed market in ${region} (${best?.[1] ?? 0} rows in the latest survey month)` };
  }

  const fallback = listSelectablePlaces().find((p) => p.admin1.toLowerCase() === region.toLowerCase());
  if (!fallback) return null;
  return {
    place: fallback,
    via: best ? `the catalogue centre for ${region}; ${best[0]}, its most surveyed market, publishes no coordinates` : `the catalogue centre for ${region}; the survey answered no rows for it`,
  };
}

export async function resolveScope(req: ReportRequest): Promise<ScopeResolution> {
  const months = Math.max(2, Math.min(24, req.months ?? 6));

  if (req.marketId) {
    const place = findPlaceByMarketId(req.marketId);
    if (!place) {
      return { ok: false, error: { code: 'bad_input', message: `No market with id “${req.marketId}” in the publisher's catalogue` } };
    }
    return { ok: true, scope: marketScope(place, req.marketId) };
  }

  if (req.market) {
    const place = findPlaceByName(req.market);
    if (!place) {
      return { ok: false, error: { code: 'bad_input', message: `No Ethiopian market centre named “${req.market}”. /api/data/locations lists the names the sources publish.` } };
    }
    return { ok: true, scope: marketScope(place, null) };
  }

  if (req.region) {
    const match = knownRegions().find((r) => r.toLowerCase() === req.region!.toLowerCase());
    if (!match) {
      return { ok: false, error: { code: 'bad_input', message: `Unknown region “${req.region}”. The price publisher uses: ${knownRegions().join(', ')}.` } };
    }
    const anchor = await regionAnchor(match, months);
    if (!anchor) {
      return { ok: false, error: { code: 'no_data', message: `No market with published coordinates in ${match}` } };
    }

    return {
      ok: true,
      scope: {
        kind: 'region',
        place: anchor.place.name,
        marketId: null,
        region: match,
        location: { ...anchor.place, coordinateSource: 'source-catalogue' },
        spatial: 'region-markets',
        // Read at a point inside the region, and labelled that way: a region report carries the
        // region's own price rows, but weather and NDVI remain single-location observations.
        note: `Region scope: price rows are ${match} markets the survey publishes; climate and satellite values are read at ${anchor.place.name} — ${anchor.via} — and are point observations, not ${match} averages.`,
      },
    };
  }

  if ((req.latitude ?? null) !== null && (req.longitude ?? null) !== null) {
    const resolved = resolveLocation({ latitude: req.latitude ?? null, longitude: req.longitude ?? null, place: null, marketId: null });
    if (!resolved.ok) return { ok: false, error: resolved.error };
    return {
      ok: true,
      scope: {
        kind: 'coordinate',
        place: null,
        marketId: null,
        region: null,
        location: resolved.location,
        spatial: 'grid-cell',
        note: 'Coordinate scope: weather, agroclimatology and satellite pixels are read at this point. No market price row can be attributed to a location between surveyed markets, so the market section reports nothing rather than a substitute.',
      },
    };
  }

  return {
    ok: true,
    scope: {
      kind: 'national',
      place: null,
      marketId: null,
      region: null,
      location: null,
      spatial: 'national-survey',
      note: 'National scope: price figures are the country-wide survey. A country has no single coordinate, so point products (weather, satellite) are not answered here — pick a market or a region for those.',
    },
  };
}

function marketScope(place: SelectablePlace, marketId: string | null): ReportScope {
  return {
    kind: 'market',
    place: place.name,
    marketId,
    // Region travels with the market for the cover line only. Price filters stay on the market
    // name, so a market report can never imply a regional average.
    region: place.admin1,
    location: { ...place, coordinateSource: 'source-catalogue' },
    spatial: 'market',
    note: null,
  };
}
