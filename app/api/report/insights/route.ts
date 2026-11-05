import { NextResponse } from 'next/server';

import { badRequest, errorResponse } from '@/lib/data/api';
import { buildReportBundle } from '@/lib/report/buildReportBundle';
import { generateGroundedFindings, type FindingsFailure, type FindingsFailureCode } from '@/lib/report/generateFindings';
import { buildInsightsPayload } from '@/lib/report/findings';
import { parseReportQuery } from '@/lib/report/request';
import type { ReportRequest } from '@/lib/report/types';
import { verifyCaller } from '@/lib/serverSupabase';

/**
 * POST /api/report/insights
 *
 * The interpretation layer, and the one route in this workflow that spends a provider call.
 *
 * - Authenticated before the paid call, in the order `/api/analyze` established: a refusal costs
 *   nothing, a generated sentence costs money, and only a confirmed token decides which of those
 *   happens.
 * - The evidence is re-read on the server. The caller sends a *scope*, never facts, so a request
 *   cannot smuggle its own "evidence" into a report about somebody else's market.
 * - Findings are validated against the package that was actually sent to the model
 *   (`lib/report/findings.ts`). Sentences that fail are returned as rejections with their reason;
 *   they are not rewritten, and nothing replaces them.
 * - `private, no-store` on every response, including failures: the payload names a caller's scope.
 */

const NO_STORE = { 'cache-control': 'private, no-store' };

/** The body is a scope in the same encoding the panel already builds for GET; nothing else is read. */
const MAX_BODY = 2000;

const STATUS_BY_FAILURE: Record<FindingsFailureCode, number> = {
  not_configured: 503,
  no_evidence: 422,
  timeout: 504,
  blocked: 503,
  provider_error: 503,
  empty: 503,
  malformed: 502,
};

export async function POST(request: Request): Promise<NextResponse> {
  const caller = await verifyCaller(request);
  if (!caller.ok) {
    return NextResponse.json(
      { ok: false, data: null, error: { code: 'auth_required', message: caller.message } },
      { status: caller.status, headers: NO_STORE },
    );
  }

  const contentType = request.headers.get('content-type') ?? '';
  if (!contentType.includes('application/x-www-form-urlencoded')) {
    return refuse({ code: 'bad_input', message: 'Send the scope as an application/x-www-form-urlencoded body, the same fields the report query uses.' }, 400);
  }
  const body = await request.text();
  if (body.length > MAX_BODY) {
    return refuse({ code: 'bad_input', message: 'The scope description is too long.' }, 400);
  }
  // Same validator, same refusals, same defaults as the read-only route it mirrors.
  const parsed = parseReportQuery(body);
  if (!parsed.ok) return noStore(badRequest(parsed.message));

  const built = await buildReportBundle({
    ...parsed.given,
    // Identity from the confirmed token only; the body cannot name the author of a report.
    caller: { displayName: caller.email },
  } satisfies ReportRequest);
  if (!built.ok) return noStore(errorResponse(built.error));

  const outcome = await generateGroundedFindings(built.bundle);
  if (!outcome.ok) return refuse(outcome.failure, STATUS_BY_FAILURE[outcome.failure.code]);

  return NextResponse.json(
    {
      ok: true,
      data: buildInsightsPayload(outcome.package, outcome.findings, outcome.model),
      error: null,
    },
    { status: 200, headers: NO_STORE },
  );
}

function refuse(failure: { code: FindingsFailure['code'] | 'bad_input'; message: string }, status: number): NextResponse {
  return NextResponse.json({ ok: false, data: null, error: failure }, { status, headers: NO_STORE });
}

/** The shared error helpers build the envelope; a caller's scope never belongs in a shared cache. */
function noStore(response: NextResponse): NextResponse {
  response.headers.set('cache-control', 'private, no-store');
  return response;
}
