import { cachedFetch } from './cache';
import { httpJson } from './http';
import { provenanceFor, SOURCES } from './sources';
import type {
  ConnectorResult,
  DailyWeatherPoint,
  HourlyWeatherPoint,
  LocationRef,
  SourceError,
  WeatherSeries,
} from './types';

const FORECAST_HOST = 'https://api.open-meteo.com/v1/forecast';
/** The archive is served from `archive-api`. `historical-api.open-meteo.com` — which this constant
 *  used until 2026-10-30 — has never resolved (`nslookup … 8.8.8.8`: *Non-existent domain*), so
 *  `mode=history` could only ever return a network 502, on this machine and on the deployed app.
 *  Measured against this connector's exact query: 200, 31 daily rows for 2026-01-01 → 2026-01-31. */
const ARCHIVE_HOST = 'https://archive-api.open-meteo.com/v1/archive';

const TIMEZONE = 'Africa/Addis_Ababa';

const DAILY_VARS = [
  'precipitation_sum',
  'precipitation_probability_max',
  'temperature_2m_max',
  'temperature_2m_min',
  'relative_humidity_2m_mean',
  'wind_speed_10m_max',
  'et0_fao_evapotranspiration',
] as const;

const HOURLY_VARS = ['temperature_2m', 'precipitation', 'relative_humidity_2m'] as const;

const CURRENT_VARS = [
  'temperature_2m',
  'relative_humidity_2m',
  'precipitation',
  'weather_code',
  'wind_speed_10m',
] as const;

/** What the TTL cache holds per coordinate/window: the parsed series and its stamp. */
export type SeriesFetch = { series: WeatherSeries; observedAt: string | null };

export interface ForecastRequest {  location: LocationRef;
  /** 0-7 in the publisher's free tier; we default to a week. */
  forecastDays?: number;
  /** Backfill of observed days, 0-92. */
  pastDays?: number;
  includeHourly?: boolean;
}

export function validateCoordinate(lat: unknown, lon: unknown): { latitude: number; longitude: number } | SourceError {
  const latitude = Number(lat);
  const longitude = Number(lon);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return { code: 'bad_input', message: 'Latitude and longitude must be finite numbers' };
  }
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
    return { code: 'bad_input', message: 'Coordinate is outside the valid range' };
  }
  return { latitude, longitude };
}

