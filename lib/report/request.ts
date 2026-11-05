import type { ReportRequest } from './types';

/**
 * The report request as it crosses the network: one module declares the parameter names and the
 * ranges, so the browser cannot invent a field the route ignores, and the route cannot rename a
 * field the browser still sends.
 *
 * Two rules hold here and nowhere else in this directory:
 *  - `caller` is absent by construction. Identity comes from the token the route verifies; a query
 *    string can never name the author of a report.
 *  - a parameter that is not sent is not sent as an empty string. `parseReportQuery` treats absent
 *    and blank alike by falling back, which is what the connector limits already do.
 */

export const REPORT_LIMITS = {
  months: { min: 2, max: 24, fallback: 6 },
  forecastDays: { min: 1, max: 7, fallback: 7 },
  pastDays: { min: 1, max: 92, fallback: 14 },
  composites: { min: 1, max: 12, fallback: 5 },
} as const;

export const REPORT_MODES = ['production', 'demo'] as const;

/** The fields this module can carry over the wire — everything except the verified caller. */
export type ReportQueryInput = Omit<ReportRequest, 'caller'>;

export type ReportQueryParse =
  | { ok: true; given: ReportQueryInput }
  | { ok: false; message: string };

export function buildReportQuery(input: ReportQueryInput): string {
  const params = new URLSearchParams();
  if (input.mode) params.set('mode', input.mode);
  if (nonEmpty(input.market)) params.set('market', input.market.trim());
  if (nonEmpty(input.marketId)) params.set('marketId', input.marketId.trim());
  if (nonEmpty(input.region)) params.set('region', input.region.trim());
  if (nonEmpty(input.commodity)) params.set('commodity', input.commodity.trim());
  // Both or neither: a lone coordinate would be refused by the route, so it is never sent.
  if (isFiniteNumber(input.latitude) && isFiniteNumber(input.longitude)) {
    params.set('lat', String(input.latitude));
    params.set('lon', String(input.longitude));
  }
  setClamped(params, 'months', input.months, REPORT_LIMITS.months);
  setClamped(params, 'forecastDays', input.forecastDays, REPORT_LIMITS.forecastDays);
  setClamped(params, 'pastDays', input.pastDays, REPORT_LIMITS.pastDays);
  setClamped(params, 'composites', input.composites, REPORT_LIMITS.composites);
  return params.toString();
}

/**
 * Reads exactly what `buildReportQuery` writes. Kept free of `next/server` so the browser and the
 * route share one validator without pulling server code into a page bundle.
 */
export function parseReportQuery(search: string): ReportQueryParse {
  const url = new URL(`http://report.local/?${search.replace(/^\?/, '')}`);
  const given: ReportQueryInput = {};

  const mode = text(url, 'mode');
  if (mode !== null) {
    if (!REPORT_MODES.includes(mode as (typeof REPORT_MODES)[number])) {
      return { ok: false, message: 'mode must be production or demo' };
    }
    given.mode = mode as ReportRequest['mode'];
  }

  given.market = text(url, 'market');
  given.marketId = text(url, 'marketId');
  given.region = text(url, 'region');
  given.commodity = text(url, 'commodity');

  const rawLat = number(url, 'lat');
  const rawLon = number(url, 'lon');
  if ((rawLat === null) !== (rawLon === null)) {
    return { ok: false, message: 'Provide both lat and lon, or neither' };
  }
  if (rawLat !== null && Number.isNaN(rawLat)) return { ok: false, message: 'lat must be a number' };
  if (rawLon !== null && Number.isNaN(rawLon)) return { ok: false, message: 'lon must be a number' };
  given.latitude = rawLat;
  given.longitude = rawLon;

  given.months = clamp(url, 'months', REPORT_LIMITS.months);
  given.forecastDays = clamp(url, 'forecastDays', REPORT_LIMITS.forecastDays);
  given.pastDays = clamp(url, 'pastDays', REPORT_LIMITS.pastDays);
  given.composites = clamp(url, 'composites', REPORT_LIMITS.composites);

  return { ok: true, given };
}

function nonEmpty(value: string | null | undefined): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isFiniteNumber(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/** Names and commodities are the publisher's strings; the 120-character cap is theirs too. */
function text(url: URL, name: string): string | null {
  const raw = url.searchParams.get(name);
  if (raw === null) return null;
  const trimmed = raw.trim();
  return trimmed === '' ? null : trimmed.slice(0, 120);
}

/** `null` means absent; `NaN` means present but not a number, which the route must refuse. */
function number(url: URL, name: string): number | null {
  const raw = url.searchParams.get(name);
  if (raw === null || raw.trim() === '') return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : NaN;
}

function clamp(url: URL, name: string, limits: { min: number; max: number; fallback: number }): number {
  const value = number(url, name);
  if (value === null || Number.isNaN(value)) return limits.fallback;
  return Math.max(limits.min, Math.min(limits.max, Math.trunc(value)));
}

function setClamped(
  params: URLSearchParams,
  name: string,
  value: number | null | undefined,
  limits: { min: number; max: number; fallback: number },
): void {
  if (value === null || value === undefined || Number.isNaN(value)) return;
  params.set(name, String(clampValue(value, limits)));
}

/** The same clamping on both sides of the wire, so a sent value is the value used. */
function clampValue(value: number, limits: { min: number; max: number }): number {
  return Math.max(limits.min, Math.min(limits.max, Math.trunc(value)));
}
