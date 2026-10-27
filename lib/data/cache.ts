/**
 * Process-local TTL cache with in-flight de-duplication.
 *
 * Two things this buys us: farmers do not pay an upstream round trip on every
 * dashboard open, and two overlapping requests for the same key share one
 * upstream call instead of hammering the publisher. On serverless the map dies
 * with the container, which is why every cached value also carries its own
 * `retrievedAt` — the UI shows the real age either way.
 */

import type { SourceError } from './types';

interface Entry<T> {
  value: T;
  expiresAt: number;
  storedAt: number;
}

const MAX_ENTRIES = 240;
const store = new Map<string, Entry<unknown>>();
const inflight = new Map<string, Promise<CacheOutcome<unknown>>>();

export interface CacheOutcome<T> {
  value: T;
  servedFromCache: boolean;
  /** When the upstream call actually happened. */
  storedAt: number;
}

export interface CacheStats {
  entries: number;
  hits: number;
  misses: number;
  coalesced: number;
}

let hits = 0;
let misses = 0;
let coalesced = 0;

/** Drop the oldest insertions first; keys are never refreshed in place. */
function evictIfNeeded(): void {
  if (store.size <= MAX_ENTRIES) return;
  const oldest = [...store.entries()].sort((a, b) => a[1].storedAt - b[1].storedAt);
  for (const [key] of oldest.slice(0, store.size - MAX_ENTRIES)) store.delete(key);
}

export function cacheGet<T>(key: string): CacheOutcome<T> | null {
  const found = store.get(key);
  if (!found) return null;
  if (found.expiresAt <= Date.now()) {
    store.delete(key);
    return null;
  }
  hits += 1;
  return { value: found.value as T, servedFromCache: true, storedAt: found.storedAt };
}

export function cacheSet<T>(key: string, value: T, ttlSeconds: number): void {
  store.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000, storedAt: Date.now() });
  evictIfNeeded();
}

/**
 * Single-flight wrapper. `ttlSeconds` <= 0 disables caching (used by tests that
 * must prove a connector can reach the live source right now).
 */
export async function cached<T>(key: string, ttlSeconds: number, producer: () => Promise<T>): Promise<CacheOutcome<T>> {
  if (ttlSeconds <= 0) {
    misses += 1;
    return { value: await producer(), servedFromCache: false, storedAt: Date.now() };
  }

  const fresh = cacheGet<T>(key);
  if (fresh) return fresh;

  const running = inflight.get(key) as Promise<CacheOutcome<T>> | undefined;
  if (running) {
    coalesced += 1;
    return running;
  }

  misses += 1;
  const task = (async (): Promise<CacheOutcome<T>> => {
    const value = await producer();
    cacheSet(key, value, ttlSeconds);
    return { value, servedFromCache: false, storedAt: Date.now() };
  })();

  inflight.set(key, task as Promise<CacheOutcome<unknown>>);
  try {
    return await task;
  } finally {
    inflight.delete(key);
  }
}

export function cacheStats(): CacheStats {
  return { entries: store.size, hits, misses, coalesced };
}

/**
 * Discriminated outcome for connector producers. Using `{ ok }` rather than
 * `'error' in value` keeps narrowing exact: a union of differently-shaped
 * success payloads is easy to write and easy for a reader to mis-narrow.
 */
export type FetchOutcome<T> = { ok: true; value: T } | { ok: false; error: SourceError };

export async function cachedFetch<T>(
  key: string,
  ttlSeconds: number,
  producer: () => Promise<FetchOutcome<T>>,
): Promise<CacheOutcome<FetchOutcome<T>>> {
  const outcome = await cached(key, ttlSeconds, producer);
  // A failure is never kept: caching an outage would make a recovered publisher
  // stay invisible for the rest of the TTL. Single-flight still coalesces the
  // concurrent requests that overlapped the failure.
  if (!outcome.value.ok && !outcome.servedFromCache) store.delete(key);
  return outcome;
}

export function cacheClear(): void {
  store.clear();
  inflight.clear();
}
