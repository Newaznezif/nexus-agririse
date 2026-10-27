import type { NextResponse } from 'next/server';

import { badRequest, errorResponse, fromConnector, intParam, numberParam, stringParam, withExtras } from '@/lib/data/api';
import { resolveLocation } from '@/lib/data/locations';
import { computeRainfallAnomaly, getAgroclimateDaily, getAgroclimateNormals } from '@/lib/data/nasaPower';

/**
 * GET /api/data/agroclimate
 *
 * NASA POWER daily agroclimatology for one place, plus the 30-year normals for the
 * same grid cell and the rainfall anomaly derived from the two. The anomaly is
 * flagged as computed, because no publisher publishes it.
 */
export async function GET(request: Request): Promise<NextResponse> {
  const url = new URL(request.url);

  const rawLat = numberParam(url, 'lat');
  const rawLon = numberParam(url, 'lon');
  if ((rawLat === null) !== (rawLon === null)) return badRequest('Provide both lat and lon, or neither');
  if (rawLat !== null && Number.isNaN(rawLat)) return badRequest('lat must be a number');
  if (rawLon !== null && Number.isNaN(rawLon)) return badRequest('lon must be a number');

  const resolved = resolveLocation({
    latitude: rawLat,
    longitude: rawLon,
    place: stringParam(url, 'place'),
    marketId: stringParam(url, 'market'),
  });
  if (!resolved.ok) return errorResponse(resolved.error);

  const days = intParam(url, 'days', 7, 365, 90);
  // POWER's newest complete day is typically 1-3 days behind, so the window ends
  // yesterday rather than today and says so through observedAt.
  const end = shiftUtcDate(new Date(), -1);
  const start = shiftUtcDate(end, -(days - 1));
  const compact = (d: Date) => d.toISOString().slice(0, 10).replace(/-/g, '');

  const daily = await getAgroclimateDaily({
    location: resolved.location,
    start: compact(start),
    end: compact(end),
  });
  if (!daily.ok) return fromConnector(daily, 6 * 3600);

  const normals = await getAgroclimateNormals(resolved.location);
  const anomaly = normals.ok
    ? computeRainfallAnomaly(daily.data.daily, normals.data.normals, `${start.toISOString().slice(0, 10)} → ${end.toISOString().slice(0, 10)}`)
    : null;

  return withExtras(
    daily,
    {
      window: { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10), days },
      normals: normals.ok ? normals.data.normals : [],
      annualNormalMmPerDay: normals.ok ? normals.data.annual.precipitationMmPerDay : null,
      normalsUnavailableReason: normals.ok ? null : normals.error.message,
      // Derived, not published: shown as a computation wherever it appears.
      derived: anomaly ? { ...anomaly, valueKind: 'estimated' as const } : null,
    },
    6 * 3600,
  );
}

function shiftUtcDate(from: Date, days: number): Date {
  return new Date(from.getTime() + days * 86_400_000);
}
