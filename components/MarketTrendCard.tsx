"use client";
import { CountryData } from '@/services/comparison';
import { RiskBadge } from './RiskBadge';
import { Globe, Database, TrendingUp } from 'lucide-react';

const FLAG_MAP: Record<string, string> = {
  'Ethiopia': '🇪🇹',
  'Rwanda': '🇷🇼',
  'Central African Republic': '🇨🇫',
};

interface MarketTrendCardProps {
  countryData: CountryData;
}

export const MarketTrendCard = ({ countryData }: MarketTrendCardProps) => {
  const flag = FLAG_MAP[countryData.country] || '🌍';
  const hasData = countryData.datasetCount > 0;

  return (
    <div className={`bg-white dark:bg-zinc-900 rounded-xl border shadow-sm p-6 flex flex-col gap-4 transition-all hover:shadow-md
      ${hasData ? 'border-gray-100 dark:border-zinc-800' : 'border-dashed border-gray-200 dark:border-zinc-700 opacity-80'}`}>
      
      <div className="flex items-center gap-3">
        <span className="text-3xl">{flag}</span>
        <div>
          <h3 className="font-bold text-lg text-gray-900 dark:text-white">{countryData.country}</h3>
          <p className="text-xs text-gray-500">Regional Market Intelligence</p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="bg-gray-50 dark:bg-zinc-950 rounded-lg p-3">
          <div className="flex items-center gap-1 text-xs text-gray-500 mb-1">
            <Database size={12} /> Datasets
          </div>
          <span className="font-bold text-xl text-gray-900 dark:text-white">{countryData.datasetCount}</span>
        </div>
        <div className="bg-gray-50 dark:bg-zinc-950 rounded-lg p-3">
          <div className="flex items-center gap-1 text-xs text-gray-500 mb-1">
            <Globe size={12} /> Risk Level
          </div>
          {hasData ? <RiskBadge level={countryData.riskLevel} /> : <span className="text-xs text-gray-400">No data</span>}
        </div>
      </div>

      <div className="bg-gray-50 dark:bg-zinc-950 rounded-lg p-3">
        <div className="flex items-center gap-1 text-xs text-gray-500 mb-1">
          <TrendingUp size={12} /> Latest Market Trend
        </div>
        <p className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed line-clamp-3">
          {hasData ? countryData.latestTrend : 'Upload datasets for this country to see trends.'}
        </p>
      </div>
    </div>
  );
};
