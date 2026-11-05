'use client';
import { useCallback, useRef, useState } from 'react';

import { getSupabase, isSupabaseConfigured } from '@/lib/supabaseClient';
import { buildReportQuery, type ReportQueryInput } from '@/lib/report/request';
import type { InsightsPayload } from '@/lib/report/findings';

/**
 * Asks `/api/report/insights` for the interpretation of the scope the panel already has.
 *
 * It sends a scope, in the same encoding `useReportBundle` uses for the read, and never the bundle
 * it is holding: the route re-reads the publishers on the server, so what the model sees is what
 * the server found, not what a browser claims. That also means the sentences can name figures from
 * a slightly later read than the table on screen — which is why the payload carries its own
 * `reference` and `generatedAt`, and the panel prints them instead of implying they are the same
 * bundle the farmer clicked.
 *
 * - Only on click. Each request is a paid provider call behind nine live sources.
 * - A new request abandons the previous one; the older answer cannot land on top of the newer.
 * - Failures keep their code, because the honest message differs per code: no key configured,
 *   no evidence to ground a claim, a provider that timed out, and a provider whose every sentence
 *   failed the citation check are four different statements.
 */

export interface InsightFetchError {
  code: string;
  message: string;
}

interface InsightsEnvelope {
  ok?: boolean;
  data?: InsightsPayload | null;
  error?: { code?: string; message?: string } | null;
}

export interface ReportInsightsState {
  loading: boolean;
  error: InsightFetchError | null;
  payload: InsightsPayload | null;
  /** When this browser received the answer — distinct from the payload's own `generatedAt`. */
  receivedAt: string | null;
  request: (input: ReportQueryInput) => void;
  reload: () => void;
  clear: () => void;
}

export function useReportInsights(): ReportInsightsState {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<InsightFetchError | null>(null);
  const [payload, setPayload] = useState<InsightsPayload | null>(null);
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

    function finish(failure: InsightFetchError) {
      setPayload(null);
      setReceivedAt(null);
      setError(failure);
      setLoading(false);
    }

    if (!isSupabaseConfigured()) {
      finish({
        code: 'not_configured',
        message: 'This deployment has no Supabase configuration, so no caller can be verified and no interpretation can be generated.',
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

    if (!token) {
      finish({ code: 'auth_required', message: 'Sign in first: the insights route answers only a caller whose token Supabase Auth has confirmed.' });
      return;
    }

    try {
      const response = await fetch('/api/report/insights', {
        method: 'POST',
        signal: controller.signal,
        headers: {
          accept: 'application/json',
          'content-type': 'application/x-www-form-urlencoded',
          Authorization: `Bearer ${token}`,
        },
        body: query,
        cache: 'no-store',
      });

      let body: InsightsEnvelope | null = null;
      try {
        body = (await response.json()) as InsightsEnvelope;
      } catch {
        body = null;
      }
      if (controller.signal.aborted) return;

      if (body?.ok && body.data) {
        setPayload(body.data);
        setReceivedAt(new Date().toISOString());
        setError(null);
        return;
      }

      finish(
        body?.error?.code
          ? { code: body.error.code, message: body.error.message ?? 'The insights route returned no reason.' }
          : { code: 'http_status', message: `The insights route returned ${response.status} without a readable answer.` },
      );
    } catch {
      if (controller.signal.aborted) return;
      finish({ code: 'network', message: 'Could not reach the insights route. No provider call was completed.' });
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
    setPayload(null);
    setReceivedAt(null);
    setError(null);
    setLoading(false);
  }, []);

  return { loading, error, payload, receivedAt, request, reload, clear };
}