/** Exported for tests: the URL is the contract with the publisher. */
export function buildForecastUrl(o: {
  latitude: number;
  longitude: number;
  forecastDays: number;
  pastDays: number;
  includeHourly: boolean;
}): string {
  const p = new URLSearchParams({
    latitude: o.latitude.toFixed(4),
    longitude: o.longitude.toFixed(4),
    daily: DAILY_VARS.join(','),
    current: CURRENT_VARS.join(','),
    timezone: TIMEZONE,
    forecast_days: String(o.forecastDays),
    past_days: String(o.pastDays),
  });
  if (o.includeHourly) p.set('hourly', HOURLY_VARS.join(','));
  return `${FORECAST_HOST}?${p.toString()}`;
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

/** Row-wise unzip of the publisher's parallel arrays. */
function parseSeries(json: Record<string, unknown>): { daily: DailyWeatherPoint[]; hourly: HourlyWeatherPoint[]; current: WeatherSeries['current'] } {
  const dailyRaw = json.daily as Record<string, unknown[]> | undefined;
  const hourlyRaw = json.hourly as Record<string, unknown[]> | undefined;
  const currentRaw = json.current as Record<string, unknown> | undefined;
  const today = new Date().toISOString().slice(0, 10);

  const daily: DailyWeatherPoint[] = [];
  if (Array.isArray(dailyRaw?.time)) {
    for (let i = 0; i < dailyRaw.time.length; i += 1) {
      const date = str(dailyRaw.time[i]);
      if (!date) continue;
      daily.push({
        date,
        isForecast: date > today,
        precipitationSumMm: num(dailyRaw.precipitation_sum?.[i]),
        precipitationProbabilityMaxPct: num(dailyRaw.precipitation_probability_max?.[i]),
        temperatureMaxC: num(dailyRaw.temperature_2m_max?.[i]),
        temperatureMinC: num(dailyRaw.temperature_2m_min?.[i]),
        relativeHumidityMeanPct: num(dailyRaw.relative_humidity_2m_mean?.[i]),
        windSpeedMaxKmh: num(dailyRaw.wind_speed_10m_max?.[i]),
        et0Mm: num(dailyRaw.et0_fao_evapotranspiration?.[i]),
      });
    }
  }

  const hourly: HourlyWeatherPoint[] = [];
  if (Array.isArray(hourlyRaw?.time)) {
    // Only the next 48h are useful on a phone screen on a 3G link.
    const start = hourlyRaw.time.findIndex((t) => typeof t === 'string' && t >= today);
    const from = start < 0 ? 0 : start;
    for (let i = from; i < Math.min(from + 48, hourlyRaw.time.length); i += 1) {
      const time = str(hourlyRaw.time[i]);
      if (!time) continue;
      hourly.push({
        time,
        temperatureC: num(hourlyRaw.temperature_2m?.[i]),
        precipitationMm: num(hourlyRaw.precipitation?.[i]),
        relativeHumidityPct: num(hourlyRaw.relative_humidity_2m?.[i]),
      });
    }
  }

  const current = currentRaw && str(currentRaw.time)
    ? {
        observedAt: String(currentRaw.time),
        temperatureC: num(currentRaw.temperature_2m),
        relativeHumidityPct: num(currentRaw.relative_humidity_2m),
        precipitationMm: num(currentRaw.precipitation),
        windSpeedKmh: num(currentRaw.wind_speed_10m),
        weatherCode: num(currentRaw.weather_code),
      }
    : null;

  return { daily, hourly, current };
}

function failure(error: SourceError, location: LocationRef, endpoint: string, cacheHit: boolean): ConnectorResult<WeatherSeries> {
  return {
    ok: false,
    error,
    provenance: provenanceFor(SOURCES.openMeteoForecast, {
      endpoint,
      observedAt: null,
      // A mix of observation and forecast even when it works; callers split it per row.
      valueKind: 'forecast',
      units: '°C, mm, %, km/h',
      methodology: 'Numerical weather prediction (publisher model blend)',
      coverage: `${location.name}, ${location.admin1 ?? 'Ethiopia'}`,
      quality: 'low',
      servedFromCache: cacheHit,
    }),
  };
}

/**
 * Current + hourly + daily for one coordinate. `past_days` gives the publisher's
 * analysed recent observations alongside the forecast, which is what makes the
 * "rain to date" figure real rather than a projection.
 */
export async function getWeatherForecast(o: ForecastRequest): Promise<ConnectorResult<WeatherSeries>> {
  const coords = validateCoordinate(o.location.latitude, o.location.longitude);
  if ('code' in coords) return failure(coords, o.location, FORECAST_HOST, false);

  const forecastDays = Math.max(0, Math.min(7, o.forecastDays ?? 7));
  const pastDays = Math.max(0, Math.min(92, o.pastDays ?? 7));
  const includeHourly = o.includeHourly ?? true;
  const url = buildForecastUrl({ ...coords, forecastDays, pastDays, includeHourly });
  const key = `om:fc:${coords.latitude.toFixed(3)},${coords.longitude.toFixed(3)},${forecastDays},${pastDays},${includeHourly ? 'h' : 'd'}`;

  const outcome = await cachedFetch<SeriesFetch>(key, 6 * 3600, async () => {
    const res = await httpJson(url, { timeoutMs: 15_000 });
    if (!res.ok) return { ok: false, error: res.error };
    const json = res.json as Record<string, unknown>;
    const { daily, hourly, current } = parseSeries(json);
    if (daily.length === 0) {
      return { ok: false, error: { code: 'no_data', message: 'Publisher returned no daily series' } };
    }
    return {
      ok: true,
      value: {
        series: {
          location: o.location,
          timezone: str(json.timezone) ?? TIMEZONE,
          elevationM: num(json.elevation),
          current,
          daily,
          hourly,
        } satisfies WeatherSeries,
        observedAt: current?.observedAt ?? daily[0]?.date ?? null,
      },
    };
  });

  const built = outcome.value;
  if (!built.ok) return failure(built.error, o.location, url, outcome.servedFromCache);

  return {
    ok: true,
    data: built.value.series,
    provenance: provenanceFor(SOURCES.openMeteoForecast, {
      endpoint: url,
      observedAt: built.value.observedAt,
      valueKind: 'forecast',
      units: 'temperature °C · precipitation mm · humidity % · wind km/h · ET0 mm',
      methodology:
        'Deterministic NWP blend. Rows dated after today are forecasts; rows on or before today are analysed observations (Open-Meteo past_days).',
      coverage: `${o.location.name} (${o.location.latitude.toFixed(3)}, ${o.location.longitude.toFixed(3)}), ${o.location.admin1 ?? 'Ethiopia'}`,
      quality: o.location.coordinateSource === 'user' ? 'medium' : 'high',
      retrievedAt: new Date(outcome.storedAt).toISOString(),
      servedFromCache: outcome.servedFromCache,
    }),
  };
}

/** Daily historical archive (ERA5/Land reanalysis) for trend analysis. */
export async function getWeatherHistory(o: {
  location: LocationRef;
  start: string;
  end: string;
}): Promise<ConnectorResult<WeatherSeries>> {
  const coords = validateCoordinate(o.location.latitude, o.location.longitude);
  if ('code' in coords) return failure(coords, o.location, ARCHIVE_HOST, false);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(o.start) || !/^\d{4}-\d{2}-\d{2}$/.test(o.end) || o.start > o.end) {
    return failure({ code: 'bad_input', message: 'Dates must be YYYY-MM-DD and in order' }, o.location, ARCHIVE_HOST, false);
  }

  const p = new URLSearchParams({
    latitude: coords.latitude.toFixed(4),
    longitude: coords.longitude.toFixed(4),
    start_date: o.start,
    end_date: o.end,
    daily: ['precipitation_sum', 'temperature_2m_max', 'temperature_2m_min', 'et0_fao_evapotranspiration'].join(','),
    timezone: TIMEZONE,
  });
  const url = `${ARCHIVE_HOST}?${p.toString()}`;

  const outcome = await cachedFetch<SeriesFetch>(`om:hist:${coords.latitude.toFixed(3)},${coords.longitude.toFixed(3)},${o.start},${o.end}`, 24 * 3600, async () => {
    const res = await httpJson(url, { timeoutMs: 20_000 });
    if (!res.ok) return { ok: false, error: res.error };
    const json = res.json as Record<string, unknown>;
    const { daily } = parseSeries(json);
    if (daily.length === 0) return { ok: false, error: { code: 'no_data', message: 'No historical rows for that window' } };
    return { ok: true, value: { series: { ...emptySeries(o.location, json), daily } satisfies WeatherSeries, observedAt: daily[daily.length - 1].date } };
  });

  const built = outcome.value;
  if (!built.ok) return failure(built.error, o.location, url, outcome.servedFromCache);

  return {
    ok: true,
    data: built.value.series,
    provenance: provenanceFor(SOURCES.openMeteoHistorical, {
      endpoint: url,
      observedAt: built.value.observedAt,
      valueKind: 'modeled',
      units: 'temperature °C · precipitation mm · ET0 mm',
      methodology: 'ERA5-Land reanalysis: gridded model reconstruction, not a station measurement.',
      coverage: `${o.location.name}, ${o.location.admin1 ?? 'Ethiopia'} (${o.start} → ${o.end})`,
      retrievedAt: new Date(outcome.storedAt).toISOString(),
      servedFromCache: outcome.servedFromCache,
    }),
  };
}

function emptySeries(location: LocationRef, json: Record<string, unknown>): WeatherSeries {
  return {
    location,
    timezone: str(json.timezone) ?? TIMEZONE,
    elevationM: num(json.elevation),
    current: null,
    daily: [],
    hourly: [],
  };
}
