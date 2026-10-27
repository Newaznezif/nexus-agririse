import { cachedFetch } from './cache';
import { httpJson } from './http';
import { provenanceFor, SOURCES } from './sources';
import type {
  AgroclimateDailyPoint,
  AgroclimateSeries,
  ConnectorResult,
  LocationRef,
  MonthlyNormal,
  SourceError,
} from './types';

const DAILY_HOST = 'https://power.larc.nasa.gov/api/temporal/daily/point';
const CLIMATOLOGY_HOST = 'https://power.larc.nasa.gov/api/temporal/climatology/point';

/**
 * POWER publishes a numeric fill value of -999 for missing days (header.fill_value).
 * Treating that as a measurement would put a -999 °C spike into a trend chart.
 */
const FILL = -999;

const DAILY_PARAMS = ['T2M_MAX', 'T2M_MIN', 'RH2M', 'WS2M', 'PRECTOTCORR', 'ALLSKY_SFC_SW_DWN'] as const;
const CLIMATOLOGY_PARAMS = ['PRECTOTCORR', 'T2M', 'RH2M'] as const;

const MONTH_CODES = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'] as const;
const MONTH_ISO = ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12'] as const;

export interface PowerParameterMeta {
  units: string;
  longname: string;
}

interface PowerResponse {
  header?: { fill_value?: number; time_standard?: string };
  parameters?: Record<string, PowerParameterMeta>;
  properties?: { parameter?: Record<string, Record<string, number>> };
}

export type DailyFetch = { points: AgroclimateDailyPoint[]; meta: Record<string, PowerParameterMeta>; latest: string | null };
export type ClimatologyFetch = { normals: MonthlyNormal[]; annualPrecipitationMmPerDay: number | null };

export function validatePowerDate(d: string): boolean {
  return /^\d{8}$/.test(d);
}

/** Exported for tests. */
export function buildDailyUrl(o: { latitude: number; longitude: number; start: string; end: string }): string {
  const p = new URLSearchParams({
    parameters: DAILY_PARAMS.join(','),
    community: 'AG',
    longitude: o.longitude.toFixed(4),
    latitude: o.latitude.toFixed(4),
    start: o.start,
    end: o.end,
    format: 'JSON',
  });
  return `${DAILY_HOST}?${p.toString()}`;
}

export function buildClimatologyUrl(o: { latitude: number; longitude: number }): string {
  const p = new URLSearchParams({
    parameters: CLIMATOLOGY_PARAMS.join(','),
    community: 'AG',
    longitude: o.longitude.toFixed(4),
    latitude: o.latitude.toFixed(4),
    format: 'JSON',
  });
  return `${CLIMATOLOGY_HOST}?${p.toString()}`;
}

/** YYYYMMDD -> YYYY-MM-DD, which is what the rest of the app uses. */
function toIsoDate(compact: string): string {
  return `${compact.slice(0, 4)}-${compact.slice(4, 6)}-${compact.slice(6, 8)}`;
}

function clean(value: number | undefined, fill: number): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value === fill) return null;
  return value;
}

function parseDaily(json: PowerResponse): { points: AgroclimateDailyPoint[]; meta: Record<string, PowerParameterMeta>; latest: string | null } {
  const fill = json.header?.fill_value ?? FILL;
  const meta = json.parameters ?? {};
  const table = json.properties?.parameter ?? {};
  const days = Object.keys(table.T2M_MAX ?? {}).sort();

  const points: AgroclimateDailyPoint[] = [];
  for (const day of days) {
    if (!/^\d{8}$/.test(day)) continue;
    points.push({
      date: toIsoDate(day),
      temperatureMaxC: clean(table.T2M_MAX?.[day], fill),
      temperatureMinC: clean(table.T2M_MIN?.[day], fill),
      relativeHumidityPct: clean(table.RH2M?.[day], fill),
      windSpeedMs: clean(table.WS2M?.[day], fill),
      precipitationMm: clean(table.PRECTOTCORR?.[day], fill),
      shortwaveRadiationMjPerM2: clean(table.ALLSKY_SFC_SW_DWN?.[day], fill),
    });
  }
  return { points, meta, latest: points.length ? points[points.length - 1].date : null };
}

