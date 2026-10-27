import { NextResponse } from 'next/server';
import { generateAgribusinessInsight } from '@/services/ai';
import { saveInsight, verifyDatasetOwnership } from '@/services/database';
import { verifyCaller } from '@/lib/serverSupabase';

const MAX_DATASET_ID_LENGTH = 64;

export async function POST(req: Request) {
  // Identity comes from the access token only. Any `userId` in the body is ignored.
  const caller = await verifyCaller(req);
  if (!caller.ok) {
    return NextResponse.json({ error: caller.message, code: caller.code }, { status: caller.status });
  }
  const userId = caller.userId;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: 'Invalid request payload', code: 'invalid_payload' },
      { status: 400 }
    );
  }

  const { dataset, datasetId } = (body ?? {}) as { dataset?: unknown; datasetId?: unknown };

  if (!Array.isArray(dataset) || dataset.length === 0) {
    return NextResponse.json(
      { error: 'Dataset is required' },
      { status: 400 }
    );
  }

  const hasDatasetId = datasetId !== undefined && datasetId !== null;

  if (hasDatasetId && (typeof datasetId !== 'string' || datasetId.length === 0 || datasetId.length > MAX_DATASET_ID_LENGTH)) {
    return NextResponse.json(
      { error: 'Invalid dataset reference', code: 'invalid_payload' },
      { status: 400 }
    );
  }

  // Authorize before the paid provider call, so a reference to another account's
  // dataset cannot spend quota or write into that account's records.
  if (hasDatasetId) {
    const { owned, error } = await verifyDatasetOwnership(datasetId as string, userId);
    if (error) {
      console.error(`Dataset ownership check failed for user ${userId}: ${error}`);
      return NextResponse.json(
        { error: 'Unable to verify dataset access', code: 'db_check_failed' },
        { status: 503 }
      );
    }
    if (!owned) {
      return NextResponse.json(
        { error: 'Dataset not found for this account', code: 'dataset_forbidden' },
        { status: 403 }
      );
    }
  }

  try {
    const aiInsight = await generateAgribusinessInsight(dataset);

    if (hasDatasetId) {
      const { error: dbError } = await saveInsight({
        userId,
        datasetId: datasetId as string,
        summary: aiInsight.marketSummary,
        riskLevel: aiInsight.riskLevel,
        trend: aiInsight.priceTrend
      });

      // A persisted-record failure is reported, not hidden: the insight would
      // otherwise disappear from the dashboard while the UI claims success.
      if (dbError) {
        console.error(`Insight save failed for user ${userId}: ${dbError}`);
        return NextResponse.json(
          { error: 'Analysis could not be saved to your account', code: 'db_save_failed' },
          { status: 500 }
        );
      }
    }

    return NextResponse.json(aiInsight, { status: 200 });

  } catch (error: any) {
    console.error(`POST /api/analyze error: ${error?.message ?? 'unknown'}`);
    return NextResponse.json(
      { error: 'AI analysis failed', code: 'analysis_failed' },
      { status: 500 }
    );
  }
}
