import type { SourceError, SourceErrorCode } from './types';

/**
 * One HTTP path for every external source: hard timeout, bounded retries with
 * jitter, explicit rate-limit handling, and a payload ceiling.
 *
 * Deliberate omissions: we never log request URLs with their query string, and
 * we never log `response.url`. HDX answers its download links with a 302 to an
 * S3 URL that carries an AWS signature in the query string, so the effective
 * URL is a credential-bearing value even though the request itself is public.
 */

const DEFAULT_TIMEOUT_MS = 12_000;
const DEFAULT_RETRIES = 2;
const DEFAULT_MAX_BYTES = 12 * 1024 * 1024;

/** Some publishers answer a bare Node client with 403, so identify honestly. */
const USER_AGENT = 'NexusAgriRise/1.0 (+agricultural intelligence; contact: hello@nexus-agririse)';

export interface HttpOptions {
  timeoutMs?: number;
  retries?: number;
  maxBytes?: number;
  headers?: Record<string, string>;
  /** Only for sources that accept a body; all of ours are GET. */
  method?: 'GET' | 'HEAD';
}

type HttpOk =
  | { ok: true; kind: 'json'; json: unknown }
  | { ok: true; kind: 'text'; text: string }
  | { ok: true; kind: 'bytes'; bytes: Uint8Array };

type HttpFail = { ok: false; error: SourceError };

type HttpKind = HttpOk['kind'];

/** The success arm is narrowed to the shape that actually carries the payload. */
export type HttpResult<K extends HttpKind> = Extract<HttpOk, { kind: K }> | HttpFail;

function classify(status: number, retryAfter: string | null): SourceErrorCode {
  if (status === 429) return 'rate_limited';
  if (status === 401 || status === 403) return 'auth_required';
  return 'http_status';
}

function retryDelayMs(attempt: number, retryAfterHeader: string | null): number {
  if (retryAfterHeader) {
    const seconds = Number(retryAfterHeader);
    if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, 20_000);
  }
  // 400ms, 1.2s, 2.8s ... capped, with jitter so parallel cron rows do not sync up.
  const base = Math.min(400 * 2 ** attempt, 8_000);
  return base + Math.floor(Math.random() * 250);
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Bounded read so a changed upstream file cannot exhaust server memory. */
async function readCapped(res: Response, maxBytes: number): Promise<Uint8Array | null> {
  const declared = Number(res.headers.get('content-length') ?? '0');
  if (declared && declared > maxBytes) return null;
  if (!res.body) {
    const buf = await res.arrayBuffer();
    return buf.byteLength > maxBytes ? null : new Uint8Array(buf);
  }
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out;
}

async function attempt(
  url: string,
  wanted: 'json' | 'text' | 'bytes',
  options: HttpOptions,
): Promise<HttpOk | { retry: true; error: SourceError } | { retry: false; error: SourceError }> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      method: options.method ?? 'GET',
      redirect: 'follow',
      signal: controller.signal,
      headers: { 'user-agent': USER_AGENT, accept: wanted === 'bytes' ? '*/*' : wanted, ...options.headers },
    });

    const retryAfter = res.headers.get('retry-after');

    if (!res.ok) {
      const code = classify(res.status, retryAfter);
      const error: SourceError = {
        code,
        // Status only. The upstream body can be an HTML error page or contain
        // request details, and none of it helps a farmer.
        message: `Upstream responded ${res.status}`,
        status: res.status,
        retryAfterSeconds: retryAfter ? Number(retryAfter) || undefined : undefined,
      };
      // 5xx and rate limits are worth another try; 4xx other than 429 are not.
      const worthRetrying = res.status === 429 || res.status === 503 || res.status >= 500;
      return { retry: worthRetrying, error };
    }

    const bytes = await readCapped(res, maxBytes);
    if (!bytes) {
      return { retry: false, error: { code: 'payload_too_large', message: `Upstream payload exceeded ${maxBytes} bytes` } };
    }

    if (wanted === 'bytes') return { ok: true, kind: 'bytes', bytes };
    const text = new TextDecoder('utf-8').decode(bytes);
    if (wanted === 'text') return { ok: true, kind: 'text', text };
    try {
      return { ok: true, kind: 'json', json: JSON.parse(text) };
    } catch {
      return { retry: false, error: { code: 'parse_failed', message: 'Upstream response is not valid JSON' } };
    }
  } catch (err) {
    const aborted = err instanceof Error && (err.name === 'AbortError' || err.name === 'TimeoutError');
    const error: SourceError = {
      code: aborted ? 'timeout' : 'network',
      // Node surfaces DNS/TLS detail in `message`; keep the shape, drop the host
      // so logs and API responses stay free of internal topology.
      message: aborted ? `Request timed out after ${timeoutMs}ms` : 'Could not reach the upstream host',
    };
    return { retry: true, error };
  } finally {
    clearTimeout(timer);
  }
}

async function request<K extends HttpKind>(url: string, wanted: K, options: HttpOptions): Promise<HttpResult<K>> {
  const retries = options.retries ?? DEFAULT_RETRIES;
  let last: SourceError = { code: 'network', message: 'Request did not complete' };

  for (let attemptIndex = 0; attemptIndex <= retries; attemptIndex += 1) {
    const outcome = await attempt(url, wanted, options);
    // `attempt` only ever produces the payload arm it was asked for.
    if ('ok' in outcome && outcome.ok) return outcome as Extract<HttpOk, { kind: K }>;
    last = (outcome as { error: SourceError }).error;
    const shouldRetry = (outcome as { retry?: boolean }).retry === true;
    if (!shouldRetry || attemptIndex === retries) break;
    await sleep(retryDelayMs(attemptIndex, last.retryAfterSeconds ? String(last.retryAfterSeconds) : null));
  }

  return { ok: false, error: last };
}

export const httpJson = (url: string, o: HttpOptions = {}) => request(url, 'json', o);
export const httpText = (url: string, o: HttpOptions = {}) => request(url, 'text', o);
export const httpBytes = (url: string, o: HttpOptions = {}) => request(url, 'bytes', o);