function parseClimatology(json: PowerResponse): MonthlyNormal[] {
  const table = json.properties?.parameter ?? {};
  const meta = json.parameters ?? {};
  const out: MonthlyNormal[] = [];
  for (const code of MONTH_CODES) {
    for (const [param, values] of Object.entries(table)) {
      const value = values?.[code];
      if (typeof value !== 'number' || value === FILL) continue;
      out.push({
        month: MONTH_ISO[MONTH_CODES.indexOf(code)],
        parameter: param,
        units: meta[param]?.units ?? '',
        value,
      });
    }
  }
  return out;
}

function fail(error: SourceError, location: LocationRef, endpoint: string): ConnectorResult<AgroclimateSeries> {
  return {
    ok: false,
    error,
    provenance: provenanceFor(SOURCES.nasaPower, {
      endpoint,
      observedAt: null,
      valueKind: 'modeled',
      units: '°C, %, m/s, mm/day, MJ/m²/day',
      methodology: 'MERRA-2 / POWER satellite-gauge reanalysis',
      coverage: location.name,
      quality: 'low',
    }),
  };
}

/**
 * Daily agroclimatology for a coordinate. POWER's latency is what it is: the
 * newest complete day is typically 1-3 days behind, so `observedAt` comes from
 * the data itself rather than from the clock.
 */
export async function getAgroclimateDaily(o: {
  location: LocationRef;
  /** YYYYMMDD */
  start: string;
  end: string;
}): Promise<ConnectorResult<AgroclimateSeries>> {
  if (!validatePowerDate(o.start) || !validatePowerDate(o.end) || o.start > o.end) {
    return fail({ code: 'bad_input', message: 'POWER dates must be YYYYMMDD and in order' }, o.location, DAILY_HOST);
  }

  const url = buildDailyUrl({ latitude: o.location.latitude, longitude: o.location.longitude, start: o.start, end: o.end });
  const outcome = await cachedFetch<DailyFetch>(`power:daily:${o.location.latitude.toFixed(3)},${o.location.longitude.toFixed(3)},${o.start},${o.end}`, 6 * 3600, async () => {
    const res = await httpJson(url, { timeoutMs: 25_000 });
    if (!res.ok) return { ok: false, error: res.error };
    const json = res.json as PowerResponse;
    const { points, meta, latest } = parseDaily(json);
    if (points.length === 0) return { ok: false, error: { code: 'no_data', message: 'No agroclimatology rows in that window' } };
    return { ok: true, value: { points, meta, latest } };
  });

  const built = outcome.value;
  if (!built.ok) return fail(built.error, o.location, url);

  const units = Object.entries(built.value.meta)
    .map(([code, m]) => `${code} ${m.units}`)
    .join(' · ');

  return {
    ok: true,
    data: { location: o.location, daily: built.value.points },
    provenance: provenanceFor(SOURCES.nasaPower, {
      endpoint: url,
      observedAt: built.value.latest,
      valueKind: 'modeled',
      units: units || '°C, %, mm/day',
      methodology:
        'Satellite-informed reanalysis at 0.5°×0.625° (roughly a 50 km grid cell); MERRA-2 with in-situ merging. A grid value, not a station reading.',
      coverage: `${o.location.name} (${o.location.latitude.toFixed(3)}, ${o.location.longitude.toFixed(3)})`,
      quality: 'medium',
      retrievedAt: new Date(outcome.storedAt).toISOString(),
      servedFromCache: outcome.servedFromCache,
    }),
  };
}

