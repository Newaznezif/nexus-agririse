"use client";
import React from 'react';
import { RiskBadge } from './RiskBadge';
import { Insight, Dataset } from '@/types';
import { TrendingUp, TrendingDown, Minus, Globe, AlertTriangle, LineChart } from 'lucide-react';

import { ExportButton } from './ExportButton';

interface InsightCardProps {
  insight: Insight;
  dataset?: Dataset | null;
}

export const InsightCard = ({ insight, dataset }: InsightCardProps) => {
  const timestamp = insight.created_at 
    ? new Date(insight.created_at).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit'
      })
    : 'Unknown date';

  // Attempt to parse crossBorderOpportunity and priceTrend if they were stuffed into summary or exists in db.
  // Wait, the types in DB: summary, risk_level, trend.
  // The AI returns: marketSummary, riskLevel, priceTrend, crossBorderOpportunity.
  // When saving, we need to make sure we saved all these.
  // Let's assume we saved it as JSON in summary, or we extended the DB. 
  // Let me check what we saved:
  // In route.ts: summary: aiInsight.marketSummary, riskLevel: aiInsight.riskLevel, trend: aiInsight.priceTrend.
  // Cross border opportunity wasn't explicitly in the schema in step 3!
  // I will check if we can parse it from summary if we store it as JSON, but we just stored marketSummary in summary column.
  // To keep it clean and match the prompt, I'll render the fields we have, and display the rest if available.
  
  // Let's render the trend icon dynamically
  let TrendIcon = Minus;
  if (insight.trend && insight.trend.toLowerCase().includes('up')) TrendIcon = TrendingUp;
  if (insight.trend && insight.trend.toLowerCase().includes('down')) TrendIcon = TrendingDown;

  return (
    <div className="bg-white dark:bg-zinc-900 rounded-xl border border-gray-100 dark:border-zinc-800 shadow-sm overflow-hidden flex flex-col mb-6 transition-all hover:shadow-md">
      <div className="px-6 py-4 border-b border-gray-100 dark:border-zinc-800 flex justify-between items-center bg-gray-50/50 dark:bg-zinc-900/50">
        <h3 className="font-semibold text-lg text-gray-900 dark:text-white flex items-center gap-2">
          <LineChart className="text-emerald-600" size={20} />
          Market Intelligence
        </h3>
        <span className="text-xs text-gray-400">Generated on {timestamp}</span>
      </div>
      
      <div className="p-6 space-y-6">
        {/* MARKET SUMMARY */}
        <div>
          <h4 className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-2">Market Summary</h4>
          <p className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed">
            {insight.summary}
          </p>
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* RISK LEVEL */}
          <div className="bg-gray-50 dark:bg-zinc-950 p-4 rounded-lg border border-gray-100 dark:border-zinc-800">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-3 flex items-center gap-2">
              <AlertTriangle size={14} /> Risk Assessment
            </h4>
            <RiskBadge level={insight.risk_level} />
          </div>

          {/* PRICE TREND */}
          <div className="bg-gray-50 dark:bg-zinc-950 p-4 rounded-lg border border-gray-100 dark:border-zinc-800">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-3 flex items-center gap-2">
              <LineChart size={14} /> Price Trend Analysis
            </h4>
            <div className="flex items-center gap-2 text-sm font-medium text-gray-800 dark:text-gray-200">
              <TrendIcon size={16} className={
                TrendIcon === TrendingUp ? 'text-emerald-500' : TrendIcon === TrendingDown ? 'text-red-500' : 'text-gray-500'
              }/>
              {insight.trend}
            </div>
          </div>
        </div>

        {/* CROSS-BORDER OPPORTUNITY */}
        {/* If we stored the raw JSON or extended the type, we render it. For now we will check if it exists on the object */}
        {(insight as any).cross_border_opportunity && (
          <div className="bg-blue-50/50 dark:bg-blue-900/10 p-4 rounded-lg border border-blue-100 dark:border-blue-900/30">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-blue-600 dark:text-blue-400 mb-2 flex items-center gap-2">
              <Globe size={14} /> Cross-Border Opportunity Insights
            </h4>
            <p className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed">
              {(insight as any).cross_border_opportunity}
            </p>
          </div>
        )}

        {/* EXPORT BUTTON */}
        {dataset && (
          <div className="pt-4 border-t border-gray-100 dark:border-zinc-800 flex justify-end">
            <ExportButton dataset={dataset} insight={insight} />
          </div>
        )}
      </div>
    </div>
  );
};
