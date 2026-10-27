'use client';
import { useCallback, useEffect, useRef, useState } from 'react';

import type { ProvenanceView, SourceErrorView } from '@/components/data/ProvenanceLabel';

/**
 * Fetches one of the `/api/data/*` routes with cancellation, so a fast location
 * change cannot leave an older response landing after a newer one.
 *
 * The route's own `{ ok, data, provenance }` envelope is kept intact: a failed
 * source stays visible as an error plus its provenance, which is what lets the UI
 * say "WFP unreachable" instead of showing nothing or a placeholder number.
 */
export interface DataEnvelope<T, P = ProvenanceView> {
  ok: boolean;
  data: T | null;
  provenance: P | null;
  error: SourceErrorView | null;
}

interface Snapshot<T, P, Extra> {
  path: string;
  /** Identifies which request produced this snapshot, for the pending derivation below. */
  stamp: number;
  data: T | null;
  provenance: P | null;
  extra: Extra | null;
  error: SourceErrorView | null;
  fetchedAt: string;
}

export interface LiveDataState<T, P = ProvenanceView, Extra = unknown> {
  /** True while there is nothing to show for the current request. */
  loading: boolean;
  /** True while a newer request for data we already hold is in flight. */
  refreshing: boolean;
  data: T | null;
  provenance: P | null;
  error: SourceErrorView | null;
  /**
   * Any additional top-level fields the route returned. `/api/data/exchange` answers
   * with one provenance and one error per category, which a single `provenance` slot
   * cannot carry, so the rest of the body is kept rather than dropped.
   */
  extra: Extra | null;
  fetchedAt: string | null;
  reload: () => void;
}

const RESERVED = new Set(['ok', 'data', 'provenance', 'error']);

export function useLiveData<T, P = ProvenanceView, Extra = Record<string, never>>(path: string | null) {
  const [snapshot, setSnapshot] = useState<Snapshot<T, P, Extra> | null>(null);
  // Bumped by `reload`; part of the request identity so the pending state can be
  // derived during render instead of being set synchronously inside an effect.
  const [attempt, setAttempt] = useState(0);
  const controllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (path === null) return;
    const controller = new AbortController();
    controllerRef.current = controller;

    async function run() {
      try {
        const res = await fetch(path as string, { signal: controller.signal, headers: { accept: 'application/json' } });
        const body = (await res.json()) as DataEnvelope<T, P> & Record<string, unknown>;
        if (controller.signal.aborted) return;

        const rest: Record<string, unknown> = {};
        for (const key of Object.keys(body)) if (!RESERVED.has(key)) rest[key] = body[key];

        setSnapshot({
          path: path as string,
          stamp: attempt,
          data: body.data,
          provenance: body.provenance ?? null,
          extra: rest as unknown as Extra,
          error: body.ok ? null : body.error ?? { code: 'http_status', message: `Request failed (${res.status})` },
          fetchedAt: new Date().toISOString(),
        });
      } catch (err) {
        if (controller.signal.aborted || (err instanceof Error && err.name === 'AbortError')) return;
        setSnapshot({
          path: path as string,
          stamp: attempt,
          data: null,
          provenance: null,
          extra: null,
          error: { code: 'network', message: 'Could not reach this service' },
          fetchedAt: new Date().toISOString(),
        });
      }
    }

    void run();
    return () => controller.abort();
  }, [path, attempt]);

  const reload = useCallback(() => setAttempt((n) => n + 1), []);

  const forThisRequest = snapshot !== null && snapshot.path === path && snapshot.stamp === attempt;
  const hasCurrentData = snapshot !== null && snapshot.path === path;

  return {
    loading: path !== null && !forThisRequest && !hasCurrentData,
    refreshing: path !== null && !forThisRequest && hasCurrentData,
    data: hasCurrentData ? snapshot!.data : null,
    provenance: hasCurrentData ? snapshot!.provenance : null,
    error: snapshot && snapshot.path === path ? snapshot.error : null,
    extra: hasCurrentData ? snapshot!.extra : null,
    fetchedAt: hasCurrentData ? snapshot!.fetchedAt : null,
    reload,
  } satisfies LiveDataState<T, P, Extra>;
}
