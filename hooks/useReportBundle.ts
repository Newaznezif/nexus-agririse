'use client';
import { useCallback, useRef, useState } from 'react';

import { getSupabase, isSupabaseConfigured } from '@/lib/supabaseClient';
import { buildReportQuery, type ReportQueryInput } from '@/lib/report/request';
import type { ReportBundle } from '@/lib/report/types';

/**
 * Requests one report bundle from `/api/report/insight-data`, on the farmer's behalf.
 *
 * Why not `useLiveData`: that hook sends no `Authorization` header, and this route refuses every
 * unauthenticated caller — the cover identity has to come from a token Auth confirmed. So this
 * hook does one extra thing: it reads the caller's own session before fetching, and hands the
 * route nothing else.
 *
 * - It fetches only when asked. A report is a request to nine live sources; a page view is not one.
 * - It keeps the whole bundle. Provenance lives inside every table, chart and register entry, so
 *   there is nothing to reassemble and nothing to strip.
 * - A new request abandons the previous one, so a second click cannot land an older bundle on top
 *   of a newer one. The bundle being replaced stays visible until the answer arrives, because
 *   "no data" and "still reading" are different statements.
 */

export interface ReportFetchError {
  code: string;
  message: string;
}

interface ReportEnvelope {
  ok?: boolean;
  data?: ReportBundle | null;
  error?: { code?: string; message?: string } | null;
}

export interface ReportBundleState {
  loading: boolean;
  error: ReportFetchError | null;
  bundle: ReportBundle | null;
  /** The query string of the bundle currently held, so the panel can echo the scope it describes. */
  queriedAs: string | null;
  /** When this browser received the answer — distinct from the bundle's own `generatedAt`. */
  receivedAt: string | null;
  request: (input: ReportQueryInput) => void;
  reload: () => void;
  clear: () => void;
}

export function useReportBundle(): ReportBundleState {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<ReportFetchError | null>(null);
  const [bundle, setBundle] = useState<ReportBundle | null>(null);
  const [queriedAs, setQueriedAs] = useState<string | null>(null);
  const [receivedAt, setReceivedAt] = useState<string | null>(null);

  const controllerRef = useRef<AbortController | null>(null);
  const lastQueryRef = useRef<string | null>(null);

  const run = useCallback(async (query: string) => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    lastQueryRef.current = query;

    setError(null);
    setLoading(true);

    // A request that never reaches a publisher still has to end the loading state honestly.
    function finish(failure: ReportFetchError) {
      setBundle(null);
      setQueriedAs(null);
      setReceivedAt(null);
      setError(failure);
      setLoading(false);
    }

    if (!isSupabaseConfigured()) {
      finish({
        code: 'not_configured',
        message: 'This deployment has no Supabase configuration, so no caller can be verified and no report can be built.',
      });
      return;
    }

    let token: string | null = null;
    try {
      const { data } = await getSupabase().auth.getSession();
      token = data.session?.access_token ?? null;
    } catch {
      token = null;
    }

    // The route answers 401 without a token. Saying so here keeps the reason accurate — an
    // unsigned-in farmer's report is not a data gap, and must not be shown as one.
    if (!token) {
      finish({ code: 'auth_required', message: 'Sign in to build a report: the route answers only a caller whose token Supabase Auth has confirmed.' });
      return;
    }

    try {
      const response = await fetch(`/api/report/insight-data?${query}`, {
        signal: controller.signal,
        headers: { accept: 'application/json', Authorization: `Bearer ${token}` },
        cache: 'no-store',
      });

      let body: ReportEnvelope | null = null;
      try {
        body = (await response.json()) as ReportEnvelope;
      } catch {
        body = null;
      }
      if (controller.signal.aborted) return;

      if (body?.ok && body.data) {
        setBundle(body.data);
        setQueriedAs(query);
        setReceivedAt(new Date().toISOString());
        setError(null);
        return;
      }

      setBundle(null);
      setQueriedAs(null);
      setReceivedAt(null);
      setError(
        body?.error?.code
          ? { code: body.error.code, message: body.error.message ?? 'The report route returned no reason.' }
          : { code: 'http_status', message: `The report route returned ${response.status} without a readable answer.` },
      );
    } catch (err) {
      if (controller.signal.aborted || (err instanceof Error && err.name === 'AbortError')) return;
      setBundle(null);
      setQueriedAs(null);
      setReceivedAt(null);
      setError({ code: 'network', message: 'Could not reach the report route. The publishers were not read.' });
    } finally {
      if (controllerRef.current === controller) {
        controllerRef.current = null;
        setLoading(false);
      }
    }
  }, []);

  const request = useCallback((input: ReportQueryInput) => void run(buildReportQuery(input)), [run]);
  const reload = useCallback(() => {
    const query = lastQueryRef.current;
    if (query !== null) void run(query);
  }, [run]);

  const clear = useCallback(() => {
    controllerRef.current?.abort();
    lastQueryRef.current = null;
    setBundle(null);
    setQueriedAs(null);
    setReceivedAt(null);
    setError(null);
    setLoading(false);
  }, []);

  return { loading, error, bundle, queriedAs, receivedAt, request, reload, clear };
}
