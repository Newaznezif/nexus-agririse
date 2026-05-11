import { GoogleGenerativeAI } from "@google/generative-ai";
import { getAgribusinessPrompt } from './prompts';
import { AIInsightResponse } from '@/types/ai';

export const generateAgribusinessInsight = async (dataset: any[]): Promise<AIInsightResponse> => {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is missing. Please add it to .env.local');
  }

  // Initialize SDK
  const genAI = new GoogleGenerativeAI(apiKey);
  
  // Try gemini-1.5-flash-latest first as it's the most stable free tier model
  const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash-latest" });

  if (!dataset || dataset.length === 0) {
    throw new Error('Dataset is required');
  }

  // Limit to first 50 rows
  const limitedDataset = dataset.slice(0, 50);
  const datasetJSON = JSON.stringify(limitedDataset);
  const prompt = getAgribusinessPrompt(datasetJSON);

  try {
    // Basic call without complex generationConfig to ensure compatibility
    const result = await model.generateContent(prompt);
    const response = await result.response;
    const content = response.text();
    
    if (!content) {
      throw new Error('Empty response from AI');
    }

    // Clean and parse the JSON response
    // AI often wraps it in ```json ... ```
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    const jsonString = jsonMatch ? jsonMatch[0] : content;
    
    const parsedResponse = JSON.parse(jsonString) as AIInsightResponse;

    // Validate structure
    if (!parsedResponse.marketSummary || !parsedResponse.riskLevel || !parsedResponse.priceTrend) {
      throw new Error('AI response missing required fields');
    }

    return parsedResponse;
  } catch (error: any) {
    console.error('Gemini analysis failed:', error.message);
    
    // If it's a model not found error, try one last fallback to the legacy name
    if (error.message.includes('404') || error.message.includes('not found')) {
       try {
         const fallbackModel = genAI.getGenerativeModel({ model: "gemini-pro" });
         const result = await fallbackModel.generateContent(prompt);
         const content = (await result.response).text();
         const jsonMatch = content.match(/\{[\s\S]*\}/);
         return JSON.parse(jsonMatch ? jsonMatch[0] : content) as AIInsightResponse;
       } catch (fallbackError) {
         console.error('Fallback also failed:', fallbackError);
       }
    }
    
    throw new Error('AI analysis failed');
  }
};
