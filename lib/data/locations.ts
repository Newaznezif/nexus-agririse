import { DEFAULT_ETHIOPIAN_LOCATION, ETHIOPIAN_MARKET_LOCATIONS } from './ethiopianMarkets';
import type { LocationRef, SourceError } from './types';

/**
 * Turning a query string into a `LocationRef`.
 *
 * Every place a farmer can pick is a real market centre from WFP's own reference
 * table, so the coordinates shown for a named town are the publisher's, not ours.
 * A hand-typed coordinate is labelled `user` and carries no administrative names,
 * because we cannot invent which woreda a point falls in without a boundary
 * service that we have not verified.
 */

const normalise = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

export interface SelectablePlace {
  name: string;
  admin1: string;
  admin2: string;
  latitude: number;
  longitude: number;
}

/** Grouped by the region name the source publishes. */
export function listSelectablePlaces(): SelectablePlace[] {
  return ETHIOPIAN_MARKET_LOCATIONS.map((m) => ({
    name: m.name,
    admin1: m.admin1,
    admin2: m.admin2,
    latitude: m.latitude,
    longitude: m.longitude,
  })).sort((a, b) => a.admin1.localeCompare(b.admin1) || a.name.localeCompare(b.name));
}

export function findPlaceByName(name: string): SelectablePlace | undefined {
  const needle = normalise(name);
  const exact = ETHIOPIAN_MARKET_LOCATIONS.find((m) => normalise(m.name) === needle);
  if (exact) return { name: exact.name, admin1: exact.admin1, admin2: exact.admin2, latitude: exact.latitude, longitude: exact.longitude };
  const partial = ETHIOPIAN_MARKET_LOCATIONS.find((m) => normalise(m.name).includes(needle));
  if (!partial) return undefined;
  return { name: partial.name, admin1: partial.admin1, admin2: partial.admin2, latitude: partial.latitude, longitude: partial.longitude };
}

export function findPlaceByMarketId(marketId: string): SelectablePlace | undefined {
  const m = ETHIOPIAN_MARKET_LOCATIONS.find((x) => x.marketId === marketId);
  return m ? { name: m.name, admin1: m.admin1, admin2: m.admin2, latitude: m.latitude, longitude: m.longitude } : undefined;
}

export interface LocationQuery {
  latitude: number | null;
  longitude: number | null;
  place: string | null;
  marketId: string | null;
}

export type ResolvedLocation = { ok: true; location: LocationRef } | { ok: false; error: SourceError };

export function resolveLocation(q: LocationQuery): ResolvedLocation {
  if (q.marketId) {
    const found = findPlaceByMarketId(q.marketId);
    if (!found) {
      return { ok: false, error: { code: 'bad_input', message: 'Unknown market id; pick one from /api/data/locations' } };
    }
    return { ok: true, location: { ...found, coordinateSource: 'source-catalogue' } };
  }

  if (q.place) {
    const found = findPlaceByName(q.place);
    if (!found) {
      return { ok: false, error: { code: 'bad_input', message: `No Ethiopian market centre named “${q.place}” in the source catalogue` } };
    }
    return { ok: true, location: { ...found, coordinateSource: 'source-catalogue' } };
  }

  if (q.latitude !== null && q.longitude !== null) {
    return {
      ok: true,
      location: {
        name: 'Selected coordinate',
        admin1: null,
        admin2: null,
        latitude: q.latitude,
        longitude: q.longitude,
        coordinateSource: 'user',
      },
    };
  }

  const d = DEFAULT_ETHIOPIAN_LOCATION;
  return {
    ok: true,
    location: { name: d.name, admin1: d.admin1, admin2: d.admin2, latitude: d.latitude, longitude: d.longitude, coordinateSource: 'default' },
  };
}

/** Rough Ethiopian extent, used only to tell the user their point is outside the country. */
export function isWithinEthiopia(latitude: number, longitude: number): boolean {
  return latitude >= 3.4 && latitude <= 14.9 && longitude >= 33.0 && longitude <= 48.0;
}
