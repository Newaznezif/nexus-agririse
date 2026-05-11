"use client";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend
} from 'recharts';
import { CountryData } from '@/services/comparison';
import { BarChart3 } from 'lucide-react';

interface ComparisonChartProps {
  countryDataList: CountryData[];
}

const COUNTRY_COLORS: Record<string, { datasets: string; insights: string }> = {
  'Ethiopia': { datasets: '#059669', insights: '#34d399' },
  'Rwanda':   { datasets: '#3b82f6', insights: '#93c5fd' },
  'Central African Republic': { datasets: '#f59e0b', insights: '#fcd34d' },
};

const DEFAULT_COLORS = { datasets: '#6b7280', insights: '#9ca3af' };

const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white dark:bg-zinc-900 border border-gray-100 dark:border-zinc-700 rounded-xl shadow-lg p-3 text-xs">
      <p className="font-bold text-gray-900 dark:text-white mb-2">{label}</p>
      {payload.map((entry: any) => (
        <div key={entry.name} className="flex items-center gap-2 mb-1">
          <span className="w-2 h-2 rounded-full" style={{ background: entry.fill }} />
          <span className="text-gray-500">{entry.name}:</span>
          <span className="font-semibold text-gray-800 dark:text-gray-200">{entry.value}</span>
        </div>
      ))}
    </div>
  );
};

export const ComparisonChart = ({ countryDataList }: ComparisonChartProps) => {
  const chartData = countryDataList.map((c) => ({
    country: c.country === 'Central African Republic' ? 'CAR' : c.country,
    fullName: c.country,
    Datasets: c.datasetCount,
    'AI Insights': c.insights.length,
    colors: COUNTRY_COLORS[c.country] || DEFAULT_COLORS,
  }));

  const hasData = chartData.some(d => d.Datasets > 0 || d['AI Insights'] > 0);

  if (!hasData) {
    return (
      <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-dashed border-gray-200 dark:border-zinc-700 p-10 flex flex-col items-center justify-center text-center gap-3 shadow-sm">
        <div className="w-12 h-12 rounded-2xl bg-gray-50 dark:bg-zinc-800 flex items-center justify-center">
          <BarChart3 size={20} className="text-gray-300" />
        </div>
        <p className="text-sm font-medium text-gray-500">No comparison data yet</p>
        <p className="text-xs text-gray-300 dark:text-gray-600 max-w-[200px] leading-relaxed">
          Upload datasets from multiple countries to generate this chart.
        </p>
      </div>
    );
  }

  return (
    <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-gray-100 dark:border-zinc-800 shadow-sm p-6">
      <div className="flex items-center gap-2 mb-6">
        <div className="p-2 bg-blue-50 dark:bg-blue-900/20 rounded-lg text-blue-600 dark:text-blue-400">
          <BarChart3 size={18} />
        </div>
        <h3 className="font-semibold text-base text-gray-900 dark:text-white">Data Coverage by Country</h3>
      </div>
      <ResponsiveContainer width="100%" height={240}>
        <BarChart data={chartData} margin={{ top: 5, right: 10, left: -10, bottom: 5 }} barCategoryGap="30%">
          <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false} />
          <XAxis
            dataKey="country"
            tick={{ fontSize: 12, fill: '#6b7280' }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            tick={{ fontSize: 12, fill: '#6b7280' }}
            allowDecimals={false}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(0,0,0,0.03)' }} />
          <Legend
            iconType="circle"
            iconSize={8}
            wrapperStyle={{ fontSize: '12px', paddingTop: '16px' }}
          />
          <Bar dataKey="Datasets" fill="#059669" radius={[6, 6, 0, 0]} maxBarSize={40} />
          <Bar dataKey="AI Insights" fill="#a78bfa" radius={[6, 6, 0, 0]} maxBarSize={40} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
};
