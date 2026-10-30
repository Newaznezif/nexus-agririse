'use client';
import { useCallback, useEffect, useRef, useState } from 'react';

import type { ProvenanceView, SourceErrorView } from '@/components/data/ProvenanceLabel';

/**
 * Fetches a changing set of `/api/data/*` paths for the map’s layers.
 *
 * `useLiveData` handles one path; the map has a dozen layers that are toggled, panned
 * and re-extented, so the number of live requests is not fixed and a hook per layer is
 * not possible. Same contract as `useLiveData`: a cancelled response never lands, a
 * failed source stays visible as an error instead of becoming an empty layer, and every
 * answer keeps its own provenance so the UI can name the provider and its timestamps.
 *
 * Answers are stored by path. Panning snaps the view onto the server’s 0.25° cache grid,
 * so returning to a previous extent reuses it instead of re-downloading the outline.
 */
export interface LayerEnvelope<T> {
  ok: boolean;
  data: T | null;
  provenance: ProvenanceView | null;
  error: SourceErrorView | null;
}

export interface LayerSlot<T> {
  /** Nothing has come back for this layer yet. */
  loading: boolean;
  /** This layer answered for a different extent and a newer one is in flight. */
  refreshing: boolean;
  data: T | null;
  provenance: ProvenanceView | null;
  error: SourceErrorView | null;
  /** When this layer last answered, so a stale panel can say so. */
  answeredAt: string | null;
}

interface Stored {
  key: string;
  data: unknown | null;
  provenance: ProvenanceView | null;
  error: SourceErrorView | null;
  answeredAt: string;
}

/** Bounded so a long pan session cannot grow the map’s memory without limit. */
const MAX_STORED = 48;

/**
 * Drops the oldest answers that are not on screen any more. Paths the current request set
 * still names are never dropped, however old they are: an evicted answer with no request in
 * flight would leave that layer showing "reading…" forever, because the fetch effect only
 * restarts when the set of paths changes.
 */
function trim(entries: Record<string, Stored>, wanted: Set<string>): Record<string, Stored> {
  const keys = Object.keys(entries);
  if (keys.length <= MAX_STORED) return entries;
  const droppable = keys
    .filter((key) => !wanted.has(key))
    .sort((a, b) => (entries[b].answeredAt > entries[a].answeredAt ? 1 : -1));
  const keep = new Set([...keys].filter((key) => wanted.has(key)).concat(droppable.slice(0, Math.max(0, MAX_STORED - wanted.size))));
  const next: Record<string, Stored> = {};
  for (const key of keep) next[key] = entries[key];
  return next;
}

export function useVectorLayers<T>(requests: { key: string; path: string | null }[]): (LayerSlot<T> | null)[] {
  const [stored, setStored] = useState<Record<string, Stored>>({});
  const storedRef = useRef<Record<string, Stored>>({});
  const inflight = useRef(new Map<string, AbortController>());
  const requestsRef = useRef(requests);
  const signature = requests.map((r) => `${r.key}=${r.path ?? ''}`).join('|');

  // Kept in a ref rather than an effect dependency: the array identity changes on every
  // render, while only a change in the actual set of paths should restart work.
  useEffect(() => {
    requestsRef.current = requests;
  });

  const remember = useCallback((path: string, key: string, value: Omit<Stored, 'key' | 'answeredAt'>) => {
    const wanted = new Set(requestsRef.current.map((r) => r.path).filter((p): p is string => Boolean(p)));
    const merged = trim({ ...storedRef.current, [path]: { key, answeredAt: new Date().toISOString(), ...value } }, wanted);
    storedRef.current = merged;
    setStored(merged);
  }, []);

  useEffect(() => {
    const wanted = new Set<string>();

    for (const request of requestsRef.current) {
      const path = request.path;
      if (!path || storedRef.current[path] || inflight.current.has(path)) continue;
      const controller = new AbortController();
      inflight.current.set(path, controller);
      void (async () => {
        try {
          const res = await fetch(path, { signal: controller.signal, headers: { accept: 'application/json' } });
          const body = (await res.json()) as LayerEnvelope<T>;
          if (controller.signal.aborted) return;
          remember(path, request.key, {
            data: body.data,
            provenance: body.provenance ?? null,
            // A 200 with ok:false still carries the provider's own reason, so keep it.
            error: body.ok ? null : (body.error ?? { code: 'http_status', message: `Request failed (${res.status})` }),
          });
        } catch (err) {
          if (controller.signal.aborted || (err instanceof Error && err.name === 'AbortError')) return;
          remember(path, request.key, {
            data: null,
            provenance: null,
            error: { code: 'network', message: 'Could not reach this service' },
          });
        } finally {
          inflight.current.delete(path);
        }
      })();
    }

    for (const request of requestsRef.current) if (request.path) wanted.add(request.path);
    for (const [path, controller] of [...inflight.current.entries()]) {
      if (!wanted.has(path)) {
        controller.abort();
        inflight.current.delete(path);
      }
    }
  }, [signature, remember]);

  useEffect(() => {
    const controllers = inflight.current;
    return () => {
      for (const controller of controllers.values()) controller.abort();
      controllers.clear();
    };
  }, []);

  return requests.map((request) => {
    const path = request.path;
    if (!path) return null;

    const exact = stored[path];
    if (exact) {
      return {
        loading: false,
        refreshing: false,
        data: exact.data as T | null,
        provenance: exact.provenance,
        error: exact.error,
        answeredAt: exact.answeredAt,
      } satisfies LayerSlot<T>;
    }

    // A newer extent is in flight. The previous extent is deliberately not drawn in its
    // place: outlines for one view presented as outlines for another would be a lie about
    // coverage, so the layer shows as updating instead.
    let newest: Stored | null = null;
    for (const entry of Object.values(stored)) {
      if (entry.key !== request.key) continue;
      if (newest === null || entry.answeredAt > newest.answeredAt) newest = entry;
    }

    return {
      loading: newest === null,
      refreshing: newest !== null,
      data: null,
      provenance: null,
      error: null,
      answeredAt: newest?.answeredAt ?? null,
    } satisfies LayerSlot<T>;
  });
}
