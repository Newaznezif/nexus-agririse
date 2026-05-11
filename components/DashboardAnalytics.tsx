"use client";
import { useDemoMode } from '@/context/DemoModeContext';
import { ComparisonChart } from './ComparisonChart';
import { demoDatasets } from '@/data/demoDatasets';
import { demoInsights } from '@/data/demoInsights';
import { compareCountries } from '@/services/comparison';
import { Globe2, TrendingUp, AlertTriangle, ShieldCheck } from 'lucide-react';

const RISK_CONFIG = {
  Low:    { color: 'bg-emerald-500', label: 'Low Risk',    textColor: 'text-emerald-700 dark:text-emerald-400', bg: 'bg-emerald-50 dark:bg-emerald-900/20' },
  Medium: { color: 'bg-amber-400',   label: 'Medium Risk', textColor: 'text-amber-700 dark:text-amber-400',   bg: 'bg-amber-50 dark:bg-amber-900/20' },
  High:   { color: 'bg-red-500',     label: 'High Risk',   textColor: 'text-red-700 dark:text-red-400',       bg: 'bg-red-50 dark:bg-red-900/20' },
};

export const DashboardAnalytics = () => {
  const { isDemoMode } = useDemoMode();

  if (!isDemoMode) {
    return (
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {[
          { label: 'Market Price Trend', icon: <TrendingUp size={20} className="text-gray-300" /> },
          { label: 'Country Comparison', icon: <Globe2 size={20} className="text-gray-300" /> },
          { label: 'Risk Distribution', icon: <ShieldCheck size={20} className="text-gray-300" /> },
        ].map(({ label, icon }) => (
          <div key={label} className="bg-white dark:bg-zinc-900 rounded-2xl border border-gray-100 dark:border-zinc-800 p-6 h-56 flex flex-col items-center justify-center text-center shadow-sm">
            <div className="w-12 h-12 rounded-2xl bg-gray-50 dark:bg-zinc-800 flex items-center justify-center mb-3">
              {icon}
            </div>
            <p className="font-semibold text-gray-600 dark:text-gray-400 text-sm">{label}</p>
            <p className="text-xs mt-1.5 text-gray-300 dark:text-gray-600 max-w-[160px] leading-relaxed">
              Upload and analyze a dataset to populate this chart
            </p>
          </div>
        ))}
      </div>
    );
  }

  const countryData = compareCountries(demoDatasets, demoInsights);

  // Calculate risk distribution from demo insights
  const riskCounts = { Low: 0, Medium: 0, High: 0 };
  demoInsights.forEach(i => {
    const key = i.risk_level as keyof typeof riskCounts;
    if (key in riskCounts) riskCounts[key]++;
  });
  const total = demoInsights.length;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* Comparison Chart */}
      <ComparisonChart countryDataList={countryData} />

      {/* Risk Distribution */}
      <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-gray-100 dark:border-zinc-800 p-6 shadow-sm flex flex-col">
        <div className="flex items-center gap-2 mb-6">
          <div className="p-2 bg-rose-50 dark:bg-rose-900/20 rounded-lg text-rose-600 dark:text-rose-400">
            <AlertTriangle size={18} />
          </div>
          <h3 className="font-semibold text-base text-gray-900 dark:text-white">Market Risk Distribution</h3>
        </div>

        {/* Bar chart */}
        <div className="space-y-4 flex-1">
          {(Object.entries(riskCounts) as [keyof typeof RISK_CONFIG, number][]).map(([level, count]) => {
            const pct = total > 0 ? Math.round((count / total) * 100) : 0;
            const cfg = RISK_CONFIG[level];
            return (
              <div key={level}>
                <div className="flex items-center justify-between mb-1.5">
                  <div className="flex items-center gap-2">
                    <span className={`w-2 h-2 rounded-full ${cfg.color}`} />
                    <span className={`text-sm font-medium ${cfg.textColor}`}>{cfg.label}</span>
                  </div>
                  <span className="text-sm font-bold text-gray-700 dark:text-gray-300">
                    {count} <span className="font-normal text-gray-400">({pct}%)</span>
                  </span>
                </div>
                <div className="w-full bg-gray-100 dark:bg-zinc-800 rounded-full h-2.5 overflow-hidden">
                  <div
                    className={`h-2.5 rounded-full ${cfg.color} transition-all duration-700`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>

        {/* Legend */}
        <div className="mt-6 pt-5 border-t border-gray-100 dark:border-zinc-800 grid grid-cols-3 gap-3">
          {(Object.entries(riskCounts) as [keyof typeof RISK_CONFIG, number][]).map(([level, count]) => {
            const cfg = RISK_CONFIG[level];
            return (
              <div key={level} className={`${cfg.bg} rounded-xl p-3 text-center`}>
                <p className={`text-xl font-black ${cfg.textColor}`}>{count}</p>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{level}</p>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
