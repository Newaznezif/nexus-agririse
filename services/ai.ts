import OpenAI from 'openai';
import { getAgribusinessPrompt } from './prompts';
import { AIInsightResponse } from '@/types/ai';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY || 'dummy_key_for_build',
});

export const generateAgribusinessInsight = async (dataset: any[]): Promise<AIInsightResponse> => {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY is missing');
  }

  if (!dataset || dataset.length === 0) {
    throw new Error('Dataset is required');
  }

  // Limit to first 50 rows to prevent token overload
  const limitedDataset = dataset.slice(0, 50);
  const datasetJSON = JSON.stringify(limitedDataset);

  const prompt = getAgribusinessPrompt(datasetJSON);

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini', // or gpt-3.5-turbo / gpt-4
      messages: [
        {
          role: 'system',
          content: 'You are a strict JSON-only API. You output raw JSON without markdown or code blocks.'
        },
        {
          role: 'user',
          content: prompt
        }
      ],
      temperature: 0.2,
      response_format: { type: 'json_object' }
    });

    const content = response.choices[0]?.message?.content;
    
    if (!content) {
      throw new Error('Empty response from AI');
    }

    const parsedResponse = JSON.parse(content) as AIInsightResponse;

    // Validate structure
    if (!parsedResponse.marketSummary || !parsedResponse.riskLevel || !parsedResponse.priceTrend || !parsedResponse.crossBorderOpportunity) {
      throw new Error('AI response missing required fields');
    }

    if (!['Low', 'Medium', 'High'].includes(parsedResponse.riskLevel)) {
      throw new Error('Invalid riskLevel from AI response');
    }

    return parsedResponse;
  } catch (error: any) {
    console.error('AI analysis failed:', error.message);
    throw new Error('AI analysis failed');
  }
};
