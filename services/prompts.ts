export const getAgribusinessPrompt = (datasetJSON: string) => {
  return `You are a professional African agribusiness intelligence analyst specializing in regional trade, agricultural economics, and market forecasting.

Analyze the following agricultural dataset and generate structured insights.

Dataset (first 50 rows max):
${datasetJSON}

Focus your analysis on:
- crop pricing
- market trends
- regional trade opportunity
- supply risk
- cross-border potential

Output your response strictly as valid JSON matching this schema exactly, with NO markdown formatting, NO code blocks, and NO additional text:
{
  "marketSummary": "Concise, professional summary of the market conditions based on the data",
  "riskLevel": "Low", // Must be exactly "Low", "Medium", or "High"
  "priceTrend": "Concise analysis of pricing trends",
  "crossBorderOpportunity": "Concise analysis of cross-border trade potential"
}`;
};
