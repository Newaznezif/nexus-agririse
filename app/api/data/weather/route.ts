import type { NextResponse } from 'next/server';

import { badRequest, errorResponse, intParam, numberParam, stringParam, withExtras } from '@/lib/data/api';
import { isWithinEthiopia, resolveLocation } from '@/lib/data/locations';
import { getWeatherForecast, getWeatherHistory, validateCoordinate } from '@/lib/data/openMeteo';

/**
 * GET /api/data/weather
 *
 * Open-Meteo forecast (with the publisher's analysed past days) for one place.
 * `mode=history` switches to the ERA5 daily archive for a stated window.
 *
 * Serves open data only and takes no credentials, so it is not session-guarded;
 * see `lib/data/api.ts` for why that is deliberate.
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

  const coords = validateCoordinate(resolved.location.latitude, resolved.location.longitude);
  if ('code' in coords) return errorResponse(coords);

  const mode = stringParam(url, 'mode') ?? 'forecast';
  const withinEthiopia = isWithinEthiopia(resolved.location.latitude, resolved.location.longitude);

  if (mode === 'history') {
    const start = stringParam(url, 'start');
    const end = stringParam(url, 'end');
    if (!start || !end) return badRequest('mode=history requires start and end as YYYY-MM-DD');
    const history = await getWeatherHistory({ location: resolved.location, start, end });
    return withExtras(history, { withinEthiopia, mode }, 24 * 3600);
  }

  const forecast = await getWeatherForecast({
    location: resolved.location,
    forecastDays: intParam(url, 'days', 0, 7, 7),
    pastDays: intParam(url, 'pastDays', 0, 92, 7),
    includeHourly: stringParam(url, 'hourly') !== '0',
  });

  return withExtras(forecast, { withinEthiopia, mode: 'forecast' }, 15 * 60);
}
