export interface AIInsightResponse {
  marketSummary: string;
  riskLevel: "Low" | "Medium" | "High";
  priceTrend: string;
  crossBorderOpportunity: string;
}