/** 30-year monthly normals, used as the honest baseline for rainfall anomalies. */
export async function getAgroclimateNormals(
  location: LocationRef,
): Promise<ConnectorResult<{ normals: MonthlyNormal[]; annual: { precipitationMmPerDay: number | null } }>> {
  const url = buildClimatologyUrl({ latitude: location.latitude, longitude: location.longitude });
  const outcome = await cachedFetch<ClimatologyFetch>(`power:clim:${location.latitude.toFixed(3)},${location.longitude.toFixed(3)}`, 30 * 86400, async () => {
    const res = await httpJson(url, { timeoutMs: 20_000 });
    if (!res.ok) return { ok: false, error: res.error };
    const json = res.json as PowerResponse;
    const normals = parseClimatology(json);
    if (normals.length === 0) return { ok: false, error: { code: 'no_data', message: 'No climatology returned' } };
    const annual = json.properties?.parameter?.PRECTOTCORR?.ANN;
    return { ok: true, value: { normals, annualPrecipitationMmPerDay: typeof annual === 'number' ? annual : null } };
  });

  const built = outcome.value;
  if (!built.ok) {
    return {
      ok: false,
      error: built.error,
      provenance: provenanceFor(SOURCES.nasaPower, {
        endpoint: url,
        observedAt: null,
        valueKind: 'modeled',
        units: 'mm/day, °C, %',
        methodology: 'Climatology normals',
        coverage: location.name,
        quality: 'low',
      }),
    };
  }

  return {
    ok: true,
    data: { normals: built.value.normals, annual: { precipitationMmPerDay: built.value.annualPrecipitationMmPerDay } },
    provenance: provenanceFor(SOURCES.nasaPower, {
      endpoint: url,
      observedAt: null,
      valueKind: 'modeled',
      units: 'mm/day (precipitation), °C (temperature), % (humidity)',
      methodology: 'Long-run monthly climatology normals for the grid cell; not a forecast of this year.',
      coverage: `${location.name} grid cell`,
      retrievedAt: new Date(outcome.storedAt).toISOString(),
      servedFromCache: outcome.servedFromCache,
    }),
  };
}

export interface RainfallAnomaly {
  period: string;
  /** Observed sum over the window, mm. */
  observedMm: number;
  /** Expected sum from the climatology normals over the same months, mm. */
  expectedMm: number;
  anomalyPct: number | null;
  /** Days in the window that carried real data, out of the days requested. */
  daysWithData: number;
  daysRequested: number;
  /** Below 60% coverage the number should not be presented as a season total. */
  sufficientCoverage: boolean;
}

/**
 * Anomaly is derived, not published: it is the ratio of two real quantities
 * (POWER daily observations against POWER normals for the same cell), and the
 * caller must show that it is computed.
 */
export function computeRainfallAnomaly(
  daily: AgroclimateDailyPoint[],
  normals: MonthlyNormal[],
  periodLabel: string,
): RainfallAnomaly {
  const precipNormals = normals.filter((n) => n.parameter === 'PRECTOTCORR');
  const byMonth = new Map(precipNormals.map((n) => [n.month, n.value]));

  const observedMm = daily.reduce((sum, d) => sum + (d.precipitationMm ?? 0), 0);
  const daysWithData = daily.filter((d) => d.precipitationMm !== null).length;

  // Expected = normal mm/day summed over the days of each month actually covered.
  let expectedMm = 0;
  const daysInMonthSeen = new Map<string, number>();
  for (const d of daily) {
    const key = d.date.slice(0, 7);
    daysInMonthSeen.set(key, (daysInMonthSeen.get(key) ?? 0) + 1);
  }
  for (const [yearMonth, days] of daysInMonthSeen) {
    const normal = byMonth.get(yearMonth.slice(5, 7));
    if (typeof normal === 'number') expectedMm += normal * days;
  }

  const anomalyPct = expectedMm > 0 ? ((observedMm - expectedMm) / expectedMm) * 100 : null;
  return {
    period: periodLabel,
    observedMm: Math.round(observedMm * 10) / 10,
    expectedMm: Math.round(expectedMm * 10) / 10,
    anomalyPct: anomalyPct === null ? null : Math.round(anomalyPct * 10) / 10,
    daysWithData,
    daysRequested: daily.length,
    sufficientCoverage: daily.length > 0 && daysWithData / daily.length >= 0.6,
  };
}
