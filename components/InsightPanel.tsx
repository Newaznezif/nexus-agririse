"use client";
import { useState } from "react";

export const InsightPanel = () => {
  // Toggle this to test states
  const [hasData, setHasData] = useState(true); 

  // Placeholder hook: fetchInsights()

  return (
    <div className="bg-white dark:bg-zinc-900 p-6 rounded-xl border border-gray-100 dark:border-zinc-800 shadow-sm flex flex-col h-full">
      <h3 className="font-semibold text-lg mb-6 border-b pb-2 border-gray-100 dark:border-zinc-800">AI Agribusiness Insights</h3>
      
      {!hasData ? (
        <div className="flex-1 flex items-center justify-center min-h-[200px]">
          <p className="text-gray-400 italic text-sm">Upload a dataset to generate AI insights</p>
        </div>
      ) : (
        <div className="space-y-6 flex-1 flex flex-col justify-center">
          <div className="bg-gray-50 dark:bg-zinc-950 p-4 rounded-lg border border-gray-100 dark:border-zinc-800">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-2">Market Summary</h4>
            <p className="text-sm text-gray-700 dark:text-gray-300">
              Maize prices are projected to rise by 12% in the next quarter due to delayed rainfall in key regions. Consider stockpiling inventory.
            </p>
          </div>
          
          <div className="flex gap-4">
            <div className="flex-1 bg-gray-50 dark:bg-zinc-950 p-4 rounded-lg border border-gray-100 dark:border-zinc-800">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-2">Risk Level</h4>
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400 text-sm font-medium">
                <span className="w-2 h-2 rounded-full bg-yellow-500"></span>
                Medium
              </div>
            </div>
            <div className="flex-1 bg-gray-50 dark:bg-zinc-950 p-4 rounded-lg border border-gray-100 dark:border-zinc-800">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-2">Trend</h4>
              <p className="text-sm font-medium text-emerald-600 dark:text-emerald-400">Stable / Upward</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
