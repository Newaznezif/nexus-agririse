import { NextResponse } from 'next/server';
import { generateAgribusinessInsight } from '@/services/ai';
import { saveInsight } from '@/services/database';

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { dataset, userId, datasetId } = body;

    if (!dataset || !Array.isArray(dataset) || dataset.length === 0) {
      return NextResponse.json(
        { error: 'Dataset is required' },
        { status: 400 }
      );
    }

    // 1. Generate insight from OpenAI
    const aiInsight = await generateAgribusinessInsight(dataset);

    // 2. Save insight to Supabase (if userId and datasetId are provided)
    if (userId && datasetId) {
      const { error: dbError } = await saveInsight({
        userId,
        datasetId,
        summary: aiInsight.marketSummary,
        riskLevel: aiInsight.riskLevel,
        trend: aiInsight.priceTrend
      });

      if (dbError) {
        console.error('Warning: Failed to save insight to database', dbError);
        // We still return the AI insight even if saving fails
      }
    }

    // 3. Return structured response
    return NextResponse.json(aiInsight, { status: 200 });

  } catch (error: any) {
    console.error('POST /api/analyze error:', error.message);
    
    // Return standard error response
    if (error.message === 'OPENAI_API_KEY is missing' || error.message === 'AI analysis failed') {
      return NextResponse.json(
        { error: 'AI analysis failed' },
        { status: 500 }
      );
    }

    return NextResponse.json(
      { error: 'Invalid request payload or internal error' },
      { status: 500 }
    );
  }
}
