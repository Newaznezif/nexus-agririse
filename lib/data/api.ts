import { NextResponse } from 'next/server';

import type { ConnectorResult, Provenance, SourceError, SourceErrorCode } from './types';

/**
 * Shared plumbing for the read-only data routes.
 *
 * These endpoints serve publicly published climate, market and exchange data, so
 * they are deliberately not behind the session check that guards `/api/analyze`:
 * the AI route spends a paid provider call and writes to a user's records, while
 * these only read open sources. Anything user-owned stays behind `verifyCaller`.
 *
 * A connector failure becomes a structured `{ ok: false, error, provenance }` body
 * with an honest status code. The upstream response body is never forwarded.
 */

const STATUS_BY_CODE: Record<SourceErrorCode, number> = {
  bad_input: 400,
  no_data: 404,
  rate_limited: 429,
  timeout: 504,
  network: 502,
  http_status: 502,
  payload_too_large: 502,
  parse_failed: 502,
  auth_required: 502,
  not_configured: 502,
};

export interface DataPayload<T> {
  ok: true;
  data: T;
  provenance: Provenance;
}

export function fromConnector<T>(result: ConnectorResult<T>, maxAgeSeconds = 300): NextResponse {
  if (result.ok) {
    return NextResponse.json(
      { ok: true, data: result.data, provenance: result.provenance } satisfies DataPayload<T>,
      {
        status: 200,
        headers: {
          // Public data, and the provenance block already tells the client when it
          // was retrieved, so a short CDN window is safe.
          'cache-control': `public, s-maxage=${maxAgeSeconds}, stale-while-revalidate=${maxAgeSeconds * 3}`,
        },
      },
    );
  }

  return errorResponse(result.error, result.provenance);
}

/**
 * `provenance` is null only when the request was rejected before any upstream call
 * (bad input): there is genuinely no publisher behind that answer.
 */
export function errorResponse(error: SourceError, provenance: Provenance | null = null): NextResponse {
  return NextResponse.json({ ok: false, error: sanitized(error), provenance }, { status: STATUS_BY_CODE[error.code] });
}

/**
 * Adds request-scoped flags (e.g. `withinEthiopia`, `mode`) to a connector payload
 * without touching the connector's own types or its provenance.
 */
export function withExtras<T extends object>(result: ConnectorResult<T>, extra: Record<string, unknown>, maxAgeSeconds = 300): NextResponse {
  return result.ok ? fromConnector({ ...result, data: { ...result.data, ...extra } }, maxAgeSeconds) : fromConnector(result, maxAgeSeconds);
}

/** Error codes are stable; the message is kept short and free of upstream detail. */
function sanitized(error: SourceError): SourceError {
  const message = error.message.length > 200 ? `${error.message.slice(0, 197)}…` : error.message;
  return { code: error.code, message, ...(error.status ? { status: error.status } : {}), ...(error.retryAfterSeconds ? { retryAfterSeconds: error.retryAfterSeconds } : {}) };
}

export function badRequest(message: string): NextResponse {
  return errorResponse({ code: 'bad_input', message });
}

/* ------------------- query-string parsing ------------------- */

export function numberParam(url: URL, name: string): number | null {
  const raw = url.searchParams.get(name);
  if (raw === null || raw.trim() === '') return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : NaN;
}

export function stringParam(url: URL, name: string): string | null {
  const raw = url.searchParams.get(name);
  if (raw === null) return null;
  const trimmed = raw.trim();
  return trimmed === '' ? null : trimmed.slice(0, 120);
}

export function booleanParam(url: URL, name: string, fallback = false): boolean {
  const raw = url.searchParams.get(name);
  if (raw === null) return fallback;
  return raw === '1' || raw.toLowerCase() === 'true';
}

/** Accepts a real YYYY-MM-DD calendar day only; callers must not be able to inject an arbitrary path segment. */
export function isoDateParam(url: URL, name: string): string | null | 'invalid' {
  const raw = stringParam(url, name);
  if (raw === null) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return 'invalid';
  // "2026-13-99" has the right shape but is not a day: sending it upstream would
  // come back as "no data", which is the wrong lesson for the caller to learn.
  const [year, month, day] = raw.split('-').map(Number);
  const probe = new Date(Date.UTC(year, month - 1, day));
  const roundTrips = probe.getUTCFullYear() === year && probe.getUTCMonth() === month - 1 && probe.getUTCDate() === day;
  return roundTrips ? raw : 'invalid';
}

export function intParam(url: URL, name: string, min: number, max: number, fallback: number): number {
  const value = numberParam(url, name);
  if (value === null || Number.isNaN(value)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(value)));
}
