import { NextResponse } from 'next/server';

import { badRequest, errorResponse } from '@/lib/data/api';
import { buildReportBundle } from '@/lib/report/buildReportBundle';
import { parseReportQuery } from '@/lib/report/request';
import type { ReportRequest } from '@/lib/report/types';
import { verifyCaller } from '@/lib/serverSupabase';

/**
 * GET /api/report/insight-data
 *
 * The read-only face of the report orchestrator: it hands the AI Insight report exactly the
 * evidence the dashboard already shows, with provenance attached, and nothing else.
 *
 * - Read-only. It writes no record and runs no sync, so a report can never alter the data it
 *   describes.
 * - Authenticated. A bundle is assembled per request for one caller, so it is `private, no-store`
 *   rather than CDN-cacheable: one farmer's report must not be served from a shared cache to
 *   another.
 * - Key-free by construction. The connectors it calls need no credentials, and the only secret
 *   this route ever sees is the caller's own access token, which is verified and discarded. The
 *   Gemini key stays in `services/ai.ts` on the server; nothing here forwards it.
 */
export async function GET(request: Request): Promise<NextResponse> {
  const caller = await verifyCaller(request);
  if (!caller.ok) {
    return NextResponse.json(
      { ok: false, data: null, provenance: null, error: { code: 'auth_required', message: caller.message } },
      { status: caller.status, headers: { 'cache-control': 'private, no-store' } },
    );
  }

  // One validator for the browser and the route: whatever the panel can build a query from, this
  // route accepts with identical rules and identical refusal messages.
  const parsed = parseReportQuery(new URL(request.url).search);
  if (!parsed.ok) return badRequest(parsed.message);

  const built = await buildReportBundle({
    ...parsed.given,
    // Identity comes from the confirmed token only. Nothing in the query string can name the
    // report's author, so a caller cannot put another account's name on a cover.
    caller: { displayName: caller.email },
  } satisfies ReportRequest);
  if (!built.ok) return errorResponse(built.error);

  return NextResponse.json(
    { ok: true, data: built.bundle, provenance: null, error: null },
    { status: 200, headers: { 'cache-control': 'private, no-store' } },
  );
}
