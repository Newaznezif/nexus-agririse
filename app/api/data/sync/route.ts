import { NextResponse } from 'next/server';

import { errorResponse } from '@/lib/data/api';
import { runSync, GATED_SYNC_TASKS, SYNC_TASK_KEYS, type SyncTaskKey } from '@/lib/data/sync';

/**
 * POST /api/data/sync
 *
 * Runs the publisher → database sync. This is the only data route that WRITES, which is why
 * it is the only one that is guarded: the open-data GET routes need no session because they
 * expose nothing but published figures, whereas this one needs the database service-role key
 * and would, if unauthenticated, let any visitor drive the pipeline and its upstream quota.
 *
 * Authorization is a single shared secret presented in the `authorization` header, compared
 * in constant time. A cron scheduler (GitHub Actions, Vercel Cron, systemd timer, or a human
 * with curl) holds it; nothing else does. The secret is never echoed, logged, or stored.
 *
 * Overlap is handled inside `runSync`: a second concurrent call gets `skipped_overlap` and
 * writes nothing, so a slow run and a scheduled tick cannot double-hammer a publisher.
 */

/**
 * 401 here, not the 502 that `errorResponse` maps `auth_required` to: that code exists for
 * an UPSTREAM publisher needing credentials we do not have. This is the caller's own
 * credential missing, which a scheduler must not retry as if the network were at fault.
 */
function unauthorized(message: string): NextResponse {
  return NextResponse.json({ ok: false, error: { code: 'auth_required', message }, provenance: null }, {
    status: 401,
    headers: { 'cache-control': 'no-store', 'www-authenticate': 'Bearer' },
  });
}

/** Constant-time comparison of equal-length secrets; unequal length fails immediately. */
function matchesSecret(candidate: string, expected: string): boolean {
  if (candidate.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i += 1) {
    diff |= candidate.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return diff === 0;
}

export async function POST(request: Request): Promise<NextResponse> {
  const expected = process.env.SYNC_SECRET;
  if (!expected || expected.length < 16) {
    // Refusing to run because the operator has not set a secret is safer than defaulting to
    // "no secret means allow".
    return unauthorized('SYNC_SECRET is not configured on this server, so the sync endpoint is disabled.');
  }

  const header = request.headers.get('authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!token || !matchesSecret(token, expected)) {
    // Same shape and same status as any other rejection: no hint about which half matched.
    return unauthorized('A valid bearer token is required to run the data sync.');
  }

  let selected: SyncTaskKey[] | undefined;
  try {
    const body = (await request.json().catch(() => ({}))) as { tasks?: unknown };
    if (Array.isArray(body.tasks) && body.tasks.length > 0) {
      const keys = body.tasks.filter((t): t is SyncTaskKey => typeof t === 'string' && (SYNC_TASK_KEYS as readonly string[]).includes(t));
      if (keys.length !== body.tasks.length) {
        return errorResponse({ code: 'bad_input', message: `Unknown task. Available: ${SYNC_TASK_KEYS.join(', ')}` });
      }
      selected = keys;
    }
  } catch {
    return errorResponse({ code: 'bad_input', message: 'Body must be JSON, e.g. {"tasks":["market-prices"]}' });
  }

  const report = await runSync(selected);

  // 200 when work happened, 202 when a lease told us to stand down, 502 when the database
  // could not be reached at all. A scheduler that retries on 5xx will not retry a skipped run.
  const status = report.blocked?.startsWith('skipped_overlap') ? 202 : report.blocked ? 502 : 200;

  return NextResponse.json({ ok: status === 200 || status === 202, ...report }, {
    status,
    // Never cacheable, and never a body an edge could replay.
    headers: { 'cache-control': 'no-store' },
  });
}

/** A health-style read for the scheduler's own logs: what ran, without touching anything. */
export async function GET(): Promise<NextResponse> {
  return NextResponse.json(
    {
      ok: true,
      data: {
        method: 'POST',
        tasks: [...SYNC_TASK_KEYS],
        // Tasks that exist in code but are held back until a proposed migration is applied.
        // Naming them here means an operator can tell "not scheduled" apart from "waiting on
        // a table", without running a write to find out.
        gated: GATED_SYNC_TASKS.map((t) => ({ task: t.key, requiresTable: `data.${t.table}` })),
        lease_key: 'nexus-data-sync',
        configured: Boolean(process.env.SYNC_SECRET) && Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
      },
      provenance: null,
    },
    { status: 200, headers: { 'cache-control': 'no-store' } },
  );
}
